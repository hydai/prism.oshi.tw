"""Tests for LENS-006: Data export to MizukiPrism JSON format.

All tests are synchronous (no async patterns).
File I/O for the export directory is mocked via tmp_path.
"""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from mizukilens.cache import (
    get_parsed_songs,
    get_stream,
    open_db,
    update_stream_status,
    upsert_parsed_songs,
    upsert_stream,
)
from mizukilens.export import (
    ExportResult,
    _new_song_id,
    _new_version_id,
    _youtube_url,
    build_export_payload,
    export_approved_streams,
)


# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------

@pytest.fixture()
def db(tmp_path: Path) -> sqlite3.Connection:
    """In-process temp SQLite connection."""
    conn = open_db(tmp_path / "test_export.db")
    yield conn
    conn.close()


def _add_approved_stream(
    conn: sqlite3.Connection,
    video_id: str = "vid001",
    title: str = "Test Stream",
    date: str = "2024-03-15",
    channel_id: str = "UCtest",
    songs: list[dict[str, Any]] | None = None,
) -> None:
    """Insert an approved stream with optional songs into *conn*."""
    upsert_stream(
        conn,
        video_id=video_id,
        channel_id=channel_id,
        title=title,
        date=date,
        status="approved",
    )
    if songs:
        upsert_parsed_songs(conn, video_id, songs)


_SONG_A = {
    "order_index": 0,
    "song_name": "Lemon",
    "artist": "米津玄師",
    "start_timestamp": "0:03:20",
    "end_timestamp": "0:08:15",
    "note": None,
}

_SONG_B = {
    "order_index": 1,
    "song_name": "打上花火",
    "artist": "DAOKO×米津玄師",
    "start_timestamp": "0:08:15",
    "end_timestamp": None,
    "note": "清唱版",
}


# ===========================================================================
# SECTION 1: ID format
# ===========================================================================

class TestIdFormat:
    """ID generators must match the spec format."""

    def test_song_id_prefix(self) -> None:
        sid = _new_song_id()
        assert sid.startswith("mlens-song-"), f"Got: {sid}"

    def test_song_id_suffix_is_8_hex_chars(self) -> None:
        sid = _new_song_id()
        suffix = sid.removeprefix("mlens-song-")
        assert re.fullmatch(r"[0-9a-f]{8}", suffix), f"Got: {suffix}"

    def test_version_id_prefix(self) -> None:
        vid = _new_version_id()
        assert vid.startswith("mlens-ver-"), f"Got: {vid}"

    def test_version_id_suffix_is_8_hex_chars(self) -> None:
        vid = _new_version_id()
        suffix = vid.removeprefix("mlens-ver-")
        assert re.fullmatch(r"[0-9a-f]{8}", suffix), f"Got: {suffix}"

    def test_song_ids_are_unique(self) -> None:
        ids = {_new_song_id() for _ in range(20)}
        assert len(ids) == 20, "IDs should be unique"

    def test_version_ids_are_unique(self) -> None:
        ids = {_new_version_id() for _ in range(20)}
        assert len(ids) == 20, "IDs should be unique"


# ===========================================================================
# SECTION 2: Top-level JSON structure
# ===========================================================================

