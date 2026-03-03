"""Tests for LENS-007: Data import into MizukiPrism.

All tests are synchronous (no async patterns).
All file I/O uses tmp_path.
"""

from __future__ import annotations

import json
import sqlite3
from copy import deepcopy
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from mizukilens.importer import (
    ImportPlan,
    ImportResult,
    compute_import_plan,
    execute_import,
    load_mizukiprism_data,
    timestamp_to_seconds,
    validate_export_json,
    _max_id_number,
    _next_song_id,
    _next_stream_id,
    _make_performance_id,
)


# ===========================================================================
# Fixtures & helpers
# ===========================================================================

def _make_export_payload(
    streams: list[dict] | None = None,
    songs: list[dict] | None = None,
    versions: list[dict] | None = None,
) -> dict[str, Any]:
    """Build a minimal valid export payload."""
    return {
        "version": "1.0",
        "exportedAt": "2024-03-15T12:00:00Z",
        "source": "mizukilens",
        "channelId": "UCtest",
        "data": {
            "streams": streams or [],
            "songs": songs or [],
            "versions": versions or [],
        },
    }


_EXISTING_SONGS: list[dict] = [
    {
        "id": "song-1",
        "title": "First Love",
        "originalArtist": "宇多田光",
        "tags": ["抒情"],
        "performances": [
            {
                "id": "p1-1",
                "streamId": "stream-2023-10-15",
                "date": "2023-10-15",
                "streamTitle": "秋日歌回",
                "videoId": "_Q5-4yMi-xg",
                "timestamp": 120,
                "endTimestamp": None,
                "note": "",
            }
        ],
    },
    {
        "id": "song-2",
        "title": "Idol",
        "originalArtist": "YOASOBI",
        "tags": ["動漫歌"],
        "performances": [
            {
                "id": "p2-1",
                "streamId": "stream-2023-05-01",
                "date": "2023-05-01",
                "streamTitle": "五月病退散",
                "videoId": "ZRtdQ81jPUQ",
                "timestamp": 500,
                "endTimestamp": None,
                "note": "",
            }
        ],
    },
]

_EXISTING_STREAMS: list[dict] = [
    {
        "id": "stream-2023-10-15",
        "title": "秋日歌回",
        "date": "2023-10-15",
        "videoId": "_Q5-4yMi-xg",
        "youtubeUrl": "https://www.youtube.com/watch?v=_Q5-4yMi-xg",
    },
    {
        "id": "stream-2023-05-01",
        "title": "五月病退散",
        "date": "2023-05-01",
        "videoId": "ZRtdQ81jPUQ",
        "youtubeUrl": "https://www.youtube.com/watch?v=ZRtdQ81jPUQ",
    },
]


def _write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ===========================================================================
# SECTION 1: Timestamp conversion
# ===========================================================================

class TestTimestampConversion:
    """timestamp_to_seconds must handle H:MM:SS and MM:SS."""

    def test_hmmss_basic(self) -> None:
        assert timestamp_to_seconds("1:23:45") == 5025

    def test_hmmss_zero_hours(self) -> None:
        assert timestamp_to_seconds("0:03:20") == 200

    def test_hmmss_two_digit_hours(self) -> None:
        assert timestamp_to_seconds("01:23:45") == 5025

    def test_mmss_basic(self) -> None:
        assert timestamp_to_seconds("3:45") == 225

    def test_mmss_zero_minutes(self) -> None:
        assert timestamp_to_seconds("0:00") == 0

    def test_mmss_large(self) -> None:
        assert timestamp_to_seconds("23:45") == 1425

    def test_zero_timestamp(self) -> None:
        assert timestamp_to_seconds("0:00:00") == 0

    def test_whitespace_stripped(self) -> None:
        assert timestamp_to_seconds("  1:23:45  ") == 5025

    def test_invalid_raises(self) -> None:
        with pytest.raises(ValueError):
            timestamp_to_seconds("invalid")

    def test_single_part_raises(self) -> None:
        with pytest.raises(ValueError):
            timestamp_to_seconds("12345")


# ===========================================================================
# SECTION 2: JSON schema validation
# ===========================================================================

class TestValidateExportJson:
    """validate_export_json must accept valid payloads and reject invalid ones."""

    def test_valid_minimal_payload(self) -> None:
        payload = _make_export_payload()
        validate_export_json(payload)  # must not raise

    def test_valid_full_payload(self) -> None:
        payload = _make_export_payload(
            streams=[{"id": "vid001", "title": "Test", "date": "2024-03-15", "youtubeUrl": "..."}],
            songs=[{"id": "mlens-song-abc", "name": "Song A", "artist": "Artist", "tags": []}],
            versions=[{
                "id": "mlens-ver-xyz",
                "songId": "mlens-song-abc",
                "streamId": "vid001",
                "startTimestamp": "0:03:20",
            }],
        )
        validate_export_json(payload)  # must not raise

    def test_not_a_dict_raises(self) -> None:
        with pytest.raises(ValueError, match="JSON object"):
            validate_export_json([1, 2, 3])

    def test_missing_version_key_raises(self) -> None:
        payload = {"source": "mizukilens", "data": {"streams": [], "songs": [], "versions": []}}
        with pytest.raises(ValueError, match="version"):
            validate_export_json(payload)

    def test_missing_source_key_raises(self) -> None:
        payload = {"version": "1.0", "data": {"streams": [], "songs": [], "versions": []}}
        with pytest.raises(ValueError, match="source"):
            validate_export_json(payload)

    def test_missing_data_key_raises(self) -> None:
        payload = {"version": "1.0", "source": "mizukilens"}
        with pytest.raises(ValueError):
            validate_export_json(payload)

    def test_missing_data_streams_raises(self) -> None:
        payload = {"version": "1.0", "source": "mizukilens", "data": {"songs": [], "versions": []}}
        with pytest.raises(ValueError, match="streams"):
            validate_export_json(payload)

    def test_data_streams_not_array_raises(self) -> None:
        payload = {"version": "1.0", "source": "mizukilens", "data": {"streams": {}, "songs": [], "versions": []}}
        with pytest.raises(ValueError):
            validate_export_json(payload)

    def test_stream_missing_id_raises(self) -> None:
        payload = _make_export_payload(
            streams=[{"title": "Test", "date": "2024-01-01"}],
        )
        with pytest.raises(ValueError, match="id"):
            validate_export_json(payload)

    def test_stream_missing_title_raises(self) -> None:
        payload = _make_export_payload(
            streams=[{"id": "vid001", "date": "2024-01-01"}],
        )
        with pytest.raises(ValueError, match="title"):
            validate_export_json(payload)

    def test_stream_missing_date_raises(self) -> None:
        payload = _make_export_payload(
            streams=[{"id": "vid001", "title": "Test"}],
        )
        with pytest.raises(ValueError, match="date"):
            validate_export_json(payload)

    def test_song_missing_id_raises(self) -> None:
        payload = _make_export_payload(
            songs=[{"name": "Song A", "artist": "Artist"}],
        )
        with pytest.raises(ValueError, match="id"):
            validate_export_json(payload)

    def test_song_missing_name_raises(self) -> None:
        payload = _make_export_payload(
            songs=[{"id": "mlens-song-001", "artist": "Artist"}],
        )
        with pytest.raises(ValueError, match="name"):
            validate_export_json(payload)

    def test_version_missing_song_id_raises(self) -> None:
        payload = _make_export_payload(
            versions=[{
                "id": "mlens-ver-001",
                "streamId": "vid001",
                "startTimestamp": "0:01:00",
            }],
        )
        with pytest.raises(ValueError, match="songId"):
            validate_export_json(payload)

    def test_version_missing_start_timestamp_raises(self) -> None:
        payload = _make_export_payload(
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-001",
                "streamId": "vid001",
            }],
        )
        with pytest.raises(ValueError, match="startTimestamp"):
            validate_export_json(payload)


