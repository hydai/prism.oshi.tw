"""Stream discovery module for PrismLens.

Fetches YouTube livestream archives from the configured channel using
``scrapetube``, compares against the local cache, and saves new streams
with status ``"discovered"``.

Public API
----------
- :func:`get_active_channel_info` — load channel ID and keywords from config
- :func:`parse_video_date` — normalise scrapetube date strings to YYYY-MM-DD
- :func:`matches_keywords` — check whether a title contains any keyword
- :func:`fetch_streams` — main entry point: fetch, filter, and cache streams
- :class:`FetchResult` — result dataclass returned by :func:`fetch_streams`
- :class:`NetworkError` — raised when scrapetube fails mid-fetch
"""

from __future__ import annotations

import re
import sqlite3
import subprocess
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Generator

# ---------------------------------------------------------------------------
# Public exceptions
# ---------------------------------------------------------------------------


class NetworkError(Exception):
    """Raised when a network failure interrupts stream discovery."""


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------


@dataclass
class FetchResult:
    """Summary of a :func:`fetch_streams` run."""

    new: int = 0       # newly discovered (added to cache with "discovered")
    existing: int = 0  # already in cache (not re-processed unless --force)
    total: int = 0     # new + existing + skipped keywords
    skipped: int = 0   # failed keyword filter (keyword_only mode only)
    partial: bool = False  # True if a network error interrupted the run
    dates_resolved: int = 0  # precise dates fetched via yt-dlp
    upcoming_skipped: int = 0  # upcoming/scheduled streams detected and skipped
    dates_updated: int = 0  # existing NULL-date entries backfilled

    def summary_line(self) -> str:
        """Return a human-readable summary string (Japanese + English)."""
        line = f"新發現 {self.new} 場、已存在 {self.existing} 場、總計 {self.total} 場"
        if self.dates_resolved > 0:
            line += f"、日付解決 {self.dates_resolved} 件"
        if self.upcoming_skipped > 0:
            line += f"、予定スキップ {self.upcoming_skipped} 件"
        if self.dates_updated > 0:
            line += f"、日付補完 {self.dates_updated} 件"
        return line


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------


def get_active_channel_info(cfg: dict[str, Any] | None = None) -> tuple[str, list[str]]:
    """Return ``(channel_id_or_handle, keywords)`` for the active channel.

    Parameters
    ----------
    cfg:
        Pre-loaded config dict (optional).  Loaded from disk when *None*.

    Raises
    ------
    RuntimeError
        If no config file exists or the active channel is not configured.
    """
    if cfg is None:
        from prismlens.config import load_config
        cfg = load_config()

    if cfg is None:
        raise RuntimeError(
            "設定ファイルが見つかりません。先に `prismlens config` を実行してください。"
        )

    active_key = cfg.get("default", {}).get("active_channel")
    if not active_key:
        raise RuntimeError(
            "有効なチャンネルが設定されていません。`prismlens config` を実行してください。"
        )

    channels = cfg.get("channels", {})
    channel_cfg = channels.get(active_key)
    if not channel_cfg:
        raise RuntimeError(
            f"チャンネル {active_key!r} の設定が見つかりません。`prismlens config` を確認してください。"
        )

    channel_id: str = channel_cfg.get("id", "")
    if not channel_id:
        raise RuntimeError(
            f"チャンネル {active_key!r} に ID が設定されていません。"
        )

    from prismlens.config import DEFAULT_KEYWORDS
    keywords: list[str] = channel_cfg.get("keywords", list(DEFAULT_KEYWORDS))
    return channel_id, keywords


# ---------------------------------------------------------------------------
# Date parsing
# ---------------------------------------------------------------------------

# Relative date patterns emitted by scrapetube (English and Japanese YouTube)
_RELATIVE_RE = re.compile(
    r"(\d+)\s+"
    r"(second|seconds|minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)"
    r"\s+ago",
    re.IGNORECASE,
)

_ISO_DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
_DATE_COMPACT_RE = re.compile(r"(\d{4})(\d{2})(\d{2})")
# Patterns like "Jan 15, 2024" or "15 Jan 2024"
_HUMAN_DATE_RE = re.compile(
    r"(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})|([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})"
)

