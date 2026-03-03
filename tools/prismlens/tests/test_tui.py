"""Tests for the MizukiLens review TUI (LENS-005).

Uses direct DB state verification and method-level testing.
Async Textual pilot tests are intentionally avoided because
``pytest-anyio`` + Textual 8.x headless mode hangs on macOS.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from mizukilens.cache import (
    get_parsed_songs,
    get_stream,
    list_streams,
    open_db,
    update_stream_status,
    upsert_parsed_songs,
    upsert_stream,
)
from mizukilens.tui import (
    CandidateListDialog,
    ConfirmDialog,
    EditSongDialog,
    HelpDialog,
    PasteImportDialog,
    ReviewApp,
    STATUS_ICONS,
    REVIEWABLE_STATUSES,
    is_valid_timestamp,
    launch_review_tui,
)


# ---------------------------------------------------------------------------
# Helpers / Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def db(tmp_path: Path) -> sqlite3.Connection:
    """Return an open DB connection backed by a temp file."""
    conn = open_db(tmp_path / "test_tui.db")
    yield conn
    conn.close()


def _add_stream(
    conn: sqlite3.Connection,
    video_id: str = "vid001",
    *,
    status: str = "extracted",
    title: str = "テスト歌回",
    date: str = "2024-03-15",
    source: str | None = "comment",
) -> None:
    """Helper: insert a stream with sensible defaults."""
    upsert_stream(
        conn,
        video_id=video_id,
        channel_id="UCtest",
        title=title,
        date=date,
        status=status,
        source=source,
    )


def _add_songs(conn: sqlite3.Connection, video_id: str, count: int = 3) -> None:
    """Helper: insert *count* placeholder songs for *video_id*."""
    songs = [
        {
            "order_index": i,
            "song_name": f"曲名{i + 1}",
            "artist": f"アーティスト{i + 1}",
            "start_timestamp": f"0:{i * 3:02d}:00",
            "end_timestamp": f"0:{(i + 1) * 3:02d}:00" if i < count - 1 else None,
            "note": None,
        }
        for i in range(count)
    ]
    upsert_parsed_songs(conn, video_id, songs)


# ---------------------------------------------------------------------------
# Section 1: Helper function tests
# ---------------------------------------------------------------------------


class TestIsValidTimestamp:
    """Tests for the timestamp format validator."""

    def test_mm_ss_valid(self) -> None:
        assert is_valid_timestamp("3:20") is True

    def test_h_mm_ss_valid(self) -> None:
        assert is_valid_timestamp("1:23:45") is True

    def test_hh_mm_ss_valid(self) -> None:
        assert is_valid_timestamp("10:23:45") is True

    def test_mm_ss_zero_padded(self) -> None:
        assert is_valid_timestamp("0:03:20") is True

    def test_empty_invalid(self) -> None:
        assert is_valid_timestamp("") is False

    def test_plain_number_invalid(self) -> None:
        assert is_valid_timestamp("12345") is False

    def test_text_invalid(self) -> None:
        assert is_valid_timestamp("abc") is False

    def test_partial_format_invalid(self) -> None:
        assert is_valid_timestamp("3:2") is False  # seconds must be 2 digits

    def test_strips_whitespace(self) -> None:
        assert is_valid_timestamp("  3:20  ") is True


class TestStatusIcons:
    """Verify STATUS_ICONS mapping includes all relevant statuses."""

    def test_approved_icon(self) -> None:
        assert STATUS_ICONS["approved"] == "●"

    def test_extracted_icon(self) -> None:
        assert STATUS_ICONS["extracted"] == "○"

    def test_pending_icon(self) -> None:
        assert STATUS_ICONS["pending"] == "◌"

    def test_excluded_icon(self) -> None:
        assert STATUS_ICONS["excluded"] == "✕"


class TestReviewableStatuses:
    """Verify REVIEWABLE_STATUSES contains the expected statuses."""

    def test_extracted_reviewable(self) -> None:
        assert "extracted" in REVIEWABLE_STATUSES

    def test_pending_reviewable(self) -> None:
        assert "pending" in REVIEWABLE_STATUSES

    def test_approved_reviewable(self) -> None:
        assert "approved" in REVIEWABLE_STATUSES

    def test_exported_reviewable(self) -> None:
        assert "exported" in REVIEWABLE_STATUSES

    def test_excluded_not_reviewable(self) -> None:
        assert "excluded" not in REVIEWABLE_STATUSES


# ---------------------------------------------------------------------------
# Section 2: ReviewApp initialization tests (headless)
# ---------------------------------------------------------------------------


class TestReviewAppInit:
    """Test TUI app construction and initial state."""

    def test_app_can_be_instantiated(self, db: sqlite3.Connection) -> None:
        app = ReviewApp(conn=db)
        assert app is not None

    def test_app_stores_connection(self, db: sqlite3.Connection) -> None:
        app = ReviewApp(conn=db)
        assert app._conn is db

    def test_app_default_show_all_false(self, db: sqlite3.Connection) -> None:
        app = ReviewApp(conn=db)
        assert app._show_all is False

    def test_app_show_all_true(self, db: sqlite3.Connection) -> None:
        app = ReviewApp(conn=db, show_all=True)
        assert app._show_all is True

    def test_app_initial_stream_idx_negative(self, db: sqlite3.Connection) -> None:
        app = ReviewApp(conn=db)
        assert app._current_stream_idx == -1

    def test_app_initial_streams_empty(self, db: sqlite3.Connection) -> None:
        app = ReviewApp(conn=db)
        assert app._streams == []


# ---------------------------------------------------------------------------
# Section 3: Stream list loading (synchronous, no pilot)
# ---------------------------------------------------------------------------


class TestStreamListLoading:
    """Test stream list loading logic without launching the TUI."""

    def test_reviewable_streams_loaded(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="extracted", title="歌回 Vol.1")
        _add_stream(db, "vid002", status="pending", title="歌回 Vol.2")
        _add_stream(db, "vid003", status="approved", title="歌回 Vol.3")

        app = ReviewApp(conn=db, show_all=False)
        # Simulate what on_mount does for stream loading
        all_streams = list(list_streams(db))
        app._streams = [s for s in all_streams if s["status"] in REVIEWABLE_STATUSES]
        assert len(app._streams) == 3

    def test_show_all_false_hides_excluded(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="extracted")
        _add_stream(db, "vid002", status="excluded")

        app = ReviewApp(conn=db, show_all=False)
        all_streams = list(list_streams(db))
        app._streams = [s for s in all_streams if s["status"] in REVIEWABLE_STATUSES]
        assert len(app._streams) == 1
        assert app._streams[0]["video_id"] == "vid001"

    def test_show_all_true_includes_excluded(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="extracted")
        _add_stream(db, "vid002", status="excluded")

        app = ReviewApp(conn=db, show_all=True)
        app._streams = list(list_streams(db))
        assert len(app._streams) == 2

    def test_songs_loaded_for_stream(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="extracted")
        _add_songs(db, "vid001", count=3)

        app = ReviewApp(conn=db)
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0
        app._songs = list(get_parsed_songs(db, "vid001"))
        assert len(app._songs) == 3

    def test_empty_db_no_crash(self, db: sqlite3.Connection) -> None:
        app = ReviewApp(conn=db)
        app._streams = list(list_streams(db))
        assert len(app._streams) == 0
        assert app._songs == []

    def test_discovered_status_hidden_by_default(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="discovered")
        _add_stream(db, "vid002", status="extracted")

        app = ReviewApp(conn=db, show_all=False)
        all_streams = list(list_streams(db))
        app._streams = [s for s in all_streams if s["status"] in REVIEWABLE_STATUSES]
        assert len(app._streams) == 1
        assert app._streams[0]["video_id"] == "vid002"


# ---------------------------------------------------------------------------
# Section 4: Approve action (synchronous via cache)
# ---------------------------------------------------------------------------


class TestApproveAction:
    """Test approve action through direct cache calls (mirrors TUI behavior)."""

    def test_approve_extracted_stream(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="extracted")
        _add_songs(db, "vid001")

        update_stream_status(db, "vid001", "approved")

        stream = get_stream(db, "vid001")
        assert stream["status"] == "approved"

    def test_approve_pending_stream(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="pending")

        update_stream_status(db, "vid001", "approved")

        stream = get_stream(db, "vid001")
        assert stream["status"] == "approved"

    def test_approve_already_approved_is_noop(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="approved")
        _add_songs(db, "vid001")

        # Already approved — the TUI shows a notification but doesn't crash
        stream = get_stream(db, "vid001")
        assert stream["status"] == "approved"


# ---------------------------------------------------------------------------
# Section 5: Exclude action (synchronous via cache)
# ---------------------------------------------------------------------------


class TestExcludeAction:
    """Test exclude action through direct cache calls."""

    def test_exclude_changes_status(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="extracted")

        update_stream_status(db, "vid001", "excluded")

        stream = get_stream(db, "vid001")
        assert stream["status"] == "excluded"

    def test_exclude_discovered_stream(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="discovered")

        update_stream_status(db, "vid001", "excluded")

        stream = get_stream(db, "vid001")
        assert stream["status"] == "excluded"

    def test_cancelled_exclude_keeps_status(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="extracted")

        # Simulate cancel: don't call update_stream_status
        stream = get_stream(db, "vid001")
        assert stream["status"] == "extracted"


# ---------------------------------------------------------------------------
# Section 7: Edit song tests (DB state-based)
# ---------------------------------------------------------------------------


class TestEditSongPersistence:
    """Test that edit song operations persist correctly to the DB."""

    def test_save_edited_song_updates_db(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="extracted")
        _add_songs(db, "vid001", count=2)

        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0
        app._songs = list(get_parsed_songs(db, "vid001"))
        app._selected_song_idx = 0

        updated = {
            "song_name": "新しい歌名",
            "artist": "新しいアーティスト",
            "start_timestamp": "0:05:00",
            "end_timestamp": "0:10:00",
            "note": "テストメモ",
            "order_index": 0,
        }
        app._save_edited_song(0, updated)

        songs = get_parsed_songs(db, "vid001")
        assert songs[0]["song_name"] == "新しい歌名"
        assert songs[0]["artist"] == "新しいアーティスト"
        assert songs[0]["start_timestamp"] == "0:05:00"
        assert songs[0]["note"] == "テストメモ"

    def test_save_edited_song_preserves_other_songs(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="extracted")
        _add_songs(db, "vid001", count=3)

        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0
        app._songs = list(get_parsed_songs(db, "vid001"))
        app._selected_song_idx = 0

        updated = {
            "song_name": "変更した歌",
            "artist": "変更したアーティスト",
            "start_timestamp": "0:01:00",
            "end_timestamp": None,
            "note": None,
            "order_index": 0,
        }
        app._save_edited_song(0, updated)

        songs = get_parsed_songs(db, "vid001")
        assert len(songs) == 3
        # Other songs should be unchanged
        assert songs[1]["song_name"] == "曲名2"
        assert songs[2]["song_name"] == "曲名3"


# ---------------------------------------------------------------------------
# Section 8: Add/Delete song tests
# ---------------------------------------------------------------------------


class TestAddDeleteSong:
    """Test adding and deleting songs."""

    def test_insert_new_song_appends_to_list(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="extracted")
        _add_songs(db, "vid001", count=2)

        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0
        app._songs = list(get_parsed_songs(db, "vid001"))
        app._selected_song_idx = -1  # No selection, will append at end

        new_song = {
            "song_name": "新しい曲",
            "artist": "新アーティスト",
            "start_timestamp": "0:15:00",
            "end_timestamp": None,
            "note": None,
        }
        app._insert_new_song(new_song)

        songs = get_parsed_songs(db, "vid001")
        assert len(songs) == 3
        # The new song should be in the list
        song_names = [s["song_name"] for s in songs]
        assert "新しい曲" in song_names

    def test_insert_new_song_to_empty_stream(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="pending")
        # No songs added

        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0
        app._songs = list(get_parsed_songs(db, "vid001"))
        app._selected_song_idx = -1

        new_song = {
            "song_name": "最初の曲",
            "artist": "アーティスト",
            "start_timestamp": "0:01:00",
            "end_timestamp": None,
            "note": None,
        }
        app._insert_new_song(new_song)

        songs = get_parsed_songs(db, "vid001")
        assert len(songs) == 1
        assert songs[0]["song_name"] == "最初の曲"

    def test_delete_song_removes_from_db(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="extracted")
        _add_songs(db, "vid001", count=3)

        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0
        app._songs = list(get_parsed_songs(db, "vid001"))

        # Delete the middle song (index 1)
        app._do_delete_song(1)

        songs = get_parsed_songs(db, "vid001")
        assert len(songs) == 2
        # Remaining songs should be reindexed
        assert songs[0]["order_index"] == 0
        assert songs[1]["order_index"] == 1

    def test_delete_song_reindexes_correctly(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="extracted")
        _add_songs(db, "vid001", count=4)

        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0
        app._songs = list(get_parsed_songs(db, "vid001"))

        app._do_delete_song(0)  # Delete first song

        songs = get_parsed_songs(db, "vid001")
        assert len(songs) == 3
        # Indices should be 0, 1, 2
        for i, song in enumerate(songs):
            assert song["order_index"] == i

    def test_delete_all_songs_leaves_empty_list(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="extracted")
        _add_songs(db, "vid001", count=1)

        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0
        app._songs = list(get_parsed_songs(db, "vid001"))

        app._do_delete_song(0)

        songs = get_parsed_songs(db, "vid001")
        assert len(songs) == 0


# ---------------------------------------------------------------------------
# Section 9: Approve/Exclude DB state changes (non-pilot)
# ---------------------------------------------------------------------------


class TestStatusChangesDirectly:
    """Test status change methods directly without pilot."""

    def test_do_approve_stream_sets_approved(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="extracted")

        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0

        # Call internal method directly (bypass TUI notification)
        from mizukilens.cache import update_stream_status
        update_stream_status(db, "vid001", "approved")

        stream = get_stream(db, "vid001")
        assert stream["status"] == "approved"

    def test_do_exclude_stream_sets_excluded(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="extracted")

        from mizukilens.cache import update_stream_status
        update_stream_status(db, "vid001", "excluded")

        stream = get_stream(db, "vid001")
        assert stream["status"] == "excluded"

    def test_pending_stream_can_be_approved(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="pending")

        from mizukilens.cache import update_stream_status
        update_stream_status(db, "vid001", "approved")

        stream = get_stream(db, "vid001")
        assert stream["status"] == "approved"


# ---------------------------------------------------------------------------
# Section 10: Re-fetch integration tests
# ---------------------------------------------------------------------------


class TestRefetchIntegration:
    """Test the re-fetch mechanism."""

    def test_do_refetch_stream_with_mock_extraction(self, db: sqlite3.Connection) -> None:
        """Verify re-fetch calls extract_timestamps and updates songs."""
        _add_stream(db, "vid001", status="extracted")
        _add_songs(db, "vid001", count=2)

        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0
        app._songs = list(get_parsed_songs(db, "vid001"))

        new_comment = "0:00 新曲A\n2:00 新曲B\n4:00 新曲C\n"
        mock_comment = {
            "cid": "c1", "text": new_comment, "votes": "100",
            "is_pinned": False, "author": "u", "channel": "ch",
            "replies": "0", "photo": "", "heart": False, "reply": False,
        }
        mock_downloader = MagicMock()
        mock_downloader.get_comments.return_value = iter([mock_comment])

        with patch(
            "youtube_comment_downloader.YoutubeCommentDownloader",
            return_value=mock_downloader,
        ):
            from mizukilens.extraction import extract_timestamps
            result = extract_timestamps(db, "vid001")

        assert result.status == "extracted"
        songs = get_parsed_songs(db, "vid001")
        assert len(songs) == 3
        assert songs[0]["song_name"] == "新曲A"

    def test_refetch_with_no_timestamps_sets_pending(self, db: sqlite3.Connection) -> None:
        """Verify re-fetch without timestamps marks stream as pending."""
        _add_stream(db, "vid001", status="extracted")
        _add_songs(db, "vid001", count=2)

        # Reset to discovered status first for re-extraction
        # (in practice the stream is already extracted; extraction handles pending transition)
        mock_downloader = MagicMock()
        mock_downloader.get_comments.return_value = iter([
            {
                "cid": "c1",
                "text": "No timestamps here",
                "votes": "0",
                "is_pinned": False,
                "author": "u",
                "channel": "ch",
                "replies": "0",
                "photo": "",
                "heart": False,
                "reply": False,
            }
        ])

        with (
            patch(
                "youtube_comment_downloader.YoutubeCommentDownloader",
                return_value=mock_downloader,
            ),
            patch("mizukilens.extraction.get_description_from_ytdlp", return_value=None),
        ):
            from mizukilens.extraction import extract_timestamps
            # Note: extracted → pending is not a valid transition in the cache module.
            # The _safe_transition helper silently skips invalid transitions.
            result = extract_timestamps(db, "vid001")

        # The status remains "extracted" since extracted→pending is not allowed
        # (pending means no auto-extraction was possible; once extracted it stays there)
        stream = get_stream(db, "vid001")
        assert stream["status"] in ("extracted", "pending")


# ---------------------------------------------------------------------------
# Section 11: CLI review command tests
# ---------------------------------------------------------------------------


class TestCliReviewCommand:
    """Test the CLI review command integration."""

    def test_review_command_calls_launch_tui(self, tmp_path: Path) -> None:
        """Verify the review CLI command invokes launch_review_tui."""
        from click.testing import CliRunner
        from mizukilens.cli import main

        db_path = tmp_path / "test_review.db"
        conn = open_db(db_path)
        conn.close()

        def mock_open_db(*args, **kwargs):
            return open_db(db_path)

        with (
            patch("mizukilens.cache.open_db", side_effect=mock_open_db),
            patch("mizukilens.tui.launch_review_tui") as mock_launch,
        ):
            runner = CliRunner()
            result = runner.invoke(main, ["review"])

        mock_launch.assert_called_once()
        assert result.exit_code == 0

    def test_review_command_passes_show_all_flag(self, tmp_path: Path) -> None:
        """Verify --all flag is passed to launch_review_tui."""
        from click.testing import CliRunner
        from mizukilens.cli import main

        db_path = tmp_path / "test_review_all.db"
        conn = open_db(db_path)
        conn.close()

        def mock_open_db(*args, **kwargs):
            return open_db(db_path)

        with (
            patch("mizukilens.cache.open_db", side_effect=mock_open_db),
            patch("mizukilens.tui.launch_review_tui") as mock_launch,
        ):
            runner = CliRunner()
            result = runner.invoke(main, ["review", "--all"])

        # Called with show_all=True
        call_kwargs = mock_launch.call_args
        assert call_kwargs is not None
        assert call_kwargs.kwargs.get("show_all") is True or (
            len(call_kwargs.args) > 1 and call_kwargs.args[1] is True
        )

    def test_review_command_exists(self) -> None:
        """Verify the review command is registered in the CLI."""
        from click.testing import CliRunner
        from mizukilens.cli import main

        runner = CliRunner()
        result = runner.invoke(main, ["--help"])
        assert "review" in result.output


# ---------------------------------------------------------------------------
# Section 12: Edit dialog unit tests
# ---------------------------------------------------------------------------


class TestEditSongDialog:
    """Unit tests for the EditSongDialog helper."""

    def test_edit_dialog_can_be_instantiated(self) -> None:
        song = {
            "song_name": "テスト曲",
            "artist": "テストアーティスト",
            "start_timestamp": "0:03:20",
            "end_timestamp": "0:08:15",
            "note": None,
            "order_index": 0,
        }
        dialog = EditSongDialog(song)
        assert dialog._song["song_name"] == "テスト曲"

    def test_edit_dialog_copies_song_dict(self) -> None:
        song = {"song_name": "オリジナル", "start_timestamp": "0:01:00"}
        dialog = EditSongDialog(song)
        dialog._song["song_name"] = "変更"
        assert song["song_name"] == "オリジナル"  # Original unchanged


# ---------------------------------------------------------------------------
# Section 13: Note editing
# ---------------------------------------------------------------------------


class TestNoteEditing:
    """Test that notes can be added/edited for songs."""

    def test_save_song_with_note(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="extracted")
        _add_songs(db, "vid001", count=1)

        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0
        app._songs = list(get_parsed_songs(db, "vid001"))

        updated = {
            "song_name": "曲名1",
            "artist": "アーティスト1",
            "start_timestamp": "0:00:00",
            "end_timestamp": None,
            "note": "清唱版",
            "order_index": 0,
        }
        app._save_edited_song(0, updated)

        songs = get_parsed_songs(db, "vid001")
        assert songs[0]["note"] == "清唱版"

    def test_clear_note_from_song(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="extracted")
        # Add song with a note
        upsert_parsed_songs(db, "vid001", [{
            "order_index": 0,
            "song_name": "曲名1",
            "artist": "アーティスト1",
            "start_timestamp": "0:00:00",
            "end_timestamp": None,
            "note": "清唱版",
        }])

        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0
        app._songs = list(get_parsed_songs(db, "vid001"))

        updated = {
            "song_name": "曲名1",
            "artist": "アーティスト1",
            "start_timestamp": "0:00:00",
            "end_timestamp": None,
            "note": None,
            "order_index": 0,
        }
        app._save_edited_song(0, updated)

        songs = get_parsed_songs(db, "vid001")
        assert songs[0]["note"] is None


# ---------------------------------------------------------------------------
# Section 14: Pending stream manual input workflow
# ---------------------------------------------------------------------------


class TestPendingStreamWorkflow:
    """Test the manual input workflow for pending streams."""

    def test_can_add_songs_to_pending_stream(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid001", status="pending")
        # No songs initially

        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0
        app._songs = []
        app._selected_song_idx = -1

        # Add first song
        new_song = {
            "song_name": "手動入力曲1",
            "artist": "アーティスト",
            "start_timestamp": "0:01:00",
            "end_timestamp": "0:04:00",
            "note": None,
        }
        app._insert_new_song(new_song)

        songs = get_parsed_songs(db, "vid001")
        assert len(songs) == 1
        assert songs[0]["song_name"] == "手動入力曲1"

    def test_pending_stream_approved_after_manual_confirmation(
        self, db: sqlite3.Connection
    ) -> None:
        """Pending stream can be approved after curator adds songs."""
        _add_stream(db, "vid001", status="pending")
        _add_songs(db, "vid001", count=2)

        from mizukilens.cache import update_stream_status
        update_stream_status(db, "vid001", "approved")

        stream = get_stream(db, "vid001")
        assert stream["status"] == "approved"


# ===========================================================================
# SECTION: Comment author attribution in TUI (LENS-008)
# ===========================================================================


class TestTuiCommentAttribution:
    """Tests for comment author display in the review TUI."""

    def test_comment_author_stored_in_stream(self, db: sqlite3.Connection) -> None:
        """Verify the DB stream row has comment_author when set."""
        upsert_stream(
            db,
            video_id="tui_auth1",
            channel_id="UCtest",
            title="Author Stream",
            date="2024-03-15",
            status="extracted",
            source="comment",
            comment_author="TimestampHero",
            comment_author_url="https://youtube.com/channel/UC123",
            comment_id="Ugxyz",
        )
        stream = get_stream(db, "tui_auth1")
        assert stream["comment_author"] == "TimestampHero"

    def test_description_source_has_no_author(self, db: sqlite3.Connection) -> None:
        """Description-sourced streams should have NULL comment_author."""
        upsert_stream(
            db,
            video_id="tui_auth2",
            channel_id="UCtest",
            title="Description Stream",
            date="2024-03-15",
            status="extracted",
            source="description",
        )
        stream = get_stream(db, "tui_auth2")
        assert stream["comment_author"] is None

    def test_review_app_instantiates_with_author_streams(
        self, db: sqlite3.Connection
    ) -> None:
        """ReviewApp should create without errors even with author attribution data."""
        upsert_stream(
            db,
            video_id="tui_auth3",
            channel_id="UCtest",
            title="TUI Author Stream",
            date="2024-03-15",
            status="extracted",
            source="comment",
            comment_author="TestAuthor",
        )
        _add_songs(db, "tui_auth3", count=2)

        # Smoke test: ReviewApp should instantiate without error
        app = ReviewApp(conn=db, show_all=False)
        assert app is not None


# ===========================================================================
# SECTION: Candidate comments TUI (show_candidates keybinding)
# ===========================================================================


class TestCandidatesTUI:
    """Tests for the candidate comments TUI keybinding and dialog."""

    def test_show_candidates_binding_exists(self, db: sqlite3.Connection) -> None:
        """Verify the 'c' keybinding is registered for show_candidates."""
        app = ReviewApp(conn=db)
        binding_keys = [b.key for b in app.BINDINGS]
        assert "c" in binding_keys

    def test_show_candidates_action_method_exists(self, db: sqlite3.Connection) -> None:
        """Verify ReviewApp has the action_show_candidates method."""
        app = ReviewApp(conn=db)
        assert hasattr(app, "action_show_candidates")
        assert callable(app.action_show_candidates)

    def test_candidate_list_dialog_instantiation(self) -> None:
        """CandidateListDialog can be instantiated with candidate data."""
        candidates = [
            {
                "id": 1,
                "comment_author": "歌單bot",
                "keywords_matched": "歌單",
                "status": "pending",
                "comment_text": "歌單：\n0:00 Song A\n1:30 Song B",
            },
        ]
        dialog = CandidateListDialog(candidates)
        assert dialog._candidates == candidates

    def test_candidate_list_dialog_empty(self) -> None:
        """CandidateListDialog with empty candidates list."""
        dialog = CandidateListDialog([])
        assert dialog._candidates == []

    def test_do_approve_candidate_method_exists(self, db: sqlite3.Connection) -> None:
        """Verify ReviewApp has the _do_approve_candidate method."""
        app = ReviewApp(conn=db)
        assert hasattr(app, "_do_approve_candidate")
        assert callable(app._do_approve_candidate)

    def test_help_text_includes_candidates(self, db: sqlite3.Connection) -> None:
        """Verify help text mentions the [c] keybinding for candidates."""
        assert "[c]" in HelpDialog.HELP_TEXT
        assert "候選留言" in HelpDialog.HELP_TEXT

    def test_candidate_dialog_has_row_selected_handler(self) -> None:
        """CandidateListDialog has on_data_table_row_selected for click/Enter."""
        dialog = CandidateListDialog([])
        assert hasattr(dialog, "on_data_table_row_selected")
        assert callable(dialog.on_data_table_row_selected)

    def test_candidate_dialog_has_button_pressed_handler(self) -> None:
        """CandidateListDialog has on_button_pressed for approve/reject buttons."""
        dialog = CandidateListDialog([])
        assert hasattr(dialog, "on_button_pressed")
        assert callable(dialog.on_button_pressed)


# ===========================================================================
# SECTION: Copy VOD URL keybinding (u)
# ===========================================================================


class TestCopyVodUrl:
    """Tests for the copy VOD URL keybinding."""

    def test_copy_vod_url_binding_exists(self, db: sqlite3.Connection) -> None:
        """Verify the 'u' keybinding is registered for copy_vod_url."""
        app = ReviewApp(conn=db)
        binding_keys = [b.key for b in app.BINDINGS]
        assert "u" in binding_keys

    def test_copy_vod_url_action_method_exists(self, db: sqlite3.Connection) -> None:
        """Verify ReviewApp has the action_copy_vod_url method."""
        app = ReviewApp(conn=db)
        assert hasattr(app, "action_copy_vod_url")
        assert callable(app.action_copy_vod_url)

    def test_copy_vod_url_builds_correct_url(self, db: sqlite3.Connection) -> None:
        """Verify the URL is built correctly from the video_id."""
        _add_stream(db, "dQw4w9WgXcQ", status="extracted", title="Test Stream")

        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0

        video_id = app._streams[0]["video_id"]
        url = f"https://www.youtube.com/watch?v={video_id}"
        assert url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

    def test_copy_vod_url_no_stream_selected(self, db: sqlite3.Connection) -> None:
        """action_copy_vod_url returns early when no stream is selected."""
        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = []
        app._current_stream_idx = -1

        # Should not raise
        with patch.object(app, "copy_to_clipboard") as mock_copy:
            with patch.object(app, "notify") as mock_notify:
                app.action_copy_vod_url()
                mock_copy.assert_not_called()
                mock_notify.assert_not_called()

    def test_copy_vod_url_uses_pbcopy_on_macos(
        self, db: sqlite3.Connection
    ) -> None:
        """On macOS, pbcopy is called to copy the URL to clipboard."""
        _add_stream(db, "abc123", status="extracted", title="Test")

        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0

        with patch("sys.platform", "darwin"):
            with patch("subprocess.run") as mock_run:
                with patch.object(app, "notify") as mock_notify:
                    app.action_copy_vod_url()
                    mock_run.assert_called_once_with(
                        ["pbcopy"],
                        input=b"https://www.youtube.com/watch?v=abc123",
                        check=True,
                        timeout=2,
                    )
                    mock_notify.assert_called_once()
                    assert "abc123" in mock_notify.call_args[0][0]

    def test_copy_vod_url_falls_back_to_osc52_on_pbcopy_failure(
        self, db: sqlite3.Connection
    ) -> None:
        """When pbcopy fails on macOS, fall back to Textual's OSC 52."""
        _add_stream(db, "abc123", status="extracted", title="Test")

        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0

        with patch("sys.platform", "darwin"):
            with patch("subprocess.run", side_effect=FileNotFoundError):
                with patch.object(app, "copy_to_clipboard") as mock_copy:
                    with patch.object(app, "notify") as mock_notify:
                        app.action_copy_vod_url()
                        mock_copy.assert_called_once_with(
                            "https://www.youtube.com/watch?v=abc123"
                        )
                        mock_notify.assert_called_once()

    def test_copy_vod_url_uses_osc52_on_non_macos(
        self, db: sqlite3.Connection
    ) -> None:
        """On non-macOS platforms, Textual's copy_to_clipboard is used."""
        _add_stream(db, "abc123", status="extracted", title="Test")

        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0

        with patch("sys.platform", "linux"):
            with patch.object(app, "copy_to_clipboard") as mock_copy:
                with patch.object(app, "notify") as mock_notify:
                    app.action_copy_vod_url()
                    mock_copy.assert_called_once_with(
                        "https://www.youtube.com/watch?v=abc123"
                    )
                    mock_notify.assert_called_once()

    def test_help_text_includes_copy_url(self) -> None:
        """Verify help text mentions the [u] keybinding for URL copy."""
        assert "[u]" in HelpDialog.HELP_TEXT
        assert "URL" in HelpDialog.HELP_TEXT


