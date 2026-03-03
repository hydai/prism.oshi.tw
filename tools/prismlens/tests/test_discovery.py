"""Tests for mizukilens.discovery — stream discovery module.

All tests mock scrapetube.get_channel() so NO real YouTube API calls are made.
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timezone
from typing import Any, Generator
from unittest.mock import MagicMock, patch

import pytest

from mizukilens.cache import get_stream, list_streams, open_db
from mizukilens.discovery import (
    FetchResult,
    NetworkError,
    _is_upcoming_stream,
    fetch_streams,
    get_active_channel_info,
    matches_keywords,
    parse_video_date,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def mem_db() -> Generator[sqlite3.Connection, None, None]:
    """In-memory SQLite database with MizukiLens schema initialised."""
    conn = open_db(":memory:")
    yield conn
    conn.close()


def _make_video(
    video_id: str,
    title: str,
    published: str = "3 days ago",
) -> dict[str, Any]:
    """Helper: build a fake scrapetube video dict."""
    return {
        "videoId": video_id,
        "title": {"runs": [{"text": title}]},
        "publishedTimeText": {"simpleText": published},
    }


# ---------------------------------------------------------------------------
# 1. parse_video_date
# ---------------------------------------------------------------------------


class TestParseVideoDate:
    """Unit tests for date normalisation."""

    def test_iso_date_passthrough(self) -> None:
        assert parse_video_date("2024-03-15") == "2024-03-15"

    def test_iso_date_embedded_in_string(self) -> None:
        assert parse_video_date("Streamed on 2024-03-15") == "2024-03-15"

    def test_compact_date(self) -> None:
        assert parse_video_date("20240315") == "2024-03-15"

    def test_human_date_mon_day_year(self) -> None:
        result = parse_video_date("Jan 15, 2024")
        assert result == "2024-01-15"

    def test_human_date_day_mon_year(self) -> None:
        result = parse_video_date("15 Jan 2024")
        assert result == "2024-01-15"

    def test_relative_days(self) -> None:
        ref = date(2024, 3, 20)
        result = parse_video_date("3 days ago", reference_date=ref)
        assert result == "2024-03-17"

    def test_relative_weeks(self) -> None:
        ref = date(2024, 3, 20)
        result = parse_video_date("2 weeks ago", reference_date=ref)
        assert result == "2024-03-06"

    def test_relative_months(self) -> None:
        ref = date(2024, 3, 20)
        result = parse_video_date("1 month ago", reference_date=ref)
        # 1 month = 30 days
        assert result == "2024-02-19"

    def test_relative_years(self) -> None:
        ref = date(2024, 3, 20)
        result = parse_video_date("1 year ago", reference_date=ref)
        # 1 year = 365 days
        assert result == "2023-03-21"

    def test_none_returns_none(self) -> None:
        assert parse_video_date(None) is None

    def test_empty_returns_none(self) -> None:
        assert parse_video_date("") is None

    def test_unparseable_returns_none(self) -> None:
        assert parse_video_date("unknown date format xyz") is None

    def test_relative_hours(self) -> None:
        ref = date(2024, 3, 20)
        result = parse_video_date("5 hours ago", reference_date=ref)
        assert result == "2024-03-20"  # same day

    def test_relative_plural_days(self) -> None:
        ref = date(2024, 3, 20)
        result = parse_video_date("7 days ago", reference_date=ref)
        assert result == "2024-03-13"


# ---------------------------------------------------------------------------
# 2. matches_keywords
# ---------------------------------------------------------------------------


class TestMatchesKeywords:
    """Unit tests for keyword filtering."""

    KEYWORDS = ["歌回", "歌枠", "唱歌", "singing", "karaoke"]

    def test_match_japanese(self) -> None:
        assert matches_keywords("【歌回】今日もうたうよ！", self.KEYWORDS)

    def test_match_english_case_insensitive(self) -> None:
        assert matches_keywords("Singing Stream!", self.KEYWORDS)
        assert matches_keywords("KARAOKE NIGHT", self.KEYWORDS)

    def test_no_match(self) -> None:
        assert not matches_keywords("雑談配信 #123", self.KEYWORDS)
        assert not matches_keywords("Gaming stream today", self.KEYWORDS)

    def test_empty_keywords(self) -> None:
        assert not matches_keywords("歌回", [])

    def test_empty_title(self) -> None:
        assert not matches_keywords("", self.KEYWORDS)

    def test_partial_keyword_match(self) -> None:
        assert matches_keywords("歌枠ぁ〜！", self.KEYWORDS)


# ---------------------------------------------------------------------------
# 3. get_active_channel_info
# ---------------------------------------------------------------------------


class TestGetActiveChannelInfo:
    """Unit tests for config loading."""

    def _make_cfg(self, channel_id: str = "UCtest", keywords: list[str] | None = None) -> dict:
        if keywords is None:
            keywords = ["歌回"]
        return {
            "default": {"active_channel": "mizuki"},
            "channels": {"mizuki": {"id": channel_id, "name": "Mizuki", "keywords": keywords}},
            "cache": {"path": "~/.local/share/mizukilens/cache.db"},
            "export": {"output_dir": "~/.local/share/mizukilens/exports"},
        }

    def test_returns_channel_id_and_keywords(self) -> None:
        cfg = self._make_cfg("UCtest1234567890123456789", ["歌回", "singing"])
        ch_id, kws = get_active_channel_info(cfg=cfg)
        assert ch_id == "UCtest1234567890123456789"
        assert "歌回" in kws
        assert "singing" in kws

    def test_raises_when_no_config(self) -> None:
        with patch("mizukilens.config.load_config", return_value=None):
            with pytest.raises(RuntimeError, match="設定ファイル"):
                get_active_channel_info()

    def test_raises_when_no_active_channel(self) -> None:
        cfg = {"default": {}, "channels": {}}
        with pytest.raises(RuntimeError, match="有効なチャンネル"):
            get_active_channel_info(cfg=cfg)

    def test_raises_when_channel_key_missing(self) -> None:
        cfg = {"default": {"active_channel": "missing_key"}, "channels": {}}
        with pytest.raises(RuntimeError, match="設定が見つかりません"):
            get_active_channel_info(cfg=cfg)

    def test_raises_when_no_channel_id(self) -> None:
        cfg = {
            "default": {"active_channel": "mizuki"},
            "channels": {"mizuki": {"name": "Mizuki", "keywords": []}},
        }
        with pytest.raises(RuntimeError, match="ID が設定されていません"):
            get_active_channel_info(cfg=cfg)

    def test_uses_default_keywords_when_missing(self) -> None:
        cfg = {
            "default": {"active_channel": "mizuki"},
            "channels": {"mizuki": {"id": "UCtest1234567890123456789", "name": "Mizuki"}},
        }
        _, kws = get_active_channel_info(cfg=cfg)
        from mizukilens.config import DEFAULT_KEYWORDS
        assert kws == DEFAULT_KEYWORDS


# ---------------------------------------------------------------------------
# 4. fetch_streams — basic modes
# ---------------------------------------------------------------------------


class TestFetchStreamsBasic:
    """Test the main fetch_streams function with mocked scrapetube."""

    def _patch_scrapetube(self, videos: list[dict]) -> Any:
        return patch("scrapetube.get_channel", return_value=iter(videos))

    def test_fetch_all_new_streams(self, mem_db: sqlite3.Connection) -> None:
        """All new streams are saved with status 'discovered'."""
        videos = [
            _make_video("vid1", "歌回 2024-01-01", "2024-01-01"),
            _make_video("vid2", "歌枠 2024-01-02", "2024-01-02"),
        ]
        with self._patch_scrapetube(videos):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=["歌回", "歌枠"],
                fetch_all=True,
            )

        assert result.new == 2
        assert result.existing == 0
        assert result.total == 2

        s1 = get_stream(mem_db, "vid1")
        assert s1 is not None
        assert s1["status"] == "discovered"
        assert s1["channel_id"] == "UCtest"

    def test_fetch_skips_already_cached(self, mem_db: sqlite3.Connection) -> None:
        """Streams already in cache (non-excluded, non-imported) are counted as existing."""
        from mizukilens.cache import upsert_stream

        upsert_stream(mem_db, video_id="vid1", status="discovered", title="already cached")

        videos = [_make_video("vid1", "already cached")]
        with self._patch_scrapetube(videos):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                fetch_all=True,
            )

        assert result.new == 0
        assert result.existing == 1
        assert result.total == 1

    def test_fetch_skips_excluded_without_force(self, mem_db: sqlite3.Connection) -> None:
        """Excluded streams are skipped unless --force."""
        from mizukilens.cache import upsert_stream

        upsert_stream(mem_db, video_id="vid1", status="excluded", title="excluded stream")

        videos = [_make_video("vid1", "excluded stream")]
        with self._patch_scrapetube(videos):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                fetch_all=True,
                force=False,
            )

        assert result.existing == 1
        assert result.new == 0
        # Status should remain excluded
        s = get_stream(mem_db, "vid1")
        assert s["status"] == "excluded"

    def test_fetch_skips_imported_without_force(self, mem_db: sqlite3.Connection) -> None:
        """Imported streams are skipped unless --force."""
        from mizukilens.cache import upsert_stream

        upsert_stream(mem_db, video_id="vid1", status="discovered", title="stream")
        # transition to imported via valid steps: discovered→extracted→approved→exported→imported
        from mizukilens.cache import update_stream_status
        update_stream_status(mem_db, "vid1", "extracted")
        update_stream_status(mem_db, "vid1", "approved")
        update_stream_status(mem_db, "vid1", "exported")
        update_stream_status(mem_db, "vid1", "imported")

        videos = [_make_video("vid1", "stream")]
        with self._patch_scrapetube(videos):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                fetch_all=True,
                force=False,
            )

        assert result.existing == 1
        assert result.new == 0
        s = get_stream(mem_db, "vid1")
        assert s["status"] == "imported"

    def test_empty_video_id_skipped(self, mem_db: sqlite3.Connection) -> None:
        """Videos without a videoId are silently skipped."""
        videos = [{"videoId": "", "title": {"runs": [{"text": "no id"}]}, "publishedTimeText": {}}]
        with self._patch_scrapetube(videos):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                fetch_all=True,
            )
        assert result.total == 0

    def test_progress_callback_invoked(self, mem_db: sqlite3.Connection) -> None:
        """progress_callback is called once per processed video."""
        videos = [_make_video("vid1", "歌回"), _make_video("vid2", "歌枠")]
        calls: list[dict] = []

        with self._patch_scrapetube(videos):
            fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                fetch_all=True,
                progress_callback=calls.append,
            )

        assert len(calls) == 2


# ---------------------------------------------------------------------------
# 5. fetch_streams — recent N mode
# ---------------------------------------------------------------------------


class TestFetchStreamsRecent:
    """Tests for --recent N behaviour."""

    def _patch_scrapetube(self, videos: list[dict]) -> Any:
        return patch("scrapetube.get_channel", return_value=iter(videos))

    def test_recent_limits_via_scrapetube(self, mem_db: sqlite3.Connection) -> None:
        """fetch_streams passes limit=N to scrapetube when no date filter."""
        videos = [_make_video(f"vid{i}", f"Stream {i}") for i in range(5)]

        with patch("scrapetube.get_channel", return_value=iter(videos)) as mock_sc:
            fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                recent=5,
            )
            # scrapetube should be called with limit=5
            call_kwargs = mock_sc.call_args.kwargs
            assert call_kwargs.get("limit") == 5

    def test_recent_all_saved(self, mem_db: sqlite3.Connection) -> None:
        """All returned videos are saved when < limit."""
        videos = [_make_video(f"vid{i}", f"Stream {i}") for i in range(3)]
        with self._patch_scrapetube(videos):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                recent=10,
            )
        assert result.new == 3
        assert result.total == 3


# ---------------------------------------------------------------------------
# 6. fetch_streams — date range mode
# ---------------------------------------------------------------------------


class TestFetchStreamsDateRange:
    """Tests for --after / --before date filtering."""

    def test_after_filters_older_streams(self, mem_db: sqlite3.Connection) -> None:
        """Streams older than --after date are skipped."""
        videos = [
            _make_video("vid_new", "New Stream", "2024-03-20"),
            _make_video("vid_old", "Old Stream", "2024-01-01"),
        ]
        with patch("scrapetube.get_channel", return_value=iter(videos)):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                after="2024-03-01",
            )

        assert result.new == 1
        assert get_stream(mem_db, "vid_new") is not None
        assert get_stream(mem_db, "vid_old") is None

    def test_before_filters_newer_streams(self, mem_db: sqlite3.Connection) -> None:
        """Streams newer than --before date are skipped."""
        videos = [
            _make_video("vid_new", "New Stream", "2024-06-01"),
            _make_video("vid_old", "Old Stream", "2024-01-01"),
        ]
        with patch("scrapetube.get_channel", return_value=iter(videos)):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                after="2024-01-01",
                before="2024-04-01",
            )

        assert result.new == 1
        assert get_stream(mem_db, "vid_old") is not None
        assert get_stream(mem_db, "vid_new") is None

    def test_date_range_both_bounds(self, mem_db: sqlite3.Connection) -> None:
        """Only streams within [after, before] are saved."""
        videos = [
            _make_video("v1", "Stream 1", "2024-03-15"),  # in range
            _make_video("v2", "Stream 2", "2024-02-15"),  # too early
            _make_video("v3", "Stream 3", "2024-04-15"),  # too late
        ]
        with patch("scrapetube.get_channel", return_value=iter(videos)):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                after="2024-03-01",
                before="2024-04-01",
            )

        assert result.new == 1
        assert get_stream(mem_db, "v1") is not None
        assert get_stream(mem_db, "v2") is None
        assert get_stream(mem_db, "v3") is None

    def test_unknown_date_not_filtered(self, mem_db: sqlite3.Connection) -> None:
        """A stream with unparseable date passes through (safe default)."""
        videos = [_make_video("vid1", "Stream", "unknown")]
        with patch("scrapetube.get_channel", return_value=iter(videos)):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                after="2024-01-01",
            )
        # Unparseable dates are not filtered out
        assert result.total == 1


# ---------------------------------------------------------------------------
# 7. fetch_streams — --force flag
# ---------------------------------------------------------------------------


class TestFetchStreamsForce:
    """Tests for --force re-processing."""

    def test_force_reprocesses_excluded(self, mem_db: sqlite3.Connection) -> None:
        """--force causes excluded streams to be re-saved as 'discovered'."""
        from mizukilens.cache import upsert_stream

        upsert_stream(mem_db, video_id="vid1", status="excluded", title="excluded stream")

        videos = [_make_video("vid1", "excluded stream")]
        with patch("scrapetube.get_channel", return_value=iter(videos)):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                fetch_all=True,
                force=True,
            )

        assert result.new == 1
        s = get_stream(mem_db, "vid1")
        assert s["status"] == "discovered"

    def test_force_reprocesses_imported(self, mem_db: sqlite3.Connection) -> None:
        """--force causes imported streams to be re-saved as 'discovered'."""
        from mizukilens.cache import upsert_stream, update_stream_status

        upsert_stream(mem_db, video_id="vid1", status="discovered", title="stream")
        update_stream_status(mem_db, "vid1", "extracted")
        update_stream_status(mem_db, "vid1", "approved")
        update_stream_status(mem_db, "vid1", "exported")
        update_stream_status(mem_db, "vid1", "imported")

        videos = [_make_video("vid1", "stream")]
        with patch("scrapetube.get_channel", return_value=iter(videos)):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                fetch_all=True,
                force=True,
            )

        assert result.new == 1
        s = get_stream(mem_db, "vid1")
        assert s["status"] == "discovered"

    def test_force_with_new_stream(self, mem_db: sqlite3.Connection) -> None:
        """--force with a new stream still saves it correctly."""
        videos = [_make_video("vid1", "new stream")]
        with patch("scrapetube.get_channel", return_value=iter(videos)):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                fetch_all=True,
                force=True,
            )
        assert result.new == 1


# ---------------------------------------------------------------------------
# 8. fetch_streams — keyword filtering (fallback mode)
# ---------------------------------------------------------------------------


class TestFetchStreamsKeywordFilter:
    """Tests for use_keyword_filter=True (videos fallback with title filtering)."""

    KEYWORDS = ["歌回", "歌枠", "singing", "karaoke"]

    def test_matching_streams_are_saved(self, mem_db: sqlite3.Connection) -> None:
        """Streams matching keywords are saved."""
        videos = [
            _make_video("vid1", "【歌回】今日も歌うよ！"),
            _make_video("vid2", "Singing stream 2024"),
        ]
        with patch("scrapetube.get_channel", return_value=iter(videos)):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=self.KEYWORDS,
                fetch_all=True,
                use_keyword_filter=True,
            )

        assert result.new == 2
        assert result.skipped == 0

    def test_non_matching_streams_are_skipped(self, mem_db: sqlite3.Connection) -> None:
        """Streams that don't match any keyword are counted as skipped, not saved."""
        videos = [
            _make_video("vid1", "雑談配信 #42"),
            _make_video("vid2", "gaming stream today"),
        ]
        with patch("scrapetube.get_channel", return_value=iter(videos)):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=self.KEYWORDS,
                fetch_all=True,
                use_keyword_filter=True,
            )

        assert result.new == 0
        assert result.skipped == 2
        assert result.total == 2

    def test_mixed_matching_and_non_matching(self, mem_db: sqlite3.Connection) -> None:
        """Mixed results: matching saved, non-matching skipped."""
        videos = [
            _make_video("vid1", "【歌回】"),       # matches
            _make_video("vid2", "雑談"),           # no match
            _make_video("vid3", "karaoke night"),  # matches
        ]
        with patch("scrapetube.get_channel", return_value=iter(videos)):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=self.KEYWORDS,
                fetch_all=True,
                use_keyword_filter=True,
            )

        assert result.new == 2
        assert result.skipped == 1
        assert result.total == 3

    def test_uses_videos_content_type(self, mem_db: sqlite3.Connection) -> None:
        """When use_keyword_filter=True, scrapetube is called with content_type='videos'."""
        videos: list[dict] = []
        with patch("scrapetube.get_channel", return_value=iter(videos)) as mock_sc:
            fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=self.KEYWORDS,
                fetch_all=True,
                use_keyword_filter=True,
            )
            call_kwargs = mock_sc.call_args.kwargs
            assert call_kwargs.get("content_type") == "videos"

    def test_uses_streams_content_type_by_default(self, mem_db: sqlite3.Connection) -> None:
        """When use_keyword_filter=False, scrapetube is called with content_type='streams'."""
        videos: list[dict] = []
        with patch("scrapetube.get_channel", return_value=iter(videos)) as mock_sc:
            fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=self.KEYWORDS,
                fetch_all=True,
                use_keyword_filter=False,
            )
            call_kwargs = mock_sc.call_args.kwargs
            assert call_kwargs.get("content_type") == "streams"