# ===========================================================================
# SECTION 3: ID generation
# ===========================================================================

class TestIdGeneration:
    """ID generators must follow MizukiPrism conventions."""

    def test_max_id_number_empty(self) -> None:
        assert _max_id_number([], "song") == 0

    def test_max_id_number_finds_max(self) -> None:
        entities = [{"id": "song-1"}, {"id": "song-3"}, {"id": "song-2"}]
        assert _max_id_number(entities, "song") == 3

    def test_max_id_number_ignores_wrong_prefix(self) -> None:
        entities = [{"id": "stream-5"}, {"id": "song-2"}]
        assert _max_id_number(entities, "song") == 2

    def test_next_stream_id_empty(self) -> None:
        assert _next_stream_id([], "2024-01-15") == "stream-2024-01-15"

    def test_next_stream_id_no_collision(self) -> None:
        existing = [{"id": "stream-2024-01-01"}]
        assert _next_stream_id(existing, "2024-01-15") == "stream-2024-01-15"

    def test_next_stream_id_same_day_collision(self) -> None:
        existing = [{"id": "stream-2024-01-15"}]
        assert _next_stream_id(existing, "2024-01-15") == "stream-2024-01-15-a"

    def test_next_stream_id_multi_collision(self) -> None:
        existing = [{"id": "stream-2024-01-15"}, {"id": "stream-2024-01-15-a"}]
        assert _next_stream_id(existing, "2024-01-15") == "stream-2024-01-15-b"

    def test_next_song_id_empty(self) -> None:
        assert _next_song_id([]) == "song-1"

    def test_next_song_id_continues_from_max(self) -> None:
        existing = [{"id": "song-1"}, {"id": "song-5"}]
        assert _next_song_id(existing) == "song-6"

    def test_performance_id_format(self) -> None:
        assert _make_performance_id(1, 1) == "p1-1"
        assert _make_performance_id(3, 2) == "p3-2"
        assert _make_performance_id(10, 5) == "p10-5"

    def test_next_song_id_multiple_new_songs(self) -> None:
        """When importing multiple new songs, each gets a unique incremented ID."""
        existing = [{"id": "song-5"}]
        payload = _make_export_payload(
            streams=[{"id": "vid001", "title": "T", "date": "2024-01-01"}],
            songs=[
                {"id": "mlens-song-aaa", "name": "Song A", "artist": "A", "tags": []},
                {"id": "mlens-song-bbb", "name": "Song B", "artist": "B", "tags": []},
            ],
            versions=[
                {
                    "id": "mlens-ver-001",
                    "songId": "mlens-song-aaa",
                    "streamId": "vid001",
                    "startTimestamp": "0:01:00",
                },
            ],
        )
        plan = compute_import_plan(payload, existing, [])
        song_ids = [s["id"] for s in plan.new_songs]
        assert "song-6" in song_ids
        assert "song-7" in song_ids
        assert len(set(song_ids)) == 2  # all unique


# ===========================================================================
# SECTION 4: Field mapping
# ===========================================================================

class TestFieldMapping:
    """Import must apply correct field transformations per §3.1.6."""

    def test_name_maps_to_title(self) -> None:
        payload = _make_export_payload(
            streams=[{"id": "vid001", "title": "Test Stream", "date": "2024-01-01"}],
            songs=[{"id": "mlens-song-001", "name": "Lemon", "artist": "米津玄師", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-001",
                "streamId": "vid001",
                "startTimestamp": "0:03:20",
            }],
        )
        plan = compute_import_plan(payload, [], [])
        assert len(plan.new_songs) == 1
        assert plan.new_songs[0]["title"] == "Lemon"

    def test_artist_maps_to_original_artist(self) -> None:
        payload = _make_export_payload(
            streams=[{"id": "vid001", "title": "Test Stream", "date": "2024-01-01"}],
            songs=[{"id": "mlens-song-001", "name": "Lemon", "artist": "米津玄師", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-001",
                "streamId": "vid001",
                "startTimestamp": "0:03:20",
            }],
        )
        plan = compute_import_plan(payload, [], [])
        assert plan.new_songs[0]["originalArtist"] == "米津玄師"

    def test_start_timestamp_string_to_seconds(self) -> None:
        payload = _make_export_payload(
            streams=[{"id": "vid001", "title": "T", "date": "2024-01-01"}],
            songs=[{"id": "mlens-song-001", "name": "Song", "artist": "A", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-001",
                "streamId": "vid001",
                "startTimestamp": "1:23:45",
            }],
        )
        plan = compute_import_plan(payload, [], [])
        perf = plan.new_songs[0]["performances"][0]
        assert perf["timestamp"] == 5025

    def test_end_timestamp_string_to_seconds(self) -> None:
        payload = _make_export_payload(
            streams=[{"id": "vid001", "title": "T", "date": "2024-01-01"}],
            songs=[{"id": "mlens-song-001", "name": "Song", "artist": "A", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-001",
                "streamId": "vid001",
                "startTimestamp": "0:03:20",
                "endTimestamp": "0:08:15",
            }],
        )
        plan = compute_import_plan(payload, [], [])
        perf = plan.new_songs[0]["performances"][0]
        assert perf["endTimestamp"] == 495  # 8*60+15

    def test_end_timestamp_null_when_absent(self) -> None:
        payload = _make_export_payload(
            streams=[{"id": "vid001", "title": "T", "date": "2024-01-01"}],
            songs=[{"id": "mlens-song-001", "name": "Song", "artist": "A", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-001",
                "streamId": "vid001",
                "startTimestamp": "0:03:20",
            }],
        )
        plan = compute_import_plan(payload, [], [])
        perf = plan.new_songs[0]["performances"][0]
        assert perf["endTimestamp"] is None

    def test_versions_embedded_in_song_performances(self) -> None:
        """Versions must be embedded inside Song.performances[], not standalone."""
        payload = _make_export_payload(
            streams=[{"id": "vid001", "title": "T", "date": "2024-01-01"}],
            songs=[{"id": "mlens-song-001", "name": "Song", "artist": "A", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-001",
                "streamId": "vid001",
                "startTimestamp": "0:03:20",
            }],
        )
        plan = compute_import_plan(payload, [], [])
        song = plan.new_songs[0]
        assert "performances" in song
        assert len(song["performances"]) == 1

    def test_performance_has_denormalized_fields(self) -> None:
        """Performance must have date, streamTitle, videoId from Stream."""
        payload = _make_export_payload(
            streams=[{"id": "vid_abc", "title": "My Stream", "date": "2024-03-15"}],
            songs=[{"id": "mlens-song-001", "name": "Song", "artist": "A", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-001",
                "streamId": "vid_abc",
                "startTimestamp": "0:01:00",
            }],
        )
        plan = compute_import_plan(payload, [], [])
        perf = plan.new_songs[0]["performances"][0]
        assert perf["date"] == "2024-03-15"
        assert perf["streamTitle"] == "My Stream"
        assert perf["videoId"] == "vid_abc"