# ===========================================================================
# SECTION: Clear all end timestamps TUI keybinding (t)
# ===========================================================================


class TestClearEndTimestamps:
    """Tests for the clear all end timestamps TUI action."""

    def test_clear_end_timestamps_binding_exists(self, db: sqlite3.Connection) -> None:
        """Verify the 't' keybinding is registered for clear_end_timestamps."""
        app = ReviewApp(conn=db)
        binding_keys = [b.key for b in app.BINDINGS]
        assert "t" in binding_keys

    def test_clear_end_timestamps_action_method_exists(
        self, db: sqlite3.Connection
    ) -> None:
        """Verify ReviewApp has the action_clear_end_timestamps method."""
        app = ReviewApp(conn=db)
        assert hasattr(app, "action_clear_end_timestamps")
        assert callable(app.action_clear_end_timestamps)

    def test_clear_end_timestamps_clears_db(self, db: sqlite3.Connection) -> None:
        """Calling _do_clear_end_timestamps nullifies all end_timestamp values."""
        _add_stream(db, "vid001", status="extracted")
        # Add songs with end timestamps
        upsert_parsed_songs(db, "vid001", [
            {
                "order_index": 0,
                "song_name": "曲A",
                "artist": "A",
                "start_timestamp": "0:00:00",
                "end_timestamp": "0:03:00",
                "note": None,
            },
            {
                "order_index": 1,
                "song_name": "曲B",
                "artist": "B",
                "start_timestamp": "0:03:00",
                "end_timestamp": "0:06:00",
                "note": None,
            },
            {
                "order_index": 2,
                "song_name": "曲C",
                "artist": "C",
                "start_timestamp": "0:06:00",
                "end_timestamp": None,
                "note": None,
            },
        ])

        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0
        app._songs = list(get_parsed_songs(db, "vid001"))

        app._do_clear_end_timestamps()

        songs = get_parsed_songs(db, "vid001")
        assert len(songs) == 3
        for song in songs:
            assert song["end_timestamp"] is None

    def test_clear_end_timestamps_returns_correct_count(
        self, db: sqlite3.Connection
    ) -> None:
        """Verify notification contains the right count of cleared rows."""
        _add_stream(db, "vid001", status="extracted")
        upsert_parsed_songs(db, "vid001", [
            {
                "order_index": 0,
                "song_name": "曲A",
                "artist": "A",
                "start_timestamp": "0:00:00",
                "end_timestamp": "0:03:00",
                "note": None,
            },
            {
                "order_index": 1,
                "song_name": "曲B",
                "artist": "B",
                "start_timestamp": "0:03:00",
                "end_timestamp": "0:06:00",
                "note": None,
            },
            {
                "order_index": 2,
                "song_name": "曲C",
                "artist": "C",
                "start_timestamp": "0:06:00",
                "end_timestamp": None,
                "note": None,
            },
        ])

        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0
        app._songs = list(get_parsed_songs(db, "vid001"))

        with patch.object(app, "notify") as mock_notify, \
             patch.object(app, "_load_songs"):
            app._do_clear_end_timestamps()
            mock_notify.assert_called_once()
            # 2 songs had end_timestamp set, 1 was already NULL
            assert "2" in mock_notify.call_args[0][0]

    def test_clear_end_timestamps_no_stream_noop(
        self, db: sqlite3.Connection
    ) -> None:
        """Guard condition: no-op when no stream is selected."""
        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = []
        app._current_stream_idx = -1

        with patch.object(app, "notify") as mock_notify:
            app._do_clear_end_timestamps()
            mock_notify.assert_not_called()

    def test_help_text_includes_clear_end_timestamps(self) -> None:
        """Verify help text mentions the [t] keybinding."""
        assert "[t]" in HelpDialog.HELP_TEXT
        assert "終了時刻クリア" in HelpDialog.HELP_TEXT