_MONTH_NAMES = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def parse_video_date(raw: str | None, reference_date: date | None = None) -> str | None:
    """Normalise a scrapetube date string to ``YYYY-MM-DD``.

    Handles the following formats:
    - ISO 8601 date (``2024-03-15``)
    - Compact date (``20240315``)
    - Human-readable (``Jan 15, 2024`` / ``15 Jan 2024``)
    - Relative (``3 days ago``, ``2 weeks ago``, …)
    - ``None`` or empty string → returns *None*

    Parameters
    ----------
    raw:
        Raw date string from scrapetube.
    reference_date:
        The date to use as "today" for relative calculations.
        Defaults to the current UTC date when *None*.
    """
    if not raw:
        return None

    raw = raw.strip()
    if not raw:
        return None

    today = reference_date or datetime.now(tz=timezone.utc).date()

    # ISO 8601
    m = _ISO_DATE_RE.fullmatch(raw)
    if m:
        return raw  # already YYYY-MM-DD

    # Partial ISO (just check if it fits YYYY-MM-DD anywhere)
    m = _ISO_DATE_RE.search(raw)
    if m:
        return m.group(0)

    # Compact numeric
    m = _DATE_COMPACT_RE.fullmatch(raw)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"

    # Human date
    m = _HUMAN_DATE_RE.search(raw)
    if m:
        if m.group(1):  # "15 Jan 2024"
            day, mon, year = int(m.group(1)), m.group(2).lower(), int(m.group(3))
        else:           # "Jan 15, 2024"
            mon, day, year = m.group(4).lower(), int(m.group(5)), int(m.group(6))
        month_num = _MONTH_NAMES.get(mon[:3])
        if month_num:
            return f"{year:04d}-{month_num:02d}-{day:02d}"

    # Relative date ("N unit ago")
    m = _RELATIVE_RE.search(raw)
    if m:
        amount = int(m.group(1))
        unit = m.group(2).lower().rstrip("s")  # normalize plural
        delta: timedelta
        if unit in ("second",):
            delta = timedelta(seconds=amount)
        elif unit in ("minute",):
            delta = timedelta(minutes=amount)
        elif unit in ("hour",):
            delta = timedelta(hours=amount)
        elif unit in ("day",):
            delta = timedelta(days=amount)
        elif unit in ("week",):
            delta = timedelta(weeks=amount)
        elif unit in ("month",):
            delta = timedelta(days=amount * 30)
        elif unit in ("year",):
            delta = timedelta(days=amount * 365)
        else:
            return None
        result = today - delta
        return result.isoformat()

    return None


# ---------------------------------------------------------------------------
# Keyword filtering
# ---------------------------------------------------------------------------


def matches_keywords(title: str, keywords: list[str]) -> bool:
    """Return True if *title* contains at least one keyword (case-insensitive for ASCII)."""
    title_lower = title.lower()
    for kw in keywords:
        if kw.lower() in title_lower:
            return True
    return False


# ---------------------------------------------------------------------------
# scrapetube helpers
# ---------------------------------------------------------------------------


def _extract_video_info(video: dict[str, Any]) -> dict[str, Any]:
    """Extract video_id, title, and raw date from a scrapetube video dict."""
    video_id: str = video.get("videoId", "")

    # Title is nested: {"title": {"runs": [{"text": "..."}]}}
    title_obj = video.get("title", {})
    runs = title_obj.get("runs", [])
    title: str = "".join(r.get("text", "") for r in runs) if runs else title_obj.get("simpleText", "")

    # publishedTimeText is {"simpleText": "3 days ago"}
    published_obj = video.get("publishedTimeText", {})
    raw_date: str | None = published_obj.get("simpleText") if published_obj else None

    return {"video_id": video_id, "title": title, "raw_date": raw_date, "is_upcoming": _is_upcoming_stream(video)}


def _is_upcoming_stream(video: dict[str, Any]) -> bool:
    """Detect upcoming/scheduled streams that haven't aired yet.

    Two signals from scrapetube's raw YouTube data:
    - ``upcomingEventData`` key is present (primary signal)
    - ``thumbnailOverlays`` contains an overlay with style ``"UPCOMING"`` (fallback)
    """
    if video.get("upcomingEventData") is not None:
        return True
    for overlay in video.get("thumbnailOverlays", []):
        renderer = overlay.get("thumbnailOverlayTimeStatusRenderer", {})
        if renderer.get("style") == "UPCOMING":
            return True
    return False


def _build_channel_kwargs(channel_id: str) -> dict[str, Any]:
    """Build keyword args for :func:`scrapetube.get_channel` from a channel ID or handle."""
    # UC… channel ID
    if re.match(r"^UC[a-zA-Z0-9_-]{22}$", channel_id):
        return {"channel_id": channel_id}
    # @handle
    if channel_id.startswith("@"):
        return {"channel_username": channel_id[1:]}
    # bare handle (no @)
    return {"channel_username": channel_id}


