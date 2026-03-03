"""Tests for eximport CLI command (export + import combined).

All tests use Click's CliRunner and mock external I/O.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from click.testing import CliRunner

from mizukilens.cache import open_db, upsert_stream, upsert_parsed_songs
from mizukilens.cli import main


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SONG_A: dict[str, Any] = {
    "order_index": 0,
    "song_name": "Lemon",
    "artist": "米津玄師",
    "start_timestamp": "0:03:20",
    "end_timestamp": "0:08:15",
    "note": None,
}

_SONG_B: dict[str, Any] = {
    "order_index": 1,
    "song_name": "打上花火",
    "artist": "DAOKO×米津玄師",
    "start_timestamp": "0:08:15",
    "end_timestamp": None,
    "note": "清唱版",
}


def _add_approved_stream(
    conn: sqlite3.Connection,
    video_id: str = "vid001",
    title: str = "Test Stream",
    date: str = "2024-03-15",
    songs: list[dict[str, Any]] | None = None,
) -> None:
    """Insert an approved stream with songs."""
    upsert_stream(
        conn,
        video_id=video_id,
        channel_id="UCtest",
        title=title,
        date=date,
        status="approved",
    )
    if songs:
        upsert_parsed_songs(conn, video_id, songs)


def _write_mizukiprism_data(
    data_dir: Path,
    songs: list[dict] | None = None,
    streams: list[dict] | None = None,
) -> tuple[Path, Path]:
    """Write songs.json and streams.json, return their paths."""
    data_dir.mkdir(parents=True, exist_ok=True)
    songs_path = data_dir / "songs.json"
    streams_path = data_dir / "streams.json"
    songs_path.write_text(json.dumps(songs or []), encoding="utf-8")
    streams_path.write_text(json.dumps(streams or []), encoding="utf-8")
    return songs_path, streams_path


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestEximportEndToEnd:
    """The eximport command should export then import in one step."""

    def test_export_import_runs_successfully(self, tmp_path: Path) -> None:
        """End-to-end: approved stream → export → import into empty data."""
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)
        _add_approved_stream(conn, video_id="eximVid", songs=[_SONG_A])
        conn.close()

        # Set up empty MizukiPrism data directory
        prism_root = tmp_path / "prism"
        songs_path, streams_path = _write_mizukiprism_data(prism_root / "data")

        def mock_open_db(*args, **kwargs):
            return open_db(db_path)

        runner = CliRunner()
        with (
            patch("mizukilens.cache.open_db", side_effect=mock_open_db),
            patch("mizukilens.discovery.get_active_channel_info", return_value=("UCtest", [])),
        ):
            result = runner.invoke(
                main,
                [
                    "eximport",
                    "--songs-file", str(songs_path),
                    "--streams-file", str(streams_path),
                ],
                input="y\n",  # confirm import
            )

        assert result.exit_code == 0, f"CLI failed:\n{result.output}"
        assert "匯出完了" in result.output  # export phase
        assert "匯入完成" in result.output  # import phase

        # Verify data was written
        imported_songs = json.loads(songs_path.read_text(encoding="utf-8"))
        imported_streams = json.loads(streams_path.read_text(encoding="utf-8"))
        assert len(imported_songs) == 1
        assert imported_songs[0]["title"] == "Lemon"
        assert len(imported_streams) == 1

    def test_multiple_songs_imported(self, tmp_path: Path) -> None:
        """Multiple songs in a stream are all imported."""
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)
        _add_approved_stream(conn, video_id="multiVid", songs=[_SONG_A, _SONG_B])
        conn.close()

        prism_root = tmp_path / "prism"
        songs_path, streams_path = _write_mizukiprism_data(prism_root / "data")

        def mock_open_db(*args, **kwargs):
            return open_db(db_path)

        runner = CliRunner()
        with (
            patch("mizukilens.cache.open_db", side_effect=mock_open_db),
            patch("mizukilens.discovery.get_active_channel_info", return_value=("UCtest", [])),
        ):
            result = runner.invoke(
                main,
                [
                    "eximport",
                    "--songs-file", str(songs_path),
                    "--streams-file", str(streams_path),
                ],
                input="y\n",
            )

        assert result.exit_code == 0, f"CLI failed:\n{result.output}"
        imported_songs = json.loads(songs_path.read_text(encoding="utf-8"))
        assert len(imported_songs) == 2


class TestEximportNoApproved:
    """When no approved streams exist, eximport should exit gracefully."""

    def test_no_approved_streams_shows_message(self, tmp_path: Path) -> None:
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)
        conn.close()

        def mock_open_db(*args, **kwargs):
            return open_db(db_path)

        runner = CliRunner()
        with (
            patch("mizukilens.cache.open_db", side_effect=mock_open_db),
            patch("mizukilens.discovery.get_active_channel_info", return_value=("UCtest", [])),
        ):
            result = runner.invoke(main, ["eximport"])

        assert result.exit_code == 0
        assert "無可匯出的資料" in result.output


class TestEximportFilters:
    """Export filters (--since, --stream) are forwarded correctly."""

    def test_since_filter_forwarded(self, tmp_path: Path) -> None:
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)
        conn.close()

        captured: dict[str, Any] = {}

        def mock_export(conn, *, since=None, stream_id=None, output_dir=None, channel_id=""):
            captured["since"] = since
            raise ValueError("no_approved_streams")

        def mock_open_db(*args, **kwargs):
            return open_db(db_path)

        runner = CliRunner()
        with (
            patch("mizukilens.cache.open_db", side_effect=mock_open_db),
            patch("mizukilens.discovery.get_active_channel_info", return_value=("UCtest", [])),
            patch("mizukilens.export.export_approved_streams", side_effect=mock_export),
        ):
            result = runner.invoke(main, ["eximport", "--since", "2024-03-01"])

        assert captured.get("since") == "2024-03-01"

    def test_stream_filter_forwarded(self, tmp_path: Path) -> None:
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)
        conn.close()

        captured: dict[str, Any] = {}

        def mock_export(conn, *, since=None, stream_id=None, output_dir=None, channel_id=""):
            captured["stream_id"] = stream_id
            raise ValueError("no_approved_streams")

        def mock_open_db(*args, **kwargs):
            return open_db(db_path)

        runner = CliRunner()
        with (
            patch("mizukilens.cache.open_db", side_effect=mock_open_db),
            patch("mizukilens.discovery.get_active_channel_info", return_value=("UCtest", [])),
            patch("mizukilens.export.export_approved_streams", side_effect=mock_export),
        ):
            result = runner.invoke(main, ["eximport", "--stream", "videoXYZ"])

        assert captured.get("stream_id") == "videoXYZ"

    def test_songs_file_and_streams_file_forwarded(self, tmp_path: Path) -> None:
        """--songs-file and --streams-file override auto-detection."""
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)
        _add_approved_stream(conn, video_id="fwdVid", songs=[_SONG_A])
        conn.close()

        custom_dir = tmp_path / "custom"
        songs_path, streams_path = _write_mizukiprism_data(custom_dir)

        def mock_open_db(*args, **kwargs):
            return open_db(db_path)

        runner = CliRunner()
        with (
            patch("mizukilens.cache.open_db", side_effect=mock_open_db),
            patch("mizukilens.discovery.get_active_channel_info", return_value=("UCtest", [])),
        ):
            result = runner.invoke(
                main,
                [
                    "eximport",
                    "--songs-file", str(songs_path),
                    "--streams-file", str(streams_path),
                ],
                input="y\n",
            )

        assert result.exit_code == 0, f"CLI failed:\n{result.output}"
        # Verify data was written to the custom paths
        imported_songs = json.loads(songs_path.read_text(encoding="utf-8"))
        assert len(imported_songs) == 1


class TestEximportCancellation:
    """User can cancel at the confirmation prompt."""

    def test_cancel_does_not_write(self, tmp_path: Path) -> None:
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)
        _add_approved_stream(conn, video_id="cancelVid", songs=[_SONG_A])
        conn.close()

        prism_root = tmp_path / "prism"
        songs_path, streams_path = _write_mizukiprism_data(prism_root / "data")

        def mock_open_db(*args, **kwargs):
            return open_db(db_path)

        runner = CliRunner()
        with (
            patch("mizukilens.cache.open_db", side_effect=mock_open_db),
            patch("mizukilens.discovery.get_active_channel_info", return_value=("UCtest", [])),
        ):
            result = runner.invoke(
                main,
                [
                    "eximport",
                    "--songs-file", str(songs_path),
                    "--streams-file", str(streams_path),
                ],
                input="n\n",  # deny import
            )

        assert result.exit_code == 0
        assert "キャンセル" in result.output
        # Data should still be empty
        imported_songs = json.loads(songs_path.read_text(encoding="utf-8"))
        assert len(imported_songs) == 0
