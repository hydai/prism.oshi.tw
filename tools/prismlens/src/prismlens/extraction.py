"""Timestamp extraction module for PrismLens.

Implements a three-stage fallback pipeline:
  1. Fetch comments (sorted by popularity) → find candidate with ≥3 timestamps
  2. If no suitable comment found → check video description
  3. If neither has timestamps → mark stream as "pending"

Public API
----------
- :func:`extract_timestamps` — main entry point: run extraction pipeline
- :func:`parse_timestamp` — parse a timestamp string to seconds
- :func:`parse_song_line` — parse a single "timestamp song_info" line
- :func:`find_candidate_comment` — select best candidate from comment list
- :func:`parse_comment_to_songs` — parse comment text into structured song list
- :class:`ExtractionResult` — result dataclass returned by :func:`extract_timestamps`
- :class:`ExtractionError` — raised on unexpected extraction errors
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass, field
from typing import Any, Generator

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: Seconds threshold above which a timestamp is flagged as suspicious (>12h)
SUSPICIOUS_THRESHOLD = 43200  # 12 * 3600

#: Minimum number of timestamp patterns required to qualify as a candidate comment
MIN_TIMESTAMPS_REQUIRED = 3

# ---------------------------------------------------------------------------
# Public exceptions
# ---------------------------------------------------------------------------


class ExtractionError(Exception):
    """Raised when an unexpected error occurs during extraction."""


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------


@dataclass
class ExtractionResult:
    """Summary of an :func:`extract_timestamps` run."""

    video_id: str
    status: str            # "extracted" | "pending"
    source: str | None     # "comment" | "description" | None
    songs: list[dict[str, Any]] = field(default_factory=list)
    raw_comment: str | None = None
    raw_description: str | None = None
    suspicious_timestamps: list[int] = field(default_factory=list)
    comment_author: str | None = None
    comment_author_url: str | None = None
    comment_id: str | None = None


# ---------------------------------------------------------------------------
# Timestamp parsing
# ---------------------------------------------------------------------------

# Matches: H:MM:SS, HH:MM:SS, M:SS, MM:SS
# Group 1 = optional hours, Group 2 = minutes, Group 3 = seconds
_TIMESTAMP_RE = re.compile(r"(?:(\d{1,2}):)?(\d{1,2}):(\d{2})")


def parse_timestamp(ts: str) -> int | None:
    """Parse a timestamp string and return the total seconds.

    Supported formats:
    - ``H:MM:SS`` / ``HH:MM:SS`` → hours * 3600 + minutes * 60 + seconds
    - ``MM:SS`` / ``M:SS``       → minutes * 60 + seconds

    Parameters
    ----------
    ts:
        Raw timestamp string (e.g. ``"1:23:45"`` or ``"23:45"``).

    Returns
    -------
    int | None
        Total seconds, or *None* if the string cannot be parsed.
    """
    m = _TIMESTAMP_RE.fullmatch(ts.strip())
    if not m:
        return None
    hours = int(m.group(1)) if m.group(1) is not None else 0
    minutes = int(m.group(2))
    seconds = int(m.group(3))
    return hours * 3600 + minutes * 60 + seconds


def count_timestamps(text: str) -> int:
    """Return the number of timestamp-like patterns in *text*."""
    return len(_TIMESTAMP_RE.findall(text))


def is_suspicious_timestamp(seconds: int) -> bool:
    """Return True if *seconds* exceeds the 12-hour threshold."""
    return seconds > SUSPICIOUS_THRESHOLD


# ---------------------------------------------------------------------------
# Song info parsing
# ---------------------------------------------------------------------------

# Separators between timestamp and song info (ordered: longest first to avoid
# partial matches)
_SEP_RE = re.compile(
    r"^\s*"
    r"(?:(?:\d{1,2}:)?\d{1,2}:\d{2})"  # timestamp (non-capturing)
    r"\s*(?:\s+-\s+|\s+–\s+|\s+—\s+|\s+)"  # separator
    r"(.+)$"
)

# Finds the timestamp at the start of a line
_LINE_TS_RE = re.compile(r"^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})")

# Range end-timestamp: matches "~ HH:MM:SS", "- HH:MM:SS", etc.
# Only matches when separator is immediately followed by a valid timestamp,
# preventing false positives on "0:30 - Song Name".
_RANGE_END_RE = re.compile(r"^(?:~|-|–|—)\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})")

# Separators for splitting artist from song name
# Priority: " / " first (more specific), then " - " (but only when not used
# as the timestamp-info separator itself)
_ARTIST_SEP_RE = re.compile(r"\s*/\s+|\s+/\s+")  # space/slash variants
_ARTIST_DASH_RE = re.compile(r"\s+-\s+")


def _split_artist(song_info: str) -> tuple[str, str]:
    """Split *song_info* into (name, artist).

    Rules:
    - If ``" / "`` is present: split on first occurrence → (left, right)
    - Else if ``" - "`` is present: split on first occurrence → (left, right)
    - Otherwise: (song_info, "")

    Returns
    -------
    tuple[str, str]
        ``(song_name, artist)``
    """
    # Try " / " variants
    m = re.search(r"\s*/\s+|\s+/\s*", song_info)
    if m:
        name = song_info[: m.start()].strip()
        artist = song_info[m.end() :].strip()
        return name, artist

    # Try " - " (em-dash and en-dash handled as separators too)
    m = re.search(r"\s+-\s+", song_info)
    if m:
        name = song_info[: m.start()].strip()
        artist = song_info[m.end() :].strip()
        return name, artist

    # Try bare "/" (no spaces required) — common in JP/CN song listings
    m = re.search(r"/", song_info)
    if m:
        name = song_info[: m.start()].strip()
        artist = song_info[m.end() :].strip()
        if name and artist:
            return name, artist

    return song_info.strip(), ""


def parse_song_line(line: str) -> dict[str, Any] | None:
    """Parse a single line into a structured song dict.

    Expected format::

        timestamp [separator] song_info

    where *separator* is one of: space, `` - ``, `` – ``, `` — ``.

    Parameters
    ----------
    line:
        A single line of text from a comment or description.

    Returns
    -------
    dict | None
        Dict with keys ``start_seconds`` (int), ``song_name`` (str),
        ``artist`` (str), or *None* if the line doesn't match.
    """
    line = line.strip()
    if not line:
        return None

    # Strip leading box-drawing / tree-formatting characters (├ └ │ ─ etc.)
    line = re.sub(r"^[\u2500-\u257F\s]+", "", line)
    if not line:
        return None

    # Strip common numbering prefixes: "01. ", "1) ", "#3 "
    line = re.sub(r"^(?:\d+\.\s*|\d+\)\s+|#\d+\s+)", "", line)

    # Strip bullet prefixes: "- ", "* ", "+ "
    line = re.sub(r"^[-*+]\s+", "", line)

    # Find leading timestamp
    ts_match = _LINE_TS_RE.match(line)
    if not ts_match:
        return None

    ts_end = ts_match.end()
    hours = int(ts_match.group(1)) if ts_match.group(1) is not None else 0
    minutes = int(ts_match.group(2))
    seconds = int(ts_match.group(3))
    start_seconds = hours * 3600 + minutes * 60 + seconds

    # Rest of the line after the timestamp
    remainder = line[ts_end:].strip()

    # Check for range end-timestamp (e.g. "~ 00:08:26" or "- 1:23:45")
    # Must be checked BEFORE separator stripping to avoid confusing
    # "- 00:08:26 Song" (range) with "- Song Name" (separator)
    end_seconds = None
    range_match = _RANGE_END_RE.match(remainder)
    if range_match:
        rh = int(range_match.group(1)) if range_match.group(1) is not None else 0
        rm = int(range_match.group(2))
        rs = int(range_match.group(3))
        end_seconds = rh * 3600 + rm * 60 + rs
        remainder = remainder[range_match.end():].strip()

    # Strip leading separator characters (" - ", " – ", " — ")
    sep_match = re.match(r"^(?:-\s+|–\s+|—\s+|)", remainder)
    if sep_match:
        remainder = remainder[sep_match.end():].strip()

    if not remainder:
        return None

    song_name, artist = _split_artist(remainder)

    result = {
        "start_seconds": start_seconds,
        "song_name": song_name,
        "artist": artist,
    }
    if end_seconds is not None:
        result["end_seconds"] = end_seconds
    return result


def parse_text_to_songs(text: str) -> list[dict[str, Any]]:
    """Parse a multi-line text block into a list of structured song dicts.

    Lines without a leading timestamp are skipped.
    End timestamps are inferred: each song's end = next song's start.
    The last song has ``end_seconds = None``.

    Also collects suspicious timestamps (>12 hours).

    Parameters
    ----------
    text:
        Comment or description text.

    Returns
    -------
    list[dict]
        List of dicts with keys:
        ``order_index``, ``song_name``, ``artist``,
        ``start_seconds``, ``end_seconds``,
        ``start_timestamp``, ``end_timestamp``,
        ``suspicious``.
    """
    raw_songs: list[dict[str, Any]] = []
    for line in text.splitlines():
        parsed = parse_song_line(line)
        if parsed:
            raw_songs.append(parsed)

    if not raw_songs:
        return []

    # Determine end timestamps: use explicit range end if available, else infer
    result: list[dict[str, Any]] = []
    for i, song in enumerate(raw_songs):
        start_sec = song["start_seconds"]
        explicit_end = song.get("end_seconds")
        if explicit_end is not None:
            end_sec = explicit_end
        elif i + 1 < len(raw_songs):
            end_sec = raw_songs[i + 1]["start_seconds"]
        else:
            end_sec = None

        result.append(
            {
                "order_index": i,
                "song_name": song["song_name"],
                "artist": song["artist"],
                "start_seconds": start_sec,
                "end_seconds": end_sec,
                "start_timestamp": seconds_to_timestamp(start_sec),
                "end_timestamp": seconds_to_timestamp(end_sec) if end_sec is not None else None,
                "suspicious": is_suspicious_timestamp(start_sec),
            }
        )

    return result


def seconds_to_timestamp(seconds: int) -> str:
    """Convert *seconds* (int) to ``H:MM:SS`` / ``MM:SS`` string."""
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


# ---------------------------------------------------------------------------
# Candidate comment selection
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Keyword candidate detection
# ---------------------------------------------------------------------------


def find_keyword_comments(
    comments: list[dict[str, Any]],
    keywords: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Find comments whose text contains any of the songlist keywords.

    Matching is case-insensitive for ASCII keywords and exact for CJK.

    Returns list of dicts with keys from the comment dict plus
    ``'keywords_matched'`` (a list of matched keyword strings).
    """
    if keywords is None:
        from prismlens.config import get_songlist_keywords
        keywords = get_songlist_keywords()

    results: list[dict[str, Any]] = []
    for comment in comments:
        text = comment.get("text", "")
        matched: list[str] = []
        for kw in keywords:
            # Case-insensitive check for ASCII keywords
            if kw.isascii():
                if kw.lower() in text.lower():
                    matched.append(kw)
            else:
                if kw in text:
                    matched.append(kw)
        if matched:
            result = dict(comment)
            result["keywords_matched"] = matched
            results.append(result)

    return results