# ===========================================================================
# SECTION 5: Song matching
# ===========================================================================

class TestSongMatching:
    """Existing songs must get new performances instead of duplicates."""

    def test_existing_song_gets_new_performance(self) -> None:
        existing_songs = deepcopy(_EXISTING_SONGS)
        existing_streams = deepcopy(_EXISTING_STREAMS)

        payload = _make_export_payload(
            streams=[{"id": "vid_new", "title": "New Stream", "date": "2024-06-01"}],
            songs=[{"id": "mlens-song-abc", "name": "First Love", "artist": "宇多田光", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-abc",
                "streamId": "vid_new",
                "startTimestamp": "0:05:00",
            }],
        )
        plan = compute_import_plan(payload, existing_songs, existing_streams)

        # No new songs should be created
        assert plan.new_song_count == 0
        # The updated song should appear
        assert plan.updated_songs
        updated = plan.updated_songs[0]
        assert updated["title"] == "First Love"

    def test_existing_song_not_duplicated(self) -> None:
        existing_songs = deepcopy(_EXISTING_SONGS)
        existing_streams = deepcopy(_EXISTING_STREAMS)

        payload = _make_export_payload(
            streams=[{"id": "vid_new", "title": "New Stream", "date": "2024-06-01"}],
            songs=[{"id": "mlens-song-abc", "name": "Idol", "artist": "YOASOBI", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-abc",
                "streamId": "vid_new",
                "startTimestamp": "0:02:00",
            }],
        )
        plan = compute_import_plan(payload, existing_songs, existing_streams)

        # Count songs with title "Idol" in merged result
        idol_songs = [s for s in plan._merged_songs if s["title"] == "Idol"]
        assert len(idol_songs) == 1, "Existing song must not be duplicated"

    def test_new_song_not_in_existing(self) -> None:
        existing_songs = deepcopy(_EXISTING_SONGS)
        existing_streams = deepcopy(_EXISTING_STREAMS)

        payload = _make_export_payload(
            streams=[{"id": "vid_new", "title": "New Stream", "date": "2024-06-01"}],
            songs=[{"id": "mlens-song-abc", "name": "Brand New Song", "artist": "New Artist", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-abc",
                "streamId": "vid_new",
                "startTimestamp": "0:02:00",
            }],
        )
        plan = compute_import_plan(payload, existing_songs, existing_streams)

        assert plan.new_song_count == 1
        assert plan.new_songs[0]["title"] == "Brand New Song"

    def test_performance_added_to_correct_existing_song(self) -> None:
        """Performance must be added to the exact matched song, not another."""
        existing_songs = deepcopy(_EXISTING_SONGS)
        existing_streams = deepcopy(_EXISTING_STREAMS)

        payload = _make_export_payload(
            streams=[{"id": "vid_new2", "title": "New Stream 2", "date": "2024-07-01"}],
            songs=[{"id": "mlens-song-yyy", "name": "Idol", "artist": "YOASOBI", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-yyy",
                "streamId": "vid_new2",
                "startTimestamp": "0:10:00",
            }],
        )
        plan = compute_import_plan(payload, existing_songs, existing_streams)

        # Find the Idol song in merged result
        idol_song = next(s for s in plan._merged_songs if s["title"] == "Idol")
        # Should now have 2 performances (1 original + 1 new)
        assert len(idol_song["performances"]) == 2


# ===========================================================================
# SECTION 6: Stream ID generation
# ===========================================================================

class TestStreamIdGeneration:
    """Stream IDs must follow 'stream-{YYYY-MM-DD}' date-based format."""

    def test_new_stream_id_uses_date(self) -> None:
        existing_streams = deepcopy(_EXISTING_STREAMS)
        payload = _make_export_payload(
            streams=[{"id": "new_vid_001", "title": "New", "date": "2024-01-01"}],
            songs=[],
            versions=[],
        )
        plan = compute_import_plan(payload, [], existing_streams)

        assert plan.new_stream_count == 1
        assert plan.new_streams[0]["id"] == "stream-2024-01-01"

    def test_new_stream_contains_youtube_video_id(self) -> None:
        payload = _make_export_payload(
            streams=[{"id": "abc123xyz", "title": "New Stream", "date": "2024-01-01"}],
            songs=[],
            versions=[],
        )
        plan = compute_import_plan(payload, [], [])
        assert plan.new_streams[0]["videoId"] == "abc123xyz"

    def test_new_stream_has_youtube_url(self) -> None:
        payload = _make_export_payload(
            streams=[{"id": "abc123xyz", "title": "New Stream", "date": "2024-01-01"}],
            songs=[],
            versions=[],
        )
        plan = compute_import_plan(payload, [], [])
        assert plan.new_streams[0]["youtubeUrl"] == "https://www.youtube.com/watch?v=abc123xyz"

    def test_multiple_new_streams_get_date_based_ids(self) -> None:
        payload = _make_export_payload(
            streams=[
                {"id": "vid_001", "title": "Stream 1", "date": "2024-01-01"},
                {"id": "vid_002", "title": "Stream 2", "date": "2024-01-02"},
            ],
            songs=[],
            versions=[],
        )
        existing_streams = [{"id": "stream-2023-12-25"}]
        plan = compute_import_plan(payload, [], existing_streams)

        new_ids = {s["id"] for s in plan.new_streams}
        assert "stream-2024-01-01" in new_ids
        assert "stream-2024-01-02" in new_ids

    def test_same_day_streams_get_suffix(self) -> None:
        payload = _make_export_payload(
            streams=[
                {"id": "vid_001", "title": "Morning", "date": "2024-01-01"},
                {"id": "vid_002", "title": "Evening", "date": "2024-01-01"},
            ],
            songs=[],
            versions=[],
        )
        plan = compute_import_plan(payload, [], [])

        new_ids = [s["id"] for s in plan.new_streams]
        assert new_ids[0] == "stream-2024-01-01"
        assert new_ids[1] == "stream-2024-01-01-a"