# ---------------------------------------------------------------------------
# 9. Network error handling
# ---------------------------------------------------------------------------


class TestNetworkErrorHandling:
    """Tests for partial save on network failure."""

    def test_network_error_raises_NetworkError(self, mem_db: sqlite3.Connection) -> None:
        """When scrapetube raises a ConnectionError, NetworkError is raised."""
        def failing_generator() -> Generator[dict, None, None]:
            yield _make_video("vid1", "Stream 1")
            raise ConnectionError("simulated network failure")

        with patch("scrapetube.get_channel", return_value=failing_generator()):
            with pytest.raises(NetworkError):
                fetch_streams(
                    mem_db,
                    channel_id="UCtest",
                    channel_id_str="UCtest",
                    keywords=[],
                    fetch_all=True,
                )

    def test_partial_results_saved_on_error(self, mem_db: sqlite3.Connection) -> None:
        """Streams fetched before a network error are committed to the cache."""
        def partial_generator() -> Generator[dict, None, None]:
            yield _make_video("vid_ok", "Good Stream")
            raise ConnectionError("simulated network failure")

        with patch("scrapetube.get_channel", return_value=partial_generator()):
            with pytest.raises(NetworkError):
                fetch_streams(
                    mem_db,
                    channel_id="UCtest",
                    channel_id_str="UCtest",
                    keywords=[],
                    fetch_all=True,
                )

        # The stream fetched before the error should be in the cache
        s = get_stream(mem_db, "vid_ok")
        assert s is not None
        assert s["status"] == "discovered"

    def test_oserror_raises_NetworkError(self, mem_db: sqlite3.Connection) -> None:
        """OSError from scrapetube is also treated as a network error."""
        def failing_generator() -> Generator[dict, None, None]:
            raise OSError("simulated OS error")
            yield  # type: ignore[misc]  # noqa: unreachable

        with patch("scrapetube.get_channel", return_value=failing_generator()):
            with pytest.raises(NetworkError):
                fetch_streams(
                    mem_db,
                    channel_id="UCtest",
                    channel_id_str="UCtest",
                    keywords=[],
                    fetch_all=True,
                )

    def test_timeout_raises_NetworkError(self, mem_db: sqlite3.Connection) -> None:
        """TimeoutError from scrapetube is treated as a network error."""
        def failing_generator() -> Generator[dict, None, None]:
            raise TimeoutError("timed out")
            yield  # type: ignore[misc]  # noqa: unreachable

        with patch("scrapetube.get_channel", return_value=failing_generator()):
            with pytest.raises(NetworkError):
                fetch_streams(
                    mem_db,
                    channel_id="UCtest",
                    channel_id_str="UCtest",
                    keywords=[],
                    fetch_all=True,
                )