def _cache_keyword_candidates(
    conn: sqlite3.Connection,
    video_id: str,
    comments: list[dict[str, Any]],
) -> int:
    """Scan comments for songlist keywords and save matches to candidate_comments.

    Returns the number of candidates saved.
    """
    from prismlens.cache import save_candidate_comments

    keyword_comments = find_keyword_comments(comments)
    if not keyword_comments:
        return 0

    candidates = [
        {
            "comment_cid":        c.get("cid"),
            "comment_author":     c.get("author"),
            "comment_author_url": c.get("channel"),
            "comment_text":       c.get("text", ""),
            "keywords_matched":   c.get("keywords_matched", []),
        }
        for c in keyword_comments
    ]
    return save_candidate_comments(conn, video_id, candidates)


# ---------------------------------------------------------------------------
# Candidate comment selection
# ---------------------------------------------------------------------------


def find_candidate_comment(
    comments: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Select the best candidate comment for timestamp extraction.

    A candidate must have ≥ :data:`MIN_TIMESTAMPS_REQUIRED` timestamp patterns.

    Priority (descending):
    1. Pinned comment (``is_pinned=True``)
    2. Highest like count (``votes`` field, cast to int)
    3. Most timestamp patterns

    Parameters
    ----------
    comments:
        List of comment dicts (as returned by youtube-comment-downloader,
        plus optional ``is_pinned`` field).

    Returns
    -------
    dict | None
        The best candidate comment dict, or *None* if no candidate qualifies.
    """
    candidates = [
        c for c in comments if count_timestamps(c.get("text", "")) >= MIN_TIMESTAMPS_REQUIRED
    ]
    if not candidates:
        return None

    def _sort_key(c: dict[str, Any]) -> tuple[int, int, int]:
        is_pinned = int(bool(c.get("is_pinned", False)))
        # votes is a string like "1.2K" or "345" — parse it
        votes = _parse_vote_count(c.get("votes", "0"))
        ts_count = count_timestamps(c.get("text", ""))
        # Higher = better; negate for sort if we sort ascending
        return (is_pinned, votes, ts_count)

    return max(candidates, key=_sort_key)


def _parse_vote_count(votes: Any) -> int:
    """Parse a vote-count string like ``"1.2K"`` or ``"345"`` to int."""
    if isinstance(votes, int):
        return votes
    s = str(votes).strip().replace(",", "")
    if not s or s == "0":
        return 0
    try:
        if s.endswith("K") or s.endswith("k"):
            return int(float(s[:-1]) * 1000)
        if s.endswith("M") or s.endswith("m"):
            return int(float(s[:-1]) * 1_000_000)
        return int(float(s))
    except (ValueError, TypeError):
        return 0


# ---------------------------------------------------------------------------
# Description fetching
# ---------------------------------------------------------------------------


def get_description_from_ytdlp(video_id: str) -> str | None:
    """Fetch the video description using ``yt-dlp --skip-download --print description``.

    Returns the description text, or *None* on failure.
    """
    import subprocess

    url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        result = subprocess.run(
            ["yt-dlp", "--skip-download", "--print", "description", url],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode == 0:
            return result.stdout.strip() or None
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        pass
    return None


def get_video_info_from_ytdlp(video_id: str) -> dict[str, str | None]:
    """Fetch video title and upload_date via yt-dlp.

    Returns ``{"title": str|None, "date": str|None}``.
    The date is formatted as ``YYYY-MM-DD`` (from yt-dlp's ``YYYYMMDD``).
    """
    import subprocess

    url = f"https://www.youtube.com/watch?v={video_id}"
    info: dict[str, str | None] = {"title": None, "date": None}
    try:
        result = subprocess.run(
            [
                "yt-dlp", "--skip-download",
                "--print", "title",
                "--print", "upload_date",
                url,
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode == 0:
            lines = result.stdout.strip().splitlines()
            if len(lines) >= 1 and lines[0].strip():
                info["title"] = lines[0].strip()
            if len(lines) >= 2 and lines[1].strip():
                raw_date = lines[1].strip()
                # Convert YYYYMMDD → YYYY-MM-DD
                if len(raw_date) == 8 and raw_date.isdigit():
                    info["date"] = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}"
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        pass
    return info


# ---------------------------------------------------------------------------
# Main extraction pipeline
# ---------------------------------------------------------------------------


def extract_timestamps(
    conn: sqlite3.Connection,
    video_id: str,
    *,
    raw_description: str | None = None,
    comment_generator: Any | None = None,
) -> ExtractionResult:
    """Run the three-stage timestamp extraction pipeline for *video_id*.

    Pipeline:
    1. Fetch comments (sorted by popularity) → find candidate with ≥3 timestamps
    2. If not found → check description (from *raw_description* or yt-dlp)
    3. If still not found → mark stream as "pending"

    The stream's ``status``, ``raw_comment``, and ``raw_description`` fields
    are updated in *conn*, and parsed songs are saved via
    :func:`cache.upsert_parsed_songs`.

    Parameters
    ----------
    conn:
        Open SQLite connection (from :func:`cache.open_db`).
    video_id:
        The YouTube video ID to process.
    raw_description:
        Pre-fetched description text (e.g. from scrapetube data).
        When *None*, yt-dlp is used as fallback.
    comment_generator:
        Optional pre-built comment generator/iterable (used for testing).
        When *None*, :class:`YoutubeCommentDownloader` is used.

    Returns
    -------
    ExtractionResult
        Result dataclass with status, source, songs, and raw text.

    Raises
    ------
    KeyError
        If *video_id* does not exist in the cache.
    """
    from prismlens.cache import (
        get_stream,
        update_stream_status,
        upsert_stream,
        upsert_parsed_songs,
    )

    # Verify stream exists
    stream = get_stream(conn, video_id)
    if stream is None:
        raise KeyError(f"Stream {video_id!r} not found in cache.")

    # -----------------------------------------------------------------------
    # Stage 1: Comment extraction
    # -----------------------------------------------------------------------
    selected_comment: dict[str, Any] | None = None
    comments_disabled = False
    raw_comment_text: str | None = None

    try:
        if comment_generator is not None:
            comment_gen = comment_generator
        else:
            from youtube_comment_downloader import YoutubeCommentDownloader, SORT_BY_POPULAR
            downloader = YoutubeCommentDownloader()
            comment_gen = downloader.get_comments(video_id, sort_by=SORT_BY_POPULAR)

        # comment_gen may be None if comments are disabled
        if comment_gen is None:
            comments_disabled = True
        else:
            comments: list[dict[str, Any]] = list(comment_gen)

            # Cache keyword-matched comments as candidates for manual review
            _cache_keyword_candidates(conn, video_id, comments)

            selected_comment = find_candidate_comment(comments)

    except RuntimeError:
        # Comments disabled or failed to fetch
        comments_disabled = True
    except Exception:  # noqa: BLE001
        # Any other error — treat comments as unavailable
        comments_disabled = True

    # Extract author attribution from the selected comment (if any)
    comment_author: str | None = None
    comment_author_url: str | None = None
    comment_id: str | None = None

    if selected_comment is not None:
        comment_author = selected_comment.get("author") or None
        comment_author_url = selected_comment.get("channel") or None
        comment_id = selected_comment.get("cid") or None
        raw_comment_text = selected_comment.get("text", "")
        songs = parse_text_to_songs(raw_comment_text)

        if songs:
            # --- Successful comment extraction ---
            suspicious = [s["start_seconds"] for s in songs if s["suspicious"]]

            # Save raw comment text & author attribution & update status
            upsert_stream(
                conn,
                video_id=video_id,
                status=stream["status"],  # keep existing for upsert
                raw_comment=raw_comment_text,
                comment_author=comment_author,
                comment_author_url=comment_author_url,
                comment_id=comment_id,
            )

            # Transition status: discovered → extracted (or pending → extracted)
            _safe_transition(conn, video_id, "extracted")

            # Save parsed songs (use cache format)
            song_rows = _songs_to_cache_format(songs, video_id)
            upsert_parsed_songs(conn, video_id, song_rows)

            return ExtractionResult(
                video_id=video_id,
                status="extracted",
                source="comment",
                songs=songs,
                raw_comment=raw_comment_text,
                raw_description=raw_description,
                suspicious_timestamps=suspicious,
                comment_author=comment_author,
                comment_author_url=comment_author_url,
                comment_id=comment_id,
            )
        else:
            # Comment found but unparseable — save raw, fall through to description
            raw_comment_text = selected_comment.get("text", "")
            upsert_stream(
                conn,
                video_id=video_id,
                status=stream["status"],
                raw_comment=raw_comment_text,
            )

    # -----------------------------------------------------------------------
    # Stage 2: Description extraction
    # -----------------------------------------------------------------------
    description_text = raw_description
    if description_text is None:
        # Try yt-dlp
        description_text = get_description_from_ytdlp(video_id)

    if description_text:
        songs = parse_text_to_songs(description_text)

        if songs:
            suspicious = [s["start_seconds"] for s in songs if s["suspicious"]]

            upsert_stream(
                conn,
                video_id=video_id,
                status=stream["status"],
                raw_description=description_text,
            )

            _safe_transition(conn, video_id, "extracted")
            song_rows = _songs_to_cache_format(songs, video_id)
            upsert_parsed_songs(conn, video_id, song_rows)

            return ExtractionResult(
                video_id=video_id,
                status="extracted",
                source="description",
                songs=songs,
                raw_comment=raw_comment_text,
                raw_description=description_text,
                suspicious_timestamps=suspicious,
            )

    # -----------------------------------------------------------------------
    # Stage 3: Mark as pending
    # -----------------------------------------------------------------------
    upsert_stream(
        conn,
        video_id=video_id,
        status=stream["status"],
        raw_comment=raw_comment_text,
        raw_description=description_text,
    )
    _safe_transition(conn, video_id, "pending")

    return ExtractionResult(
        video_id=video_id,
        status="pending",
        source=None,
        songs=[],
        raw_comment=raw_comment_text,
        raw_description=description_text,
    )


def _safe_transition(conn: sqlite3.Connection, video_id: str, new_status: str) -> None:
    """Transition stream status, silently skipping invalid transitions.

    This is used because re-running extraction on an already-extracted stream
    should not raise an error.
    """
    from prismlens.cache import get_stream, is_valid_transition, update_stream_status

    stream = get_stream(conn, video_id)
    if stream is None:
        return
    current = stream["status"]
    if current == new_status:
        return
    if is_valid_transition(current, new_status):
        update_stream_status(conn, video_id, new_status)


def _songs_to_cache_format(
    songs: list[dict[str, Any]], video_id: str
) -> list[dict[str, Any]]:
    """Convert internal song dicts to the format expected by :func:`cache.upsert_parsed_songs`."""
    return [
        {
            "order_index": s["order_index"],
            "song_name": s["song_name"],
            "artist": s.get("artist") or None,
            "start_timestamp": s["start_timestamp"],
            "end_timestamp": s.get("end_timestamp"),
            "note": None,
        }
        for s in songs
    ]


# ---------------------------------------------------------------------------
# Text file extraction
# ---------------------------------------------------------------------------


def extract_from_text(
    conn: sqlite3.Connection,
    video_id: str,
    text: str,
) -> ExtractionResult:
    """Extract timestamps from user-supplied text (file or paste).

    Unlike :func:`extract_timestamps`, this skips the comment/description
    pipeline and parses *text* directly.  If the stream doesn't exist in
    the cache it is auto-created via :func:`get_video_info_from_ytdlp`.

    Parameters
    ----------
    conn:
        Open SQLite connection.
    video_id:
        YouTube video ID.
    text:
        Raw text containing ``timestamp song_info`` lines.

    Returns
    -------
    ExtractionResult
        Result with ``source="text_file"`` on success.
    """
    from prismlens.cache import (
        get_stream,
        upsert_parsed_songs,
        upsert_stream,
    )

    # Auto-create stream if missing
    stream = get_stream(conn, video_id)
    if stream is None:
        info = get_video_info_from_ytdlp(video_id)
        upsert_stream(
            conn,
            video_id=video_id,
            status="discovered",
            title=info["title"],
            date=info["date"],
            raw_description=text,
        )
    else:
        # Save the raw text for audit
        upsert_stream(
            conn,
            video_id=video_id,
            status=stream["status"],
            raw_description=text,
        )

    songs = parse_text_to_songs(text)

    if songs:
        _safe_transition(conn, video_id, "extracted")
        song_rows = _songs_to_cache_format(songs, video_id)
        upsert_parsed_songs(conn, video_id, song_rows)

        suspicious = [s["start_seconds"] for s in songs if s["suspicious"]]
        return ExtractionResult(
            video_id=video_id,
            status="extracted",
            source="text_file",
            songs=songs,
            raw_description=text,
            suspicious_timestamps=suspicious,
        )

    # No parseable songs
    _safe_transition(conn, video_id, "pending")
    return ExtractionResult(
        video_id=video_id,
        status="pending",
        source=None,
        songs=[],
        raw_description=text,
    )


# ---------------------------------------------------------------------------
# Batch extraction helper
# ---------------------------------------------------------------------------


def extract_from_candidate(
    conn: sqlite3.Connection,
    video_id: str,
    candidate_id: int,
) -> ExtractionResult:
    """Re-extract timestamps using a specific candidate comment.

    Reads the candidate's comment_text, runs :func:`parse_text_to_songs`,
    saves results, and updates both stream and candidate status.

    Raises:
        KeyError: If *video_id* or *candidate_id* is not found.
        ValueError: If the candidate belongs to a different video.
    """
    from prismlens.cache import (
        get_candidate_comment,
        get_stream,
        update_candidate_status,
        upsert_parsed_songs,
        upsert_stream,
    )

    stream = get_stream(conn, video_id)
    if stream is None:
        raise KeyError(f"Stream {video_id!r} not found in cache.")

    candidate = get_candidate_comment(conn, candidate_id)
    if candidate is None:
        raise KeyError(f"Candidate comment {candidate_id} not found.")
    if candidate["video_id"] != video_id:
        raise ValueError(
            f"Candidate {candidate_id} belongs to video "
            f"{candidate['video_id']!r}, not {video_id!r}."
        )

    text = candidate["comment_text"]
    songs = parse_text_to_songs(text)

    if songs:
        suspicious = [s["start_seconds"] for s in songs if s["suspicious"]]

        upsert_stream(
            conn,
            video_id=video_id,
            status=stream["status"],
            raw_comment=text,
            comment_author=candidate["comment_author"],
            comment_author_url=candidate["comment_author_url"],
            comment_id=candidate["comment_cid"],
        )

        _safe_transition(conn, video_id, "extracted")

        song_rows = _songs_to_cache_format(songs, video_id)
        upsert_parsed_songs(conn, video_id, song_rows)

        update_candidate_status(conn, candidate_id, "approved")

        return ExtractionResult(
            video_id=video_id,
            status="extracted",
            source="comment",
            songs=songs,
            raw_comment=text,
            suspicious_timestamps=suspicious,
            comment_author=candidate["comment_author"],
            comment_author_url=candidate["comment_author_url"],
            comment_id=candidate["comment_cid"],
        )

    # No songs parsed from the candidate
    return ExtractionResult(
        video_id=video_id,
        status=stream["status"],
        source=None,
        songs=[],
        raw_comment=text,
    )


def extract_all_discovered(
    conn: sqlite3.Connection,
    *,
    progress_callback: Any | None = None,
) -> list[ExtractionResult]:
    """Run extraction on all streams with status ``"discovered"``.

    Parameters
    ----------
    conn:
        Open SQLite connection.
    progress_callback:
        Optional callable invoked after each stream with the
        :class:`ExtractionResult`.

    Returns
    -------
    list[ExtractionResult]
        Results for each processed stream.
    """
    from prismlens.cache import list_streams

    streams = list_streams(conn, status="discovered")
    results: list[ExtractionResult] = []

    for stream in streams:
        vid = stream["video_id"]
        try:
            result = extract_timestamps(conn, vid)
        except Exception as exc:  # noqa: BLE001
            result = ExtractionResult(
                video_id=vid,
                status="pending",
                source=None,
                songs=[],
            )
        results.append(result)
        if progress_callback:
            progress_callback(result)

    return results
