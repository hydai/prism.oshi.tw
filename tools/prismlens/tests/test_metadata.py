"""Tests for mizukilens.metadata — iTunes integration.

Coverage:
  - normalize_artist()
  - fetch_itunes_metadata() — all strategies, no-match, timeout, HTTP error
  - read_metadata_file()    — normal, missing, corrupt
  - write_metadata_file()   — basic write
  - upsert_song_metadata()  — insert, update
  - upsert_artist_info()    — insert, update
  - is_stale()              — fresh, stale, missing
  - fetch_song_metadata()   — full integration (mocked APIs), all branches
  - get_metadata_status()   — cross-reference logic, pending/matched/no_match
  - CLI: metadata fetch     — --missing, --stale, --all, --song, --force,
                              error handling, rate-limiting/min-interval
  - CLI: metadata status    — basic, --filter, --detail, empty, all-pending, summary
"""

from __future__ import annotations

import json
import time
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest
from click.testing import CliRunner

from mizukilens.cli import main
from mizukilens.metadata import (
    STALE_DAYS,
    FetchResult,
    SongStatusRecord,
    _clean_title,
    _strip_featuring,
    fetch_itunes_metadata,
    fetch_song_metadata,
    get_metadata_status,
    is_stale,
    normalize_artist,
    read_metadata_file,
    upsert_artist_info,
    upsert_song_metadata,
    write_metadata_file,
)


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

def make_itunes_track(
    track_id: int = 1,
    title: str = "Test Song",
    artist_id: int = 10,
    artist_name: str = "Test Artist",
    album_title: str = "Test Album",
    duration_ms: int = 240000,
) -> dict:
    """Build a minimal iTunes track result dict."""
    return {
        "trackId": track_id,
        "trackName": title,
        "artistId": artist_id,
        "artistName": artist_name,
        "collectionId": 100,
        "collectionName": album_title,
        "trackTimeMillis": duration_ms,
        "artworkUrl100": "https://example.com/art100x100bb.jpg",
    }


def _fresh_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _stale_iso() -> str:
    return (datetime.now(tz=timezone.utc) - timedelta(days=STALE_DAYS + 1)).isoformat()


# ---------------------------------------------------------------------------
# normalize_artist
# ---------------------------------------------------------------------------

class TestNormalizeArtist:
    def test_lowercases(self):
        assert normalize_artist("YOASOBI") == "yoasobi"

    def test_strips_whitespace(self):
        assert normalize_artist("  宇多田光  ") == "宇多田光"

    def test_collapses_internal_spaces(self):
        assert normalize_artist("  宇多田  光  ") == "宇多田 光"

    def test_mixed_case_and_spaces(self):
        assert normalize_artist("  Ado  ") == "ado"

    def test_empty_string(self):
        assert normalize_artist("") == ""

    def test_already_normalized(self):
        assert normalize_artist("yoasobi") == "yoasobi"


# ---------------------------------------------------------------------------
# fetch_itunes_metadata — mocked _itunes_search
# ---------------------------------------------------------------------------

class TestFetchItunesMetadata:
    """Tests for the iTunes search with fallback strategies."""

    def test_strategy_1_exact_match(self):
        """Strategy 1 (artist + title) succeeds → returns match_confidence='exact'."""
        track = make_itunes_track()
        with patch("mizukilens.metadata._itunes_search", return_value=[track]) as mock_search:
            result = fetch_itunes_metadata("Test Artist", "Test Song")
        assert result is not None
        assert result["match_confidence"] == "exact"
        assert result["itunesTrackId"] == 1
        assert result["albumArtUrls"]["xl"] == "https://example.com/art600x600bb.jpg"
        # Should have been called with artist + title query
        mock_search.assert_called_once()
        first_call_query = mock_search.call_args[0][0]
        assert "Test Artist" in first_call_query
        assert "Test Song" in first_call_query

    def test_strategy_2_title_only(self):
        """Strategy 2 (title-only) is used when strategy 1 returns no results."""
        track = make_itunes_track()

        call_count = [0]
        def side_effect(query):
            call_count[0] += 1
            if call_count[0] == 1:
                return []  # artist+title failed
            return [track]  # title-only succeeded

        with patch("mizukilens.metadata._itunes_search", side_effect=side_effect):
            result = fetch_itunes_metadata("Test Artist", "Test Song")

        assert result["match_confidence"] == "fuzzy"
        assert call_count[0] == 2

    def test_all_strategies_no_match(self):
        """All strategies return empty → match_confidence is None, last_error None."""
        with patch("mizukilens.metadata._itunes_search", return_value=[]):
            result = fetch_itunes_metadata("Unknown Artist", "Unknown Song")

        assert result["match_confidence"] is None
        assert result.get("last_error") is None

    def test_timeout_marks_error(self):
        """Timeout on all strategies → last_error='timeout'."""
        with patch("mizukilens.metadata._itunes_search", side_effect=TimeoutError("timeout")):
            result = fetch_itunes_metadata("Test Artist", "Test Song")

        assert result["match_confidence"] is None
        assert result["last_error"] == "timeout"

    def test_http_error_marks_error(self):
        """HTTP error on all strategies → last_error set."""
        with patch("mizukilens.metadata._itunes_search",
                   side_effect=urllib.error.URLError("connection refused")):
            result = fetch_itunes_metadata("Test Artist", "Test Song")

        assert result["match_confidence"] is None
        assert result["last_error"] is not None

    def test_artwork_url_resizing(self):
        """iTunes artwork URLs are resized from 100x100bb template."""
        track = make_itunes_track()
        with patch("mizukilens.metadata._itunes_search", return_value=[track]):
            result = fetch_itunes_metadata("Test Artist", "Test Song")

        assert result["albumArtUrls"]["small"] == "https://example.com/art60x60bb.jpg"
        assert result["albumArtUrls"]["medium"] == "https://example.com/art200x200bb.jpg"
        assert result["albumArtUrls"]["big"] == "https://example.com/art400x400bb.jpg"
        assert result["albumArtUrls"]["xl"] == "https://example.com/art600x600bb.jpg"

    def test_duration_ms_to_seconds(self):
        """trackTimeMillis is converted to seconds."""
        track = make_itunes_track(duration_ms=240000)
        with patch("mizukilens.metadata._itunes_search", return_value=[track]):
            result = fetch_itunes_metadata("Test Artist", "Test Song")

        assert result["trackDuration"] == 240

    def test_collection_id_extracted(self):
        """collectionId is extracted as itunesCollectionId."""
        track = make_itunes_track()
        with patch("mizukilens.metadata._itunes_search", return_value=[track]):
            result = fetch_itunes_metadata("Test Artist", "Test Song")

        assert result["itunesCollectionId"] == 100

    def test_timeout_on_first_strategy_continues(self):
        """Timeout on first strategy → tries next strategies."""
        track = make_itunes_track()
        call_count = [0]
        def side_effect(query):
            call_count[0] += 1
            if call_count[0] == 1:
                raise TimeoutError("timeout")
            return [track]

        with patch("mizukilens.metadata._itunes_search", side_effect=side_effect):
            result = fetch_itunes_metadata("Test Artist", "Test Song")

        # Strategy 2 (title-only) should have succeeded
        assert result["match_confidence"] == "fuzzy"


# ---------------------------------------------------------------------------
# _strip_featuring / _clean_title helpers
# ---------------------------------------------------------------------------

class TestStripFeaturing:
    def test_removes_feat_dot(self):
        assert _strip_featuring("きくお feat. 初音ミク") == "きくお"

    def test_removes_ft_dot(self):
        assert _strip_featuring("Ado ft. hatsune miku") == "Ado"

    def test_noop_when_no_feat(self):
        assert _strip_featuring("YOASOBI") == "YOASOBI"

    def test_removes_parenthesized_feat(self):
        assert _strip_featuring("A (feat. B)") == "A"

    def test_removes_fullwidth_paren_feat(self):
        assert _strip_featuring("アーティスト（feat. ゲスト）") == "アーティスト"

    def test_empty_string(self):
        assert _strip_featuring("") == ""

    def test_case_insensitive(self):
        assert _strip_featuring("Singer FEAT. Other") == "Singer"


class TestCleanTitle:
    def test_removes_musical_note(self):
        assert _clean_title("夜に駆ける♪") == "夜に駆ける"

    def test_removes_exclamation(self):
        assert _clean_title("うっせぇわ！！") == "うっせぇわ"

    def test_removes_tilde(self):
        assert _clean_title("Hello 〜 World") == "Hello World"

    def test_noop_plain_text(self):
        assert _clean_title("Simple Title") == "Simple Title"

    def test_removes_brackets(self):
        assert _clean_title("Song「挿入歌」") == "Song 挿入歌"

    def test_collapses_whitespace(self):
        assert _clean_title("A ♪♪ B") == "A B"

    def test_empty_string(self):
        assert _clean_title("") == ""


# ---------------------------------------------------------------------------
# fetch_itunes_metadata — conditional strategy tests
# ---------------------------------------------------------------------------