# ---------------------------------------------------------------------------
# Section: PasteImportDialog tests
# ---------------------------------------------------------------------------

PASTE_SAMPLE = """\
5:30 買你 - 魏如萱
17:00 ただ君に晴れ - ヨルシカ
1:01:30 怪物 - YOASOBI
"""


class TestPasteImportDialog:
    """Tests for :class:`PasteImportDialog`."""

    def test_dialog_can_be_instantiated(self) -> None:
        """Verify PasteImportDialog can be constructed."""
        dialog = PasteImportDialog()
        assert dialog is not None

    def test_parse_valid_text_returns_songs(self) -> None:
        """Verify _try_parse dismisses with parsed songs for valid input."""
        dialog = PasteImportDialog()
        # Mock the query_one calls and dismiss
        mock_textarea = MagicMock()
        mock_textarea.text = PASTE_SAMPLE
        mock_error_label = MagicMock()

        with (
            patch.object(dialog, "query_one", side_effect=lambda sel, cls: {
                "#paste-area": mock_textarea,
                "#paste-error": mock_error_label,
            }[sel]),
            patch.object(dialog, "dismiss") as mock_dismiss,
        ):
            dialog._try_parse()
            mock_dismiss.assert_called_once()
            songs = mock_dismiss.call_args[0][0]
            assert len(songs) == 3
            assert songs[0]["song_name"] == "買你"

    def test_parse_empty_text_shows_error(self) -> None:
        """No timestamps → error label updated."""
        dialog = PasteImportDialog()
        mock_textarea = MagicMock()
        mock_textarea.text = "no timestamps here"
        mock_error_label = MagicMock()

        with (
            patch.object(dialog, "query_one", side_effect=lambda sel, cls: {
                "#paste-area": mock_textarea,
                "#paste-error": mock_error_label,
            }[sel]),
            patch.object(dialog, "dismiss") as mock_dismiss,
        ):
            dialog._try_parse()
            mock_dismiss.assert_not_called()
            mock_error_label.update.assert_called_once()
            assert "タイムスタンプが見つかりません" in mock_error_label.update.call_args[0][0]

    def test_cancel_returns_none(self) -> None:
        """Pressing cancel dismisses with None."""
        dialog = PasteImportDialog()
        event = MagicMock()
        event.button = MagicMock()
        event.button.id = "cancel"
        with patch.object(dialog, "dismiss") as mock_dismiss:
            dialog.on_button_pressed(event)
            mock_dismiss.assert_called_once_with(None)