# ===========================================================================
# SECTION 7: Stream conflict detection
# ===========================================================================

class TestStreamConflictDetection:
    """Streams with existing videoId must be flagged as conflicts."""

    def test_existing_video_id_triggers_conflict(self) -> None:
        existing_streams = deepcopy(_EXISTING_STREAMS)  # has videoId "_Q5-4yMi-xg"

        payload = _make_export_payload(
            streams=[{"id": "_Q5-4yMi-xg", "title": "Duplicate", "date": "2024-01-01"}],
        )
        plan = compute_import_plan(payload, [], existing_streams)

        assert len(plan.conflicts) == 1
        assert plan.conflicts[0].video_id == "_Q5-4yMi-xg"
        assert plan.conflicts[0].existing_stream_id == "stream-2023-10-15"

    def test_conflict_is_not_added_to_new_streams(self) -> None:
        existing_streams = deepcopy(_EXISTING_STREAMS)

        payload = _make_export_payload(
            streams=[{"id": "_Q5-4yMi-xg", "title": "Duplicate", "date": "2024-01-01"}],
        )
        plan = compute_import_plan(payload, [], existing_streams)

        assert plan.new_stream_count == 0
        # Conflict stream should not appear in new_streams
        new_video_ids = {s.get("videoId") for s in plan.new_streams}
        assert "_Q5-4yMi-xg" not in new_video_ids

    def test_conflict_performances_excluded_from_plan(self) -> None:
        """Performances for conflicted streams should not appear in the plan by default."""
        existing_streams = deepcopy(_EXISTING_STREAMS)
        existing_songs = deepcopy(_EXISTING_SONGS)

        payload = _make_export_payload(
            streams=[{"id": "_Q5-4yMi-xg", "title": "Conflict Stream", "date": "2024-01-01"}],
            songs=[{"id": "mlens-song-abc", "name": "New Song", "artist": "Artist", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-abc",
                "streamId": "_Q5-4yMi-xg",
                "startTimestamp": "0:01:00",
            }],
        )
        plan = compute_import_plan(payload, existing_songs, existing_streams)

        # The new song exists but should have no performances (conflicted stream)
        new_song = plan.new_songs[0] if plan.new_songs else None
        if new_song:
            assert len(new_song.get("performances", [])) == 0

    def test_non_conflicting_stream_has_no_conflict(self) -> None:
        existing_streams = deepcopy(_EXISTING_STREAMS)

        payload = _make_export_payload(
            streams=[{"id": "brand_new_vid", "title": "Brand New", "date": "2024-01-01"}],
        )
        plan = compute_import_plan(payload, [], existing_streams)

        assert len(plan.conflicts) == 0
        assert plan.new_stream_count == 1

    def test_conflict_info_contains_correct_titles(self) -> None:
        existing_streams = deepcopy(_EXISTING_STREAMS)

        payload = _make_export_payload(
            streams=[{"id": "_Q5-4yMi-xg", "title": "Incoming Title", "date": "2024-01-01"}],
        )
        plan = compute_import_plan(payload, [], existing_streams)

        conflict = plan.conflicts[0]
        assert conflict.existing_stream_title == "秋日歌回"
        assert conflict.incoming_title == "Incoming Title"


# ===========================================================================
# SECTION 8: Load MizukiPrism data
# ===========================================================================

class TestLoadMizukiprismData:
    """load_mizukiprism_data must read and validate the data files."""

    def test_loads_valid_files(self, tmp_path: Path) -> None:
        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, _EXISTING_SONGS)
        _write_json(streams_path, _EXISTING_STREAMS)

        songs, streams = load_mizukiprism_data(songs_path, streams_path)
        assert len(songs) == 2
        assert len(streams) == 2

    def test_missing_songs_file_raises(self, tmp_path: Path) -> None:
        streams_path = tmp_path / "streams.json"
        _write_json(streams_path, _EXISTING_STREAMS)

        with pytest.raises(FileNotFoundError, match="songs"):
            load_mizukiprism_data(tmp_path / "songs.json", streams_path)

    def test_missing_streams_file_raises(self, tmp_path: Path) -> None:
        songs_path = tmp_path / "songs.json"
        _write_json(songs_path, _EXISTING_SONGS)

        with pytest.raises(FileNotFoundError, match="streams"):
            load_mizukiprism_data(songs_path, tmp_path / "streams.json")

    def test_invalid_json_raises(self, tmp_path: Path) -> None:
        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        songs_path.write_text("not valid json", encoding="utf-8")
        _write_json(streams_path, _EXISTING_STREAMS)

        with pytest.raises(ValueError, match="valid JSON"):
            load_mizukiprism_data(songs_path, streams_path)

    def test_non_array_songs_raises(self, tmp_path: Path) -> None:
        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, {"not": "array"})
        _write_json(streams_path, _EXISTING_STREAMS)

        with pytest.raises(ValueError, match="array"):
            load_mizukiprism_data(songs_path, streams_path)


# ===========================================================================
# SECTION 9: Backup file creation
# ===========================================================================

class TestBackupCreation:
    """execute_import must create .bak backup files before writing."""

    def test_backup_files_created(self, tmp_path: Path) -> None:
        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, _EXISTING_SONGS)
        _write_json(streams_path, _EXISTING_STREAMS)

        payload = _make_export_payload(
            streams=[{"id": "new_vid", "title": "New", "date": "2024-01-01"}],
        )
        plan = compute_import_plan(payload, deepcopy(_EXISTING_SONGS), deepcopy(_EXISTING_STREAMS))
        execute_import(plan, songs_path, streams_path)

        assert songs_path.with_suffix(".json.bak").exists()
        assert streams_path.with_suffix(".json.bak").exists()

    def test_backup_contains_original_data(self, tmp_path: Path) -> None:
        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, _EXISTING_SONGS)
        _write_json(streams_path, _EXISTING_STREAMS)

        payload = _make_export_payload(
            streams=[{"id": "new_vid", "title": "New", "date": "2024-01-01"}],
        )
        plan = compute_import_plan(payload, deepcopy(_EXISTING_SONGS), deepcopy(_EXISTING_STREAMS))
        execute_import(plan, songs_path, streams_path)

        bak_songs = json.loads(songs_path.with_suffix(".json.bak").read_text(encoding="utf-8"))
        assert len(bak_songs) == len(_EXISTING_SONGS)