class TestItunesConditionalStrategies:
    """Tests for conditional strategies (feat. stripping, cleaned title)."""

    def test_feat_artist_adds_cleaned_strategy(self):
        """Artist with 'feat.' triggers strategy 2 (cleaned artist)."""
        queries: list[str] = []
        def side_effect(query):
            queries.append(query)
            return []  # no match for any

        with patch("mizukilens.metadata._itunes_search", side_effect=side_effect):
            result = fetch_itunes_metadata("きくお feat. 初音ミク", "テスト曲")

        assert result["match_confidence"] is None
        # Should have: artist+title, cleaned-artist+title, title-only = 3
        assert len(queries) == 3
        # Strategy 2: cleaned artist + title
        assert queries[1] == "きくお テスト曲"

    def test_special_punct_title_adds_cleaned_strategy(self):
        """Title with CJK punctuation triggers cleaned title strategy."""
        queries: list[str] = []
        def side_effect(query):
            queries.append(query)
            return []

        with patch("mizukilens.metadata._itunes_search", side_effect=side_effect):
            result = fetch_itunes_metadata("Artist", "うっせぇわ！")

        assert result["match_confidence"] is None
        # artist+title, title-only, cleaned-title = 3
        assert len(queries) == 3
        # Last strategy: cleaned title
        assert "うっせぇわ" in queries[2]
        assert "！" not in queries[2]

    def test_cleaned_title_strategy_matches(self):
        """Cleaned title strategy can find matches when title has punctuation."""
        track = make_itunes_track()
        call_count = [0]
        def side_effect(query):
            call_count[0] += 1
            if call_count[0] <= 2:  # artist+title, title-only fail
                return []
            return [track]  # cleaned title succeeds

        with patch("mizukilens.metadata._itunes_search", side_effect=side_effect):
            result = fetch_itunes_metadata("Artist", "うっせぇわ！")

        assert result["match_confidence"] == "fuzzy_cleaned"

    def test_no_extra_strategies_for_plain_input(self):
        """Plain artist + title (no feat, no special punct) → 2 strategies."""
        queries: list[str] = []
        def side_effect(query):
            queries.append(query)
            return []

        with patch("mizukilens.metadata._itunes_search", side_effect=side_effect):
            fetch_itunes_metadata("Test Artist", "Test Song")

        # artist+title, title-only = 2
        # (cleaned title == title, so no extra; no feat in artist, so no extra)
        assert len(queries) == 2


# ---------------------------------------------------------------------------
# read_metadata_file
# ---------------------------------------------------------------------------

class TestReadMetadataFile:
    def test_reads_valid_json_array(self, tmp_path):
        p = tmp_path / "data.json"
        p.write_text('[{"songId": "song-1"}]', encoding="utf-8")
        data = read_metadata_file(p)
        assert data == [{"songId": "song-1"}]

    def test_returns_empty_for_missing_file(self, tmp_path):
        p = tmp_path / "nonexistent.json"
        data = read_metadata_file(p)
        assert data == []

    def test_returns_empty_for_corrupt_json(self, tmp_path):
        p = tmp_path / "corrupt.json"
        p.write_text("not valid json {{{", encoding="utf-8")
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            data = read_metadata_file(p)
        assert data == []

    def test_returns_empty_for_non_list_json(self, tmp_path):
        p = tmp_path / "object.json"
        p.write_text('{"key": "value"}', encoding="utf-8")
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            data = read_metadata_file(p)
        assert data == []

    def test_returns_empty_list_json(self, tmp_path):
        p = tmp_path / "empty.json"
        p.write_text("[]", encoding="utf-8")
        data = read_metadata_file(p)
        assert data == []


# ---------------------------------------------------------------------------
# write_metadata_file
# ---------------------------------------------------------------------------

class TestWriteMetadataFile:
    def test_writes_json_array(self, tmp_path):
        p = tmp_path / "out.json"
        data = [{"songId": "song-1", "fetchStatus": "matched"}]
        write_metadata_file(p, data)
        content = json.loads(p.read_text(encoding="utf-8"))
        assert content == data

    def test_creates_parent_directories(self, tmp_path):
        p = tmp_path / "nested" / "dir" / "out.json"
        write_metadata_file(p, [])
        assert p.exists()

    def test_overwrites_existing_file(self, tmp_path):
        p = tmp_path / "out.json"
        p.write_text("[1, 2, 3]", encoding="utf-8")
        write_metadata_file(p, [{"new": True}])
        content = json.loads(p.read_text(encoding="utf-8"))
        assert content == [{"new": True}]

    def test_ends_with_newline(self, tmp_path):
        p = tmp_path / "out.json"
        write_metadata_file(p, [])
        text = p.read_text(encoding="utf-8")
        assert text.endswith("\n")


# ---------------------------------------------------------------------------
# upsert_song_metadata
# ---------------------------------------------------------------------------

class TestUpsertSongMetadata:
    def test_insert_new_record(self):
        entry = {"songId": "song-1", "fetchStatus": "matched"}
        result = upsert_song_metadata([], entry)
        assert len(result) == 1
        assert result[0]["songId"] == "song-1"

    def test_update_existing_record(self):
        old = {"songId": "song-1", "fetchStatus": "error"}
        new = {"songId": "song-1", "fetchStatus": "matched"}
        result = upsert_song_metadata([old], new)
        assert len(result) == 1
        assert result[0]["fetchStatus"] == "matched"

    def test_does_not_affect_other_records(self):
        existing = [
            {"songId": "song-1", "fetchStatus": "matched"},
            {"songId": "song-2", "fetchStatus": "error"},
        ]
        new_entry = {"songId": "song-2", "fetchStatus": "matched"}
        result = upsert_song_metadata(existing, new_entry)
        assert len(result) == 2
        by_id = {r["songId"]: r for r in result}
        assert by_id["song-1"]["fetchStatus"] == "matched"
        assert by_id["song-2"]["fetchStatus"] == "matched"

    def test_returns_new_list(self):
        original = []
        result = upsert_song_metadata(original, {"songId": "song-1"})
        assert result is not original


# ---------------------------------------------------------------------------
# upsert_artist_info
# ---------------------------------------------------------------------------

class TestUpsertArtistInfo:
    def test_insert_new_record(self):
        entry = {"normalizedArtist": "yoasobi", "originalName": "YOASOBI"}
        result = upsert_artist_info([], entry)
        assert len(result) == 1

    def test_update_existing_record(self):
        old = {"normalizedArtist": "yoasobi", "originalName": "Yoasobi"}
        new = {"normalizedArtist": "yoasobi", "originalName": "YOASOBI", "itunesCollectionId": 42}
        result = upsert_artist_info([old], new)
        assert len(result) == 1
        assert result[0]["itunesCollectionId"] == 42

    def test_different_artists_not_overwritten(self):
        a1 = {"normalizedArtist": "yoasobi", "originalName": "YOASOBI"}
        a2 = {"normalizedArtist": "ado", "originalName": "Ado"}
        result = upsert_artist_info([a1], a2)
        assert len(result) == 2


# ---------------------------------------------------------------------------
# is_stale
# ---------------------------------------------------------------------------

class TestIsStale:
    def test_fresh_entry_not_stale(self):
        entry = {"fetchedAt": _fresh_iso()}
        assert is_stale(entry) is False

    def test_old_entry_is_stale(self):
        entry = {"fetchedAt": _stale_iso()}
        assert is_stale(entry) is True

    def test_missing_fetched_at_is_stale(self):
        assert is_stale({}) is True

    def test_none_fetched_at_is_stale(self):
        assert is_stale({"fetchedAt": None}) is True

    def test_invalid_date_is_stale(self):
        assert is_stale({"fetchedAt": "not-a-date"}) is True

    def test_exactly_stale_threshold(self):
        """Entry fetchedAt exactly STALE_DAYS days ago should be stale."""
        exact = (datetime.now(tz=timezone.utc) - timedelta(days=STALE_DAYS)).isoformat()
        entry = {"fetchedAt": exact}
        assert is_stale(entry) is True


# ---------------------------------------------------------------------------
# fetch_song_metadata — integration (mocked APIs, real file I/O)
# ---------------------------------------------------------------------------