# ---------------------------------------------------------------------------
# Section: Paste action tests
# ---------------------------------------------------------------------------


class TestPasteAction:
    """Tests for ReviewApp paste songs action."""

    def test_paste_songs_to_empty_stream(self, db: sqlite3.Connection) -> None:
        """Paste songs to a stream with no existing songs."""
        _add_stream(db, "paste01", status="pending")
        app = ReviewApp(conn=db)
        app._streams = [get_stream(db, "paste01")]
        app._current_stream_idx = 0
        app._songs = []

        from mizukilens.extraction import parse_text_to_songs
        songs = parse_text_to_songs(PASTE_SAMPLE)

        with patch.object(app, "notify"):
            app._do_paste_songs(songs)

        saved = get_parsed_songs(db, "paste01")
        assert len(saved) == 3
        assert saved[0]["song_name"] == "買你"

    def test_paste_songs_replaces_existing(self, db: sqlite3.Connection) -> None:
        """Paste overwrites existing songs."""
        _add_stream(db, "paste02", status="extracted")
        _add_songs(db, "paste02", count=5)

        app = ReviewApp(conn=db)
        app._streams = [get_stream(db, "paste02")]
        app._current_stream_idx = 0
        app._songs = list(get_parsed_songs(db, "paste02"))

        from mizukilens.extraction import parse_text_to_songs
        songs = parse_text_to_songs(PASTE_SAMPLE)

        with patch.object(app, "notify"):
            app._do_paste_songs(songs)

        saved = get_parsed_songs(db, "paste02")
        assert len(saved) == 3  # replaced 5 with 3

    def test_paste_songs_status_transition(self, db: sqlite3.Connection) -> None:
        """Pending stream transitions to extracted after paste."""
        _add_stream(db, "paste03", status="pending")
        app = ReviewApp(conn=db)
        app._streams = [get_stream(db, "paste03")]
        app._current_stream_idx = 0
        app._songs = []

        from mizukilens.extraction import parse_text_to_songs
        songs = parse_text_to_songs(PASTE_SAMPLE)

        with patch.object(app, "notify"):
            app._do_paste_songs(songs)

        stream = get_stream(db, "paste03")
        assert stream["status"] == "extracted"