# ===========================================================================
# SECTION 10: Output files remain valid JSON
# ===========================================================================

class TestOutputFilesValidJson:
    """Output files must remain valid JSON with correct structure after import."""

    def test_songs_json_valid_after_import(self, tmp_path: Path) -> None:
        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, deepcopy(_EXISTING_SONGS))
        _write_json(streams_path, deepcopy(_EXISTING_STREAMS))

        payload = _make_export_payload(
            streams=[{"id": "new_vid", "title": "New Stream", "date": "2024-06-01"}],
            songs=[{"id": "mlens-song-abc", "name": "Brand New", "artist": "Artist", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-abc",
                "streamId": "new_vid",
                "startTimestamp": "0:01:00",
            }],
        )
        plan = compute_import_plan(payload, deepcopy(_EXISTING_SONGS), deepcopy(_EXISTING_STREAMS))
        execute_import(plan, songs_path, streams_path)

        result_text = songs_path.read_text(encoding="utf-8")
        result_data = json.loads(result_text)
        assert isinstance(result_data, list)

    def test_streams_json_valid_after_import(self, tmp_path: Path) -> None:
        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, deepcopy(_EXISTING_SONGS))
        _write_json(streams_path, deepcopy(_EXISTING_STREAMS))

        payload = _make_export_payload(
            streams=[{"id": "new_vid", "title": "New Stream", "date": "2024-06-01"}],
        )
        plan = compute_import_plan(payload, deepcopy(_EXISTING_SONGS), deepcopy(_EXISTING_STREAMS))
        execute_import(plan, songs_path, streams_path)

        result_text = streams_path.read_text(encoding="utf-8")
        result_data = json.loads(result_text)
        assert isinstance(result_data, list)

    def test_songs_have_required_fields_after_import(self, tmp_path: Path) -> None:
        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, [])
        _write_json(streams_path, [])

        payload = _make_export_payload(
            streams=[{"id": "vid001", "title": "Test", "date": "2024-01-01"}],
            songs=[{"id": "mlens-song-abc", "name": "My Song", "artist": "Artist", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-abc",
                "streamId": "vid001",
                "startTimestamp": "0:01:00",
            }],
        )
        plan = compute_import_plan(payload, [], [])
        execute_import(plan, songs_path, streams_path)

        songs = json.loads(songs_path.read_text(encoding="utf-8"))
        assert len(songs) == 1
        song = songs[0]
        assert "id" in song
        assert "title" in song
        assert "originalArtist" in song
        assert "tags" in song
        assert "performances" in song

    def test_streams_have_required_fields_after_import(self, tmp_path: Path) -> None:
        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, [])
        _write_json(streams_path, [])

        payload = _make_export_payload(
            streams=[{"id": "vid001", "title": "Test Stream", "date": "2024-01-01"}],
        )
        plan = compute_import_plan(payload, [], [])
        execute_import(plan, songs_path, streams_path)

        streams = json.loads(streams_path.read_text(encoding="utf-8"))
        assert len(streams) == 1
        stream = streams[0]
        assert "id" in stream
        assert "title" in stream
        assert "date" in stream
        assert "videoId" in stream
        assert "youtubeUrl" in stream

    def test_no_internal_metadata_in_output(self, tmp_path: Path) -> None:
        """Internal keys like _new_perf_count must not appear in output files."""
        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, deepcopy(_EXISTING_SONGS))
        _write_json(streams_path, deepcopy(_EXISTING_STREAMS))

        payload = _make_export_payload(
            streams=[{"id": "vid_new", "title": "New", "date": "2024-06-01"}],
            songs=[{"id": "mlens-song-abc", "name": "First Love", "artist": "宇多田光", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-abc",
                "streamId": "vid_new",
                "startTimestamp": "0:05:00",
            }],
        )
        plan = compute_import_plan(payload, deepcopy(_EXISTING_SONGS), deepcopy(_EXISTING_STREAMS))
        execute_import(plan, songs_path, streams_path)

        songs = json.loads(songs_path.read_text(encoding="utf-8"))
        for song in songs:
            for key in song:
                assert not key.startswith("_"), f"Internal key found in output: {key!r}"


# ===========================================================================
# SECTION 11: Cache status update
# ===========================================================================

class TestCacheStatusUpdate:
    """execute_import must update cache status to 'imported' for imported streams."""

    def test_status_updated_to_imported_for_exported_stream(self, tmp_path: Path) -> None:
        from mizukilens.cache import open_db, upsert_stream, get_stream

        db_path = tmp_path / "test.db"
        conn = open_db(db_path)
        # Stream starts as exported
        upsert_stream(conn, video_id="vid001", status="approved", title="T", date="2024-01-01")
        from mizukilens.cache import update_stream_status
        update_stream_status(conn, "vid001", "exported")

        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, [])
        _write_json(streams_path, [])

        payload = _make_export_payload(
            streams=[{"id": "vid001", "title": "T", "date": "2024-01-01"}],
        )
        plan = compute_import_plan(payload, [], [])
        execute_import(plan, songs_path, streams_path, conn=conn)

        stream = get_stream(conn, "vid001")
        assert stream["status"] == "imported"
        conn.close()

    def test_status_updated_for_multiple_streams(self, tmp_path: Path) -> None:
        from mizukilens.cache import open_db, upsert_stream, get_stream, update_stream_status

        db_path = tmp_path / "test.db"
        conn = open_db(db_path)

        for vid in ["vid001", "vid002"]:
            upsert_stream(conn, video_id=vid, status="approved", title="T", date="2024-01-01")
            update_stream_status(conn, vid, "exported")

        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, [])
        _write_json(streams_path, [])

        payload = _make_export_payload(
            streams=[
                {"id": "vid001", "title": "T1", "date": "2024-01-01"},
                {"id": "vid002", "title": "T2", "date": "2024-01-02"},
            ],
        )
        plan = compute_import_plan(payload, [], [])
        execute_import(plan, songs_path, streams_path, conn=conn)

        for vid in ["vid001", "vid002"]:
            stream = get_stream(conn, vid)
            assert stream["status"] == "imported"
        conn.close()

    def test_stream_not_in_cache_doesnt_raise(self, tmp_path: Path) -> None:
        """execute_import must not fail if a video_id is not in the cache."""
        from mizukilens.cache import open_db

        db_path = tmp_path / "test.db"
        conn = open_db(db_path)

        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, [])
        _write_json(streams_path, [])

        payload = _make_export_payload(
            streams=[{"id": "vid_not_in_cache", "title": "T", "date": "2024-01-01"}],
        )
        plan = compute_import_plan(payload, [], [])
        # Should not raise
        execute_import(plan, songs_path, streams_path, conn=conn)
        conn.close()