class TestTopLevelStructure:
    """The exported JSON must match the §4.3.1 top-level contract."""

    def test_top_level_keys_present(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(
            db, output_dir=tmp_path / "exports", channel_id="UCtest"
        )
        with result.output_path.open() as fh:
            data = json.load(fh)
        for key in ("version", "exportedAt", "source", "channelId", "data"):
            assert key in data, f"Missing key: {key}"

    def test_version_is_1_0(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        assert data["version"] == "1.0"

    def test_source_is_mizukilens(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        assert data["source"] == "mizukilens"

    def test_channel_id_is_embedded(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCsomechannel")
        with result.output_path.open() as fh:
            data = json.load(fh)
        assert data["channelId"] == "UCsomechannel"

    def test_exported_at_is_utc_iso8601(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        exported_at = data["exportedAt"]
        # Must end in "Z" and be parseable
        assert exported_at.endswith("Z"), f"exportedAt should end in Z: {exported_at}"
        # Should be parseable as datetime
        datetime.fromisoformat(exported_at.replace("Z", "+00:00"))

    def test_data_has_three_arrays(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        assert "streams" in data["data"]
        assert "songs" in data["data"]
        assert "versions" in data["data"]
        assert isinstance(data["data"]["streams"], list)
        assert isinstance(data["data"]["songs"], list)
        assert isinstance(data["data"]["versions"], list)


# ===========================================================================
# SECTION 3: Stream entities
# ===========================================================================

class TestStreamEntity:
    """Each exported stream must have the correct fields."""

    def test_stream_id_is_youtube_video_id(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, video_id="abc123", songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        stream = data["data"]["streams"][0]
        assert stream["id"] == "abc123"

    def test_stream_youtube_url(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, video_id="abc123", songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        stream = data["data"]["streams"][0]
        assert stream["youtubeUrl"] == "https://www.youtube.com/watch?v=abc123"

    def test_stream_date(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, video_id="abc123", date="2024-05-20", songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        stream = data["data"]["streams"][0]
        assert stream["date"] == "2024-05-20"

    def test_stream_title(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, video_id="abc123", title="歌回 Vol.12", songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        stream = data["data"]["streams"][0]
        assert stream["title"] == "歌回 Vol.12"

    def test_stream_entity_has_all_required_fields(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        stream = data["data"]["streams"][0]
        for field in ("id", "youtubeUrl", "date", "title"):
            assert field in stream, f"Stream missing field: {field}"


# ===========================================================================
# SECTION 4: Song entities
# ===========================================================================

class TestSongEntity:
    """Each exported song must have the correct fields and format."""

    def test_song_id_format(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        song = data["data"]["songs"][0]
        assert re.fullmatch(r"mlens-song-[0-9a-f]{8}", song["id"]), f"Bad song id: {song['id']}"

    def test_song_name(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        song = data["data"]["songs"][0]
        assert song["name"] == "Lemon"

    def test_song_artist(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        song = data["data"]["songs"][0]
        assert song["artist"] == "米津玄師"

    def test_song_tags_defaults_to_empty_list(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        song = data["data"]["songs"][0]
        assert song["tags"] == []

    def test_song_has_all_required_fields(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        song = data["data"]["songs"][0]
        for field in ("id", "name", "artist", "tags"):
            assert field in song, f"Song missing field: {field}"


# ===========================================================================
# SECTION 5: Version entities
# ===========================================================================

class TestVersionEntity:
    """Each exported version must have the correct fields."""

    def test_version_id_format(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        ver = data["data"]["versions"][0]
        assert re.fullmatch(r"mlens-ver-[0-9a-f]{8}", ver["id"]), f"Bad version id: {ver['id']}"

    def test_version_song_id_references_song(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        song_ids = {s["id"] for s in data["data"]["songs"]}
        ver = data["data"]["versions"][0]
        assert ver["songId"] in song_ids

    def test_version_stream_id_is_youtube_video_id(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, video_id="myVideoId", songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        ver = data["data"]["versions"][0]
        assert ver["streamId"] == "myVideoId"

    def test_version_start_timestamp(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        ver = data["data"]["versions"][0]
        assert ver["startTimestamp"] == "0:03:20"

    def test_version_end_timestamp_present_when_set(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        ver = data["data"]["versions"][0]
        assert "endTimestamp" in ver
        assert ver["endTimestamp"] == "0:08:15"

    def test_version_end_timestamp_absent_when_none(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        """endTimestamp should be omitted (not null) when not set."""
        song_no_end = {
            "order_index": 0,
            "song_name": "Song X",
            "artist": "Artist X",
            "start_timestamp": "0:05:00",
            "end_timestamp": None,
            "note": None,
        }
        _add_approved_stream(db, songs=[song_no_end])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        ver = data["data"]["versions"][0]
        assert "endTimestamp" not in ver

    def test_version_note_present_when_set(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, songs=[_SONG_B])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        ver = data["data"]["versions"][0]
        assert "note" in ver
        assert ver["note"] == "清唱版"

    def test_version_note_absent_when_none(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        """note should be omitted when not set."""
        _add_approved_stream(db, songs=[_SONG_A])  # _SONG_A has note=None
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        ver = data["data"]["versions"][0]
        assert "note" not in ver

    def test_version_has_required_fields(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        ver = data["data"]["versions"][0]
        for required in ("id", "songId", "streamId", "startTimestamp"):
            assert required in ver, f"Version missing field: {required}"


# ===========================================================================
# SECTION 6: Song deduplication
# ===========================================================================

class TestSongDeduplication:
    """Same song (name + artist) across streams → single Song, multiple Versions."""

    def test_same_song_across_two_streams_yields_one_song_entity(
        self, db: sqlite3.Connection, tmp_path: Path
    ) -> None:
        same_song_1 = {**_SONG_A, "order_index": 0}
        same_song_2 = {**_SONG_A, "order_index": 0, "start_timestamp": "0:05:00", "end_timestamp": "0:10:00"}

        _add_approved_stream(db, video_id="vid001", songs=[same_song_1])
        _add_approved_stream(db, video_id="vid002", songs=[same_song_2])

        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)

        assert len(data["data"]["songs"]) == 1, "Should be deduplicated to 1 song"

    def test_same_song_yields_two_version_entities(
        self, db: sqlite3.Connection, tmp_path: Path
    ) -> None:
        same_song_1 = {**_SONG_A, "order_index": 0}
        same_song_2 = {**_SONG_A, "order_index": 0, "start_timestamp": "0:05:00", "end_timestamp": None}

        _add_approved_stream(db, video_id="vid001", songs=[same_song_1])
        _add_approved_stream(db, video_id="vid002", songs=[same_song_2])

        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)

        assert len(data["data"]["versions"]) == 2

    def test_both_versions_reference_same_song_id(
        self, db: sqlite3.Connection, tmp_path: Path
    ) -> None:
        same_song_1 = {**_SONG_A, "order_index": 0}
        same_song_2 = {**_SONG_A, "order_index": 0, "start_timestamp": "0:05:00", "end_timestamp": None}

        _add_approved_stream(db, video_id="vid001", songs=[same_song_1])
        _add_approved_stream(db, video_id="vid002", songs=[same_song_2])

        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)

        song_id = data["data"]["songs"][0]["id"]
        for ver in data["data"]["versions"]:
            assert ver["songId"] == song_id

    def test_different_songs_yields_two_song_entities(
        self, db: sqlite3.Connection, tmp_path: Path
    ) -> None:
        _add_approved_stream(db, video_id="vid001", songs=[_SONG_A, _SONG_B])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        assert len(data["data"]["songs"]) == 2

    def test_different_artist_same_name_yields_two_songs(
        self, db: sqlite3.Connection, tmp_path: Path
    ) -> None:
        """Same name but different artist → two Song entities."""
        song_v1 = {**_SONG_A, "order_index": 0, "artist": "Artist A"}
        song_v2 = {**_SONG_A, "order_index": 0, "artist": "Artist B", "start_timestamp": "0:10:00"}

        _add_approved_stream(db, video_id="vid001", songs=[song_v1])
        _add_approved_stream(db, video_id="vid002", songs=[song_v2])

        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)
        assert len(data["data"]["songs"]) == 2


# ===========================================================================
# SECTION 7: --since date filtering
# ===========================================================================

class TestSinceFilter:
    """Only streams approved after --since date should be exported."""

    def test_since_filters_older_stream(self, tmp_path: Path) -> None:
        """Stream updated before --since date is excluded."""
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)

        # Insert the stream as discovered first, then advance to approved
        upsert_stream(
            conn,
            video_id="old_vid",
            channel_id="UCtest",
            title="Old Stream",
            date="2024-01-01",
            status="discovered",
        )
        # Manually set an old updated_at by manipulating the DB directly
        conn.execute(
            "UPDATE streams SET status = 'approved', updated_at = '2024-01-15T00:00:00+00:00' WHERE video_id = 'old_vid'"
        )
        conn.commit()

        result_streams = []
        from mizukilens.export import _load_approved_streams
        rows = _load_approved_streams(conn, since="2024-02-01")
        assert len(rows) == 0, "Old stream should be excluded by --since"
        conn.close()

    def test_since_includes_stream_on_or_after(self, tmp_path: Path) -> None:
        """Stream updated on or after --since date is included."""
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)

        upsert_stream(
            conn,
            video_id="new_vid",
            channel_id="UCtest",
            title="New Stream",
            date="2024-03-01",
            status="discovered",
        )
        conn.execute(
            "UPDATE streams SET status = 'approved', updated_at = '2024-03-15T10:00:00+00:00' WHERE video_id = 'new_vid'"
        )
        conn.commit()

        from mizukilens.export import _load_approved_streams
        rows = _load_approved_streams(conn, since="2024-03-01")
        assert len(rows) == 1
        assert rows[0]["video_id"] == "new_vid"
        conn.close()

    def test_since_filters_only_old_keeps_new(self, tmp_path: Path) -> None:
        """When two streams exist, --since includes only the newer one."""
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)

        for vid, upd in [("old", "2024-01-10T00:00:00+00:00"), ("new", "2024-03-10T00:00:00+00:00")]:
            upsert_stream(conn, video_id=vid, channel_id="UCtest", title=f"Stream {vid}",
                          date="2024-01-01", status="discovered")
            conn.execute(
                "UPDATE streams SET status = 'approved', updated_at = ? WHERE video_id = ?",
                (upd, vid),
            )
        conn.commit()

        from mizukilens.export import _load_approved_streams
        rows = _load_approved_streams(conn, since="2024-02-01")
        assert len(rows) == 1
        assert rows[0]["video_id"] == "new"
        conn.close()


# ===========================================================================
# SECTION 8: --stream filtering
# ===========================================================================

class TestStreamFilter:
    """--stream VIDEO_ID should export only that specific stream."""

    def test_stream_filter_returns_only_target(
        self, db: sqlite3.Connection, tmp_path: Path
    ) -> None:
        _add_approved_stream(db, video_id="vid001", songs=[_SONG_A])
        _add_approved_stream(db, video_id="vid002", songs=[_SONG_B])

        result = export_approved_streams(
            db, stream_id="vid001", output_dir=tmp_path, channel_id="UCtest"
        )
        with result.output_path.open() as fh:
            data = json.load(fh)

        assert len(data["data"]["streams"]) == 1
        assert data["data"]["streams"][0]["id"] == "vid001"

    def test_stream_filter_excludes_other_streams(
        self, db: sqlite3.Connection, tmp_path: Path
    ) -> None:
        _add_approved_stream(db, video_id="vid001", songs=[_SONG_A])
        _add_approved_stream(db, video_id="vid002", songs=[_SONG_B])

        result = export_approved_streams(
            db, stream_id="vid002", output_dir=tmp_path, channel_id="UCtest"
        )
        with result.output_path.open() as fh:
            data = json.load(fh)

        stream_ids = [s["id"] for s in data["data"]["streams"]]
        assert "vid001" not in stream_ids

    def test_stream_filter_no_match_raises(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, video_id="vid001", songs=[_SONG_A])

        with pytest.raises(ValueError, match="no_approved_streams"):
            export_approved_streams(
                db, stream_id="nonexistent", output_dir=tmp_path, channel_id="UCtest"
            )

    def test_stream_filter_non_approved_raises(
        self, db: sqlite3.Connection, tmp_path: Path
    ) -> None:
        """A stream that exists but is not approved should raise."""
        upsert_stream(db, video_id="pending_vid", status="pending")
        with pytest.raises(ValueError, match="no_approved_streams"):
            export_approved_streams(
                db, stream_id="pending_vid", output_dir=tmp_path, channel_id="UCtest"
            )

    def test_re_export_already_exported_stream(
        self, db: sqlite3.Connection, tmp_path: Path
    ) -> None:
        """An already-exported stream can be re-exported with --stream."""
        upsert_stream(
            db,
            video_id="exported_vid",
            channel_id="UCtest",
            title="Exported Stream",
            date="2024-03-15",
            status="approved",
        )
        upsert_parsed_songs(db, "exported_vid", [_SONG_A])
        # First export transitions to "exported"
        export_approved_streams(
            db, stream_id="exported_vid", output_dir=tmp_path, channel_id="UCtest"
        )
        row = get_stream(db, "exported_vid")
        assert row["status"] == "exported"

        # Re-export with explicit --stream should succeed
        result = export_approved_streams(
            db, stream_id="exported_vid", output_dir=tmp_path, channel_id="UCtest"
        )
        assert result.stream_count == 1
        assert result.song_count == 1
        # Status should remain "exported"
        row = get_stream(db, "exported_vid")
        assert row["status"] == "exported"


# ===========================================================================
# SECTION 9: Empty approved list
# ===========================================================================

class TestEmptyApprovedList:
    """When no approved streams exist, export should raise ValueError."""

    def test_no_approved_streams_raises(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="no_approved_streams"):
            export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")

    def test_only_non_approved_streams_raises(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        upsert_stream(db, video_id="vid001", status="discovered")
        upsert_stream(db, video_id="vid002", status="extracted")
        upsert_stream(db, video_id="vid003", status="excluded")
        with pytest.raises(ValueError, match="no_approved_streams"):
            export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")


# ===========================================================================
# SECTION 10: Status transition to "exported"
# ===========================================================================

class TestStatusTransition:
    """After export, stream status must change from approved → exported."""

    def test_stream_status_becomes_exported(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, video_id="vid001", songs=[_SONG_A])
        export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")

        row = get_stream(db, "vid001")
        assert row is not None
        assert row["status"] == "exported"

    def test_multiple_streams_all_become_exported(
        self, db: sqlite3.Connection, tmp_path: Path
    ) -> None:
        _add_approved_stream(db, video_id="vid001", songs=[_SONG_A])
        _add_approved_stream(db, video_id="vid002", songs=[_SONG_B])
        export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")

        for vid in ("vid001", "vid002"):
            row = get_stream(db, vid)
            assert row is not None
            assert row["status"] == "exported", f"{vid} should be exported"


# ===========================================================================
# SECTION 11: Export summary / result object
# ===========================================================================

class TestExportResult:
    """ExportResult should carry accurate counts."""

    def test_result_stream_count(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, video_id="vid001", songs=[_SONG_A])
        _add_approved_stream(db, video_id="vid002", songs=[_SONG_B])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        assert result.stream_count == 2

    def test_result_song_count(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, video_id="vid001", songs=[_SONG_A, _SONG_B])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        assert result.song_count == 2

    def test_result_version_count(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, video_id="vid001", songs=[_SONG_A, _SONG_B])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        assert result.version_count == 2

    def test_result_dedup_reduces_song_count(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        """Same song in two streams → song_count=1 but version_count=2."""
        s1 = {**_SONG_A, "order_index": 0}
        s2 = {**_SONG_A, "order_index": 0, "start_timestamp": "0:10:00", "end_timestamp": None}
        _add_approved_stream(db, video_id="vid001", songs=[s1])
        _add_approved_stream(db, video_id="vid002", songs=[s2])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        assert result.song_count == 1
        assert result.version_count == 2

    def test_result_output_path_is_in_correct_directory(
        self, db: sqlite3.Connection, tmp_path: Path
    ) -> None:
        export_dir = tmp_path / "my_exports"
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=export_dir, channel_id="UCtest")
        assert result.output_path.parent == export_dir

    def test_result_output_path_filename_format(
        self, db: sqlite3.Connection, tmp_path: Path
    ) -> None:
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        name = result.output_path.name
        assert re.fullmatch(r"mizukilens-export-\d{4}-\d{2}-\d{2}-\d{6}\.json", name), (
            f"Unexpected filename: {name}"
        )

    def test_output_file_is_valid_json(self, db: sqlite3.Connection, tmp_path: Path) -> None:
        _add_approved_stream(db, songs=[_SONG_A])
        result = export_approved_streams(db, output_dir=tmp_path, channel_id="UCtest")
        with result.output_path.open() as fh:
            data = json.load(fh)  # should not raise
        assert isinstance(data, dict)


# ===========================================================================
# SECTION 12: CLI integration
# ===========================================================================

class TestExportCli:
    """Integration tests for the `mizukilens export` CLI command."""

    def _make_db_and_open(self, tmp_path: Path) -> sqlite3.Connection:
        db_path = tmp_path / "cli_test.db"
        return open_db(db_path)

    def test_export_no_approved_shows_message(self, tmp_path: Path) -> None:
        from click.testing import CliRunner
        from mizukilens.cli import main

        db_path = tmp_path / "cli.db"
        conn = open_db(db_path)
        conn.close()

        def mock_open_db(*args, **kwargs):
            return open_db(db_path)

        runner = CliRunner()
        with (
            patch("mizukilens.cache.open_db", side_effect=mock_open_db),
            patch("mizukilens.discovery.get_active_channel_info", return_value=("UCtest", [])),
        ):
            result = runner.invoke(main, ["export"])

        assert result.exit_code == 0
        assert "無可匯出的資料" in result.output

    def test_export_creates_file_and_shows_summary(self, tmp_path: Path) -> None:
        from click.testing import CliRunner
        from mizukilens.cli import main

        db_path = tmp_path / "cli.db"
        export_dir = tmp_path / "exports"
        conn = open_db(db_path)
        _add_approved_stream(conn, video_id="testVid", songs=[_SONG_A])
        conn.close()

        def mock_open_db(*args, **kwargs):
            return open_db(db_path)

        # Patch export to use our tmp_path as output_dir
        original_export = __import__(
            "mizukilens.export", fromlist=["export_approved_streams"]
        ).export_approved_streams

        def mock_export(conn, *, since=None, stream_id=None, output_dir=None, channel_id=""):
            return original_export(
                conn, since=since, stream_id=stream_id,
                output_dir=export_dir, channel_id=channel_id
            )

        runner = CliRunner()
        with (
            patch("mizukilens.cache.open_db", side_effect=mock_open_db),
            patch("mizukilens.discovery.get_active_channel_info", return_value=("UCtest", [])),
            patch("mizukilens.export.export_approved_streams", side_effect=mock_export),
        ):
            result = runner.invoke(main, ["export"])

        assert result.exit_code == 0
        assert "匯出完成" in result.output
        # Summary line should mention counts
        assert "1" in result.output  # at least 1 stream

    def test_export_since_flag_passed_through(self, tmp_path: Path) -> None:
        from click.testing import CliRunner
        from mizukilens.cli import main

        db_path = tmp_path / "cli.db"
        conn = open_db(db_path)
        conn.close()

        captured_since = {}

        def mock_export(conn, *, since=None, stream_id=None, output_dir=None, channel_id=""):
            captured_since["since"] = since
            raise ValueError("no_approved_streams")

        def mock_open_db(*args, **kwargs):
            return open_db(db_path)

        runner = CliRunner()
        with (
            patch("mizukilens.cache.open_db", side_effect=mock_open_db),
            patch("mizukilens.discovery.get_active_channel_info", return_value=("UCtest", [])),
            patch("mizukilens.export.export_approved_streams", side_effect=mock_export),
        ):
            result = runner.invoke(main, ["export", "--since", "2024-03-01"])

        assert captured_since.get("since") == "2024-03-01"

    def test_export_stream_flag_passed_through(self, tmp_path: Path) -> None:
        from click.testing import CliRunner
        from mizukilens.cli import main

        db_path = tmp_path / "cli.db"
        conn = open_db(db_path)
        conn.close()

        captured_stream = {}

        def mock_export(conn, *, since=None, stream_id=None, output_dir=None, channel_id=""):
            captured_stream["stream_id"] = stream_id
            raise ValueError("no_approved_streams")

        def mock_open_db(*args, **kwargs):
            return open_db(db_path)

        runner = CliRunner()
        with (
            patch("mizukilens.cache.open_db", side_effect=mock_open_db),
            patch("mizukilens.discovery.get_active_channel_info", return_value=("UCtest", [])),
            patch("mizukilens.export.export_approved_streams", side_effect=mock_export),
        ):
            result = runner.invoke(main, ["export", "--stream", "videoABC"])

        assert captured_stream.get("stream_id") == "videoABC"


# ===========================================================================
# SECTION: commentCredit in export (LENS-008)
# ===========================================================================


class TestCommentCreditExport:
    """Tests for comment author attribution in export JSON."""

    def test_comment_credit_included_when_author_present(self, db: sqlite3.Connection) -> None:
        """Stream with comment author data should include commentCredit."""
        upsert_stream(
            db,
            video_id="credit01",
            channel_id="UCtest",
            title="歌回 Vol.1",
            date="2024-03-15",
            status="approved",
            source="comment",
            comment_author="TimestampHero",
            comment_author_url="https://www.youtube.com/channel/UC123",
            comment_id="Ugxyz123",
        )
        upsert_parsed_songs(db, "credit01", [_SONG_A])

        streams = [get_stream(db, "credit01")]
        payload = build_export_payload(db, streams=streams, channel_id="UCtest")

        stream_entity = payload["data"]["streams"][0]
        assert "commentCredit" in stream_entity
        credit = stream_entity["commentCredit"]
        assert credit["author"] == "TimestampHero"
        assert credit["authorUrl"] == "https://www.youtube.com/channel/UC123"
        assert credit["commentUrl"] == "https://www.youtube.com/watch?v=credit01&lc=Ugxyz123"

    def test_no_comment_credit_when_author_null(self, db: sqlite3.Connection) -> None:
        """Stream without author data should NOT include commentCredit."""
        upsert_stream(
            db,
            video_id="credit02",
            channel_id="UCtest",
            title="歌回 Vol.2",
            date="2024-03-15",
            status="approved",
            source="description",
        )
        upsert_parsed_songs(db, "credit02", [_SONG_A])

        streams = [get_stream(db, "credit02")]
        payload = build_export_payload(db, streams=streams, channel_id="UCtest")

        stream_entity = payload["data"]["streams"][0]
        assert "commentCredit" not in stream_entity

    def test_comment_credit_partial_author_only(self, db: sqlite3.Connection) -> None:
        """Stream with only author name (no URL, no cid) should include partial credit."""
        upsert_stream(
            db,
            video_id="credit03",
            channel_id="UCtest",
            title="歌回 Vol.3",
            date="2024-03-15",
            status="approved",
            source="comment",
            comment_author="SomeUser",
        )
        upsert_parsed_songs(db, "credit03", [_SONG_A])

        streams = [get_stream(db, "credit03")]
        payload = build_export_payload(db, streams=streams, channel_id="UCtest")

        credit = payload["data"]["streams"][0]["commentCredit"]
        assert credit["author"] == "SomeUser"
        assert "authorUrl" not in credit
        assert "commentUrl" not in credit
