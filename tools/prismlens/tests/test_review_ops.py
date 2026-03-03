"""Tests for batch review operations (review_ops.py)."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from click.testing import CliRunner

from mizukilens.cache import (
    get_parsed_songs,
    get_stream,
    list_streams,
    open_db,
    update_stream_status,
    upsert_parsed_songs,
    upsert_stream,
)
from mizukilens.cli import main
from mizukilens.review_ops import (
    _clean_artist_field,
    _has_emoji_artifacts,
    batch_approve,
    batch_exclude,
    categorize_stream,
    clean_parsed_songs,
    generate_report,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def db(tmp_path: Path) -> sqlite3.Connection:
    conn = open_db(tmp_path / "test_review.db")
    yield conn
    conn.close()


def _add_stream(conn: sqlite3.Connection, video_id: str, title: str = "Test", **kwargs: Any) -> None:
    defaults: dict[str, Any] = {
        "channel_id": "UCtest",
        "date": "2024-03-15",
        "status": "extracted",
    }
    defaults.update(kwargs)
    upsert_stream(conn, video_id=video_id, title=title, **defaults)


def _add_songs(conn: sqlite3.Connection, video_id: str, songs: list[dict[str, Any]]) -> None:
    upsert_parsed_songs(conn, video_id, songs)


def _make_song(order: int, name: str = "TestSong", artist: str | None = None) -> dict[str, Any]:
    return {
        "order_index": order,
        "song_name": name,
        "artist": artist,
        "start_timestamp": f"0:{order:02d}:00",
        "end_timestamp": None,
        "note": None,
    }


# ===========================================================================
# categorize_stream
# ===========================================================================

class TestCategorizeStream:

    @pytest.mark.parametrize("title,expected", [
        ("【歌枠】singing time!", "Karaoke"),
        ("Karaoke night vol.12", "Karaoke"),
        ("うたわく with friends", "Karaoke"),
        ("歌回 Vol.5", "Karaoke"),
        ("Acoustic live session", "Karaoke"),
        ("合唱大會", "Karaoke"),
        ("MINI LIVE on stage", "Karaoke"),
        ("ASMR 耳かき", "ASMR"),
        ("Let's play some Game!", "Game"),
        ("ゲーム配信", "Game"),
        ("雜談配信", "FreeTalk"),
        ("Free Talk with fans", "FreeTalk"),
        ("棉花糖回答", "FreeTalk"),
        ("3D Live Concert", "3D/Dance"),
        ("跳舞練習", "3D/Dance"),
        ("練舞 session", "3D/Dance"),
        ("Random stream title", "Other"),
        ("", "Other"),
    ])
    def test_categorize(self, title: str, expected: str) -> None:
        assert categorize_stream(title) == expected

    def test_case_insensitive(self) -> None:
        assert categorize_stream("karaoke night") == "Karaoke"
        assert categorize_stream("KARAOKE NIGHT") == "Karaoke"
        assert categorize_stream("asmr whisper") == "ASMR"

    def test_first_match_wins(self) -> None:
        # "歌枠" matches Karaoke before any other category
        assert categorize_stream("歌枠 + ASMR mix") == "Karaoke"


# ===========================================================================
# Emoji artifact detection / cleaning
# ===========================================================================

class TestEmojiArtifacts:

    @pytest.mark.parametrize("artist,expected", [
        ("✰:_MIZUKIMilk: Artist Name", True),
        ("✩:_SomeEmote: singer", True),
        ("✰□ performer", True),
        ("✩■ vocalist", True),
        (":_CustomEmote: name", True),
        # New prefix variants
        ("ʚ♡⃛ɞ:_MIZUKIMilk: doriko", True),
        ("🍪:_MIZUKIMilk: song", True),
        ("🍮:_MIZUKIMilk: song", True),
        ("✿:_MIZUKIMilk: artist", True),
        # Numbered setlist prefixes
        ("01. Song Name", True),
        ("12. 絕頂讚歌", True),
        ("1. Song", True),
        ("1.Song", True),                   # no-space numbered prefix
        # Safe non-matches
        ("Normal Artist Name", False),
        ("", False),
        ("DAOKO×米津玄師", False),
        ("0.5倍速帶音樂練習跳一下", False),  # decimal, not a prefix
    ])
    def test_has_emoji_artifacts(self, artist: str, expected: bool) -> None:
        assert _has_emoji_artifacts(artist) == expected

    @pytest.mark.parametrize("artist,expected", [
        ("✰:_MIZUKIMilk: Aimer", "Aimer"),
        ("✩:_Custom: ✰□ Artist", "Artist"),
        (":_Emote1: :_Emote2: Singer", "Singer"),
        ("Normal Name", "Normal Name"),
        ("  Extra  Spaces  ", "Extra Spaces"),
        ("✰□✩■ leftovers", "leftovers"),
        # New prefix variants
        ("doriko     ʚ♡⃛ɞ:_MIZUKIMilk:", "doriko"),
        ("🍪:_MIZUKIMilk: title", "title"),
        ("🍮:_MIZUKIMilk: title", "title"),
        ("✿:_MIZUKIMilk: artist", "artist"),
        ("artist ✩:_MIZUKIMilk:", "artist"),
        # Numbered setlist prefix cleaning
        ("01. DROP", "DROP"),
        ("12. 絕頂讚歌", "絕頂讚歌"),
        ("1. Song", "Song"),
        ("1.Song", "Song"),                     # no-space numbered prefix
        ("01.DROP", "DROP"),                     # no-space numbered prefix
        ("0.5倍速帶音樂練習跳一下", "0.5倍速帶音樂練習跳一下"),  # no change
    ])
    def test_clean_artist_field(self, artist: str, expected: str) -> None:
        assert _clean_artist_field(artist) == expected


# ===========================================================================
# generate_report
# ===========================================================================

class TestGenerateReport:

    def test_report_empty_db(self, db: sqlite3.Connection) -> None:
        # Should not raise
        generate_report(db)

    def test_report_with_data(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid1", "歌枠 Vol.1")
        _add_songs(db, "vid1", [_make_song(1, artist="Singer A")])
        _add_stream(db, "vid2", "ASMR 配信")
        _add_songs(db, "vid2", [_make_song(1)])

        # Should print without errors
        generate_report(db)

    def test_report_detail(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid1", "歌枠 Vol.1")
        _add_songs(db, "vid1", [_make_song(1, artist="Artist")])

        generate_report(db, detail=True)

    def test_report_no_extracted(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid1", "Test", status="discovered")
        generate_report(db)  # Should handle gracefully


# ===========================================================================
# batch_approve
# ===========================================================================

class TestBatchApprove:

    def test_approve_karaoke(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "k1", "歌枠 Vol.1")
        _add_stream(db, "k2", "Karaoke night")
        _add_stream(db, "g1", "Game stream")

        count = batch_approve(db, karaoke=True, yes=True)
        assert count == 2
        assert get_stream(db, "k1")["status"] == "approved"
        assert get_stream(db, "k2")["status"] == "approved"
        assert get_stream(db, "g1")["status"] == "extracted"

    def test_approve_by_category(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "a1", "ASMR session")
        _add_stream(db, "k1", "歌枠")

        count = batch_approve(db, category="ASMR", yes=True)
        assert count == 1
        assert get_stream(db, "a1")["status"] == "approved"
        assert get_stream(db, "k1")["status"] == "extracted"

    def test_approve_by_video_id(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid1", "歌枠")
        _add_stream(db, "vid2", "歌枠 2")

        count = batch_approve(db, video_id="vid1", yes=True)
        assert count == 1
        assert get_stream(db, "vid1")["status"] == "approved"
        assert get_stream(db, "vid2")["status"] == "extracted"

    def test_approve_min_songs(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "k1", "歌枠 1")
        _add_songs(db, "k1", [_make_song(1), _make_song(2), _make_song(3)])
        _add_stream(db, "k2", "歌枠 2")
        _add_songs(db, "k2", [_make_song(1)])

        count = batch_approve(db, karaoke=True, min_songs=3, yes=True)
        assert count == 1
        assert get_stream(db, "k1")["status"] == "approved"
        assert get_stream(db, "k2")["status"] == "extracted"

    def test_approve_dry_run(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "k1", "歌枠")

        count = batch_approve(db, karaoke=True, dry_run=True)
        assert count == 1
        # Status should not change
        assert get_stream(db, "k1")["status"] == "extracted"

    def test_approve_no_matches(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "g1", "Game stream")

        count = batch_approve(db, karaoke=True, yes=True)
        assert count == 0

    def test_approve_eligible_statuses(self, db: sqlite3.Connection) -> None:
        """Only extracted, pending, and imported streams should be eligible for batch approve."""
        _add_stream(db, "k1", "歌枠", status="discovered")
        _add_stream(db, "k2", "歌枠 2", status="approved")
        _add_stream(db, "k3", "歌枠 3", status="pending")
        _add_stream(db, "k4", "歌枠 4", status="imported")
        _add_stream(db, "k5", "歌枠 5", status="exported")

        count = batch_approve(db, karaoke=True, yes=True)
        assert count == 2
        assert get_stream(db, "k1")["status"] == "discovered"
        assert get_stream(db, "k2")["status"] == "approved"
        assert get_stream(db, "k3")["status"] == "approved"
        assert get_stream(db, "k4")["status"] == "approved"
        assert get_stream(db, "k5")["status"] == "exported"

    def test_approve_pending_by_video_id(self, db: sqlite3.Connection) -> None:
        """A pending stream matched via video_id should be approved."""
        _add_stream(db, "p1", "歌枠 pending", status="pending")

        count = batch_approve(db, video_id="p1", yes=True)
        assert count == 1
        assert get_stream(db, "p1")["status"] == "approved"

    def test_approve_imported_by_video_id(self, db: sqlite3.Connection) -> None:
        """An imported stream matched via video_id should be approved."""
        _add_stream(db, "i1", "歌枠 imported", status="imported")

        count = batch_approve(db, video_id="i1", yes=True)
        assert count == 1
        assert get_stream(db, "i1")["status"] == "approved"

    def test_approve_confirmation_declined(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "k1", "歌枠")

        with patch("mizukilens.review_ops._confirm", return_value=False):
            count = batch_approve(db, karaoke=True)
        assert count == 0
        assert get_stream(db, "k1")["status"] == "extracted"


# ===========================================================================
# batch_exclude
# ===========================================================================

class TestBatchExclude:

    def test_exclude_non_karaoke(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "k1", "歌枠 Vol.1")
        _add_stream(db, "g1", "Game stream")
        _add_stream(db, "a1", "ASMR night")

        count = batch_exclude(db, non_karaoke=True, yes=True)
        assert count == 2
        assert get_stream(db, "k1")["status"] == "extracted"
        assert get_stream(db, "g1")["status"] == "excluded"
        assert get_stream(db, "a1")["status"] == "excluded"

    def test_exclude_by_category(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "g1", "Game night")
        _add_stream(db, "g2", "ゲーム配信")
        _add_stream(db, "k1", "歌枠")

        count = batch_exclude(db, category="Game", yes=True)
        assert count == 2
        assert get_stream(db, "g1")["status"] == "excluded"
        assert get_stream(db, "g2")["status"] == "excluded"
        assert get_stream(db, "k1")["status"] == "extracted"

    def test_exclude_by_video_id(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid1", "Something")
        _add_stream(db, "vid2", "Other")

        count = batch_exclude(db, video_id="vid1", yes=True)
        assert count == 1
        assert get_stream(db, "vid1")["status"] == "excluded"
        assert get_stream(db, "vid2")["status"] == "extracted"

    def test_exclude_no_songs(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "empty1", "Empty stream")
        _add_stream(db, "has_songs", "Stream with songs")
        _add_songs(db, "has_songs", [_make_song(1)])

        count = batch_exclude(db, no_songs=True, yes=True)
        assert count == 1
        assert get_stream(db, "empty1")["status"] == "excluded"
        assert get_stream(db, "has_songs")["status"] == "extracted"

    def test_exclude_dry_run(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "g1", "Game stream")

        count = batch_exclude(db, non_karaoke=True, dry_run=True)
        assert count == 1
        assert get_stream(db, "g1")["status"] == "extracted"

    def test_exclude_no_matches(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "k1", "歌枠")

        count = batch_exclude(db, non_karaoke=True, yes=True)
        assert count == 0

    def test_exclude_only_extracted(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "g1", "Game", status="discovered")

        count = batch_exclude(db, non_karaoke=True, yes=True)
        assert count == 0

    def test_exclude_confirmation_declined(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "g1", "Game")

        with patch("mizukilens.review_ops._confirm", return_value=False):
            count = batch_exclude(db, non_karaoke=True)
        assert count == 0
        assert get_stream(db, "g1")["status"] == "extracted"


# ===========================================================================
# clean_parsed_songs
# ===========================================================================

class TestCleanParsedSongs:

    def test_clean_emoji_artifacts(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid1", "歌枠")
        _add_songs(db, "vid1", [
            _make_song(1, "Song A", artist="✰:_MIZUKIMilk: Aimer"),
            _make_song(2, "Song B", artist="Normal Artist"),
            _make_song(3, "Song C", artist="✩:_Custom: ✰□ Singer"),
        ])

        count = clean_parsed_songs(db)
        assert count == 2

        songs = get_parsed_songs(db, "vid1")
        assert songs[0]["artist"] == "Aimer"
        assert songs[1]["artist"] == "Normal Artist"
        assert songs[2]["artist"] == "Singer"

    def test_clean_dry_run(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid1", "歌枠")
        _add_songs(db, "vid1", [
            _make_song(1, "Song A", artist="✰:_MIZUKIMilk: Aimer"),
        ])

        count = clean_parsed_songs(db, dry_run=True)
        assert count == 1

        # Should not have changed
        songs = get_parsed_songs(db, "vid1")
        assert songs[0]["artist"] == "✰:_MIZUKIMilk: Aimer"

    def test_clean_no_dirty(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid1", "歌枠")
        _add_songs(db, "vid1", [
            _make_song(1, "Song A", artist="Clean Artist"),
        ])

        count = clean_parsed_songs(db)
        assert count == 0

    def test_clean_empty_db(self, db: sqlite3.Connection) -> None:
        count = clean_parsed_songs(db)
        assert count == 0

    def test_clean_preserves_other_fields(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid1", "歌枠")
        _add_songs(db, "vid1", [{
            "order_index": 1,
            "song_name": "Test Song",
            "artist": "✰:_MIZUKIMilk: Real Artist",
            "start_timestamp": "0:05:30",
            "end_timestamp": "0:10:00",
            "note": "acoustic ver.",
        }])

        clean_parsed_songs(db)

        songs = get_parsed_songs(db, "vid1")
        assert songs[0]["song_name"] == "Test Song"
        assert songs[0]["artist"] == "Real Artist"
        assert songs[0]["start_timestamp"] == "0:05:30"
        assert songs[0]["end_timestamp"] == "0:10:00"
        assert songs[0]["note"] == "acoustic ver."

    def test_clean_null_artist_ignored(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid1", "歌枠")
        _add_songs(db, "vid1", [
            _make_song(1, "Song", artist=None),
        ])

        count = clean_parsed_songs(db)
        assert count == 0

    def test_clean_across_multiple_streams(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid1", "歌枠 1")
        _add_songs(db, "vid1", [_make_song(1, artist="✰:_E: A")])
        _add_stream(db, "vid2", "歌枠 2")
        _add_songs(db, "vid2", [_make_song(1, artist="✩:_F: B")])

        count = clean_parsed_songs(db)
        assert count == 2
        assert get_parsed_songs(db, "vid1")[0]["artist"] == "A"
        assert get_parsed_songs(db, "vid2")[0]["artist"] == "B"

    def test_clean_song_name(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid1", "歌枠")
        _add_songs(db, "vid1", [
            _make_song(1, "喝水🍪:_MIZUKIMilk:", artist="Clean Artist"),
            _make_song(2, "いーあるふぁんくらぶ       ✩:_MIZUKIMilk:", artist="Clean"),
        ])

        count = clean_parsed_songs(db)
        assert count == 2

        songs = get_parsed_songs(db, "vid1")
        assert songs[0]["song_name"] == "喝水"
        assert songs[0]["artist"] == "Clean Artist"
        assert songs[1]["song_name"] == "いーあるふぁんくらぶ"

    def test_clean_both_artist_and_song_name(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid1", "歌枠")
        _add_songs(db, "vid1", [
            _make_song(1, "Song🍮:_MIZUKIMilk:", artist="doriko ʚ♡⃛ɞ:_MIZUKIMilk:"),
        ])

        count = clean_parsed_songs(db)
        assert count == 1

        songs = get_parsed_songs(db, "vid1")
        assert songs[0]["song_name"] == "Song"
        assert songs[0]["artist"] == "doriko"

    def test_clean_numbered_prefix(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid1", "歌枠")
        _add_songs(db, "vid1", [
            _make_song(1, "01. DROP", artist="Clean"),
            _make_song(2, "12. 絕頂讚歌", artist="Clean"),
            _make_song(3, "0.5倍速帶音樂練習跳一下", artist="Clean"),
            _make_song(4, "1.Song", artist="Clean"),         # no-space prefix
            _make_song(5, "01.DROP", artist="Clean"),        # no-space prefix
        ])

        count = clean_parsed_songs(db)
        assert count == 4

        songs = get_parsed_songs(db, "vid1")
        assert songs[0]["song_name"] == "DROP"
        assert songs[0]["order_index"] == 1  # preserved
        assert songs[1]["song_name"] == "絕頂讚歌"
        assert songs[1]["order_index"] == 2  # preserved
        assert songs[2]["song_name"] == "0.5倍速帶音樂練習跳一下"  # unchanged
        assert songs[3]["song_name"] == "Song"               # no-space cleaned
        assert songs[4]["song_name"] == "DROP"               # no-space cleaned

    def test_clean_song_name_dry_run(self, db: sqlite3.Connection) -> None:
        _add_stream(db, "vid1", "歌枠")
        _add_songs(db, "vid1", [
            _make_song(1, "喝水:_MIZUKIMilk:", artist="Clean"),
        ])

        count = clean_parsed_songs(db, dry_run=True)
        assert count == 1

        # Should not have changed
        songs = get_parsed_songs(db, "vid1")
        assert songs[0]["song_name"] == "喝水:_MIZUKIMilk:"


# ===========================================================================
# CLI integration
# ===========================================================================

class TestReviewCLIIntegration:
    """Test CLI wiring for review subcommands."""

    def test_review_bare_launches_tui(self, tmp_path: Path) -> None:
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)
        conn.close()

        def mock_open_db(*args, **kwargs):
            return open_db(db_path)

        runner = CliRunner()
        with (
            patch("mizukilens.cache.open_db", side_effect=mock_open_db),
            patch("mizukilens.tui.launch_review_tui") as mock_tui,
        ):
            result = runner.invoke(main, ["review"])
        assert result.exit_code == 0
        mock_tui.assert_called_once()

    def test_review_help_shows_subcommands(self) -> None:
        runner = CliRunner()
        result = runner.invoke(main, ["review", "--help"])
        assert result.exit_code == 0
        for sub in ("report", "approve", "exclude", "clean"):
            assert sub in result.output

    def test_review_report_runs(self, tmp_path: Path) -> None:
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)
        conn.close()

        runner = CliRunner()
        with patch("mizukilens.cache.open_db", return_value=open_db(db_path)):
            result = runner.invoke(main, ["review", "report"])
        assert result.exit_code == 0

    def test_review_approve_requires_filter(self, tmp_path: Path) -> None:
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)
        conn.close()

        runner = CliRunner()
        with patch("mizukilens.cache.open_db", return_value=open_db(db_path)):
            result = runner.invoke(main, ["review", "approve"])
        assert result.exit_code != 0

    def test_review_exclude_requires_filter(self, tmp_path: Path) -> None:
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)
        conn.close()

        runner = CliRunner()
        with patch("mizukilens.cache.open_db", return_value=open_db(db_path)):
            result = runner.invoke(main, ["review", "exclude"])
        assert result.exit_code != 0

    def test_review_approve_dry_run_via_cli(self, tmp_path: Path) -> None:
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)
        _add_stream(conn, "k1", "歌枠 Vol.1")
        conn.close()

        runner = CliRunner()
        with patch("mizukilens.cache.open_db", return_value=open_db(db_path)):
            result = runner.invoke(main, ["review", "approve", "--karaoke", "--dry-run"])
        assert result.exit_code == 0
        assert "Dry run" in result.output

    def test_review_exclude_dry_run_via_cli(self, tmp_path: Path) -> None:
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)
        _add_stream(conn, "g1", "Game stream")
        conn.close()

        runner = CliRunner()
        with patch("mizukilens.cache.open_db", return_value=open_db(db_path)):
            result = runner.invoke(main, ["review", "exclude", "--non-karaoke", "--dry-run"])
        assert result.exit_code == 0
        assert "Dry run" in result.output

    def test_review_clean_dry_run_via_cli(self, tmp_path: Path) -> None:
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)
        _add_stream(conn, "vid1", "歌枠")
        _add_songs(conn, "vid1", [_make_song(1, artist="✰:_MIZUKIMilk: Test")])
        conn.close()

        runner = CliRunner()
        with patch("mizukilens.cache.open_db", return_value=open_db(db_path)):
            result = runner.invoke(main, ["review", "clean", "--dry-run"])
        assert result.exit_code == 0
        assert "Dry run" in result.output or "would be cleaned" in result.output