# ---------------------------------------------------------------------------
# 10. FetchResult summary
# ---------------------------------------------------------------------------


class TestFetchResult:
    """Tests for FetchResult data and summary_line."""

    def test_summary_line_format(self) -> None:
        r = FetchResult(new=3, existing=5, total=8)
        summary = r.summary_line()
        assert "3" in summary
        assert "5" in summary
        assert "8" in summary

    def test_default_values(self) -> None:
        r = FetchResult()
        assert r.new == 0
        assert r.existing == 0
        assert r.total == 0
        assert r.skipped == 0
        assert r.partial is False


# ---------------------------------------------------------------------------
# 11. CLI fetch command integration
# ---------------------------------------------------------------------------


class TestFetchCmdCli:
    """Integration tests for the CLI fetch command (mocked scrapetube)."""

    def _make_cfg(self) -> dict:
        return {
            "default": {"active_channel": "mizuki"},
            "channels": {"mizuki": {"id": "UCtest1234567890123456789", "name": "Mizuki", "keywords": ["歌回"]}},
            "cache": {"path": "~/.local/share/mizukilens/cache.db"},
            "export": {"output_dir": "~/.local/share/mizukilens/exports"},
        }

    def test_fetch_no_mode_exits_with_error(self) -> None:
        from click.testing import CliRunner
        from mizukilens.cli import main

        runner = CliRunner()
        result = runner.invoke(main, ["fetch"])
        assert result.exit_code != 0 or "エラー" in result.output or "モード" in result.output

    def test_fetch_all_and_recent_mutually_exclusive(self) -> None:
        from click.testing import CliRunner
        from mizukilens.cli import main

        runner = CliRunner()
        result = runner.invoke(main, ["fetch", "--all", "--recent", "5"])
        assert result.exit_code != 0 or "エラー" in result.output

    def test_fetch_before_without_after_is_error(self) -> None:
        from click.testing import CliRunner
        from mizukilens.cli import main

        runner = CliRunner()
        result = runner.invoke(main, ["fetch", "--before", "2024-03-01"])
        assert result.exit_code != 0 or "エラー" in result.output

    def test_fetch_all_success(self, tmp_path) -> None:
        """fetch --all with mocked scrapetube shows success summary."""
        from click.testing import CliRunner
        from mizukilens.cli import main

        videos = [_make_video("vid1", "歌回テスト", "2024-01-01")]
        db_path = tmp_path / "cache.db"

        runner = CliRunner()
        with (
            patch("mizukilens.config.load_config", return_value=self._make_cfg()),
            patch("mizukilens.cache._resolve_cache_path", return_value=db_path),
            patch("scrapetube.get_channel", return_value=iter(videos)),
        ):
            result = runner.invoke(main, ["fetch", "--all"], catch_exceptions=False)

        assert result.exit_code == 0
        assert "完了" in result.output or "1" in result.output

    def test_fetch_all_network_error_shows_message(self, tmp_path) -> None:
        """fetch --all shows friendly message on network error."""
        from click.testing import CliRunner
        from mizukilens.cli import main

        def failing_gen():
            raise ConnectionError("no network")
            yield  # noqa: unreachable

        db_path = tmp_path / "cache.db"

        runner = CliRunner()
        with (
            patch("mizukilens.config.load_config", return_value=self._make_cfg()),
            patch("mizukilens.cache._resolve_cache_path", return_value=db_path),
            patch("scrapetube.get_channel", return_value=failing_gen()),
        ):
            result = runner.invoke(main, ["fetch", "--all"], catch_exceptions=False)

        assert "ネットワーク" in result.output or "エラー" in result.output

    def test_fetch_recent_passes_limit(self, tmp_path) -> None:
        """fetch --recent 3 passes limit=3 to scrapetube."""
        from click.testing import CliRunner
        from mizukilens.cli import main

        db_path = tmp_path / "cache.db"

        runner = CliRunner()
        with (
            patch("mizukilens.config.load_config", return_value=self._make_cfg()),
            patch("mizukilens.cache._resolve_cache_path", return_value=db_path),
            patch("scrapetube.get_channel", return_value=iter([])) as mock_sc,
        ):
            result = runner.invoke(main, ["fetch", "--recent", "3"], catch_exceptions=False)

        assert result.exit_code == 0
        call_kwargs = mock_sc.call_args.kwargs
        assert call_kwargs.get("limit") == 3

    def test_fetch_after_date_mode(self, tmp_path) -> None:
        """fetch --after YYYY-MM-DD runs without error."""
        from click.testing import CliRunner
        from mizukilens.cli import main

        db_path = tmp_path / "cache.db"

        runner = CliRunner()
        with (
            patch("mizukilens.config.load_config", return_value=self._make_cfg()),
            patch("mizukilens.cache._resolve_cache_path", return_value=db_path),
            patch("scrapetube.get_channel", return_value=iter([])),
        ):
            result = runner.invoke(main, ["fetch", "--after", "2024-01-01"], catch_exceptions=False)

        assert result.exit_code == 0

    def test_fetch_force_flag(self, tmp_path) -> None:
        """fetch --all --force runs without error."""
        from click.testing import CliRunner
        from mizukilens.cli import main

        db_path = tmp_path / "cache.db"

        runner = CliRunner()
        with (
            patch("mizukilens.config.load_config", return_value=self._make_cfg()),
            patch("mizukilens.cache._resolve_cache_path", return_value=db_path),
            patch("scrapetube.get_channel", return_value=iter([])),
        ):
            result = runner.invoke(main, ["fetch", "--all", "--force"], catch_exceptions=False)

        assert result.exit_code == 0

    def test_fetch_no_config_shows_error(self) -> None:
        """fetch --all shows config error when no config exists."""
        from click.testing import CliRunner
        from mizukilens.cli import main

        runner = CliRunner()
        with patch("mizukilens.config.load_config", return_value=None):
            result = runner.invoke(main, ["fetch", "--all"], catch_exceptions=False)

        assert result.exit_code != 0 or "設定" in result.output or "エラー" in result.output