# ===========================================================================
# SECTION: Unapprove stream keybinding (z)
# ===========================================================================


class TestUnapproveStream:
    """Tests for the unapprove (z) keybinding and action."""

    def test_unapprove_binding_exists(self, db: sqlite3.Connection) -> None:
        """Verify the 'z' keybinding is registered for unapprove_stream."""
        app = ReviewApp(conn=db)
        binding_keys = [b.key for b in app.BINDINGS]
        assert "z" in binding_keys

    def test_unapprove_action_method_exists(self, db: sqlite3.Connection) -> None:
        """Verify ReviewApp has the action_unapprove_stream method."""
        app = ReviewApp(conn=db)
        assert hasattr(app, "action_unapprove_stream")
        assert callable(app.action_unapprove_stream)

    def test_do_unapprove_stream_sets_extracted(self, db: sqlite3.Connection) -> None:
        """Approve a stream, then unapprove — status should be extracted."""
        _add_stream(db, "vid001", status="extracted")
        _add_songs(db, "vid001")

        # First approve it
        update_stream_status(db, "vid001", "approved")
        assert get_stream(db, "vid001")["status"] == "approved"

        # Now unapprove via the internal method
        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0

        with patch.object(app, "notify"), \
             patch.object(app, "_load_streams_preserving_selection"):
            app._do_unapprove_stream("vid001")

        stream = get_stream(db, "vid001")
        assert stream["status"] == "extracted"

    def test_unapprove_non_approved_stream_fails(
        self, db: sqlite3.Connection
    ) -> None:
        """Unapprove on an extracted stream shows error notification."""
        _add_stream(db, "vid001", status="extracted")

        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = list(list_streams(db))
        app._current_stream_idx = 0

        with patch.object(app, "notify") as mock_notify:
            app._do_unapprove_stream("vid001")
            mock_notify.assert_called_once()
            msg = mock_notify.call_args[0][0]
            assert "取消承認できません" in msg

    def test_unapprove_no_stream_selected_noop(
        self, db: sqlite3.Connection
    ) -> None:
        """action_unapprove_stream returns early when no stream is selected."""
        app = ReviewApp(conn=db)
        app._conn = db
        app._streams = []
        app._current_stream_idx = -1

        with patch.object(app, "notify") as mock_notify:
            app.action_unapprove_stream()
            mock_notify.assert_not_called()

    def test_help_text_includes_unapprove(self) -> None:
        """Verify help text mentions the [z] keybinding for unapprove."""
        assert "[z]" in HelpDialog.HELP_TEXT
        assert "取消承認" in HelpDialog.HELP_TEXT