class TestFetchSongMetadata:
    """Full integration tests with mocked API calls and real tmp directories."""

    @pytest.fixture()
    def metadata_dir(self, tmp_path):
        d = tmp_path / "metadata"
        d.mkdir()
        (d / "song-metadata.json").write_text("[]", encoding="utf-8")
        (d / "artist-info.json").write_text("[]", encoding="utf-8")
        return d

    @pytest.fixture()
    def song(self):
        return {"id": "song-1", "title": "Test Song", "originalArtist": "Test Artist"}

    def test_matched_itunes(self, metadata_dir, song):
        track = make_itunes_track()

        with patch("mizukilens.metadata._itunes_search", return_value=[track]):
            result = fetch_song_metadata(song, metadata_dir)

        assert result.art_status == "matched"
        assert result.overall_status == "matched"

        # Check files were written
        metadata = json.loads((metadata_dir / "song-metadata.json").read_text())
        assert len(metadata) == 1
        assert metadata[0]["songId"] == "song-1"
        assert metadata[0]["fetchStatus"] == "matched"
        assert metadata[0]["albumArtUrl"] != ""

        artists = json.loads((metadata_dir / "artist-info.json").read_text())
        assert len(artists) == 1
        assert artists[0]["normalizedArtist"] == "test artist"

    def test_itunes_no_match(self, metadata_dir, song):
        with patch("mizukilens.metadata._itunes_search", return_value=[]):
            result = fetch_song_metadata(song, metadata_dir)

        assert result.art_status == "no_match"

    def test_itunes_error(self, metadata_dir, song):
        with patch("mizukilens.metadata._itunes_search", side_effect=TimeoutError("timeout")):
            result = fetch_song_metadata(song, metadata_dir)

        assert result.art_status == "error"
        assert result.art_error == "timeout"
        metadata = json.loads((metadata_dir / "song-metadata.json").read_text())
        assert metadata[0]["fetchStatus"] == "error"
        assert metadata[0]["lastError"] == "timeout"

    def test_upsert_updates_existing_entry(self, metadata_dir, song):
        """Calling fetch twice updates the existing record (upsert behavior)."""
        track = make_itunes_track()
        with patch("mizukilens.metadata._itunes_search", return_value=[track]):
            fetch_song_metadata(song, metadata_dir)
            fetch_song_metadata(song, metadata_dir)

        metadata = json.loads((metadata_dir / "song-metadata.json").read_text())
        # Should only have one entry, not two
        assert len(metadata) == 1

    def test_artist_info_upsert(self, metadata_dir):
        """Two songs with the same artist share one ArtistInfo entry."""
        track = make_itunes_track()
        song1 = {"id": "song-1", "title": "Song A", "originalArtist": "YOASOBI"}
        song2 = {"id": "song-2", "title": "Song B", "originalArtist": "YOASOBI"}

        with patch("mizukilens.metadata._itunes_search", return_value=[track]):
            fetch_song_metadata(song1, metadata_dir)
            fetch_song_metadata(song2, metadata_dir)

        artists = json.loads((metadata_dir / "artist-info.json").read_text())
        assert len(artists) == 1
        assert artists[0]["normalizedArtist"] == "yoasobi"

    def test_missing_metadata_dir_created(self, tmp_path, song):
        """metadata_dir is created if it doesn't exist."""
        metadata_dir = tmp_path / "brand_new_dir"
        # Don't create it
        track = make_itunes_track()
        with patch("mizukilens.metadata._itunes_search", return_value=[track]):
            result = fetch_song_metadata(song, metadata_dir)

        assert result.art_status == "matched"
        assert metadata_dir.exists()

    def test_album_art_url_set_to_xl(self, metadata_dir, song):
        """albumArtUrl is set to the XL URL."""
        track = make_itunes_track()
        with patch("mizukilens.metadata._itunes_search", return_value=[track]):
            fetch_song_metadata(song, metadata_dir)

        metadata = json.loads((metadata_dir / "song-metadata.json").read_text())
        assert metadata[0]["albumArtUrl"] == "https://example.com/art600x600bb.jpg"


# ---------------------------------------------------------------------------
# Rate limiting — _wait_itunes
# ---------------------------------------------------------------------------

class TestRateLimiting:
    """Verify that consecutive API calls respect the minimum interval."""

    def test_itunes_rate_limit_respected(self):
        """Two consecutive iTunes calls should have _wait_itunes invoked."""
        import mizukilens.metadata as m_module

        # Reset last call time to simulate a fresh start
        m_module._last_itunes_call = 0.0

        call_times = []

        # Track timing through _wait_itunes calls
        original_wait = m_module._wait_itunes

        def recording_wait():
            call_times.append(time.monotonic())
            original_wait()

        with patch.object(m_module, "_wait_itunes", side_effect=recording_wait):
            with patch.object(m_module, "_http_get_json", return_value={"results": []}):
                m_module._itunes_search("query1")
                m_module._itunes_search("query2")

        # Should have been called twice
        assert len(call_times) == 2
        # The second call should be invoked after the first
        assert call_times[1] >= call_times[0]

    def test_min_interval_enforced(self):
        """The _wait_itunes function sleeps if called too quickly."""
        import mizukilens.metadata as m_module

        sleep_calls = []

        def mock_sleep(seconds):
            sleep_calls.append(seconds)

        # Set last call to "just happened"
        m_module._last_itunes_call = time.monotonic()

        with patch("mizukilens.metadata.time.sleep", side_effect=mock_sleep):
            m_module._wait_itunes()

        # Should have slept for approximately ITUNES_MIN_INTERVAL_SEC
        assert len(sleep_calls) == 1
        assert sleep_calls[0] > 0
        assert sleep_calls[0] <= m_module._ITUNES_MIN_INTERVAL_SEC + 0.01


# ---------------------------------------------------------------------------
# CLI: metadata fetch
# ---------------------------------------------------------------------------