# ---------------------------------------------------------------------------
# 12. resolve_precise_dates
# ---------------------------------------------------------------------------


class TestResolvePreciseDates:
    """Tests for yt-dlp-based precise date resolution."""

    def test_resolve_success(self, mem_db: sqlite3.Connection) -> None:
        """Successfully resolves a date via yt-dlp mock."""
        from mizukilens.cache import upsert_stream
        from mizukilens.discovery import resolve_precise_dates

        upsert_stream(
            mem_db, video_id="vid_resolve1", status="discovered",
            date="2024-03-10", date_source="relative",
        )

        mock_proc = MagicMock()
        mock_proc.returncode = 0
        mock_proc.stdout = "20240315\n"

        with patch("mizukilens.discovery.subprocess.run", return_value=mock_proc):
            count = resolve_precise_dates(mem_db, ["vid_resolve1"])

        assert count == 1
        stream = get_stream(mem_db, "vid_resolve1")
        assert stream["date"] == "2024-03-15"
        assert stream["date_source"] == "precise"

    def test_resolve_partial_failure(self, mem_db: sqlite3.Connection) -> None:
        """One video succeeds, one fails — only the successful one is updated."""
        from mizukilens.cache import upsert_stream
        from mizukilens.discovery import resolve_precise_dates

        upsert_stream(
            mem_db, video_id="vid_ok", status="discovered",
            date="2024-01-01", date_source="relative",
        )
        upsert_stream(
            mem_db, video_id="vid_fail", status="discovered",
            date="2024-01-02", date_source="relative",
        )

        def mock_run(cmd, **kwargs):
            vid = cmd[-1].split("=")[-1]
            result = MagicMock()
            if vid == "vid_ok":
                result.returncode = 0
                result.stdout = "20240315\n"
            else:
                result.returncode = 1
                result.stdout = ""
            return result

        with patch("mizukilens.discovery.subprocess.run", side_effect=mock_run):
            count = resolve_precise_dates(mem_db, ["vid_ok", "vid_fail"])

        assert count == 1
        assert get_stream(mem_db, "vid_ok")["date"] == "2024-03-15"
        assert get_stream(mem_db, "vid_ok")["date_source"] == "precise"
        assert get_stream(mem_db, "vid_fail")["date"] == "2024-01-02"
        assert get_stream(mem_db, "vid_fail")["date_source"] == "relative"

    def test_resolve_timeout(self, mem_db: sqlite3.Connection) -> None:
        """Subprocess timeout is handled gracefully."""
        from mizukilens.cache import upsert_stream
        from mizukilens.discovery import resolve_precise_dates
        import subprocess as sp

        upsert_stream(
            mem_db, video_id="vid_timeout", status="discovered",
            date="2024-01-01", date_source="relative",
        )

        with patch(
            "mizukilens.discovery.subprocess.run",
            side_effect=sp.TimeoutExpired("yt-dlp", 30),
        ):
            count = resolve_precise_dates(mem_db, ["vid_timeout"])

        assert count == 0
        stream = get_stream(mem_db, "vid_timeout")
        assert stream["date"] == "2024-01-01"
        assert stream["date_source"] == "relative"

    def test_resolve_empty_list(self, mem_db: sqlite3.Connection) -> None:
        """Empty video list returns 0 without calling subprocess."""
        from mizukilens.discovery import resolve_precise_dates

        with patch("mizukilens.discovery.subprocess.run") as mock_run:
            count = resolve_precise_dates(mem_db, [])

        assert count == 0
        mock_run.assert_not_called()

    def test_resolve_auto_selects_imprecise(self, mem_db: sqlite3.Connection) -> None:
        """When video_ids=None, only non-precise streams are selected."""
        from mizukilens.cache import upsert_stream
        from mizukilens.discovery import resolve_precise_dates

        upsert_stream(
            mem_db, video_id="vid_precise", status="discovered",
            date="2024-03-15", date_source="precise",
        )
        upsert_stream(
            mem_db, video_id="vid_relative", status="discovered",
            date="2024-01-01", date_source="relative",
        )

        mock_proc = MagicMock()
        mock_proc.returncode = 0
        mock_proc.stdout = "20240220\n"

        with patch("mizukilens.discovery.subprocess.run", return_value=mock_proc) as mock_run:
            count = resolve_precise_dates(mem_db, None)

        assert count == 1
        # Only vid_relative should have been processed
        assert mock_run.call_count == 1
        assert get_stream(mem_db, "vid_precise")["date"] == "2024-03-15"
        assert get_stream(mem_db, "vid_relative")["date"] == "2024-02-20"

    def test_progress_callback_called(self, mem_db: sqlite3.Connection) -> None:
        """Progress callback receives (video_id, date_or_none)."""
        from mizukilens.cache import upsert_stream
        from mizukilens.discovery import resolve_precise_dates

        upsert_stream(
            mem_db, video_id="vid_cb", status="discovered",
            date="2024-01-01", date_source="relative",
        )

        mock_proc = MagicMock()
        mock_proc.returncode = 0
        mock_proc.stdout = "20240315\n"

        calls: list[tuple[str, str | None]] = []

        with patch("mizukilens.discovery.subprocess.run", return_value=mock_proc):
            resolve_precise_dates(
                mem_db, ["vid_cb"], progress_callback=lambda v, d: calls.append((v, d))
            )

        assert len(calls) == 1
        assert calls[0] == ("vid_cb", "2024-03-15")