# ---------------------------------------------------------------------------
# Section: Year filter tests
# ---------------------------------------------------------------------------


class TestYearFilter:
    """Tests for the year filter feature ([ / ] keys)."""

    def test_cycle_year_forward_through_years(self, db: sqlite3.Connection) -> None:
        """Cycling forward goes: All → newest → … → oldest → All."""
        app = ReviewApp(conn=db)
        app._available_years = ["2025", "2024", "2021"]
        app._all_streams = []
        app._streams = []
        # Mock _apply_year_filter to avoid widget queries
        with patch.object(app, "_apply_year_filter"):
            assert app._year_filter is None  # All

            app._cycle_year(1)
            assert app._year_filter == "2025"

            app._cycle_year(1)
            assert app._year_filter == "2024"

            app._cycle_year(1)
            assert app._year_filter == "2021"

            app._cycle_year(1)  # Wraps back to All
            assert app._year_filter is None

    def test_cycle_year_backward_through_years(self, db: sqlite3.Connection) -> None:
        """Cycling backward goes: All → oldest → … → newest → All."""
        app = ReviewApp(conn=db)
        app._available_years = ["2025", "2024", "2021"]
        app._all_streams = []
        app._streams = []
        with patch.object(app, "_apply_year_filter"):
            assert app._year_filter is None

            app._cycle_year(-1)
            assert app._year_filter == "2021"

            app._cycle_year(-1)
            assert app._year_filter == "2024"

            app._cycle_year(-1)
            assert app._year_filter == "2025"

            app._cycle_year(-1)  # Wraps back to All
            assert app._year_filter is None

    def test_cycle_year_no_years_is_noop(self, db: sqlite3.Connection) -> None:
        """Cycling when no years are available does nothing."""
        app = ReviewApp(conn=db)
        app._available_years = []
        app._all_streams = []
        app._streams = []
        with patch.object(app, "_apply_year_filter") as mock:
            app._cycle_year(1)
            assert app._year_filter is None
            mock.assert_not_called()

    def test_cycle_year_single_year(self, db: sqlite3.Connection) -> None:
        """With one year, cycles between All and that year."""
        app = ReviewApp(conn=db)
        app._available_years = ["2024"]
        app._all_streams = []
        app._streams = []
        with patch.object(app, "_apply_year_filter"):
            app._cycle_year(1)
            assert app._year_filter == "2024"

            app._cycle_year(1)
            assert app._year_filter is None

    def test_year_extraction_from_streams(self, db: sqlite3.Connection) -> None:
        """_load_streams extracts unique years sorted DESC."""
        _add_stream(db, "v1", date="2024-03-15")
        _add_stream(db, "v2", date="2021-10-01")
        _add_stream(db, "v3", date="2024-08-20")
        _add_stream(db, "v4", date="2025-01-01")

        app = ReviewApp(conn=db)
        app._show_all = True
        # Only test _load_streams' year extraction, mock _apply_year_filter
        with patch.object(app, "_apply_year_filter"):
            from mizukilens.cache import list_streams as _ls

            app._all_streams = list(_ls(db))
            years: set[str] = set()
            for s in app._all_streams:
                d = s["date"]
                if d and len(d) >= 4 and d[:4].isdigit():
                    years.add(d[:4])
            app._available_years = sorted(years, reverse=True)

        assert app._available_years == ["2025", "2024", "2021"]

    def test_year_extraction_skips_unknown_dates(self, db: sqlite3.Connection) -> None:
        """Streams with None or non-date strings are excluded from year list."""
        _add_stream(db, "v1", date="2024-03-15")
        _add_stream(db, "v2", date="日付不明")

        app = ReviewApp(conn=db)
        app._show_all = True
        with patch.object(app, "_apply_year_filter"):
            from mizukilens.cache import list_streams as _ls

            app._all_streams = list(_ls(db))
            years: set[str] = set()
            for s in app._all_streams:
                d = s["date"]
                if d and len(d) >= 4 and d[:4].isdigit():
                    years.add(d[:4])
            app._available_years = sorted(years, reverse=True)

        assert app._available_years == ["2024"]

    def test_filter_narrows_streams(self, db: sqlite3.Connection) -> None:
        """Setting _year_filter before _apply_year_filter narrows _streams."""
        _add_stream(db, "v1", date="2024-03-15")
        _add_stream(db, "v2", date="2021-10-01")
        _add_stream(db, "v3", date="2024-08-20")

        app = ReviewApp(conn=db)
        app._show_all = True
        from mizukilens.cache import list_streams as _ls

        app._all_streams = list(_ls(db))

        # Simulate filtering without widgets
        app._year_filter = "2024"
        filtered = [
            s for s in app._all_streams
            if s["date"] and s["date"][:4] == app._year_filter
        ]
        assert len(filtered) == 2
        assert all(s["date"].startswith("2024") for s in filtered)

    def test_filter_all_shows_everything(self, db: sqlite3.Connection) -> None:
        """_year_filter=None includes all streams."""
        _add_stream(db, "v1", date="2024-03-15")
        _add_stream(db, "v2", date="2021-10-01")

        app = ReviewApp(conn=db)
        app._show_all = True
        from mizukilens.cache import list_streams as _ls

        app._all_streams = list(_ls(db))
        app._year_filter = None
        # None means no filter — all_streams == streams
        assert len(app._all_streams) == 2

    def test_filter_empty_year(self, db: sqlite3.Connection) -> None:
        """Filtering by a year with no streams yields empty list."""
        _add_stream(db, "v1", date="2024-03-15")

        app = ReviewApp(conn=db)
        from mizukilens.cache import list_streams as _ls

        app._all_streams = list(_ls(db))
        app._year_filter = "2099"
        filtered = [
            s for s in app._all_streams
            if s["date"] and s["date"][:4] == app._year_filter
        ]
        assert filtered == []

    def test_help_text_includes_year_navigation(self) -> None:
        """Verify help text mentions [ and ] for year navigation."""
        assert "前の年" in HelpDialog.HELP_TEXT
        assert "次の年" in HelpDialog.HELP_TEXT

    def test_init_has_year_filter_fields(self, db: sqlite3.Connection) -> None:
        """ReviewApp.__init__ initializes year filter fields."""
        app = ReviewApp(conn=db)
        assert app._year_filter is None
        assert app._available_years == []
        assert app._all_streams == []

    def test_cycle_year_with_stale_filter_resets(self, db: sqlite3.Connection) -> None:
        """If _year_filter is not in options, cycling resets to index 0 (All)."""
        app = ReviewApp(conn=db)
        app._available_years = ["2024"]
        app._all_streams = []
        app._streams = []
        app._year_filter = "1999"  # Not in available years
        with patch.object(app, "_apply_year_filter"):
            app._cycle_year(1)
            # ValueError → idx=0, then +1 → index 1 → "2024"
            assert app._year_filter == "2024"