# ===========================================================================
# SECTION 12: Performance ID conventions
# ===========================================================================

class TestPerformanceIdConventions:
    """Performance IDs must follow p{songIndex}-{performanceIndex} convention."""

    def test_first_performance_id(self) -> None:
        payload = _make_export_payload(
            streams=[{"id": "vid001", "title": "T", "date": "2024-01-01"}],
            songs=[{"id": "mlens-song-001", "name": "Song", "artist": "A", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-001",
                "streamId": "vid001",
                "startTimestamp": "0:01:00",
            }],
        )
        plan = compute_import_plan(payload, [], [])
        perf = plan.new_songs[0]["performances"][0]
        # song-1 is index 1, first performance is index 1
        assert perf["id"] == "p1-1"

    def test_performance_id_for_second_song(self) -> None:
        payload = _make_export_payload(
            streams=[{"id": "vid001", "title": "T", "date": "2024-01-01"}],
            songs=[
                {"id": "mlens-song-001", "name": "Song A", "artist": "A", "tags": []},
                {"id": "mlens-song-002", "name": "Song B", "artist": "B", "tags": []},
            ],
            versions=[
                {
                    "id": "mlens-ver-001",
                    "songId": "mlens-song-001",
                    "streamId": "vid001",
                    "startTimestamp": "0:01:00",
                },
                {
                    "id": "mlens-ver-002",
                    "songId": "mlens-song-002",
                    "streamId": "vid001",
                    "startTimestamp": "0:02:00",
                },
            ],
        )
        plan = compute_import_plan(payload, [], [])
        # Check second song's performance ID
        song_b = next(s for s in plan.new_songs if s["title"] == "Song B")
        perf = song_b["performances"][0]
        # song-2 has index 2
        assert perf["id"] == "p2-1"

    def test_performance_id_continues_from_existing(self) -> None:
        """New performances on existing songs must continue from existing count."""
        existing_songs = deepcopy(_EXISTING_SONGS)  # song-1 has 1 performance
        existing_streams = deepcopy(_EXISTING_STREAMS)

        payload = _make_export_payload(
            streams=[{"id": "vid_new", "title": "New", "date": "2024-06-01"}],
            songs=[{"id": "mlens-song-abc", "name": "First Love", "artist": "宇多田光", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-abc",
                "streamId": "vid_new",
                "startTimestamp": "0:05:00",
            }],
        )
        plan = compute_import_plan(payload, existing_songs, existing_streams)

        # song-1 already had 1 performance → new one should be p1-2
        first_love = next(s for s in plan._merged_songs if s["title"] == "First Love")
        new_perf = first_love["performances"][-1]
        assert new_perf["id"] == "p1-2"


# ===========================================================================
# SECTION 13: Full import round-trip
# ===========================================================================

class TestFullImportRoundTrip:
    """End-to-end tests using tmp_path for file I/O."""

    def test_new_song_appears_in_songs_json(self, tmp_path: Path) -> None:
        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, deepcopy(_EXISTING_SONGS))
        _write_json(streams_path, deepcopy(_EXISTING_STREAMS))

        payload = _make_export_payload(
            streams=[{"id": "brand_new_vid", "title": "Fresh Stream", "date": "2024-06-01"}],
            songs=[{"id": "mlens-song-aaa", "name": "Lemon", "artist": "米津玄師", "tags": ["J-POP"]}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-aaa",
                "streamId": "brand_new_vid",
                "startTimestamp": "0:03:20",
                "endTimestamp": "0:08:00",
            }],
        )
        plan = compute_import_plan(payload, deepcopy(_EXISTING_SONGS), deepcopy(_EXISTING_STREAMS))
        execute_import(plan, songs_path, streams_path)

        songs = json.loads(songs_path.read_text(encoding="utf-8"))
        titles = [s["title"] for s in songs]
        assert "Lemon" in titles

    def test_new_stream_appears_in_streams_json(self, tmp_path: Path) -> None:
        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, deepcopy(_EXISTING_SONGS))
        _write_json(streams_path, deepcopy(_EXISTING_STREAMS))

        payload = _make_export_payload(
            streams=[{"id": "brand_new_vid", "title": "Fresh Stream", "date": "2024-06-01"}],
        )
        plan = compute_import_plan(payload, deepcopy(_EXISTING_SONGS), deepcopy(_EXISTING_STREAMS))
        execute_import(plan, songs_path, streams_path)

        streams = json.loads(streams_path.read_text(encoding="utf-8"))
        video_ids = [s.get("videoId") for s in streams]
        assert "brand_new_vid" in video_ids

    def test_existing_data_preserved_after_import(self, tmp_path: Path) -> None:
        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, deepcopy(_EXISTING_SONGS))
        _write_json(streams_path, deepcopy(_EXISTING_STREAMS))

        payload = _make_export_payload(
            streams=[{"id": "brand_new_vid", "title": "Fresh Stream", "date": "2024-06-01"}],
            songs=[{"id": "mlens-song-aaa", "name": "New Song", "artist": "New", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-aaa",
                "streamId": "brand_new_vid",
                "startTimestamp": "0:01:00",
            }],
        )
        plan = compute_import_plan(payload, deepcopy(_EXISTING_SONGS), deepcopy(_EXISTING_STREAMS))
        execute_import(plan, songs_path, streams_path)

        songs = json.loads(songs_path.read_text(encoding="utf-8"))
        # Original songs should still be there
        titles = [s["title"] for s in songs]
        assert "First Love" in titles
        assert "Idol" in titles

    def test_import_result_counts_are_correct(self, tmp_path: Path) -> None:
        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, [])
        _write_json(streams_path, [])

        payload = _make_export_payload(
            streams=[{"id": "vid001", "title": "T", "date": "2024-01-01"}],
            songs=[{"id": "mlens-song-001", "name": "Song", "artist": "A", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-001",
                "streamId": "vid001",
                "startTimestamp": "0:01:00",
            }],
        )
        plan = compute_import_plan(payload, [], [])
        result = execute_import(plan, songs_path, streams_path)

        assert result.new_song_count == 1
        assert result.new_stream_count == 1
        assert result.new_version_count == 1

    def test_import_empty_payload_no_changes(self, tmp_path: Path) -> None:
        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, deepcopy(_EXISTING_SONGS))
        _write_json(streams_path, deepcopy(_EXISTING_STREAMS))

        payload = _make_export_payload()
        plan = compute_import_plan(payload, deepcopy(_EXISTING_SONGS), deepcopy(_EXISTING_STREAMS))
        result = execute_import(plan, songs_path, streams_path)

        assert result.new_song_count == 0
        assert result.new_stream_count == 0
        assert result.new_version_count == 0