# ---------------------------------------------------------------------------
# 13. fetch_streams sets date_source="relative"
# ---------------------------------------------------------------------------


class TestFetchStreamsDateSource:
    """Tests that fetch_streams marks dates as relative."""

    def test_new_streams_get_relative_date_source(self, mem_db: sqlite3.Connection) -> None:
        """New streams discovered via scrapetube get date_source='relative'."""
        videos = [_make_video("vid_ds1", "歌回テスト", "3 days ago")]

        with patch("scrapetube.get_channel", return_value=iter(videos)):
            with patch("mizukilens.discovery.resolve_precise_dates", return_value=0):
                result = fetch_streams(
                    mem_db,
                    channel_id="UCtest",
                    channel_id_str="UCtest",
                    keywords=[],
                    fetch_all=True,
                )

        assert result.new == 1
        stream = get_stream(mem_db, "vid_ds1")
        assert stream["date_source"] == "relative"


# ---------------------------------------------------------------------------
# Helpers for upcoming stream tests
# ---------------------------------------------------------------------------


def _make_upcoming_video(
    video_id: str,
    title: str,
    *,
    has_upcoming_event_data: bool = True,
    has_upcoming_overlay: bool = True,
) -> dict[str, Any]:
    """Build a fake scrapetube dict representing an upcoming/scheduled stream."""
    video: dict[str, Any] = {
        "videoId": video_id,
        "title": {"runs": [{"text": title}]},
        # Upcoming streams have no publishedTimeText
    }
    if has_upcoming_event_data:
        video["upcomingEventData"] = {
            "scheduledStartTime": "1740610800",
            "isReminderSet": False,
        }
    if has_upcoming_overlay:
        video["thumbnailOverlays"] = [
            {
                "thumbnailOverlayTimeStatusRenderer": {
                    "text": {"simpleText": "UPCOMING"},
                    "style": "UPCOMING",
                }
            }
        ]
    return video