# ---------------------------------------------------------------------------
# Date range helpers
# ---------------------------------------------------------------------------


def _parse_cli_date(date_str: str) -> date:
    """Parse a YYYY-MM-DD string into a :class:`datetime.date`."""
    return datetime.strptime(date_str, "%Y-%m-%d").date()


def _video_date_in_range(
    video_date: str | None,
    after: date | None,
    before: date | None,
) -> bool:
    """Return True if *video_date* (YYYY-MM-DD) falls within [after, before].

    When either bound is *None* that direction is unbounded.
    When *video_date* is *None*, we cannot determine—return True to be safe.
    """
    if video_date is None:
        return True
    try:
        d = datetime.strptime(video_date, "%Y-%m-%d").date()
    except ValueError:
        return True
    if after is not None and d < after:
        return False
    if before is not None and d > before:
        return False
    return True


# ---------------------------------------------------------------------------
# Precise date resolution via yt-dlp
# ---------------------------------------------------------------------------


def resolve_precise_dates(
    conn: sqlite3.Connection,
    video_ids: list[str] | None = None,
    *,
    progress_callback: Callable[[str, str | None], None] | None = None,
) -> int:
    """Fetch precise upload dates for streams via ``yt-dlp``.

    Parameters
    ----------
    conn:
        Open SQLite connection.
    video_ids:
        Specific video IDs to resolve.  When *None*, resolves all streams
        whose ``date_source`` is not ``'precise'``.
    progress_callback:
        Called with ``(video_id, formatted_date_or_none)`` after each attempt.

    Returns
    -------
    int
        Number of successfully updated dates.
    """
    if video_ids is None:
        cur = conn.execute(
            "SELECT video_id FROM streams "
            "WHERE date_source IS NULL OR date_source != 'precise'"
        )
        video_ids = [row["video_id"] for row in cur.fetchall()]

    if not video_ids:
        return 0

    from prismlens.cache import _now_iso

    updated = 0
    for vid in video_ids:
        formatted_date: str | None = None
        try:
            proc = subprocess.run(
                [
                    "yt-dlp",
                    "--skip-download",
                    "--no-warnings",
                    "--print", "upload_date",
                    f"https://www.youtube.com/watch?v={vid}",
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if proc.returncode == 0:
                raw = proc.stdout.strip()
                # yt-dlp outputs YYYYMMDD
                if re.fullmatch(r"\d{8}", raw):
                    formatted_date = f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}"
        except (subprocess.TimeoutExpired, OSError):
            pass  # skip on failure

        if formatted_date:
            conn.execute(
                "UPDATE streams SET date = ?, date_source = 'precise', "
                "updated_at = ? WHERE video_id = ?",
                (formatted_date, _now_iso(), vid),
            )
            conn.commit()
            updated += 1

        if progress_callback:
            progress_callback(vid, formatted_date)

    return updated


# ---------------------------------------------------------------------------
# Main fetch function
# ---------------------------------------------------------------------------


def fetch_streams(
    conn: sqlite3.Connection,
    *,
    channel_id: str,
    channel_id_str: str,
    keywords: list[str],
    fetch_all: bool = False,
    recent: int | None = None,
    after: str | None = None,
    before: str | None = None,
    force: bool = False,
    use_keyword_filter: bool = False,
    progress_callback: Any | None = None,
) -> FetchResult:
    """Discover streams from YouTube and save new ones to *conn*.

    Parameters
    ----------
    conn:
        Open SQLite connection (from :func:`cache.open_db`).
    channel_id:
        The YouTube channel ID or handle to fetch from.
    channel_id_str:
        The same channel ID string to store in the ``channel_id`` column.
    keywords:
        List of title keywords to use when ``use_keyword_filter=True``.
    fetch_all:
        Fetch every stream archive (no limit).
    recent:
        Fetch at most this many recent streams.
    after:
        Only keep streams published on or after this ``YYYY-MM-DD`` date.
    before:
        Only keep streams published on or before this ``YYYY-MM-DD`` date.
    force:
        When True, re-insert/update streams regardless of their current status
        (including ``"excluded"`` and ``"imported"``).
    use_keyword_filter:
        When True, fetch with ``content_type="videos"`` and filter by keyword.
        Streams that don't match any keyword are **skipped** (not saved).
    progress_callback:
        Optional callable invoked with each processed video dict so callers
        can display progress.  Signature: ``progress_callback(video_info: dict)``.

    Returns
    -------
    FetchResult
        A summary of what was discovered.

    Raises
    ------
    NetworkError
        When scrapetube raises a network-level exception mid-fetch.  Any
        streams already processed before the error are committed to the cache.
    """
    import scrapetube
    from prismlens.cache import get_stream, update_stream_date, upsert_stream

    result = FetchResult()
    newly_discovered: list[str] = []

    # Determine scrapetube content_type
    content_type = "videos" if use_keyword_filter else "streams"

    # Determine limit for scrapetube
    scrapetube_limit: int | None = None
    if recent is not None and after is None and before is None:
        # Only apply scrapetube limit when no date range is involved
        scrapetube_limit = recent

    after_date: date | None = _parse_cli_date(after) if after else None
    before_date: date | None = _parse_cli_date(before) if before else None

    channel_kwargs = _build_channel_kwargs(channel_id)

    try:
        generator: Generator[dict, None, None] = scrapetube.get_channel(
            **channel_kwargs,
            content_type=content_type,
            limit=scrapetube_limit,
        )
        videos_seen = 0

        for video in generator:
            info = _extract_video_info(video)
            video_id = info["video_id"]
            title = info["title"]
            raw_date = info["raw_date"]

            if not video_id:
                continue

            # Skip upcoming/scheduled streams — they have no real date and
            # would pollute the cache with NULL-date entries.
            if info["is_upcoming"]:
                result.upcoming_skipped += 1
                if progress_callback:
                    progress_callback(info)
                continue

            # Parse and normalise date
            parsed_date = parse_video_date(raw_date)

            # Date-range filtering (when --after or --before are given)
            if after_date is not None or before_date is not None:
                if not _video_date_in_range(parsed_date, after_date, before_date):
                    # When fetching by date range with newest-first sort, once we go
                    # past `before` we can keep going; once we go before `after` we
                    # can stop early.
                    if (
                        after_date is not None
                        and parsed_date is not None
                    ):
                        try:
                            d = datetime.strptime(parsed_date, "%Y-%m-%d").date()
                            if d < after_date:
                                break  # older than our window — stop iterating
                        except ValueError:
                            pass
                    continue

            # Recent-N with date filtering: still need to honour --recent limit
            if recent is not None and (after is not None or before is not None):
                if videos_seen >= recent:
                    break

            # Keyword filtering (fallback mode)
            if use_keyword_filter:
                if not matches_keywords(title, keywords):
                    result.skipped += 1
                    result.total += 1
                    if progress_callback:
                        progress_callback(info)
                    continue

            # Check existing cache status
            existing = get_stream(conn, video_id)

            if existing is not None and not force:
                # Backfill NULL dates: if we now have a date for a previously
                # dateless entry, update it regardless of status.
                if parsed_date is not None and existing["date"] is None:
                    if update_stream_date(conn, video_id, parsed_date):
                        result.dates_updated += 1

                existing_status = existing["status"]
                # Skip excluded/imported unless --force
                if existing_status in ("excluded", "imported"):
                    result.existing += 1
                    result.total += 1
                    if progress_callback:
                        progress_callback(info)
                    videos_seen += 1
                    continue
                # Already in cache (any other status) — count as existing
                result.existing += 1
                result.total += 1
                if progress_callback:
                    progress_callback(info)
                videos_seen += 1
                continue

            # New stream (or forced re-process)
            upsert_stream(
                conn,
                video_id=video_id,
                channel_id=channel_id_str,
                title=title,
                date=parsed_date,
                date_source="relative",
                status="discovered",
                source="scrapetube",
            )
            result.new += 1
            result.total += 1
            newly_discovered.append(video_id)
            if progress_callback:
                progress_callback(info)
            videos_seen += 1

    except (OSError, ConnectionError, TimeoutError, Exception) as exc:
        # Distinguish network errors from other exceptions
        exc_name = type(exc).__name__
        is_network = (
            isinstance(exc, (OSError, ConnectionError, TimeoutError))
            or "requests" in str(type(exc).__module__)
            or exc_name in ("ConnectionError", "Timeout", "HTTPError", "RequestException")
        )
        if is_network or "requests" in str(exc).lower() or "network" in str(exc).lower():
            result.partial = True
            raise NetworkError(f"ネットワークエラーが発生しました: {exc}") from exc
        raise

    if newly_discovered:
        try:
            result.dates_resolved = resolve_precise_dates(conn, newly_discovered)
        except Exception:  # noqa: BLE001
            pass  # Non-fatal: relative dates are acceptable fallback

    return result