# ===========================================================================
# SECTION 14: CLI import command
# ===========================================================================

class TestImportCli:
    """Test the 'import' CLI subcommand."""

    def test_import_no_file_shows_error(self) -> None:
        from click.testing import CliRunner
        from mizukilens.cli import main

        runner = CliRunner()
        result = runner.invoke(main, ["import"])
        assert result.exit_code != 0 or "エラー" in result.output or "FILE" in result.output

    def test_import_invalid_json_shows_error(self, tmp_path: Path) -> None:
        from click.testing import CliRunner
        from mizukilens.cli import main

        bad_file = tmp_path / "bad.json"
        bad_file.write_text("{ not valid json", encoding="utf-8")

        runner = CliRunner()
        result = runner.invoke(main, ["import", str(bad_file)])
        assert "エラー" in result.output or "JSON" in result.output

    def test_import_schema_validation_error(self, tmp_path: Path) -> None:
        from click.testing import CliRunner
        from mizukilens.cli import main

        bad_payload = {"version": "1.0"}  # missing required keys
        bad_file = tmp_path / "bad_schema.json"
        _write_json(bad_file, bad_payload)

        runner = CliRunner()
        result = runner.invoke(main, ["import", str(bad_file)])
        assert result.exit_code != 0 or "エラー" in result.output or "検証" in result.output

    def test_import_shows_change_summary(self, tmp_path: Path) -> None:
        from click.testing import CliRunner
        from mizukilens.cli import main

        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, [])
        _write_json(streams_path, [])

        payload = _make_export_payload(
            streams=[{"id": "vid001", "title": "T", "date": "2024-01-01"}],
            songs=[{"id": "mlens-song-001", "name": "Song", "artist": "A", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-001",
                "streamId": "vid001",
                "startTimestamp": "0:01:00",
            }],
        )
        import_file = tmp_path / "export.json"
        _write_json(import_file, payload)

        runner = CliRunner()
        result = runner.invoke(
            main,
            [
                "import",
                str(import_file),
                "--songs-file", str(songs_path),
                "--streams-file", str(streams_path),
            ],
            input="y\n",
            catch_exceptions=False,
        )

        # Change summary should mention the counts
        assert "新增" in result.output
        assert "首歌曲" in result.output or "場直播" in result.output or "個版本" in result.output

    def test_import_writes_data_files(self, tmp_path: Path) -> None:
        from click.testing import CliRunner
        from mizukilens.cli import main

        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, [])
        _write_json(streams_path, [])

        payload = _make_export_payload(
            streams=[{"id": "vid001", "title": "T", "date": "2024-01-01"}],
            songs=[{"id": "mlens-song-001", "name": "Song", "artist": "A", "tags": []}],
            versions=[{
                "id": "mlens-ver-001",
                "songId": "mlens-song-001",
                "streamId": "vid001",
                "startTimestamp": "0:01:00",
            }],
        )
        import_file = tmp_path / "export.json"
        _write_json(import_file, payload)

        runner = CliRunner()
        result = runner.invoke(
            main,
            [
                "import",
                str(import_file),
                "--songs-file", str(songs_path),
                "--streams-file", str(streams_path),
            ],
            input="y\n",
            catch_exceptions=False,
        )

        assert result.exit_code == 0
        songs = json.loads(songs_path.read_text(encoding="utf-8"))
        streams = json.loads(streams_path.read_text(encoding="utf-8"))
        assert len(songs) == 1
        assert len(streams) == 1

    def test_import_cancel_does_not_write(self, tmp_path: Path) -> None:
        from click.testing import CliRunner
        from mizukilens.cli import main

        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, [])
        _write_json(streams_path, [])

        payload = _make_export_payload(
            streams=[{"id": "vid001", "title": "T", "date": "2024-01-01"}],
        )
        import_file = tmp_path / "export.json"
        _write_json(import_file, payload)

        runner = CliRunner()
        result = runner.invoke(
            main,
            [
                "import",
                str(import_file),
                "--songs-file", str(songs_path),
                "--streams-file", str(streams_path),
            ],
            input="n\n",
            catch_exceptions=False,
        )

        assert result.exit_code == 0
        # Files should remain unchanged
        songs = json.loads(songs_path.read_text(encoding="utf-8"))
        streams = json.loads(streams_path.read_text(encoding="utf-8"))
        assert len(songs) == 0
        assert len(streams) == 0

    def test_import_conflict_skip_choice(self, tmp_path: Path) -> None:
        from click.testing import CliRunner
        from mizukilens.cli import main

        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, deepcopy(_EXISTING_SONGS))
        _write_json(streams_path, deepcopy(_EXISTING_STREAMS))

        # Use an existing videoId to trigger conflict
        payload = _make_export_payload(
            streams=[{"id": "_Q5-4yMi-xg", "title": "Conflict Stream", "date": "2024-01-01"}],
        )
        import_file = tmp_path / "export.json"
        _write_json(import_file, payload)

        runner = CliRunner()
        result = runner.invoke(
            main,
            [
                "import",
                str(import_file),
                "--songs-file", str(songs_path),
                "--streams-file", str(streams_path),
            ],
            # skip conflict, no new data → cancel
            input="skip\nn\n",
            catch_exceptions=False,
        )

        assert result.exit_code == 0
        assert "衝突" in result.output

    def test_import_creates_backup_files(self, tmp_path: Path) -> None:
        from click.testing import CliRunner
        from mizukilens.cli import main

        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, deepcopy(_EXISTING_SONGS))
        _write_json(streams_path, deepcopy(_EXISTING_STREAMS))

        payload = _make_export_payload(
            streams=[{"id": "new_vid_xyz", "title": "New", "date": "2024-06-01"}],
        )
        import_file = tmp_path / "export.json"
        _write_json(import_file, payload)

        runner = CliRunner()
        runner.invoke(
            main,
            [
                "import",
                str(import_file),
                "--songs-file", str(songs_path),
                "--streams-file", str(streams_path),
            ],
            input="y\n",
            catch_exceptions=False,
        )

        assert songs_path.with_suffix(".json.bak").exists()
        assert streams_path.with_suffix(".json.bak").exists()