# ---------------------------------------------------------------------------
# 14. _is_upcoming_stream detection
# ---------------------------------------------------------------------------


class TestIsUpcomingStream:
    """Unit tests for the upcoming stream detection helper."""

    def test_detects_upcoming_event_data(self) -> None:
        video = _make_upcoming_video("up1", "Upcoming", has_upcoming_overlay=False)
        assert _is_upcoming_stream(video) is True

    def test_detects_upcoming_overlay(self) -> None:
        video = _make_upcoming_video("up2", "Upcoming", has_upcoming_event_data=False)
        assert _is_upcoming_stream(video) is True

    def test_detects_both_signals(self) -> None:
        video = _make_upcoming_video("up3", "Upcoming")
        assert _is_upcoming_stream(video) is True

    def test_normal_vod_not_upcoming(self) -> None:
        video = _make_video("vod1", "Normal VOD", "3 days ago")
        assert _is_upcoming_stream(video) is False

    def test_empty_overlays_not_upcoming(self) -> None:
        video = _make_video("vod2", "Stream", "1 day ago")
        video["thumbnailOverlays"] = []
        assert _is_upcoming_stream(video) is False


# ---------------------------------------------------------------------------
# 15. fetch_streams — upcoming stream skipping
# ---------------------------------------------------------------------------


