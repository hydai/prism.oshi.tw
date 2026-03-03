"""Tests for the MizukiLens EndStamp feature (cache + Flask API)."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

import pytest

from unittest.mock import patch

from mizukilens.cache import (
    clear_all_end_timestamps,
    clear_song_end_timestamp,
    get_parsed_songs,
    get_stream,
    open_db,
    update_song_details,
    update_song_duration,
    update_song_end_timestamp,
    update_song_start_timestamp,
    update_stream_status,
    upsert_parsed_songs,
    upsert_stream,
)
from mizukilens.stamp import create_app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def db(tmp_path: Path) -> sqlite3.Connection:
    """Return a temp-file-backed connection with schema initialized."""
    conn = open_db(tmp_path / "test_stamp.db")
    yield conn
    conn.close()


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    """Return a temp DB path (for Flask app factory)."""
    return tmp_path / "test_stamp.db"


def _add_stream(conn: sqlite3.Connection, video_id: str = "abc123", **kw: Any) -> None:
    defaults: dict[str, Any] = {
        "channel_id": "UCtest",
        "title": "Test Stream",
        "date": "2024-03-15",
        "status": "approved",
    }
    defaults.update(kw)
    upsert_stream(conn, video_id=video_id, **defaults)


def _add_songs(conn: sqlite3.Connection, video_id: str = "abc123") -> None:
    upsert_parsed_songs(conn, video_id, [
        {"order_index": 0, "song_name": "Song A", "artist": "Artist 1",
         "start_timestamp": "4:23", "end_timestamp": None, "note": None},
        {"order_index": 1, "song_name": "Song B", "artist": "Artist 2",
         "start_timestamp": "8:12", "end_timestamp": None, "note": None},
        {"order_index": 2, "song_name": "Song C", "artist": None,
         "start_timestamp": "12:45", "end_timestamp": "16:30", "note": "encore"},
    ])


@pytest.fixture()
def populated_db(db: sqlite3.Connection) -> sqlite3.Connection:
    _add_stream(db)
    _add_songs(db)
    return db


@pytest.fixture()
def client(db_path: Path):
    """Flask test client backed by a temp DB."""
    # Pre-create DB with data
    conn = open_db(db_path)
    _add_stream(conn)
    _add_songs(conn)
    conn.close()

    app = create_app(db_path=db_path)
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ===========================================================================
# SECTION 1: Cache — manual_end_ts column
# ===========================================================================

class TestManualEndTsColumn:
    """Verify the manual_end_ts column exists and defaults correctly."""

    def test_column_defaults_to_zero(self, populated_db: sqlite3.Connection) -> None:
        songs = get_parsed_songs(populated_db, "abc123")
        for s in songs:
            assert s["manual_end_ts"] == 0

    def test_manual_flag_set_on_manual_update(self, populated_db: sqlite3.Connection) -> None:
        songs = get_parsed_songs(populated_db, "abc123")
        song_id = songs[0]["id"]
        update_song_end_timestamp(populated_db, song_id, "5:00", manual=True)
        updated = get_parsed_songs(populated_db, "abc123")
        assert updated[0]["manual_end_ts"] == 1
        assert updated[0]["end_timestamp"] == "5:00"

    def test_non_manual_update_does_not_set_flag(self, populated_db: sqlite3.Connection) -> None:
        songs = get_parsed_songs(populated_db, "abc123")
        song_id = songs[0]["id"]
        update_song_end_timestamp(populated_db, song_id, "5:00", manual=False)
        updated = get_parsed_songs(populated_db, "abc123")
        assert updated[0]["manual_end_ts"] == 0
        assert updated[0]["end_timestamp"] == "5:00"

    def test_manual_update_overwrites_existing(self, populated_db: sqlite3.Connection) -> None:
        """Manual update should work even if end_timestamp is already set."""
        songs = get_parsed_songs(populated_db, "abc123")
        song_c_id = songs[2]["id"]  # Song C has end_timestamp="16:30"
        update_song_end_timestamp(populated_db, song_c_id, "17:00", manual=True)
        updated = get_parsed_songs(populated_db, "abc123")
        assert updated[2]["end_timestamp"] == "17:00"
        assert updated[2]["manual_end_ts"] == 1


# ===========================================================================
# SECTION 2: Cache — clear_song_end_timestamp
# ===========================================================================

class TestClearSongEndTimestamp:
    def test_clear_resets_timestamp_and_flag(self, populated_db: sqlite3.Connection) -> None:
        songs = get_parsed_songs(populated_db, "abc123")
        song_id = songs[0]["id"]
        update_song_end_timestamp(populated_db, song_id, "5:00", manual=True)
        clear_song_end_timestamp(populated_db, song_id)
        updated = get_parsed_songs(populated_db, "abc123")
        assert updated[0]["end_timestamp"] is None
        assert updated[0]["manual_end_ts"] == 0

    def test_clear_nonexistent_returns_false(self, populated_db: sqlite3.Connection) -> None:
        assert clear_song_end_timestamp(populated_db, 99999) is False

    def test_clear_existing_returns_true(self, populated_db: sqlite3.Connection) -> None:
        songs = get_parsed_songs(populated_db, "abc123")
        assert clear_song_end_timestamp(populated_db, songs[0]["id"]) is True


# ===========================================================================
# SECTION 2b: Cache — update_song_start_timestamp
# ===========================================================================

class TestUpdateSongStartTimestamp:
    def test_update_start_timestamp(self, populated_db: sqlite3.Connection) -> None:
        songs = get_parsed_songs(populated_db, "abc123")
        song_id = songs[0]["id"]
        assert update_song_start_timestamp(populated_db, song_id, "3:00") is True
        updated = get_parsed_songs(populated_db, "abc123")
        assert updated[0]["start_timestamp"] == "3:00"

    def test_nonexistent_returns_false(self, populated_db: sqlite3.Connection) -> None:
        assert update_song_start_timestamp(populated_db, 99999, "1:00") is False

    def test_overwrites_existing(self, populated_db: sqlite3.Connection) -> None:
        songs = get_parsed_songs(populated_db, "abc123")
        song_id = songs[0]["id"]  # start_timestamp = "4:23"
        update_song_start_timestamp(populated_db, song_id, "4:00")
        updated = get_parsed_songs(populated_db, "abc123")
        assert updated[0]["start_timestamp"] == "4:00"

    def test_does_not_affect_other_fields(self, populated_db: sqlite3.Connection) -> None:
        songs = get_parsed_songs(populated_db, "abc123")
        song = songs[2]  # Song C has end_timestamp="16:30"
        update_song_start_timestamp(populated_db, song["id"], "11:00")
        updated = get_parsed_songs(populated_db, "abc123")
        assert updated[2]["start_timestamp"] == "11:00"
        assert updated[2]["end_timestamp"] == "16:30"
        assert updated[2]["song_name"] == "Song C"


# ===========================================================================
# SECTION 3: Cache — re-extraction preservation
# ===========================================================================

class TestUpsertPreservesManualEndTimestamps:
    def test_manual_end_ts_survives_reextraction(self, populated_db: sqlite3.Connection) -> None:
        songs = get_parsed_songs(populated_db, "abc123")
        song_id = songs[0]["id"]
        update_song_end_timestamp(populated_db, song_id, "5:00", manual=True)

        # Re-extract: same songs, no end_timestamps
        upsert_parsed_songs(populated_db, "abc123", [
            {"order_index": 0, "song_name": "Song A", "artist": "Artist 1",
             "start_timestamp": "4:23", "end_timestamp": None, "note": None},
            {"order_index": 1, "song_name": "Song B", "artist": "Artist 2",
             "start_timestamp": "8:12", "end_timestamp": None, "note": None},
            {"order_index": 2, "song_name": "Song C", "artist": None,
             "start_timestamp": "12:45", "end_timestamp": None, "note": None},
        ])

        updated = get_parsed_songs(populated_db, "abc123")
        # Song A should have manual end_ts preserved
        assert updated[0]["end_timestamp"] == "5:00"
        assert updated[0]["manual_end_ts"] == 1
        # Song B should remain NULL
        assert updated[1]["end_timestamp"] is None
        assert updated[1]["manual_end_ts"] == 0

    def test_non_manual_end_ts_not_preserved(self, populated_db: sqlite3.Connection) -> None:
        songs = get_parsed_songs(populated_db, "abc123")
        song_id = songs[0]["id"]
        # Non-manual update (automated fill)
        update_song_end_timestamp(populated_db, song_id, "5:00", manual=False)

        upsert_parsed_songs(populated_db, "abc123", [
            {"order_index": 0, "song_name": "Song A", "artist": "Artist 1",
             "start_timestamp": "4:23", "end_timestamp": None, "note": None},
        ])

        updated = get_parsed_songs(populated_db, "abc123")
        # Non-manual end_ts should be wiped on re-extraction
        assert updated[0]["end_timestamp"] is None

    def test_preservation_matches_on_name_artist_start(self, populated_db: sqlite3.Connection) -> None:
        """Manual end_ts should survive even if order_index changes."""
        songs = get_parsed_songs(populated_db, "abc123")
        song_id = songs[1]["id"]  # Song B
        update_song_end_timestamp(populated_db, song_id, "10:00", manual=True)

        # Re-extract with different order
        upsert_parsed_songs(populated_db, "abc123", [
            {"order_index": 0, "song_name": "Song B", "artist": "Artist 2",
             "start_timestamp": "8:12", "end_timestamp": None, "note": None},
            {"order_index": 1, "song_name": "Song A", "artist": "Artist 1",
             "start_timestamp": "4:23", "end_timestamp": None, "note": None},
        ])

        updated = get_parsed_songs(populated_db, "abc123")
        # Song B (now at index 0) should still have its manual timestamp
        assert updated[0]["song_name"] == "Song B"
        assert updated[0]["end_timestamp"] == "10:00"
        assert updated[0]["manual_end_ts"] == 1

    def test_null_artist_matching(self, populated_db: sqlite3.Connection) -> None:
        """Preservation works when artist is NULL."""
        songs = get_parsed_songs(populated_db, "abc123")
        song_c_id = songs[2]["id"]  # Song C (artist=None)
        update_song_end_timestamp(populated_db, song_c_id, "18:00", manual=True)

        upsert_parsed_songs(populated_db, "abc123", [
            {"order_index": 0, "song_name": "Song C", "artist": None,
             "start_timestamp": "12:45", "end_timestamp": None, "note": None},
        ])

        updated = get_parsed_songs(populated_db, "abc123")
        assert updated[0]["end_timestamp"] == "18:00"
        assert updated[0]["manual_end_ts"] == 1


# ===========================================================================
# SECTION 4: Cache — update_song_end_timestamp backward compat
# ===========================================================================

class TestUpdateSongEndTimestampCompat:
    def test_default_null_guard_still_works(self, populated_db: sqlite3.Connection) -> None:
        """Default (non-manual) mode only updates NULL end_timestamps."""
        songs = get_parsed_songs(populated_db, "abc123")
        song_c_id = songs[2]["id"]  # Song C has end_timestamp="16:30"
        result = update_song_end_timestamp(populated_db, song_c_id, "99:99")
        assert result is False  # Should not update since it's not NULL
        updated = get_parsed_songs(populated_db, "abc123")
        assert updated[2]["end_timestamp"] == "16:30"

    def test_update_nonexistent_song(self, populated_db: sqlite3.Connection) -> None:
        result = update_song_end_timestamp(populated_db, 99999, "5:00", manual=True)
        assert result is False


# ===========================================================================
# SECTION 5: Flask API — /api/streams
# ===========================================================================

class TestApiStreams:
    def test_list_streams(self, client) -> None:
        resp = client.get("/api/streams")
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data) == 1
        assert data[0]["videoId"] == "abc123"
        assert data[0]["title"] == "Test Stream"
        assert data[0]["status"] == "approved"

    def test_pending_count(self, client) -> None:
        resp = client.get("/api/streams")
        data = resp.get_json()
        # 2 songs missing end_timestamp (Song A, Song B)
        assert data[0]["pending"] == 2

    def test_only_approved_exported_imported(self, db_path: Path) -> None:
        """Streams with status 'discovered' etc. should not appear."""
        conn = open_db(db_path)
        _add_stream(conn, video_id="disc1", status="discovered")
        _add_stream(conn, video_id="exp1", status="exported")
        conn.close()

        app = create_app(db_path=db_path)
        app.config["TESTING"] = True
        with app.test_client() as c:
            resp = c.get("/api/streams")
            data = resp.get_json()
            video_ids = {s["videoId"] for s in data}
            assert "disc1" not in video_ids
            assert "exp1" in video_ids

    def test_filter_by_single_status(self, db_path: Path) -> None:
        conn = open_db(db_path)
        _add_stream(conn, video_id="a1", status="approved")
        _add_stream(conn, video_id="e1", status="exported")
        _add_stream(conn, video_id="i1", status="imported")
        conn.close()

        app = create_app(db_path=db_path)
        app.config["TESTING"] = True
        with app.test_client() as c:
            resp = c.get("/api/streams?status=approved")
            data = resp.get_json()
            statuses = {s["status"] for s in data}
            assert statuses == {"approved"}

    def test_filter_by_multiple_statuses(self, db_path: Path) -> None:
        conn = open_db(db_path)
        _add_stream(conn, video_id="a1", status="approved")
        _add_stream(conn, video_id="e1", status="exported")
        _add_stream(conn, video_id="i1", status="imported")
        conn.close()

        app = create_app(db_path=db_path)
        app.config["TESTING"] = True
        with app.test_client() as c:
            resp = c.get("/api/streams?status=approved,imported")
            data = resp.get_json()
            statuses = {s["status"] for s in data}
            assert statuses == {"approved", "imported"}

    def test_filter_ignores_invalid_status(self, db_path: Path) -> None:
        conn = open_db(db_path)
        _add_stream(conn, video_id="a1", status="approved")
        conn.close()

        app = create_app(db_path=db_path)
        app.config["TESTING"] = True
        with app.test_client() as c:
            resp = c.get("/api/streams?status=discovered")
            data = resp.get_json()
            assert data == []

    def test_no_filter_returns_all(self, db_path: Path) -> None:
        conn = open_db(db_path)
        _add_stream(conn, video_id="a1", status="approved")
        _add_stream(conn, video_id="e1", status="exported")
        _add_stream(conn, video_id="i1", status="imported")
        conn.close()

        app = create_app(db_path=db_path)
        app.config["TESTING"] = True
        with app.test_client() as c:
            resp = c.get("/api/streams")
            data = resp.get_json()
            statuses = {s["status"] for s in data}
            assert statuses == {"approved", "exported", "imported"}


# ===========================================================================
# SECTION 6: Flask API — /api/streams/<id>/songs
# ===========================================================================

class TestApiStreamSongs:
    def test_list_songs(self, client) -> None:
        resp = client.get("/api/streams/abc123/songs")
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data) == 3
        assert data[0]["songName"] == "Song A"
        assert data[0]["startTimestamp"] == "4:23"
        assert data[0]["endTimestamp"] is None
        assert data[0]["manualEndTs"] is False

    def test_songs_sorted_by_order(self, client) -> None:
        resp = client.get("/api/streams/abc123/songs")
        data = resp.get_json()
        indices = [s["orderIndex"] for s in data]
        assert indices == [0, 1, 2]

    def test_empty_stream(self, db_path: Path) -> None:
        conn = open_db(db_path)
        _add_stream(conn, video_id="empty1")
        conn.close()

        app = create_app(db_path=db_path)
        app.config["TESTING"] = True
        with app.test_client() as c:
            resp = c.get("/api/streams/empty1/songs")
            assert resp.get_json() == []


# ===========================================================================
# SECTION 7: Flask API — PUT /api/songs/<id>/end-timestamp
# ===========================================================================

class TestApiSetEndTimestamp:
    def test_set_end_timestamp(self, client) -> None:
        resp = client.get("/api/streams/abc123/songs")
        song_id = resp.get_json()[0]["id"]

        resp = client.put(
            f"/api/songs/{song_id}/end-timestamp",
            data=json.dumps({"endTimestamp": "5:30"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["endTimestamp"] == "5:30"

    def test_set_end_timestamp_sets_manual_flag(self, client) -> None:
        resp = client.get("/api/streams/abc123/songs")
        song_id = resp.get_json()[0]["id"]

        client.put(
            f"/api/songs/{song_id}/end-timestamp",
            data=json.dumps({"endTimestamp": "5:30"}),
            content_type="application/json",
        )

        resp = client.get("/api/streams/abc123/songs")
        assert resp.get_json()[0]["manualEndTs"] is True

    def test_missing_body(self, client) -> None:
        resp = client.put("/api/songs/1/end-timestamp")
        assert resp.status_code == 400

    def test_missing_field(self, client) -> None:
        resp = client.put(
            "/api/songs/1/end-timestamp",
            data=json.dumps({"wrong": "field"}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_empty_timestamp(self, client) -> None:
        resp = client.put(
            "/api/songs/1/end-timestamp",
            data=json.dumps({"endTimestamp": ""}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_nonexistent_song(self, client) -> None:
        resp = client.put(
            "/api/songs/99999/end-timestamp",
            data=json.dumps({"endTimestamp": "5:30"}),
            content_type="application/json",
        )
        assert resp.status_code == 404

    def test_overwrite_existing_timestamp(self, client) -> None:
        """Manual mode should allow overwriting existing end_timestamp."""
        resp = client.get("/api/streams/abc123/songs")
        song_c_id = resp.get_json()[2]["id"]  # Song C with end_timestamp

        resp = client.put(
            f"/api/songs/{song_c_id}/end-timestamp",
            data=json.dumps({"endTimestamp": "17:00"}),
            content_type="application/json",
        )
        assert resp.status_code == 200

        resp = client.get("/api/streams/abc123/songs")
        assert resp.get_json()[2]["endTimestamp"] == "17:00"


# ===========================================================================
# SECTION 7b: Flask API — PUT /api/songs/<id>/start-timestamp
# ===========================================================================

class TestApiSetStartTimestamp:
    def test_set_start_timestamp(self, client) -> None:
        resp = client.get("/api/streams/abc123/songs")
        song_id = resp.get_json()[0]["id"]

        resp = client.put(
            f"/api/songs/{song_id}/start-timestamp",
            data=json.dumps({"startTimestamp": "3:00"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["startTimestamp"] == "3:00"

    def test_verify_via_get(self, client) -> None:
        resp = client.get("/api/streams/abc123/songs")
        song_id = resp.get_json()[0]["id"]

        client.put(
            f"/api/songs/{song_id}/start-timestamp",
            data=json.dumps({"startTimestamp": "3:00"}),
            content_type="application/json",
        )

        resp = client.get("/api/streams/abc123/songs")
        assert resp.get_json()[0]["startTimestamp"] == "3:00"

    def test_missing_body(self, client) -> None:
        resp = client.put("/api/songs/1/start-timestamp")
        assert resp.status_code == 400

    def test_missing_field(self, client) -> None:
        resp = client.put(
            "/api/songs/1/start-timestamp",
            data=json.dumps({"wrong": "field"}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_empty_timestamp(self, client) -> None:
        resp = client.put(
            "/api/songs/1/start-timestamp",
            data=json.dumps({"startTimestamp": ""}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_nonexistent_song(self, client) -> None:
        resp = client.put(
            "/api/songs/99999/start-timestamp",
            data=json.dumps({"startTimestamp": "3:00"}),
            content_type="application/json",
        )
        assert resp.status_code == 404


# ===========================================================================
# SECTION 8: Flask API — DELETE /api/songs/<id>/end-timestamp
# ===========================================================================

class TestApiClearEndTimestamp:
    def test_clear_end_timestamp(self, client) -> None:
        resp = client.get("/api/streams/abc123/songs")
        song_c_id = resp.get_json()[2]["id"]  # Song C with end_timestamp

        resp = client.delete(f"/api/songs/{song_c_id}/end-timestamp")
        assert resp.status_code == 200
        assert resp.get_json()["ok"] is True

        resp = client.get("/api/streams/abc123/songs")
        assert resp.get_json()[2]["endTimestamp"] is None
        assert resp.get_json()[2]["manualEndTs"] is False

    def test_clear_nonexistent(self, client) -> None:
        resp = client.delete("/api/songs/99999/end-timestamp")
        assert resp.status_code == 404


# ===========================================================================
# SECTION 9: Flask API — /api/stats
# ===========================================================================

class TestApiStats:
    def test_stats(self, client) -> None:
        resp = client.get("/api/stats")
        assert resp.status_code == 200
        data = resp.get_json()
        # 3 total, 1 filled (Song C), 2 remaining
        assert data["total"] == 3
        assert data["filled"] == 1
        assert data["remaining"] == 2

    def test_stats_update_after_stamp(self, client) -> None:
        resp = client.get("/api/streams/abc123/songs")
        song_id = resp.get_json()[0]["id"]

        client.put(
            f"/api/songs/{song_id}/end-timestamp",
            data=json.dumps({"endTimestamp": "5:30"}),
            content_type="application/json",
        )

        resp = client.get("/api/stats")
        data = resp.get_json()
        assert data["filled"] == 2
        assert data["remaining"] == 1


# ===========================================================================
# SECTION 10: Flask API — stamp re-approves stream
# ===========================================================================

class TestStampReapprovesStream:
    """Stamping/clearing should transition exported/imported streams back to approved."""

    def _make_client(self, db_path: Path, stream_status: str):
        conn = open_db(db_path)
        _add_stream(conn, status="approved")
        _add_songs(conn)
        # Transition to target status via valid path
        if stream_status in ("exported", "imported"):
            update_stream_status(conn, "abc123", "exported")
        if stream_status == "imported":
            update_stream_status(conn, "abc123", "imported")
        conn.close()
        app = create_app(db_path=db_path)
        app.config["TESTING"] = True
        return app.test_client()

    def test_stamp_on_exported_stream_reapproves(self, db_path: Path) -> None:
        c = self._make_client(db_path, "exported")
        songs = c.get("/api/streams/abc123/songs").get_json()
        c.put(
            f"/api/songs/{songs[0]['id']}/end-timestamp",
            data=json.dumps({"endTimestamp": "5:30"}),
            content_type="application/json",
        )
        conn = open_db(db_path)
        assert get_stream(conn, "abc123")["status"] == "approved"
        conn.close()

    def test_stamp_on_imported_stream_reapproves(self, db_path: Path) -> None:
        c = self._make_client(db_path, "imported")
        songs = c.get("/api/streams/abc123/songs").get_json()
        c.put(
            f"/api/songs/{songs[0]['id']}/end-timestamp",
            data=json.dumps({"endTimestamp": "5:30"}),
            content_type="application/json",
        )
        conn = open_db(db_path)
        assert get_stream(conn, "abc123")["status"] == "approved"
        conn.close()

    def test_stamp_on_extracted_stream_approves(self, db_path: Path) -> None:
        c = self._make_client(db_path, "extracted")
        songs = c.get("/api/streams/abc123/songs").get_json()
        c.put(
            f"/api/songs/{songs[0]['id']}/end-timestamp",
            data=json.dumps({"endTimestamp": "5:30"}),
            content_type="application/json",
        )
        conn = open_db(db_path)
        assert get_stream(conn, "abc123")["status"] == "approved"
        conn.close()

    def test_stamp_on_pending_stream_approves(self, db_path: Path) -> None:
        c = self._make_client(db_path, "pending")
        songs = c.get("/api/streams/abc123/songs").get_json()
        c.put(
            f"/api/songs/{songs[0]['id']}/end-timestamp",
            data=json.dumps({"endTimestamp": "5:30"}),
            content_type="application/json",
        )
        conn = open_db(db_path)
        assert get_stream(conn, "abc123")["status"] == "approved"
        conn.close()

    def test_clear_on_exported_stream_reapproves(self, db_path: Path) -> None:
        c = self._make_client(db_path, "exported")
        songs = c.get("/api/streams/abc123/songs").get_json()
        song_c_id = songs[2]["id"]  # Song C has end_timestamp
        c.delete(f"/api/songs/{song_c_id}/end-timestamp")
        conn = open_db(db_path)
        assert get_stream(conn, "abc123")["status"] == "approved"
        conn.close()

    def test_clear_on_imported_stream_reapproves(self, db_path: Path) -> None:
        c = self._make_client(db_path, "imported")
        songs = c.get("/api/streams/abc123/songs").get_json()
        song_c_id = songs[2]["id"]
        c.delete(f"/api/songs/{song_c_id}/end-timestamp")
        conn = open_db(db_path)
        assert get_stream(conn, "abc123")["status"] == "approved"
        conn.close()

    def test_stamp_on_approved_stream_stays_approved(self, db_path: Path) -> None:
        c = self._make_client(db_path, "approved")
        songs = c.get("/api/streams/abc123/songs").get_json()
        c.put(
            f"/api/songs/{songs[0]['id']}/end-timestamp",
            data=json.dumps({"endTimestamp": "5:30"}),
            content_type="application/json",
        )
        conn = open_db(db_path)
        assert get_stream(conn, "abc123")["status"] == "approved"
        conn.close()

    def test_start_stamp_on_exported_stream_reapproves(self, db_path: Path) -> None:
        c = self._make_client(db_path, "exported")
        songs = c.get("/api/streams/abc123/songs").get_json()
        c.put(
            f"/api/songs/{songs[0]['id']}/start-timestamp",
            data=json.dumps({"startTimestamp": "3:00"}),
            content_type="application/json",
        )
        conn = open_db(db_path)
        assert get_stream(conn, "abc123")["status"] == "approved"
        conn.close()

    def test_start_stamp_on_imported_stream_reapproves(self, db_path: Path) -> None:
        c = self._make_client(db_path, "imported")
        songs = c.get("/api/streams/abc123/songs").get_json()
        c.put(
            f"/api/songs/{songs[0]['id']}/start-timestamp",
            data=json.dumps({"startTimestamp": "3:00"}),
            content_type="application/json",
        )
        conn = open_db(db_path)
        assert get_stream(conn, "abc123")["status"] == "approved"
        conn.close()


# ===========================================================================
# SECTION 11: Flask API — index page
# ===========================================================================

class TestIndexPage:
    def test_index_returns_html(self, client) -> None:
        resp = client.get("/")
        assert resp.status_code == 200
        assert b"MizukiLens EndStamp Editor" in resp.data


# ===========================================================================
# SECTION 11: CLI stamp command registration
# ===========================================================================

class TestStampCliRegistration:
    def test_stamp_command_exists(self) -> None:
        from mizukilens.cli import main
        from click.testing import CliRunner

        runner = CliRunner()
        result = runner.invoke(main, ["stamp", "--help"])
        assert result.exit_code == 0
        assert "EndStamp" in result.output

    def test_stamp_default_options(self) -> None:
        from mizukilens.cli import main
        from click.testing import CliRunner

        runner = CliRunner()
        result = runner.invoke(main, ["stamp", "--help"])
        assert "--port" in result.output
        assert "--host" in result.output
        assert "5555" in result.output


# ===========================================================================
# SECTION 12: Schema migration
# ===========================================================================

# ===========================================================================
# SECTION 12: Cache — update_song_details
# ===========================================================================

class TestUpdateSongDetails:
    def test_update_song_name_only(self, populated_db: sqlite3.Connection) -> None:
        songs = get_parsed_songs(populated_db, "abc123")
        song_id = songs[0]["id"]
        assert update_song_details(populated_db, song_id, song_name="New Name") is True
        updated = get_parsed_songs(populated_db, "abc123")
        assert updated[0]["song_name"] == "New Name"
        assert updated[0]["artist"] == "Artist 1"  # unchanged

    def test_update_artist_only(self, populated_db: sqlite3.Connection) -> None:
        songs = get_parsed_songs(populated_db, "abc123")
        song_id = songs[0]["id"]
        assert update_song_details(populated_db, song_id, artist="New Artist") is True
        updated = get_parsed_songs(populated_db, "abc123")
        assert updated[0]["artist"] == "New Artist"
        assert updated[0]["song_name"] == "Song A"  # unchanged

    def test_update_both_fields(self, populated_db: sqlite3.Connection) -> None:
        songs = get_parsed_songs(populated_db, "abc123")
        song_id = songs[0]["id"]
        assert update_song_details(populated_db, song_id, song_name="X", artist="Y") is True
        updated = get_parsed_songs(populated_db, "abc123")
        assert updated[0]["song_name"] == "X"
        assert updated[0]["artist"] == "Y"

    def test_clear_artist(self, populated_db: sqlite3.Connection) -> None:
        songs = get_parsed_songs(populated_db, "abc123")
        song_id = songs[0]["id"]  # Artist 1
        assert update_song_details(populated_db, song_id, artist=None) is True
        updated = get_parsed_songs(populated_db, "abc123")
        assert updated[0]["artist"] is None

    def test_nonexistent_returns_false(self, populated_db: sqlite3.Connection) -> None:
        assert update_song_details(populated_db, 99999, song_name="X") is False


# ===========================================================================
# SECTION 13: Flask API — PUT /api/songs/<id>/details
# ===========================================================================

class TestApiUpdateSongDetails:
    def test_update_song_name(self, client) -> None:
        resp = client.get("/api/streams/abc123/songs")
        song_id = resp.get_json()[0]["id"]

        resp = client.put(
            f"/api/songs/{song_id}/details",
            data=json.dumps({"songName": "New Name"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["songName"] == "New Name"

        # Verify via GET
        resp = client.get("/api/streams/abc123/songs")
        assert resp.get_json()[0]["songName"] == "New Name"

    def test_update_artist(self, client) -> None:
        resp = client.get("/api/streams/abc123/songs")
        song_id = resp.get_json()[0]["id"]

        resp = client.put(
            f"/api/songs/{song_id}/details",
            data=json.dumps({"artist": "New Artist"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        assert resp.get_json()["artist"] == "New Artist"

    def test_update_both(self, client) -> None:
        resp = client.get("/api/streams/abc123/songs")
        song_id = resp.get_json()[0]["id"]

        resp = client.put(
            f"/api/songs/{song_id}/details",
            data=json.dumps({"songName": "X", "artist": "Y"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["songName"] == "X"
        assert data["artist"] == "Y"

    def test_clear_artist_with_null(self, client) -> None:
        resp = client.get("/api/streams/abc123/songs")
        song_id = resp.get_json()[0]["id"]

        resp = client.put(
            f"/api/songs/{song_id}/details",
            data=json.dumps({"artist": None}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        assert resp.get_json()["artist"] is None

    def test_empty_song_name_rejected(self, client) -> None:
        resp = client.get("/api/streams/abc123/songs")
        song_id = resp.get_json()[0]["id"]

        resp = client.put(
            f"/api/songs/{song_id}/details",
            data=json.dumps({"songName": ""}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_missing_both_fields(self, client) -> None:
        resp = client.put(
            "/api/songs/1/details",
            data=json.dumps({"unrelated": "field"}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_nonexistent_song(self, client) -> None:
        resp = client.put(
            "/api/songs/99999/details",
            data=json.dumps({"songName": "X"}),
            content_type="application/json",
        )
        assert resp.status_code == 404

    def test_reapproves_exported_stream(self, db_path: Path) -> None:
        conn = open_db(db_path)
        _add_stream(conn, status="approved")
        _add_songs(conn)
        update_stream_status(conn, "abc123", "exported")
        conn.close()

        app = create_app(db_path=db_path)
        app.config["TESTING"] = True
        with app.test_client() as c:
            songs = c.get("/api/streams/abc123/songs").get_json()
            c.put(
                f"/api/songs/{songs[0]['id']}/details",
                data=json.dumps({"songName": "Fixed Name"}),
                content_type="application/json",
            )
            conn = open_db(db_path)
            assert get_stream(conn, "abc123")["status"] == "approved"
            conn.close()


# ===========================================================================
# SECTION 14: Schema migration
# ===========================================================================

class TestSchemaMigration:
    def test_manual_end_ts_column_exists_in_fresh_db(self, tmp_path: Path) -> None:
        conn = open_db(tmp_path / "fresh.db")
        cur = conn.execute("PRAGMA table_info(parsed_songs)")
        columns = {row[1] for row in cur.fetchall()}
        assert "manual_end_ts" in columns
        conn.close()

    def test_migration_adds_column_to_existing_db(self, tmp_path: Path) -> None:
        """Simulate an old DB without manual_end_ts, then open_db should migrate."""
        db_path = tmp_path / "old.db"
        conn = sqlite3.connect(db_path)
        conn.execute("""
            CREATE TABLE streams (
                video_id TEXT PRIMARY KEY, channel_id TEXT, title TEXT,
                date TEXT, status TEXT NOT NULL, source TEXT,
                raw_comment TEXT, raw_description TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE parsed_songs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                video_id TEXT NOT NULL, order_index INTEGER NOT NULL,
                song_name TEXT NOT NULL, artist TEXT,
                start_timestamp TEXT NOT NULL, end_timestamp TEXT, note TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE candidate_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                video_id TEXT NOT NULL, comment_cid TEXT,
                comment_author TEXT, comment_author_url TEXT,
                comment_text TEXT NOT NULL, keywords_matched TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )
        """)
        conn.commit()
        conn.close()

        # Now open with open_db which should run migrations
        conn = open_db(db_path)
        cur = conn.execute("PRAGMA table_info(parsed_songs)")
        columns = {row[1] for row in cur.fetchall()}
        assert "manual_end_ts" in columns
        conn.close()

    def test_duration_column_exists_in_fresh_db(self, tmp_path: Path) -> None:
        conn = open_db(tmp_path / "fresh2.db")
        cur = conn.execute("PRAGMA table_info(parsed_songs)")
        columns = {row[1] for row in cur.fetchall()}
        assert "duration" in columns
        conn.close()


# ===========================================================================
# SECTION 15: Cache — update_song_duration
# ===========================================================================

class TestUpdateSongDuration:
    def test_update_duration(self, populated_db: sqlite3.Connection) -> None:
        songs = get_parsed_songs(populated_db, "abc123")
        song_id = songs[0]["id"]
        assert update_song_duration(populated_db, song_id, 225) is True
        updated = get_parsed_songs(populated_db, "abc123")
        assert updated[0]["duration"] == 225

    def test_clear_duration(self, populated_db: sqlite3.Connection) -> None:
        songs = get_parsed_songs(populated_db, "abc123")
        song_id = songs[0]["id"]
        update_song_duration(populated_db, song_id, 225)
        assert update_song_duration(populated_db, song_id, None) is True
        updated = get_parsed_songs(populated_db, "abc123")
        assert updated[0]["duration"] is None

    def test_nonexistent_returns_false(self, populated_db: sqlite3.Connection) -> None:
        assert update_song_duration(populated_db, 99999, 180) is False

    def test_duration_preserved_on_reextraction(self, populated_db: sqlite3.Connection) -> None:
        songs = get_parsed_songs(populated_db, "abc123")
        update_song_duration(populated_db, songs[0]["id"], 225)

        # Re-extract: same songs
        upsert_parsed_songs(populated_db, "abc123", [
            {"order_index": 0, "song_name": "Song A", "artist": "Artist 1",
             "start_timestamp": "4:23", "end_timestamp": None, "note": None},
            {"order_index": 1, "song_name": "Song B", "artist": "Artist 2",
             "start_timestamp": "8:12", "end_timestamp": None, "note": None},
        ])

        updated = get_parsed_songs(populated_db, "abc123")
        assert updated[0]["duration"] == 225
        assert updated[1]["duration"] is None


# ===========================================================================
# SECTION 16: Flask API — POST /api/songs/<id>/fetch-duration
# ===========================================================================

def _mock_itunes_success(artist: str, title: str) -> dict:
    """Return a fake iTunes match with trackDuration."""
    return {
        "trackDuration": 225,
        "albumTitle": "Test Album",
        "itunesTrackId": 12345,
        "match_confidence": "exact",
    }


def _mock_itunes_no_match(artist: str, title: str) -> dict:
    return {"match_confidence": None, "last_error": None}


class TestApiFetchDuration:
    def test_fetch_duration_success(self, db_path: Path) -> None:
        conn = open_db(db_path)
        _add_stream(conn)
        _add_songs(conn)
        conn.close()

        app = create_app(db_path=db_path)
        app.config["TESTING"] = True
        with app.test_client() as c:
            songs = c.get("/api/streams/abc123/songs").get_json()
            song_id = songs[0]["id"]
            with patch("mizukilens.metadata.fetch_itunes_metadata", _mock_itunes_success):
                resp = c.post(f"/api/songs/{song_id}/fetch-duration")

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["duration"] == 225
        # Song A: start=4:23 (263s) + 225s = 488s = 8:08
        assert data["end_timestamp"] == "8:08"

        # Verify duration and end_timestamp are stored in DB
        conn = open_db(db_path)
        songs_db = get_parsed_songs(conn, "abc123")
        assert songs_db[0]["duration"] == 225
        assert songs_db[0]["end_timestamp"] == "8:08"
        conn.close()

    def test_fetch_duration_no_match(self, db_path: Path) -> None:
        conn = open_db(db_path)
        _add_stream(conn)
        _add_songs(conn)
        conn.close()

        app = create_app(db_path=db_path)
        app.config["TESTING"] = True
        with app.test_client() as c:
            songs = c.get("/api/streams/abc123/songs").get_json()
            song_id = songs[0]["id"]
            with patch("mizukilens.metadata.fetch_itunes_metadata", _mock_itunes_no_match):
                resp = c.post(f"/api/songs/{song_id}/fetch-duration")

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["duration"] is None
        assert "No iTunes match" in data["message"]

    def test_fetch_duration_nonexistent_song(self, client) -> None:
        resp = client.post("/api/songs/99999/fetch-duration")
        assert resp.status_code == 404

    def test_fetch_duration_null_artist(self, db_path: Path) -> None:
        """Works when artist is None (Song C in test data).
        Song C already has end_timestamp='16:30', so it must NOT be overwritten.
        """
        conn = open_db(db_path)
        _add_stream(conn)
        _add_songs(conn)
        conn.close()

        app = create_app(db_path=db_path)
        app.config["TESTING"] = True
        with app.test_client() as c:
            songs = c.get("/api/streams/abc123/songs").get_json()
            # Song C has artist=None
            song_c_id = songs[2]["id"]
            with patch("mizukilens.metadata.fetch_itunes_metadata", _mock_itunes_success):
                resp = c.post(f"/api/songs/{song_c_id}/fetch-duration")

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["duration"] == 225
        # end_timestamp was already set — no fill happened
        assert data["end_timestamp"] is None

        # Verify DB still has original end_timestamp
        conn = open_db(db_path)
        songs_db = get_parsed_songs(conn, "abc123")
        assert songs_db[2]["end_timestamp"] == "16:30"
        conn.close()

    def test_duration_in_song_list(self, db_path: Path) -> None:
        conn = open_db(db_path)
        _add_stream(conn)
        _add_songs(conn)
        songs = get_parsed_songs(conn, "abc123")
        update_song_duration(conn, songs[0]["id"], 225)
        conn.close()

        app = create_app(db_path=db_path)
        app.config["TESTING"] = True
        with app.test_client() as c:
            resp = c.get("/api/streams/abc123/songs")
            data = resp.get_json()
            assert data[0]["duration"] == 225
            assert data[1]["duration"] is None


# ===========================================================================
# SECTION 17: Cache — clear_all_end_timestamps
# ===========================================================================

class TestClearAllEndTimestamps:
    def test_clear_all_returns_count(self, populated_db: sqlite3.Connection) -> None:
        # Song C has end_timestamp="16:30", so 1 row should be cleared
        count = clear_all_end_timestamps(populated_db, "abc123")
        assert count == 1

    def test_clear_all_clears_manual_flag(self, populated_db: sqlite3.Connection) -> None:
        songs = get_parsed_songs(populated_db, "abc123")
        # Manually stamp Song A and Song B
        update_song_end_timestamp(populated_db, songs[0]["id"], "5:00", manual=True)
        update_song_end_timestamp(populated_db, songs[1]["id"], "10:00", manual=True)

        clear_all_end_timestamps(populated_db, "abc123")
        updated = get_parsed_songs(populated_db, "abc123")
        for s in updated:
            assert s["end_timestamp"] is None
            assert s["manual_end_ts"] == 0

    def test_clear_all_preserves_duration(self, populated_db: sqlite3.Connection) -> None:
        songs = get_parsed_songs(populated_db, "abc123")
        update_song_duration(populated_db, songs[0]["id"], 225)
        update_song_end_timestamp(populated_db, songs[0]["id"], "5:00", manual=True)

        clear_all_end_timestamps(populated_db, "abc123")
        updated = get_parsed_songs(populated_db, "abc123")
        assert updated[0]["duration"] == 225
        assert updated[0]["end_timestamp"] is None

    def test_clear_all_idempotent(self, populated_db: sqlite3.Connection) -> None:
        clear_all_end_timestamps(populated_db, "abc123")  # clears Song C
        count = clear_all_end_timestamps(populated_db, "abc123")  # nothing left
        assert count == 0

    def test_clear_all_nonexistent_stream(self, populated_db: sqlite3.Connection) -> None:
        count = clear_all_end_timestamps(populated_db, "nonexistent")
        assert count == 0


# ===========================================================================
# SECTION 18: Flask API — DELETE /api/streams/<id>/end-timestamps
# ===========================================================================

class TestApiClearAllEndTimestamps:
    def test_clear_all_success(self, client) -> None:
        # Song C already has end_timestamp="16:30"
        resp = client.delete("/api/streams/abc123/end-timestamps")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["cleared"] == 1

        # Verify songs are actually cleared
        resp = client.get("/api/streams/abc123/songs")
        songs = resp.get_json()
        for s in songs:
            assert s["endTimestamp"] is None

    def test_clear_all_reapproves_exported_stream(self, db_path: Path) -> None:
        conn = open_db(db_path)
        _add_stream(conn, status="approved")
        _add_songs(conn)
        update_stream_status(conn, "abc123", "exported")
        conn.close()

        app = create_app(db_path=db_path)
        app.config["TESTING"] = True
        with app.test_client() as c:
            c.delete("/api/streams/abc123/end-timestamps")
            conn = open_db(db_path)
            assert get_stream(conn, "abc123")["status"] == "approved"
            conn.close()

    def test_clear_all_updates_stats(self, client) -> None:
        # Before: 1 filled (Song C)
        resp = client.get("/api/stats")
        assert resp.get_json()["filled"] == 1

        client.delete("/api/streams/abc123/end-timestamps")

        resp = client.get("/api/stats")
        assert resp.get_json()["filled"] == 0

    def test_clear_all_nonexistent_stream(self, client) -> None:
        resp = client.delete("/api/streams/nonexistent/end-timestamps")
        assert resp.status_code == 404


# ===========================================================================
# SECTION 19: Cache — delete_parsed_song
# ===========================================================================

class TestDeleteParsedSong:
    def test_delete_returns_video_id(self, populated_db: sqlite3.Connection) -> None:
        from mizukilens.cache import delete_parsed_song
        songs = get_parsed_songs(populated_db, "abc123")
        result = delete_parsed_song(populated_db, songs[1]["id"])
        assert result == "abc123"

    def test_delete_removes_song(self, populated_db: sqlite3.Connection) -> None:
        from mizukilens.cache import delete_parsed_song
        songs = get_parsed_songs(populated_db, "abc123")
        delete_parsed_song(populated_db, songs[1]["id"])  # remove Song B
        remaining = get_parsed_songs(populated_db, "abc123")
        assert len(remaining) == 2
        assert remaining[0]["song_name"] == "Song A"
        assert remaining[1]["song_name"] == "Song C"

    def test_delete_reindexes(self, populated_db: sqlite3.Connection) -> None:
        from mizukilens.cache import delete_parsed_song
        songs = get_parsed_songs(populated_db, "abc123")
        delete_parsed_song(populated_db, songs[0]["id"])  # remove Song A
        remaining = get_parsed_songs(populated_db, "abc123")
        assert remaining[0]["order_index"] == 0
        assert remaining[1]["order_index"] == 1

    def test_delete_nonexistent_returns_none(self, populated_db: sqlite3.Connection) -> None:
        from mizukilens.cache import delete_parsed_song
        assert delete_parsed_song(populated_db, 99999) is None

    def test_delete_last_song(self, populated_db: sqlite3.Connection) -> None:
        from mizukilens.cache import delete_parsed_song
        songs = get_parsed_songs(populated_db, "abc123")
        for s in songs:
            delete_parsed_song(populated_db, s["id"])
        remaining = get_parsed_songs(populated_db, "abc123")
        assert len(remaining) == 0


# ===========================================================================
# SECTION 20: Flask API — DELETE /api/songs/<id>
# ===========================================================================

class TestApiDeleteSong:
    def test_delete_song_success(self, client) -> None:
        resp = client.get("/api/streams/abc123/songs")
        songs = resp.get_json()
        song_id = songs[1]["id"]  # Song B

        resp = client.delete(f"/api/songs/{song_id}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["songId"] == song_id

        # Verify removal
        resp = client.get("/api/streams/abc123/songs")
        remaining = resp.get_json()
        assert len(remaining) == 2
        assert remaining[0]["songName"] == "Song A"
        assert remaining[1]["songName"] == "Song C"

    def test_delete_reindexes_order(self, client) -> None:
        resp = client.get("/api/streams/abc123/songs")
        songs = resp.get_json()
        song_id = songs[0]["id"]  # Song A

        client.delete(f"/api/songs/{song_id}")

        resp = client.get("/api/streams/abc123/songs")
        remaining = resp.get_json()
        assert remaining[0]["orderIndex"] == 0
        assert remaining[1]["orderIndex"] == 1

    def test_delete_nonexistent_returns_404(self, client) -> None:
        resp = client.delete("/api/songs/99999")
        assert resp.status_code == 404

    def test_delete_reapproves_exported_stream(self, db_path: Path) -> None:
        conn = open_db(db_path)
        _add_stream(conn, status="approved")
        _add_songs(conn)
        update_stream_status(conn, "abc123", "exported")
        conn.close()

        app = create_app(db_path=db_path)
        app.config["TESTING"] = True
        with app.test_client() as c:
            songs = c.get("/api/streams/abc123/songs").get_json()
            c.delete(f"/api/songs/{songs[0]['id']}")
            conn = open_db(db_path)
            assert get_stream(conn, "abc123")["status"] == "approved"
            conn.close()

    def test_delete_updates_stats(self, client) -> None:
        # Song C has end_timestamp, so filled=1
        resp = client.get("/api/stats")
        assert resp.get_json()["filled"] == 1

        # Delete Song C (the one with end_timestamp)
        resp = client.get("/api/streams/abc123/songs")
        songs = resp.get_json()
        song_c_id = songs[2]["id"]
        client.delete(f"/api/songs/{song_c_id}")

        resp = client.get("/api/stats")
        assert resp.get_json()["filled"] == 0


# ===========================================================================
# SECTION 21: Flask API — POST /api/streams/<id>/refetch
# ===========================================================================

class TestApiRefetchStream:
    def test_refetch_nonexistent_returns_404(self, client) -> None:
        resp = client.post("/api/streams/nonexistent/refetch")
        assert resp.status_code == 404

    def test_refetch_calls_extract_timestamps(self, db_path: Path) -> None:
        from dataclasses import dataclass, field

        @dataclass
        class FakeResult:
            video_id: str = "abc123"
            status: str = "extracted"
            source: str | None = "comment"
            songs: list = field(default_factory=lambda: [
                {"order_index": 0, "song_name": "New A", "start_timestamp": "1:00"},
                {"order_index": 1, "song_name": "New B", "start_timestamp": "5:00"},
            ])

        conn = open_db(db_path)
        _add_stream(conn)
        _add_songs(conn)
        conn.close()

        app = create_app(db_path=db_path)
        app.config["TESTING"] = True
        with app.test_client() as c:
            with patch(
                "mizukilens.extraction.extract_timestamps",
                return_value=FakeResult(),
            ):
                resp = c.post("/api/streams/abc123/refetch")

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["source"] == "comment"
        assert data["songCount"] == 2
        assert data["status"] == "extracted"

    def test_refetch_pending_result(self, db_path: Path) -> None:
        from dataclasses import dataclass, field

        @dataclass
        class FakePendingResult:
            video_id: str = "abc123"
            status: str = "pending"
            source: str | None = None
            songs: list = field(default_factory=list)

        conn = open_db(db_path)
        _add_stream(conn)
        _add_songs(conn)
        conn.close()

        app = create_app(db_path=db_path)
        app.config["TESTING"] = True
        with app.test_client() as c:
            with patch(
                "mizukilens.extraction.extract_timestamps",
                return_value=FakePendingResult(),
            ):
                resp = c.post("/api/streams/abc123/refetch")

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["source"] is None
        assert data["songCount"] == 0
        assert data["status"] == "pending"