# ===========================================================================
# SECTION: commentCredit → credit mapping (LENS-008)
# ===========================================================================


class TestCommentCreditImport:
    """Tests for commentCredit → credit field mapping on MizukiPrism streams."""

    def test_credit_mapped_from_comment_credit(self, tmp_path: Path) -> None:
        """commentCredit in export should become credit on MizukiPrism stream."""
        payload = _make_export_payload(
            streams=[{
                "id": "newVid1",
                "date": "2024-06-01",
                "title": "Attribution Test",
                "commentCredit": {
                    "author": "TimestampHero",
                    "authorUrl": "https://www.youtube.com/channel/UC123",
                    "commentUrl": "https://www.youtube.com/watch?v=newVid1&lc=Ugxyz",
                },
            }],
            songs=[{"id": "s1", "name": "TestSong", "artist": "TestArtist", "tags": []}],
            versions=[{
                "id": "v1",
                "songId": "s1",
                "streamId": "newVid1",
                "startTimestamp": "0:03:00",
            }],
        )

        plan = compute_import_plan(payload, deepcopy(_EXISTING_SONGS), deepcopy(_EXISTING_STREAMS))

        assert len(plan.new_streams) == 1
        new_stream = plan.new_streams[0]
        assert "credit" in new_stream
        assert new_stream["credit"]["author"] == "TimestampHero"
        assert new_stream["credit"]["authorUrl"] == "https://www.youtube.com/channel/UC123"
        assert new_stream["credit"]["commentUrl"] == "https://www.youtube.com/watch?v=newVid1&lc=Ugxyz"

    def test_no_credit_when_comment_credit_absent(self, tmp_path: Path) -> None:
        """Streams without commentCredit should have no credit field."""
        payload = _make_export_payload(
            streams=[{"id": "newVid2", "date": "2024-06-01", "title": "No Credit"}],
            songs=[{"id": "s1", "name": "TestSong", "artist": "TestArtist", "tags": []}],
            versions=[{
                "id": "v1",
                "songId": "s1",
                "streamId": "newVid2",
                "startTimestamp": "0:03:00",
            }],
        )

        plan = compute_import_plan(payload, deepcopy(_EXISTING_SONGS), deepcopy(_EXISTING_STREAMS))

        assert len(plan.new_streams) == 1
        assert "credit" not in plan.new_streams[0]

    def test_credit_partial_author_only(self) -> None:
        """commentCredit with only author (no URLs) should map correctly."""
        payload = _make_export_payload(
            streams=[{
                "id": "newVid3",
                "date": "2024-06-01",
                "title": "Partial Credit",
                "commentCredit": {"author": "JustAName"},
            }],
            songs=[{"id": "s1", "name": "TestSong", "artist": "TestArtist", "tags": []}],
            versions=[{
                "id": "v1",
                "songId": "s1",
                "streamId": "newVid3",
                "startTimestamp": "0:03:00",
            }],
        )

        plan = compute_import_plan(payload, deepcopy(_EXISTING_SONGS), deepcopy(_EXISTING_STREAMS))

        credit = plan.new_streams[0]["credit"]
        assert credit["author"] == "JustAName"
        assert "authorUrl" not in credit
        assert "commentUrl" not in credit

    def test_credit_written_to_file(self, tmp_path: Path) -> None:
        """Credit should persist through execute_import into streams.json."""
        payload = _make_export_payload(
            streams=[{
                "id": "newVid4",
                "date": "2024-06-01",
                "title": "File Credit",
                "commentCredit": {
                    "author": "FileHero",
                    "authorUrl": "https://www.youtube.com/channel/UC456",
                    "commentUrl": "https://www.youtube.com/watch?v=newVid4&lc=Ugabc",
                },
            }],
            songs=[{"id": "s1", "name": "TestSong", "artist": "TestArtist", "tags": []}],
            versions=[{
                "id": "v1",
                "songId": "s1",
                "streamId": "newVid4",
                "startTimestamp": "0:03:00",
            }],
        )

        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, deepcopy(_EXISTING_SONGS))
        _write_json(streams_path, deepcopy(_EXISTING_STREAMS))

        plan = compute_import_plan(payload, deepcopy(_EXISTING_SONGS), deepcopy(_EXISTING_STREAMS))
        execute_import(plan, songs_path, streams_path, payload=payload)

        written_streams = json.loads(streams_path.read_text(encoding="utf-8"))
        # Find the new stream
        new_stream = next(s for s in written_streams if s.get("videoId") == "newVid4")
        assert new_stream["credit"]["author"] == "FileHero"

    def test_validate_accepts_comment_credit(self) -> None:
        """Validator should not reject a payload with commentCredit."""
        payload = _make_export_payload(
            streams=[{
                "id": "vid1",
                "date": "2024-06-01",
                "title": "With Credit",
                "commentCredit": {
                    "author": "ValidUser",
                    "authorUrl": "https://youtube.com/channel/UC789",
                },
            }],
        )
        validate_export_json(payload)  # Should not raise

    def test_validate_rejects_invalid_comment_credit(self) -> None:
        """Validator should reject commentCredit without author."""
        payload = _make_export_payload(
            streams=[{
                "id": "vid1",
                "date": "2024-06-01",
                "title": "Bad Credit",
                "commentCredit": {"authorUrl": "https://youtube.com/channel/UC789"},
            }],
        )
        with pytest.raises(ValueError, match="commentCredit.author"):
            validate_export_json(payload)

    def test_old_export_without_comment_credit_imports_fine(self, tmp_path: Path) -> None:
        """Old export JSON without commentCredit should import without issues."""
        payload = _make_export_payload(
            streams=[{"id": "oldVid1", "date": "2024-01-01", "title": "Legacy Stream"}],
            songs=[{"id": "s1", "name": "OldSong", "artist": "OldArtist", "tags": []}],
            versions=[{
                "id": "v1",
                "songId": "s1",
                "streamId": "oldVid1",
                "startTimestamp": "0:01:00",
            }],
        )

        songs_path = tmp_path / "songs.json"
        streams_path = tmp_path / "streams.json"
        _write_json(songs_path, deepcopy(_EXISTING_SONGS))
        _write_json(streams_path, deepcopy(_EXISTING_STREAMS))

        validate_export_json(payload)  # Should not raise
        plan = compute_import_plan(payload, deepcopy(_EXISTING_SONGS), deepcopy(_EXISTING_STREAMS))
        result = execute_import(plan, songs_path, streams_path, payload=payload)

        assert result.new_stream_count == 1
        written_streams = json.loads(streams_path.read_text(encoding="utf-8"))
        new_stream = next(s for s in written_streams if s.get("videoId") == "oldVid1")
        assert "credit" not in new_stream