class TestFetchStreamsUpcoming:
    """Tests for skipping upcoming/scheduled streams in the fetch loop."""

    def _patch_scrapetube(self, videos: list[dict]) -> Any:
        return patch("scrapetube.get_channel", return_value=iter(videos))

    def test_upcoming_streams_skipped(self, mem_db: sqlite3.Connection) -> None:
        """Upcoming streams are not saved to cache."""
        videos = [
            _make_upcoming_video("up1", "予定配信"),
            _make_video("vod1", "歌回 2024-01-01", "2024-01-01"),
        ]
        with self._patch_scrapetube(videos):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                fetch_all=True,
            )

        assert result.upcoming_skipped == 1
        assert result.new == 1
        assert result.total == 1  # upcoming not counted in total
        assert get_stream(mem_db, "up1") is None
        assert get_stream(mem_db, "vod1") is not None

    def test_upcoming_not_counted_toward_recent(self, mem_db: sqlite3.Connection) -> None:
        """Upcoming streams do not consume --recent N slots."""
        videos = [
            _make_upcoming_video("up1", "予定配信 1"),
            _make_upcoming_video("up2", "予定配信 2"),
            _make_video("vod1", "歌回 1", "2024-03-01"),
            _make_video("vod2", "歌回 2", "2024-02-01"),
        ]
        # recent=2: should get both real VODs, ignoring the 2 upcoming
        with self._patch_scrapetube(videos):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                recent=2,
                after="2024-01-01",
            )

        assert result.upcoming_skipped == 2
        assert result.new == 2
        assert get_stream(mem_db, "vod1") is not None
        assert get_stream(mem_db, "vod2") is not None

    def test_upcoming_progress_callback_called(self, mem_db: sqlite3.Connection) -> None:
        """Progress callback is still called for upcoming streams."""
        videos = [_make_upcoming_video("up1", "予定配信")]
        calls: list[dict] = []

        with self._patch_scrapetube(videos):
            fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                fetch_all=True,
                progress_callback=calls.append,
            )

        assert len(calls) == 1

    def test_all_upcoming_yields_empty_result(self, mem_db: sqlite3.Connection) -> None:
        """If all streams are upcoming, result should have 0 new and 0 total."""
        videos = [
            _make_upcoming_video("up1", "予定 1"),
            _make_upcoming_video("up2", "予定 2"),
        ]
        with self._patch_scrapetube(videos):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                fetch_all=True,
            )

        assert result.new == 0
        assert result.total == 0
        assert result.upcoming_skipped == 2