class TestCLIMetadataFetch:
    """Tests for the `mizukilens metadata fetch` CLI command."""

    @pytest.fixture()
    def prism_root(self, tmp_path):
        """Set up a minimal MizukiPrism project root."""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        metadata_dir = data_dir / "metadata"
        metadata_dir.mkdir()

        songs = [
            {"id": "song-1", "title": "First Love", "originalArtist": "宇多田光"},
            {"id": "song-2", "title": "Idol", "originalArtist": "YOASOBI"},
        ]
        (data_dir / "songs.json").write_text(
            json.dumps(songs, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        (metadata_dir / "song-metadata.json").write_text("[]", encoding="utf-8")
        (metadata_dir / "artist-info.json").write_text("[]", encoding="utf-8")
        return tmp_path

    def _run(self, args: list[str], prism_root: Path) -> "Result":
        """Run CLI command from within the prism_root directory."""
        runner = CliRunner()
        import os
        old_cwd = os.getcwd()
        try:
            os.chdir(str(prism_root))
            return runner.invoke(main, args, catch_exceptions=False)
        finally:
            os.chdir(old_cwd)

    def test_fetch_missing_fetches_all_when_none_exist(self, prism_root):
        track = make_itunes_track()
        with patch("mizukilens.metadata._itunes_search", return_value=[track]):
            result = self._run(["metadata", "fetch", "--missing"], prism_root)

        assert result.exit_code == 0
        assert "Matched" in result.output or "matched" in result.output.lower()

        # Verify files were written
        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert len(metadata) == 2

    def test_fetch_missing_skips_already_fetched(self, prism_root):
        """--missing only fetches songs without any existing metadata."""
        # Pre-populate song-1's metadata
        existing = [{"songId": "song-1", "fetchStatus": "matched", "fetchedAt": _fresh_iso()}]
        (prism_root / "data" / "metadata" / "song-metadata.json").write_text(
            json.dumps(existing) + "\n", encoding="utf-8"
        )

        track = make_itunes_track()
        fetch_calls = []

        def track_itunes(query):
            fetch_calls.append(query)
            return [track]

        with patch("mizukilens.metadata._itunes_search", side_effect=track_itunes):
            result = self._run(["metadata", "fetch", "--missing"], prism_root)

        assert result.exit_code == 0
        # Only song-2 should be fetched (song-1 already has metadata)
        # The iTunes query should mention Idol or YOASOBI but not 宇多田光
        all_queries = " ".join(fetch_calls)
        assert "Idol" in all_queries or "YOASOBI" in all_queries

    def test_fetch_stale_only_fetches_stale_entries(self, prism_root):
        """--stale only fetches entries older than STALE_DAYS."""
        existing = [
            {"songId": "song-1", "fetchStatus": "matched", "fetchedAt": _stale_iso()},  # stale
            {"songId": "song-2", "fetchStatus": "matched", "fetchedAt": _fresh_iso()},  # fresh
        ]
        (prism_root / "data" / "metadata" / "song-metadata.json").write_text(
            json.dumps(existing) + "\n", encoding="utf-8"
        )

        track = make_itunes_track()
        fetch_calls = []

        def track_itunes(query):
            fetch_calls.append(query)
            return [track]

        with patch("mizukilens.metadata._itunes_search", side_effect=track_itunes):
            result = self._run(["metadata", "fetch", "--stale"], prism_root)

        assert result.exit_code == 0
        # Only song-1 (stale) should be fetched
        all_queries = " ".join(fetch_calls)
        assert "First Love" in all_queries or "宇多田光" in all_queries

    def test_fetch_all_fetches_all_non_manual(self, prism_root):
        """--all fetches all songs, skipping manual entries."""
        existing = [
            {"songId": "song-1", "fetchStatus": "manual", "fetchedAt": _fresh_iso()},
            {"songId": "song-2", "fetchStatus": "matched", "fetchedAt": _fresh_iso()},
        ]
        (prism_root / "data" / "metadata" / "song-metadata.json").write_text(
            json.dumps(existing) + "\n", encoding="utf-8"
        )

        track = make_itunes_track()
        fetch_calls = []

        def track_itunes(query):
            fetch_calls.append(query)
            return [track]

        with patch("mizukilens.metadata._itunes_search", side_effect=track_itunes):
            result = self._run(["metadata", "fetch", "--all"], prism_root)

        assert result.exit_code == 0
        # Only song-2 should be fetched (song-1 is manual)
        all_queries = " ".join(fetch_calls)
        assert "Idol" in all_queries or "YOASOBI" in all_queries
        # First Love (song-1/manual) should NOT be fetched
        assert "First Love" not in all_queries

    def test_fetch_all_with_force_includes_manual(self, prism_root):
        """--all --force fetches all songs including manual entries."""
        existing = [
            {"songId": "song-1", "fetchStatus": "manual", "fetchedAt": _fresh_iso()},
        ]
        (prism_root / "data" / "metadata" / "song-metadata.json").write_text(
            json.dumps(existing) + "\n", encoding="utf-8"
        )

        track = make_itunes_track()
        fetch_calls = []

        def track_itunes(query):
            fetch_calls.append(query)
            return [track]

        with patch("mizukilens.metadata._itunes_search", side_effect=track_itunes):
            result = self._run(["metadata", "fetch", "--all", "--force"], prism_root)

        assert result.exit_code == 0
        # Both songs should be fetched (manual entry overridden by --force)
        assert "First Love" in " ".join(fetch_calls) or "宇多田光" in " ".join(fetch_calls)

    def test_fetch_specific_song(self, prism_root):
        """--song ID fetches only that song."""
        track = make_itunes_track()
        fetch_calls = []

        def track_itunes(query):
            fetch_calls.append(query)
            return [track]

        with patch("mizukilens.metadata._itunes_search", side_effect=track_itunes):
            result = self._run(["metadata", "fetch", "--song", "song-1"], prism_root)

        assert result.exit_code == 0
        all_queries = " ".join(fetch_calls)
        # Only song-1 (First Love / 宇多田光) should appear
        assert "First Love" in all_queries or "宇多田光" in all_queries
        # song-2 should not appear
        assert "Idol" not in all_queries and "YOASOBI" not in all_queries

    def test_fetch_specific_song_not_found(self, prism_root):
        """--song with invalid ID exits with error."""
        result = self._run(["metadata", "fetch", "--song", "song-999"], prism_root)
        assert result.exit_code != 0

    def test_api_error_caught_gracefully(self, prism_root):
        """API errors for one song don't stop remaining songs from being processed."""
        call_count = [0]

        def side_effect(query):
            call_count[0] += 1
            if call_count[0] == 1:
                raise TimeoutError("timeout")
            return [make_itunes_track()]

        with patch("mizukilens.metadata._itunes_search", side_effect=side_effect):
            result = self._run(["metadata", "fetch", "--missing"], prism_root)

        assert result.exit_code == 0
        # Both songs should be processed (even if one errored)
        assert call_count[0] > 1

    def test_summary_table_shown(self, prism_root):
        """Summary table is displayed after fetching."""
        track = make_itunes_track()
        with patch("mizukilens.metadata._itunes_search", return_value=[track]):
            result = self._run(["metadata", "fetch", "--missing"], prism_root)

        assert result.exit_code == 0
        # Check that summary table keywords appear in output
        output_lower = result.output.lower()
        assert "matched" in output_lower or "total" in output_lower

    def test_no_songs_to_fetch_exits_cleanly(self, prism_root):
        """When all songs already have metadata, reports nothing to do."""
        existing = [
            {"songId": "song-1", "fetchStatus": "matched", "fetchedAt": _fresh_iso()},
            {"songId": "song-2", "fetchStatus": "matched", "fetchedAt": _fresh_iso()},
        ]
        (prism_root / "data" / "metadata" / "song-metadata.json").write_text(
            json.dumps(existing) + "\n", encoding="utf-8"
        )

        result = self._run(["metadata", "fetch", "--missing"], prism_root)
        assert result.exit_code == 0
        assert "Nothing to do" in result.output or "No songs" in result.output

    def test_fetched_at_is_set(self, prism_root):
        """Each fetched entry has a fetchedAt timestamp."""
        track = make_itunes_track()
        with patch("mizukilens.metadata._itunes_search", return_value=[track]):
            self._run(["metadata", "fetch", "--missing"], prism_root)

        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        for entry in metadata:
            assert entry.get("fetchedAt") is not None
            # Should be parseable as ISO 8601
            datetime.fromisoformat(entry["fetchedAt"])

    def test_metadata_schema_has_required_fields(self, prism_root):
        """song-metadata.json entries have all required schema fields."""
        track = make_itunes_track()
        with patch("mizukilens.metadata._itunes_search", return_value=[track]):
            self._run(["metadata", "fetch", "--missing"], prism_root)

        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        required_fields = {"songId", "fetchStatus", "albumArtUrl", "albumArtUrls", "fetchedAt", "matchConfidence"}
        for entry in metadata:
            missing = required_fields - set(entry.keys())
            assert missing == set(), f"Missing fields: {missing}"

    def test_artist_info_schema_has_required_fields(self, prism_root):
        """artist-info.json entries have all required schema fields."""
        track = make_itunes_track()
        with patch("mizukilens.metadata._itunes_search", return_value=[track]):
            self._run(["metadata", "fetch", "--missing"], prism_root)

        artists = json.loads(
            (prism_root / "data" / "metadata" / "artist-info.json").read_text()
        )
        required_fields = {"normalizedArtist", "originalName", "itunesArtistId", "fetchedAt"}
        for entry in artists:
            missing = required_fields - set(entry.keys())
            assert missing == set(), f"Missing fields: {missing}"

    def test_default_mode_is_missing(self, prism_root):
        """Running `metadata fetch` without a mode flag defaults to --missing."""
        track = make_itunes_track()
        with patch("mizukilens.metadata._itunes_search", return_value=[track]):
            result = self._run(["metadata", "fetch"], prism_root)

        assert result.exit_code == 0
        # Should have processed songs (--missing is the default)
        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert len(metadata) == 2

    def test_fetch_missing_is_default_when_no_flag(self, prism_root):
        """metadata fetch without mode flag processes missing songs."""
        # Pre-populate song-1's metadata (so only song-2 should be fetched)
        existing = [{"songId": "song-1", "fetchStatus": "matched", "fetchedAt": _fresh_iso()}]
        (prism_root / "data" / "metadata" / "song-metadata.json").write_text(
            json.dumps(existing) + "\n", encoding="utf-8"
        )

        track = make_itunes_track()
        fetch_calls = []

        def track_itunes(query):
            fetch_calls.append(query)
            return [track]

        with patch("mizukilens.metadata._itunes_search", side_effect=track_itunes):
            result = self._run(["metadata", "fetch"], prism_root)

        assert result.exit_code == 0
        # Only song-2 should be fetched (song-1 already has metadata)
        all_queries = " ".join(fetch_calls)
        assert "Idol" in all_queries or "YOASOBI" in all_queries


# ---------------------------------------------------------------------------
# FetchResult.overall_status
# ---------------------------------------------------------------------------

class TestFetchResultOverallStatus:
    def test_matched(self):
        r = FetchResult("s1", "T", "A", art_status="matched")
        assert r.overall_status == "matched"


# ---------------------------------------------------------------------------
# get_metadata_status
# ---------------------------------------------------------------------------

class TestGetMetadataStatus:
    """Unit tests for get_metadata_status() cross-reference logic."""

    def _make_root(self, tmp_path, songs, metadata=None):
        """Set up a minimal project root with data files."""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        metadata_dir = data_dir / "metadata"
        metadata_dir.mkdir()
        (data_dir / "songs.json").write_text(
            json.dumps(songs, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        (metadata_dir / "song-metadata.json").write_text(
            json.dumps(metadata or [], ensure_ascii=False) + "\n", encoding="utf-8"
        )
        return data_dir, metadata_dir

    def test_all_pending_when_no_metadata_files(self, tmp_path):
        songs = [
            {"id": "s1", "title": "Song A", "originalArtist": "Artist A"},
            {"id": "s2", "title": "Song B", "originalArtist": "Artist B"},
        ]
        data_dir, metadata_dir = self._make_root(tmp_path, songs)
        records = get_metadata_status(data_dir / "songs.json", metadata_dir)
        assert len(records) == 2
        assert all(r.cover_status == "pending" for r in records)

    def test_matched_song_shows_correct_status(self, tmp_path):
        songs = [{"id": "s1", "title": "First Love", "originalArtist": "宇多田光"}]
        metadata = [{
            "songId": "s1",
            "fetchStatus": "matched",
            "matchConfidence": "exact",
            "albumArtUrl": "https://example.com/art.jpg",
            "albumArtUrls": {},
            "itunesTrackId": 123,
            "fetchedAt": "2026-02-20T10:00:00+00:00",
            "lastError": None,
        }]
        data_dir, metadata_dir = self._make_root(tmp_path, songs, metadata)
        records = get_metadata_status(data_dir / "songs.json", metadata_dir)
        assert len(records) == 1
        r = records[0]
        assert r.song_id == "s1"
        assert r.cover_status == "matched"
        assert r.match_confidence == "exact"
        assert r.fetched_at == "2026-02-20"
        assert r.album_art_url == "https://example.com/art.jpg"
        assert r.itunes_track_id == 123

    def test_no_match_status(self, tmp_path):
        songs = [{"id": "s1", "title": "Rare Song", "originalArtist": "Unknown"}]
        metadata = [{
            "songId": "s1",
            "fetchStatus": "no_match",
            "matchConfidence": None,
            "fetchedAt": "2026-02-20T10:00:00+00:00",
            "lastError": None,
        }]
        data_dir, metadata_dir = self._make_root(tmp_path, songs, metadata)
        records = get_metadata_status(data_dir / "songs.json", metadata_dir)
        assert records[0].cover_status == "no_match"
        assert records[0].match_confidence is None

    def test_error_status_with_last_error(self, tmp_path):
        songs = [{"id": "s1", "title": "Bad Song", "originalArtist": "Err"}]
        metadata = [{
            "songId": "s1",
            "fetchStatus": "error",
            "matchConfidence": None,
            "fetchedAt": "2026-02-20T10:00:00+00:00",
            "lastError": "timeout",
        }]
        data_dir, metadata_dir = self._make_root(tmp_path, songs, metadata)
        records = get_metadata_status(data_dir / "songs.json", metadata_dir)
        assert records[0].cover_status == "error"
        assert records[0].cover_last_error == "timeout"

    def test_mixed_songs_some_pending(self, tmp_path):
        songs = [
            {"id": "s1", "title": "Matched", "originalArtist": "A"},
            {"id": "s2", "title": "Pending", "originalArtist": "B"},
        ]
        metadata = [{
            "songId": "s1",
            "fetchStatus": "matched",
            "matchConfidence": "fuzzy",
            "fetchedAt": "2026-02-20T10:00:00+00:00",
            "lastError": None,
        }]
        data_dir, metadata_dir = self._make_root(tmp_path, songs, metadata)
        records = get_metadata_status(data_dir / "songs.json", metadata_dir)
        assert len(records) == 2
        assert records[0].cover_status == "matched"
        assert records[1].cover_status == "pending"

    def test_empty_songs_returns_empty(self, tmp_path):
        data_dir, metadata_dir = self._make_root(tmp_path, [])
        records = get_metadata_status(data_dir / "songs.json", metadata_dir)
        assert records == []

    def test_order_preserved(self, tmp_path):
        songs = [
            {"id": "s3", "title": "C", "originalArtist": "X"},
            {"id": "s1", "title": "A", "originalArtist": "X"},
            {"id": "s2", "title": "B", "originalArtist": "X"},
        ]
        data_dir, metadata_dir = self._make_root(tmp_path, songs)
        records = get_metadata_status(data_dir / "songs.json", metadata_dir)
        assert [r.song_id for r in records] == ["s3", "s1", "s2"]

    def test_manual_status(self, tmp_path):
        songs = [{"id": "s1", "title": "Manual Song", "originalArtist": "A"}]
        metadata = [{
            "songId": "s1",
            "fetchStatus": "manual",
            "matchConfidence": "manual",
            "albumArtUrl": "https://example.com/manual.jpg",
            "fetchedAt": "2026-02-20T10:00:00+00:00",
            "lastError": None,
        }]
        data_dir, metadata_dir = self._make_root(tmp_path, songs, metadata)
        records = get_metadata_status(data_dir / "songs.json", metadata_dir)
        assert records[0].cover_status == "manual"
        assert records[0].match_confidence == "manual"

    def test_missing_metadata_dir_returns_all_pending(self, tmp_path):
        """When metadata files don't exist, all songs are pending."""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        songs = [{"id": "s1", "title": "Song", "originalArtist": "A"}]
        (data_dir / "songs.json").write_text(json.dumps(songs) + "\n", encoding="utf-8")
        # metadata dir does not exist
        metadata_dir = data_dir / "metadata"
        records = get_metadata_status(data_dir / "songs.json", metadata_dir)
        assert len(records) == 1
        assert records[0].cover_status == "pending"


# ---------------------------------------------------------------------------
# CLI: metadata status
# ---------------------------------------------------------------------------

class TestCLIMetadataStatus:
    """Tests for the `mizukilens metadata status` CLI command."""

    @pytest.fixture()
    def prism_root(self, tmp_path):
        """Set up a minimal MizukiPrism project root with mixed statuses."""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        metadata_dir = data_dir / "metadata"
        metadata_dir.mkdir()

        songs = [
            {"id": "s1", "title": "Matched Song", "originalArtist": "Artist A"},
            {"id": "s2", "title": "No Match Song", "originalArtist": "Artist B"},
            {"id": "s3", "title": "Error Song", "originalArtist": "Artist C"},
            {"id": "s4", "title": "Pending Song", "originalArtist": "Artist D"},
        ]
        (data_dir / "songs.json").write_text(
            json.dumps(songs, ensure_ascii=False) + "\n", encoding="utf-8"
        )

        metadata = [
            {
                "songId": "s1",
                "fetchStatus": "matched",
                "matchConfidence": "exact",
                "albumArtUrl": "https://example.com/s1.jpg",
                "albumArtUrls": {"xl": "https://example.com/s1_xl.jpg"},
                "itunesTrackId": 111,
                "fetchedAt": "2026-02-20T10:00:00+00:00",
                "lastError": None,
            },
            {
                "songId": "s2",
                "fetchStatus": "no_match",
                "matchConfidence": None,
                "albumArtUrl": None,
                "albumArtUrls": None,
                "itunesTrackId": None,
                "fetchedAt": "2026-02-20T10:00:00+00:00",
                "lastError": None,
            },
            {
                "songId": "s3",
                "fetchStatus": "error",
                "matchConfidence": None,
                "albumArtUrl": None,
                "albumArtUrls": None,
                "itunesTrackId": None,
                "fetchedAt": "2026-02-20T10:00:00+00:00",
                "lastError": "timeout",
            },
            # s4 has no metadata entry -> pending
        ]
        (metadata_dir / "song-metadata.json").write_text(
            json.dumps(metadata) + "\n", encoding="utf-8"
        )

        (metadata_dir / "artist-info.json").write_text("[]", encoding="utf-8")
        return tmp_path

    def _run(self, args: list[str], prism_root: Path) -> "Result":
        """Run CLI command from within the prism_root directory.

        Uses a wide terminal (COLUMNS=250) so Rich tables are not truncated.
        """
        runner = CliRunner(env={"COLUMNS": "250"})
        import os
        old_cwd = os.getcwd()
        try:
            os.chdir(str(prism_root))
            return runner.invoke(main, args, catch_exceptions=False)
        finally:
            os.chdir(old_cwd)

    def test_basic_status_shows_all_songs(self, prism_root):
        result = self._run(["metadata", "status"], prism_root)
        assert result.exit_code == 0
        assert "Matched Song" in result.output
        assert "No Match Song" in result.output
        assert "Error Song" in result.output
        assert "Pending Song" in result.output

    def test_basic_status_shows_correct_columns(self, prism_root):
        result = self._run(["metadata", "status"], prism_root)
        assert result.exit_code == 0
        # Column headers
        assert "Song Title" in result.output
        assert "Original Artist" in result.output
        assert "Cover" in result.output
        assert "Confidence" in result.output
        assert "Fetched" in result.output

    def test_basic_status_shows_mixed_statuses(self, prism_root):
        result = self._run(["metadata", "status"], prism_root)
        assert result.exit_code == 0
        assert "matched" in result.output
        assert "no_match" in result.output
        assert "error" in result.output
        assert "pending" in result.output

    def test_pending_songs_show_as_pending(self, prism_root):
        """Songs without metadata entries must appear as pending."""
        result = self._run(["metadata", "status"], prism_root)
        assert result.exit_code == 0
        # s4 has no metadata, should show as pending
        assert "Pending Song" in result.output
        assert "pending" in result.output

    def test_filter_matched_shows_only_matched(self, prism_root):
        result = self._run(["metadata", "status", "--filter", "matched"], prism_root)
        assert result.exit_code == 0
        assert "Matched Song" in result.output
        # Other songs should NOT appear in the table rows
        assert "No Match Song" not in result.output
        assert "Pending Song" not in result.output

    def test_filter_pending_shows_only_pending(self, prism_root):
        result = self._run(["metadata", "status", "--filter", "pending"], prism_root)
        assert result.exit_code == 0
        assert "Pending Song" in result.output
        assert "Matched Song" not in result.output

    def test_filter_no_match(self, prism_root):
        result = self._run(["metadata", "status", "--filter", "no_match"], prism_root)
        assert result.exit_code == 0
        assert "No Match Song" in result.output
        assert "Matched Song" not in result.output

    def test_filter_error(self, prism_root):
        result = self._run(["metadata", "status", "--filter", "error"], prism_root)
        assert result.exit_code == 0
        assert "Error Song" in result.output
        assert "Matched Song" not in result.output

    def test_detail_includes_extra_columns(self, prism_root):
        result = self._run(["metadata", "status", "--detail"], prism_root)
        assert result.exit_code == 0
        # Detail columns should appear
        assert "Album Art URL" in result.output
        assert "iTunes Track ID" in result.output
        assert "Last Error" in result.output

    def test_detail_shows_album_art_url(self, prism_root):
        result = self._run(["metadata", "status", "--detail"], prism_root)
        assert result.exit_code == 0
        assert "https://example.com/s1.jpg" in result.output

    def test_detail_shows_itunes_track_id(self, prism_root):
        result = self._run(["metadata", "status", "--detail"], prism_root)
        assert result.exit_code == 0
        assert "111" in result.output

    def test_detail_shows_last_error(self, prism_root):
        result = self._run(["metadata", "status", "--detail"], prism_root)
        assert result.exit_code == 0
        assert "timeout" in result.output

    def test_summary_row_appears(self, prism_root):
        result = self._run(["metadata", "status"], prism_root)
        assert result.exit_code == 0
        assert "Total:" in result.output

    def test_summary_counts_are_correct(self, prism_root):
        result = self._run(["metadata", "status"], prism_root)
        assert result.exit_code == 0
        # 4 songs: 1 matched, 1 no_match, 1 error, 1 pending
        assert "Total: 4" in result.output
        assert "matched: 1" in result.output
        assert "no_match: 1" in result.output
        assert "error: 1" in result.output
        assert "pending: 1" in result.output

    def test_empty_songs_json(self, tmp_path):
        """When songs.json is empty, output indicates no songs."""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        metadata_dir = data_dir / "metadata"
        metadata_dir.mkdir()
        (data_dir / "songs.json").write_text("[]", encoding="utf-8")
        (metadata_dir / "song-metadata.json").write_text("[]", encoding="utf-8")
        (metadata_dir / "artist-info.json").write_text("[]", encoding="utf-8")

        runner = CliRunner(env={"COLUMNS": "250"})
        import os
        old_cwd = os.getcwd()
        try:
            os.chdir(str(tmp_path))
            result = runner.invoke(main, ["metadata", "status"], catch_exceptions=False)
        finally:
            os.chdir(old_cwd)

        assert result.exit_code == 0
        assert "No songs" in result.output

    def test_all_pending_no_metadata_files(self, tmp_path):
        """When metadata files are absent, all songs show as pending."""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        metadata_dir = data_dir / "metadata"
        metadata_dir.mkdir()
        songs = [
            {"id": "s1", "title": "Song A", "originalArtist": "A"},
            {"id": "s2", "title": "Song B", "originalArtist": "B"},
        ]
        (data_dir / "songs.json").write_text(json.dumps(songs) + "\n", encoding="utf-8")
        # No metadata files — get_metadata_status handles missing files gracefully

        runner = CliRunner(env={"COLUMNS": "250"})
        import os
        old_cwd = os.getcwd()
        try:
            os.chdir(str(tmp_path))
            result = runner.invoke(main, ["metadata", "status"], catch_exceptions=False)
        finally:
            os.chdir(old_cwd)

        assert result.exit_code == 0
        assert "Song A" in result.output
        assert "Song B" in result.output
        assert "pending" in result.output
        assert "Total: 2" in result.output
        assert "pending: 2" in result.output

    def test_filter_shows_summary_of_all_songs(self, prism_root):
        """Summary row always shows counts for all songs, not just filtered."""
        result = self._run(["metadata", "status", "--filter", "matched"], prism_root)
        assert result.exit_code == 0
        # Summary should still reflect all 4 songs
        assert "Total: 4" in result.output


# ---------------------------------------------------------------------------
# CLI: metadata override
# ---------------------------------------------------------------------------

class TestCLIMetadataOverride:
    """Tests for the `mizukilens metadata override` CLI command."""

    @pytest.fixture()
    def prism_root(self, tmp_path):
        """Set up a minimal MizukiPrism project root with two songs."""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        metadata_dir = data_dir / "metadata"
        metadata_dir.mkdir()

        songs = [
            {"id": "song-1", "title": "First Love", "originalArtist": "宇多田光"},
            {"id": "song-2", "title": "Idol", "originalArtist": "YOASOBI"},
        ]
        (data_dir / "songs.json").write_text(
            json.dumps(songs, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        (metadata_dir / "song-metadata.json").write_text("[]", encoding="utf-8")
        (metadata_dir / "artist-info.json").write_text("[]", encoding="utf-8")
        return tmp_path

    def _run(self, args: list[str], prism_root: Path) -> "Result":
        """Run CLI command from within the prism_root directory."""
        runner = CliRunner()
        import os
        old_cwd = os.getcwd()
        try:
            os.chdir(str(prism_root))
            return runner.invoke(main, args, catch_exceptions=False)
        finally:
            os.chdir(old_cwd)

    # --- Album art override ---

    def test_override_album_art_url_updates_metadata(self, prism_root):
        """--album-art-url creates/updates song-metadata.json with manual status."""
        url = "https://example.com/cover.jpg"
        result = self._run(
            ["metadata", "override", "song-1", "--album-art-url", url],
            prism_root,
        )
        assert result.exit_code == 0

        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert len(metadata) == 1
        entry = metadata[0]
        assert entry["songId"] == "song-1"
        assert entry["fetchStatus"] == "manual"
        assert entry["matchConfidence"] == "manual"
        assert entry["albumArtUrl"] == url

    def test_override_album_art_url_sets_all_sizes(self, prism_root):
        """All album art URL sizes are set to the same provided URL."""
        url = "https://example.com/cover.jpg"
        self._run(
            ["metadata", "override", "song-1", "--album-art-url", url],
            prism_root,
        )

        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        entry = metadata[0]
        assert entry["albumArtUrls"]["small"] == url
        assert entry["albumArtUrls"]["medium"] == url
        assert entry["albumArtUrls"]["big"] == url
        assert entry["albumArtUrls"]["xl"] == url

    def test_override_album_art_sets_fetched_at(self, prism_root):
        """fetchedAt is set to a valid ISO 8601 timestamp."""
        url = "https://example.com/cover.jpg"
        self._run(
            ["metadata", "override", "song-1", "--album-art-url", url],
            prism_root,
        )

        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        entry = metadata[0]
        assert entry.get("fetchedAt") is not None
        datetime.fromisoformat(entry["fetchedAt"])  # should not raise

    def test_override_album_art_clears_last_error(self, prism_root):
        """lastError is set to null/None after manual override."""
        url = "https://example.com/cover.jpg"
        self._run(
            ["metadata", "override", "song-1", "--album-art-url", url],
            prism_root,
        )

        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert metadata[0]["lastError"] is None

    def test_override_album_art_updates_existing_entry(self, prism_root):
        """Overriding an existing entry replaces it rather than appending."""
        # Pre-populate with a no_match entry
        existing = [
            {
                "songId": "song-1",
                "fetchStatus": "no_match",
                "matchConfidence": None,
                "albumArtUrl": None,
                "albumArtUrls": None,
                "fetchedAt": "2026-01-01T00:00:00+00:00",
                "lastError": "some error",
            }
        ]
        (prism_root / "data" / "metadata" / "song-metadata.json").write_text(
            json.dumps(existing) + "\n", encoding="utf-8"
        )

        url = "https://example.com/new-cover.jpg"
        result = self._run(
            ["metadata", "override", "song-1", "--album-art-url", url],
            prism_root,
        )
        assert result.exit_code == 0

        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        # Should still have only one entry (upserted, not appended)
        assert len(metadata) == 1
        assert metadata[0]["fetchStatus"] == "manual"
        assert metadata[0]["albumArtUrl"] == url
        assert metadata[0]["lastError"] is None

    # --- Non-existent song ID ---

    def test_override_nonexistent_song_id_warns_but_succeeds(self, prism_root):
        """Overriding an unknown song ID prints a warning but still writes the entry."""
        url = "https://example.com/cover.jpg"
        result = self._run(
            ["metadata", "override", "song-999", "--album-art-url", url],
            prism_root,
        )
        assert result.exit_code == 0
        assert "Warning" in result.output or "warning" in result.output.lower()

        # Entry should still be written
        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert any(e["songId"] == "song-999" for e in metadata)

    # --- Validation errors ---

    def test_missing_required_options_fails(self, prism_root):
        """Providing neither --album-art-url nor --duration exits with error."""
        result = self._run(
            ["metadata", "override", "song-1"],
            prism_root,
        )
        assert result.exit_code != 0
        output_lower = result.output.lower()
        assert "album-art-url" in output_lower or "duration" in output_lower or "at least one" in output_lower

    # --- Manual status preserved against metadata fetch ---

    def test_manual_status_not_overwritten_by_fetch_missing(self, prism_root):
        """A manual entry is NOT overwritten by `metadata fetch --missing`."""
        # First, set a manual override
        url = "https://example.com/manual-cover.jpg"
        self._run(
            ["metadata", "override", "song-1", "--album-art-url", url],
            prism_root,
        )

        # Verify manual status is set
        metadata_before = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert metadata_before[0]["fetchStatus"] == "manual"

        # Now run `metadata fetch --missing`
        # song-1 already has an entry, so --missing should skip it
        track = make_itunes_track()
        with patch("mizukilens.metadata._itunes_search", return_value=[track]):
            fetch_result = self._run(
                ["metadata", "fetch", "--missing"],
                prism_root,
            )
        assert fetch_result.exit_code == 0

        # song-1's manual entry should be unchanged
        metadata_after = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        song1_after = next(e for e in metadata_after if e["songId"] == "song-1")
        assert song1_after["fetchStatus"] == "manual"
        assert song1_after["albumArtUrl"] == url

    def test_manual_status_overwritten_by_fetch_all_force(self, prism_root):
        """A manual entry IS overwritten by `metadata fetch --all --force`."""
        # First, set a manual override
        manual_url = "https://example.com/manual-cover.jpg"
        self._run(
            ["metadata", "override", "song-1", "--album-art-url", manual_url],
            prism_root,
        )

        # Now run `metadata fetch --all --force`
        track = make_itunes_track()
        with patch("mizukilens.metadata._itunes_search", return_value=[track]):
            fetch_result = self._run(
                ["metadata", "fetch", "--all", "--force"],
                prism_root,
            )
        assert fetch_result.exit_code == 0

        # song-1 should now be overwritten (fetchStatus != manual)
        metadata_after = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        song1_after = next(e for e in metadata_after if e["songId"] == "song-1")
        # After --force, should be 'matched' (from iTunes mock), not 'manual'
        assert song1_after["fetchStatus"] == "matched"

    # --- fetchStatus and matchConfidence verification ---

    def test_fetch_status_is_manual(self, prism_root):
        """After override, fetchStatus is exactly 'manual'."""
        url = "https://example.com/cover.jpg"
        self._run(
            ["metadata", "override", "song-1", "--album-art-url", url],
            prism_root,
        )

        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert metadata[0]["fetchStatus"] == "manual"

    def test_match_confidence_is_manual(self, prism_root):
        """After override, matchConfidence is exactly 'manual'."""
        url = "https://example.com/cover.jpg"
        self._run(
            ["metadata", "override", "song-1", "--album-art-url", url],
            prism_root,
        )

        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert metadata[0]["matchConfidence"] == "manual"

    # --- Output confirmation messages ---

    def test_output_shows_song_title(self, prism_root):
        """Confirmation output includes song title."""
        url = "https://example.com/cover.jpg"
        result = self._run(
            ["metadata", "override", "song-1", "--album-art-url", url],
            prism_root,
        )
        assert result.exit_code == 0
        assert "First Love" in result.output

    def test_output_shows_album_art_overridden(self, prism_root):
        """Confirmation output mentions album art override."""
        url = "https://example.com/cover.jpg"
        result = self._run(
            ["metadata", "override", "song-1", "--album-art-url", url],
            prism_root,
        )
        assert result.exit_code == 0
        assert "Album art" in result.output or "album-art" in result.output.lower()

    def test_manual_status_not_overwritten_by_fetch_all_without_force(self, prism_root):
        """A manual entry is NOT overwritten by `metadata fetch --all` (without --force)."""
        # First, set a manual override
        url = "https://example.com/manual-cover.jpg"
        self._run(
            ["metadata", "override", "song-1", "--album-art-url", url],
            prism_root,
        )

        # Now run `metadata fetch --all` WITHOUT --force
        track = make_itunes_track()
        with patch("mizukilens.metadata._itunes_search", return_value=[track]):
            fetch_result = self._run(
                ["metadata", "fetch", "--all"],
                prism_root,
            )
        assert fetch_result.exit_code == 0

        # song-1's manual entry should be unchanged
        metadata_after = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        song1_after = next(e for e in metadata_after if e["songId"] == "song-1")
        assert song1_after["fetchStatus"] == "manual"
        assert song1_after["albumArtUrl"] == url

    # --- Duration override ---

    def test_override_duration_updates_metadata(self, prism_root):
        """--duration creates/updates song-metadata.json with the given duration."""
        result = self._run(
            ["metadata", "override", "song-1", "--duration", "243"],
            prism_root,
        )
        assert result.exit_code == 0

        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert len(metadata) == 1
        entry = metadata[0]
        assert entry["songId"] == "song-1"
        assert entry["trackDuration"] == 243

    def test_override_duration_preserves_existing_album_art(self, prism_root):
        """Duration-only override preserves existing album art data."""
        # First set album art
        url = "https://example.com/cover.jpg"
        self._run(
            ["metadata", "override", "song-1", "--album-art-url", url],
            prism_root,
        )

        # Now override only duration
        result = self._run(
            ["metadata", "override", "song-1", "--duration", "180"],
            prism_root,
        )
        assert result.exit_code == 0

        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert len(metadata) == 1
        entry = metadata[0]
        assert entry["trackDuration"] == 180
        assert entry["albumArtUrl"] == url
        assert entry["albumArtUrls"]["small"] == url

    def test_override_duration_with_album_art(self, prism_root):
        """Providing both --album-art-url and --duration sets both."""
        url = "https://example.com/cover.jpg"
        result = self._run(
            [
                "metadata", "override", "song-1",
                "--album-art-url", url,
                "--duration", "300",
            ],
            prism_root,
        )
        assert result.exit_code == 0

        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert len(metadata) == 1
        entry = metadata[0]
        assert entry["albumArtUrl"] == url
        assert entry["trackDuration"] == 300

    def test_override_duration_sets_manual_status(self, prism_root):
        """Duration override sets fetchStatus and matchConfidence to 'manual'."""
        self._run(
            ["metadata", "override", "song-1", "--duration", "200"],
            prism_root,
        )

        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert metadata[0]["fetchStatus"] == "manual"
        assert metadata[0]["matchConfidence"] == "manual"

    def test_override_duration_negative_value_fails(self, prism_root):
        """Negative or zero duration exits with error."""
        result = self._run(
            ["metadata", "override", "song-1", "--duration", "0"],
            prism_root,
        )
        assert result.exit_code != 0

        result = self._run(
            ["metadata", "override", "song-1", "--duration", "-5"],
            prism_root,
        )
        assert result.exit_code != 0

        # No metadata should have been written
        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert len(metadata) == 0

    def test_manual_duration_not_overwritten_by_fetch(self, prism_root):
        """A manual duration entry is NOT overwritten by `metadata fetch --missing`."""
        self._run(
            ["metadata", "override", "song-1", "--duration", "999"],
            prism_root,
        )

        track = make_itunes_track()
        with patch("mizukilens.metadata._itunes_search", return_value=[track]):
            fetch_result = self._run(
                ["metadata", "fetch", "--missing"],
                prism_root,
            )
        assert fetch_result.exit_code == 0

        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        song1 = next(e for e in metadata if e["songId"] == "song-1")
        assert song1["fetchStatus"] == "manual"
        assert song1["trackDuration"] == 999

    def test_override_duration_output_confirmation(self, prism_root):
        """Confirmation output shows the duration that was set."""
        result = self._run(
            ["metadata", "override", "song-1", "--duration", "243"],
            prism_root,
        )
        assert result.exit_code == 0
        assert "Duration" in result.output or "duration" in result.output.lower()
        assert "243" in result.output


# ---------------------------------------------------------------------------
# CLI: metadata clear
# ---------------------------------------------------------------------------

class TestCLIMetadataClear:
    """Tests for the `mizukilens metadata clear` CLI command."""

    @pytest.fixture()
    def prism_root(self, tmp_path):
        """Set up a minimal MizukiPrism project root with two songs and metadata."""
        data_dir = tmp_path / "data"
        data_dir.mkdir()
        metadata_dir = data_dir / "metadata"
        metadata_dir.mkdir()

        songs = [
            {"id": "song-1", "title": "First Love", "originalArtist": "宇多田光"},
            {"id": "song-2", "title": "Idol", "originalArtist": "YOASOBI"},
        ]
        (data_dir / "songs.json").write_text(
            json.dumps(songs, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        # Pre-populate both songs with matched metadata and artist info
        metadata = [
            {
                "songId": "song-1",
                "fetchStatus": "matched",
                "matchConfidence": "exact",
                "albumArtUrl": "https://example.com/art1.jpg",
                "albumArtUrls": {"small": "", "medium": "", "big": "", "xl": "https://example.com/art1.jpg"},
                "albumTitle": "Album A",
                "itunesTrackId": 1,
                "itunesCollectionId": 10,
                "trackDuration": 240,
                "fetchedAt": _fresh_iso(),
                "lastError": None,
            },
            {
                "songId": "song-2",
                "fetchStatus": "matched",
                "matchConfidence": "fuzzy",
                "albumArtUrl": "https://example.com/art2.jpg",
                "albumArtUrls": {"small": "", "medium": "", "big": "", "xl": "https://example.com/art2.jpg"},
                "albumTitle": "Album B",
                "itunesTrackId": 2,
                "itunesCollectionId": 20,
                "trackDuration": 200,
                "fetchedAt": _fresh_iso(),
                "lastError": None,
            },
        ]
        artist_info = [
            {
                "normalizedArtist": "宇多田光",
                "originalName": "宇多田光",
                "itunesCollectionId": 10,
                "pictureUrls": {"medium": "", "big": "", "xl": ""},
                "fetchedAt": _fresh_iso(),
            },
            {
                "normalizedArtist": "yoasobi",
                "originalName": "YOASOBI",
                "itunesCollectionId": 20,
                "pictureUrls": {"medium": "", "big": "", "xl": ""},
                "fetchedAt": _fresh_iso(),
            },
        ]
        (metadata_dir / "song-metadata.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        (metadata_dir / "artist-info.json").write_text(
            json.dumps(artist_info, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        return tmp_path

    def _run(self, args: list[str], prism_root: Path, input: str | None = None) -> "Result":
        """Run CLI command from within the prism_root directory."""
        runner = CliRunner()
        import os
        old_cwd = os.getcwd()
        try:
            os.chdir(str(prism_root))
            return runner.invoke(main, args, input=input, catch_exceptions=False)
        finally:
            os.chdir(old_cwd)

    # --- Single song clear ---

    def test_clear_specific_song_removes_from_metadata(self, prism_root):
        """Clearing a specific song removes its entry from song-metadata.json."""
        result = self._run(
            ["metadata", "clear", "song-1", "--force"],
            prism_root,
        )
        assert result.exit_code == 0

        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        song_ids = [e["songId"] for e in metadata]
        assert "song-1" not in song_ids
        assert "song-2" in song_ids  # song-2 should be untouched

    def test_clear_does_not_remove_artist_info(self, prism_root):
        """Clearing a song does NOT remove ArtistInfo entries (shared resource)."""
        result = self._run(
            ["metadata", "clear", "song-1", "--force"],
            prism_root,
        )
        assert result.exit_code == 0

        artist_info = json.loads(
            (prism_root / "data" / "metadata" / "artist-info.json").read_text()
        )
        # Both artist entries should still be present
        normalized = [e["normalizedArtist"] for e in artist_info]
        assert "yoasobi" in normalized

    def test_clear_with_force_skips_confirmation(self, prism_root):
        """--force clears without prompting and exits 0."""
        result = self._run(
            ["metadata", "clear", "song-1", "--force"],
            prism_root,
        )
        assert result.exit_code == 0
        # No prompt text expected
        assert "Cleared metadata for" in result.output

    def test_clear_outputs_song_title_in_confirmation(self, prism_root):
        """Output contains the song title after clearing."""
        result = self._run(
            ["metadata", "clear", "song-1", "--force"],
            prism_root,
        )
        assert result.exit_code == 0
        assert "First Love" in result.output

    def test_clear_nonexistent_song_id_clean_exit(self, prism_root):
        """Clearing a song ID not in metadata files exits cleanly with message."""
        result = self._run(
            ["metadata", "clear", "song-999", "--force"],
            prism_root,
        )
        assert result.exit_code == 0
        assert "No metadata found for song ID" in result.output
        assert "song-999" in result.output

    def test_clear_nonexistent_song_id_does_not_modify_files(self, prism_root):
        """When song ID not found, metadata files are not modified."""
        metadata_before = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        self._run(["metadata", "clear", "song-999", "--force"], prism_root)
        metadata_after = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert len(metadata_before) == len(metadata_after)

    def test_clear_song_id_not_in_songs_json_warns(self, prism_root):
        """Clearing a song not in songs.json prints a warning but still clears."""
        # Add song-3 to metadata but NOT to songs.json
        metadata_path = prism_root / "data" / "metadata" / "song-metadata.json"
        metadata = json.loads(metadata_path.read_text())
        metadata.append({
            "songId": "song-3",
            "fetchStatus": "matched",
            "matchConfidence": "fuzzy",
            "albumArtUrl": "https://example.com/art3.jpg",
            "albumArtUrls": {},
            "fetchedAt": _fresh_iso(),
            "lastError": None,
        })
        metadata_path.write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

        result = self._run(["metadata", "clear", "song-3", "--force"], prism_root)
        assert result.exit_code == 0
        # Should warn about song-3 not being in songs.json
        assert "Warning" in result.output or "warning" in result.output.lower()
        # Should still clear the entry
        metadata_after = json.loads(metadata_path.read_text())
        assert not any(e["songId"] == "song-3" for e in metadata_after)

    def test_clear_without_force_shows_confirmation_prompt(self, prism_root):
        """Without --force, a confirmation prompt is shown; 'n' cancels."""
        result = self._run(
            ["metadata", "clear", "song-1"],
            prism_root,
            input="n\n",  # User says no
        )
        assert result.exit_code == 0
        # Should NOT have cleared anything
        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert any(e["songId"] == "song-1" for e in metadata)

    def test_clear_without_force_confirm_yes_clears(self, prism_root):
        """Without --force, confirming with 'y' performs the clear."""
        result = self._run(
            ["metadata", "clear", "song-1"],
            prism_root,
            input="y\n",  # User confirms
        )
        assert result.exit_code == 0
        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert not any(e["songId"] == "song-1" for e in metadata)

    # --- Clear all ---

    def test_clear_all_empties_metadata_file(self, prism_root):
        """--all --force empties song-metadata.json to []."""
        result = self._run(
            ["metadata", "clear", "--all", "--force"],
            prism_root,
        )
        assert result.exit_code == 0

        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert metadata == []

    def test_clear_all_preserves_artist_info(self, prism_root):
        """--all preserves artist-info.json completely."""
        result = self._run(
            ["metadata", "clear", "--all", "--force"],
            prism_root,
        )
        assert result.exit_code == 0

        artist_info = json.loads(
            (prism_root / "data" / "metadata" / "artist-info.json").read_text()
        )
        # Both artist entries should still be present
        assert len(artist_info) == 2
        normalized = [e["normalizedArtist"] for e in artist_info]
        assert "yoasobi" in normalized

    def test_clear_all_output_shows_counts(self, prism_root):
        """--all output mentions the number of cleared metadata entries."""
        result = self._run(
            ["metadata", "clear", "--all", "--force"],
            prism_root,
        )
        assert result.exit_code == 0
        output = result.output
        # Should mention counts (2 metadata entries)
        assert "2" in output
        assert "Cleared all" in output

    def test_clear_all_no_entries_exits_cleanly(self, prism_root):
        """--all on empty files exits cleanly with no-op message."""
        # First clear everything
        self._run(["metadata", "clear", "--all", "--force"], prism_root)
        # Now clear again — files are empty
        result = self._run(["metadata", "clear", "--all", "--force"], prism_root)
        assert result.exit_code == 0
        assert "No metadata" in result.output or "nothing" in result.output.lower()

    def test_clear_all_without_force_shows_prompt(self, prism_root):
        """--all without --force shows a confirmation prompt; 'n' cancels."""
        result = self._run(
            ["metadata", "clear", "--all"],
            prism_root,
            input="n\n",
        )
        assert result.exit_code == 0
        # Files should be unchanged
        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert len(metadata) == 2  # Both entries still present

    # --- Integration with status and fetch ---

    def test_after_clear_song_appears_as_pending_in_status(self, prism_root):
        """After clearing song-1, `metadata status --filter pending` shows it as pending."""
        # Clear song-1
        self._run(["metadata", "clear", "song-1", "--force"], prism_root)

        # Run status --filter pending
        result = self._run(["metadata", "status", "--filter", "pending"], prism_root)
        assert result.exit_code == 0
        assert "First Love" in result.output

    def test_after_clear_song_can_be_refetched(self, prism_root):
        """After clearing song-1, `metadata fetch --song song-1` succeeds."""
        # Clear song-1
        self._run(["metadata", "clear", "song-1", "--force"], prism_root)

        # Verify it's gone
        metadata = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert not any(e["songId"] == "song-1" for e in metadata)

        # Re-fetch
        track = make_itunes_track()
        with patch("mizukilens.metadata._itunes_search", return_value=[track]):
            fetch_result = self._run(
                ["metadata", "fetch", "--song", "song-1"],
                prism_root,
            )
        assert fetch_result.exit_code == 0

        # Verify song-1 is now fetched again
        metadata_after = json.loads(
            (prism_root / "data" / "metadata" / "song-metadata.json").read_text()
        )
        assert any(e["songId"] == "song-1" for e in metadata_after)

    # --- Argument validation ---

    def test_no_song_id_no_all_flag_exits_with_error(self, prism_root):
        """Running `metadata clear` without SONG_ID or --all exits with an error."""
        result = self._run(["metadata", "clear"], prism_root)
        assert result.exit_code != 0

    def test_song_id_and_all_flag_together_exits_with_error(self, prism_root):
        """Running `metadata clear SONG_ID --all` exits with an error."""
        result = self._run(["metadata", "clear", "song-1", "--all"], prism_root)
        assert result.exit_code != 0