# ---------------------------------------------------------------------------
# 16. fetch_streams — NULL date backfill
# ---------------------------------------------------------------------------


class TestFetchStreamsDateBackfill:
    """Tests for backfilling NULL dates on existing cache entries."""

    def _patch_scrapetube(self, videos: list[dict]) -> Any:
        return patch("scrapetube.get_channel", return_value=iter(videos))

    def test_backfills_null_date(self, mem_db: sqlite3.Connection) -> None:
        """Existing entry with NULL date gets backfilled when scrapetube provides one."""
        from mizukilens.cache import upsert_stream

        upsert_stream(mem_db, video_id="vid_null", status="discovered", title="Stream")
        assert get_stream(mem_db, "vid_null")["date"] is None

        videos = [_make_video("vid_null", "Stream", "2024-03-15")]
        with self._patch_scrapetube(videos):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                fetch_all=True,
            )

        assert result.dates_updated == 1
        assert result.existing == 1
        stream = get_stream(mem_db, "vid_null")
        assert stream["date"] == "2024-03-15"

    def test_no_backfill_when_date_already_set(self, mem_db: sqlite3.Connection) -> None:
        """Existing entry with a date is not backfilled."""
        from mizukilens.cache import upsert_stream

        upsert_stream(
            mem_db, video_id="vid_dated", status="discovered",
            title="Stream", date="2024-01-01",
        )

        videos = [_make_video("vid_dated", "Stream", "2024-03-15")]
        with self._patch_scrapetube(videos):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                fetch_all=True,
            )

        assert result.dates_updated == 0
        assert get_stream(mem_db, "vid_dated")["date"] == "2024-01-01"

    def test_no_backfill_when_scrapetube_date_is_none(self, mem_db: sqlite3.Connection) -> None:
        """No backfill when scrapetube also has no date."""
        from mizukilens.cache import upsert_stream

        upsert_stream(mem_db, video_id="vid_both_null", status="discovered", title="Stream")

        videos = [_make_video("vid_both_null", "Stream", "")]  # empty date
        with self._patch_scrapetube(videos):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                fetch_all=True,
            )

        assert result.dates_updated == 0
        assert get_stream(mem_db, "vid_both_null")["date"] is None

    def test_backfill_works_for_imported_status(self, mem_db: sqlite3.Connection) -> None:
        """Backfill works even for imported streams (any status)."""
        from mizukilens.cache import upsert_stream, update_stream_status

        upsert_stream(mem_db, video_id="vid_imp", status="discovered", title="Stream")
        update_stream_status(mem_db, "vid_imp", "extracted")
        update_stream_status(mem_db, "vid_imp", "approved")
        update_stream_status(mem_db, "vid_imp", "exported")
        update_stream_status(mem_db, "vid_imp", "imported")
        assert get_stream(mem_db, "vid_imp")["date"] is None

        videos = [_make_video("vid_imp", "Stream", "2024-06-01")]
        with self._patch_scrapetube(videos):
            result = fetch_streams(
                mem_db,
                channel_id="UCtest",
                channel_id_str="UCtest",
                keywords=[],
                fetch_all=True,
            )

        assert result.dates_updated == 1
        assert get_stream(mem_db, "vid_imp")["date"] == "2024-06-01"
