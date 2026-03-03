"""Metadata module for PrismLens — iTunes album art fetching.

Fetches music metadata from external APIs and stores results in static JSON
files under data/metadata/ in the Prism project root.

Public API
----------
normalize_artist(name: str) -> str
    Normalize an artist name for use as an ArtistInfo lookup key.

_strip_featuring(artist: str) -> str
    Remove feat./ft. suffix from artist name for cleaner search queries.

_clean_title(title: str) -> str
    Remove CJK/special punctuation from title for cleaner search queries.

fetch_itunes_metadata(artist: str, title: str) -> dict | None
    Search iTunes for a track, returning structured metadata.

read_metadata_file(path: Path) -> list[dict]
    Load a JSON array from a metadata file (graceful on missing/corrupt).

write_metadata_file(path: Path, data: list[dict]) -> None
    Atomically write a JSON array to a metadata file.

upsert_song_metadata(records: list[dict], entry: dict) -> list[dict]
    Upsert a SongMetadata record by songId.

upsert_artist_info(records: list[dict], entry: dict) -> list[dict]
    Upsert an ArtistInfo record by normalizedArtist.

fetch_song_metadata(song: dict, metadata_dir: Path, fetch_art: bool) -> FetchResult
    Fetch and persist metadata for a single song.

get_metadata_status(songs_path: Path, metadata_dir: Path) -> list[SongStatusRecord]
    Cross-reference songs.json with metadata files to compute per-song status.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ITUNES_SEARCH_URL = "https://itunes.apple.com/search"

# Rate limiting: iTunes ~20 req/min → 3s between calls
_ITUNES_MIN_INTERVAL_SEC = 3.0
_TIMEOUT_SEC = 5.0

# Staleness threshold: 90 days
STALE_DAYS = 90


# ---------------------------------------------------------------------------
# Rate limiter state (module-level, shared across all calls in a session)
# ---------------------------------------------------------------------------

_last_itunes_call: float = 0.0


def _wait_itunes() -> None:
    """Enforce minimum interval between iTunes API calls."""
    global _last_itunes_call
    elapsed = time.monotonic() - _last_itunes_call
    if elapsed < _ITUNES_MIN_INTERVAL_SEC:
        time.sleep(_ITUNES_MIN_INTERVAL_SEC - elapsed)
    _last_itunes_call = time.monotonic()


# ---------------------------------------------------------------------------
# Search query helpers
# ---------------------------------------------------------------------------

# Pattern for "feat." / "ft." and everything after (with optional parentheses)
_FEAT_RE = re.compile(r"\s*[\(（]?\s*(?:feat\.?|ft\.?)\s+.+[\)）]?\s*$", re.IGNORECASE)

# CJK and special punctuation that pollutes search queries
_CJK_PUNCT_RE = re.compile(r"[？！♪☆★〜~・「」『』【】（）《》〈〉♡♥→←↑↓…‥、。]+")


def _strip_featuring(artist: str) -> str:
    """Remove 'feat.'/'ft.' suffix and everything after.

    Examples::

        _strip_featuring("きくお feat. 初音ミク")  -> "きくお"
        _strip_featuring("Ado ft. hatsune miku")   -> "Ado"
        _strip_featuring("YOASOBI")                -> "YOASOBI"
        _strip_featuring("A (feat. B)")            -> "A"
    """
    return _FEAT_RE.sub("", artist).strip()


def _clean_title(title: str) -> str:
    """Remove CJK/special punctuation and collapse whitespace.

    Examples::

        _clean_title("夜に駆ける♪")       -> "夜に駆ける"
        _clean_title("うっせぇわ！！")     -> "うっせぇわ"
        _clean_title("Hello 〜 World")     -> "Hello World"
    """
    cleaned = _CJK_PUNCT_RE.sub(" ", title)
    return " ".join(cleaned.split()).strip()


# ---------------------------------------------------------------------------
# Artist name normalization
# ---------------------------------------------------------------------------

def normalize_artist(name: str) -> str:
    """Normalize an artist name for use as an ArtistInfo lookup key.

    Converts to lowercase, strips leading/trailing whitespace, and collapses
    multiple internal spaces into a single space.

    Examples::

        normalize_artist("YOASOBI")         -> "yoasobi"
        normalize_artist("  宇多田 光  ")   -> "宇多田 光"
        normalize_artist("Ado")             -> "ado"
    """
    return " ".join(name.lower().strip().split())


# ---------------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------------

def _http_get_json(url: str, timeout: float = _TIMEOUT_SEC) -> Any:
    """Perform a GET request and return parsed JSON.

    Raises:
        urllib.error.URLError: On network failure.
        urllib.error.HTTPError: On non-2xx HTTP response.
        TimeoutError: On connection/read timeout (mapped from socket.timeout).
        json.JSONDecodeError: If the response is not valid JSON.
    """
    import socket
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "PrismLens/1.0 (Prism curator tool)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body)
    except socket.timeout as exc:
        raise TimeoutError(f"Request timed out: {url}") from exc


# ---------------------------------------------------------------------------
# iTunes API client
# ---------------------------------------------------------------------------

def _itunes_search(query: str, country: str = "JP") -> list[dict]:
    """Execute a single iTunes search and return the results list."""
    _wait_itunes()
    params = urllib.parse.urlencode({
        "term": query, "media": "music", "entity": "song",
        "country": country, "limit": "10",
    })
    url = f"{ITUNES_SEARCH_URL}?{params}"
    try:
        data = _http_get_json(url)
    except TimeoutError:
        raise
    except (urllib.error.URLError, json.JSONDecodeError) as exc:
        raise urllib.error.URLError(str(exc)) from exc
    return data.get("results", []) if isinstance(data, dict) else []


def _extract_itunes_metadata(track: dict) -> dict:
    """Extract structured metadata from an iTunes track result."""
    duration_ms = track.get("trackTimeMillis", 0)
    artwork = track.get("artworkUrl100", "")
    return {
        "itunesTrackId": track.get("trackId"),
        "itunesCollectionId": track.get("collectionId"),
        "albumTitle": track.get("collectionName", ""),
        "trackDuration": duration_ms // 1000,
        "albumArtUrls": {
            "small": artwork.replace("100x100bb", "60x60bb"),
            "medium": artwork.replace("100x100bb", "200x200bb"),
            "big": artwork.replace("100x100bb", "400x400bb"),
            "xl": artwork.replace("100x100bb", "600x600bb"),
        },
        "artistName": track.get("artistName", ""),
    }


def fetch_itunes_metadata(original_artist: str, title: str) -> dict | None:
    """Search iTunes for a track using up to 4 fallback strategies.

    Strategy order (conditional strategies only added when relevant):
      1. ``<artist> <title>`` with country=JP → exact
      2. ``<cleaned_artist> <title>`` (if feat.) with country=JP → exact
      3. ``<title>`` with country=JP → fuzzy
      4. ``<cleaned_title>`` (if special punct) with country=JP → fuzzy_cleaned

    Returns a dict with keys: track_result, match_confidence, and the
    extracted iTunes metadata. Returns None only when no API call succeeded
    (network error propagated).

    On no-match (all strategies return 0 results), returns a dict with
    ``match_confidence=None`` and ``track_result=None``.
    """
    cleaned_artist = _strip_featuring(original_artist)
    has_feat = cleaned_artist != original_artist
    cleaned_title = _clean_title(title)
    has_special_punct = cleaned_title != title

    strategies: list[tuple[str, str]] = [
        (f"{original_artist} {title}", "exact"),
    ]
    if has_feat:
        strategies.append((f"{cleaned_artist} {title}", "exact"))
    strategies.append((title, "fuzzy"))
    if has_special_punct:
        strategies.append((cleaned_title, "fuzzy_cleaned"))

    last_error: str | None = None

    for query, confidence in strategies:
        try:
            results = _itunes_search(query)
        except TimeoutError:
            last_error = "timeout"
            continue
        except urllib.error.URLError as exc:
            last_error = str(exc)
            continue

        if results:
            track = results[0]
            meta = _extract_itunes_metadata(track)
            meta["match_confidence"] = confidence
            return meta

    # All strategies exhausted with no results
    return {"match_confidence": None, "last_error": last_error}


# ---------------------------------------------------------------------------
# File I/O
# ---------------------------------------------------------------------------

def read_metadata_file(path: Path) -> list[dict]:
    """Load a JSON array from a metadata file.

    Handles missing files and corrupted JSON gracefully — returns [] and
    prints a warning if the file cannot be parsed.
    """
    if not path.exists():
        return []
    try:
        text = path.read_text(encoding="utf-8")
        data = json.loads(text)
        if isinstance(data, list):
            return data
        # File contains non-list JSON — treat as corrupted
        import warnings
        warnings.warn(f"Metadata file {path} does not contain a JSON array; initializing empty.", stacklevel=2)
        return []
    except (json.JSONDecodeError, OSError) as exc:
        import warnings
        warnings.warn(f"Could not read metadata file {path}: {exc}; initializing empty.", stacklevel=2)
        return []


def write_metadata_file(path: Path, data: list[dict]) -> None:
    """Atomically write a JSON array to a metadata file.

    Creates parent directories if necessary.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    # Write to a temp file first, then rename for atomicity
    tmp_path = path.with_suffix(".json.tmp")
    try:
        with tmp_path.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        tmp_path.replace(path)
    except Exception:
        if tmp_path.exists():
            tmp_path.unlink()
        raise


# ---------------------------------------------------------------------------
# Upsert helpers
# ---------------------------------------------------------------------------

def upsert_song_metadata(records: list[dict], entry: dict) -> list[dict]:
    """Upsert a SongMetadata record by songId.

    If a record with the same songId exists, it is replaced. Otherwise,
    the entry is appended. Returns a new list.
    """
    song_id = entry["songId"]
    new_records = [r for r in records if r.get("songId") != song_id]
    new_records.append(entry)
    return new_records


def upsert_artist_info(records: list[dict], entry: dict) -> list[dict]:
    """Upsert an ArtistInfo record by normalizedArtist.

    If a record with the same normalizedArtist exists, it is replaced.
    Otherwise, the entry is appended. Returns a new list.
    """
    key = entry["normalizedArtist"]
    new_records = [r for r in records if r.get("normalizedArtist") != key]
    new_records.append(entry)
    return new_records


# ---------------------------------------------------------------------------
# FetchResult dataclass
# ---------------------------------------------------------------------------

@dataclass
class FetchResult:
    """Result of fetching metadata for a single song."""

    song_id: str
    title: str
    original_artist: str
    art_status: str  # 'matched', 'no_match', 'error', 'skipped'
    art_confidence: str | None = None
    art_error: str | None = None

    @property
    def overall_status(self) -> str:
        """Return 'matched', 'no_match', 'error', or 'skipped'."""
        return self.art_status


# ---------------------------------------------------------------------------
# Single-song fetch orchestrator
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    """Return the current UTC time as an ISO 8601 string."""
    return datetime.now(tz=timezone.utc).isoformat()


def fetch_song_metadata(
    song: dict,
    metadata_dir: Path,
    fetch_art: bool = True,
) -> FetchResult:
    """Fetch and persist metadata for a single song.

    Reads the metadata JSON files, performs API calls, upserts the
    results, and writes the files back.

    Args:
        song: A song dict with at least ``id``, ``title``, ``originalArtist``.
        metadata_dir: Path to the ``data/metadata/`` directory.
        fetch_art: Whether to call the iTunes API.

    Returns:
        A :class:`FetchResult` describing what was fetched.
    """
    song_id: str = song["id"]
    title: str = song.get("title", "")
    original_artist: str = song.get("originalArtist", "")

    # File paths
    metadata_path = metadata_dir / "song-metadata.json"
    artist_path = metadata_dir / "artist-info.json"

    # Load current records
    metadata_records = read_metadata_file(metadata_path)
    artist_records = read_metadata_file(artist_path)

    now = _now_iso()

    # --- iTunes ---
    art_status = "skipped"
    art_confidence: str | None = None
    art_error: str | None = None

    if fetch_art:
        itunes_result = fetch_itunes_metadata(original_artist, title)

        if itunes_result is None:
            art_status = "error"
            art_error = "unexpected None from fetch_itunes_metadata"
        elif itunes_result.get("match_confidence") is not None:
            # Matched
            art_status = "matched"
            art_confidence = itunes_result["match_confidence"]
            art_urls = itunes_result.get("albumArtUrls", {})
            album_art_url = art_urls.get("xl") or art_urls.get("big") or art_urls.get("medium") or art_urls.get("small") or ""

            song_meta_entry: dict[str, Any] = {
                "songId": song_id,
                "fetchStatus": "matched",
                "matchConfidence": art_confidence,
                "albumArtUrl": album_art_url,
                "albumArtUrls": art_urls,
                "albumTitle": itunes_result.get("albumTitle"),
                "itunesTrackId": itunes_result.get("itunesTrackId"),
                "itunesCollectionId": itunes_result.get("itunesCollectionId"),
                "trackDuration": itunes_result.get("trackDuration"),
                "fetchedAt": now,
                "lastError": None,
            }
            metadata_records = upsert_song_metadata(metadata_records, song_meta_entry)

            # Upsert ArtistInfo
            itunes_artist_name = itunes_result.get("artistName", original_artist)
            artist_entry: dict[str, Any] = {
                "normalizedArtist": normalize_artist(original_artist),
                "originalName": itunes_artist_name,
                "itunesArtistId": itunes_result.get("itunesTrackId"),
                "fetchedAt": now,
            }
            artist_records = upsert_artist_info(artist_records, artist_entry)
        else:
            # No match or error
            last_err = itunes_result.get("last_error")
            if last_err is not None:
                art_status = "error"
                art_error = last_err
            else:
                art_status = "no_match"

            song_meta_entry = {
                "songId": song_id,
                "fetchStatus": art_status,
                "matchConfidence": None,
                "albumArtUrl": None,
                "albumArtUrls": None,
                "albumTitle": None,
                "itunesTrackId": None,
                "itunesCollectionId": None,
                "trackDuration": None,
                "fetchedAt": now,
                "lastError": art_error,
            }
            metadata_records = upsert_song_metadata(metadata_records, song_meta_entry)

    # --- Persist ---
    if fetch_art:
        write_metadata_file(metadata_path, metadata_records)
        write_metadata_file(artist_path, artist_records)

    return FetchResult(
        song_id=song_id,
        title=title,
        original_artist=original_artist,
        art_status=art_status,
        art_confidence=art_confidence,
        art_error=art_error,
    )


# ---------------------------------------------------------------------------
# Staleness check helper
# ---------------------------------------------------------------------------

def is_stale(entry: dict) -> bool:
    """Return True if the entry's fetchedAt is older than STALE_DAYS days."""
    fetched_at_str = entry.get("fetchedAt")
    if not fetched_at_str:
        return True
    try:
        fetched_at = datetime.fromisoformat(fetched_at_str)
        if fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        age = datetime.now(tz=timezone.utc) - fetched_at
        return age.days >= STALE_DAYS
    except (ValueError, TypeError):
        return True


# ---------------------------------------------------------------------------
# Metadata status
# ---------------------------------------------------------------------------

@dataclass
class SongStatusRecord:
    """Per-song metadata status, computed by cross-referencing data files."""

    song_id: str
    title: str
    original_artist: str
    cover_status: str           # 'matched', 'no_match', 'error', 'manual', 'pending'
    match_confidence: str | None = None   # 'exact', 'fuzzy', 'manual', or None
    fetched_at: str | None = None         # ISO 8601 date string (date portion only)
    album_art_url: str | None = None
    itunes_track_id: int | None = None
    cover_last_error: str | None = None


def get_metadata_status(
    songs_path: Path,
    metadata_dir: Path,
) -> list[SongStatusRecord]:
    """Cross-reference songs.json with metadata files to compute per-song status.

    ``pending`` is a virtual status: songs in songs.json with NO entry in
    song-metadata.json are reported as ``pending``.

    Args:
        songs_path: Path to data/songs.json.
        metadata_dir: Path to data/metadata/ directory.

    Returns:
        A list of :class:`SongStatusRecord`, one per song in songs.json,
        in the same order as songs.json.
    """
    import json as _json

    # Load songs
    try:
        raw = songs_path.read_text(encoding="utf-8")
        all_songs: list[dict] = _json.loads(raw)
    except (OSError, _json.JSONDecodeError):
        all_songs = []
    if not isinstance(all_songs, list):
        all_songs = []

    # Load metadata files
    metadata_records = read_metadata_file(metadata_dir / "song-metadata.json")

    # Build lookup dict
    metadata_by_id: dict[str, dict] = {r["songId"]: r for r in metadata_records if "songId" in r}

    records: list[SongStatusRecord] = []
    for song in all_songs:
        song_id = song.get("id", "")
        title = song.get("title", "")
        artist = song.get("originalArtist", "")

        meta = metadata_by_id.get(song_id)

        # Cover status
        if meta is None:
            cover_status = "pending"
            match_confidence = None
            fetched_at = None
            album_art_url = None
            itunes_track_id = None
            cover_last_error = None
        else:
            cover_status = meta.get("fetchStatus", "pending")
            match_confidence = meta.get("matchConfidence")
            raw_fetched = meta.get("fetchedAt")
            # Extract date portion only (YYYY-MM-DD)
            if raw_fetched:
                fetched_at = raw_fetched[:10]
            else:
                fetched_at = None
            album_art_url = meta.get("albumArtUrl")
            itunes_track_id = meta.get("itunesTrackId")
            cover_last_error = meta.get("lastError")

        records.append(SongStatusRecord(
            song_id=song_id,
            title=title,
            original_artist=artist,
            cover_status=cover_status,
            match_confidence=match_confidence,
            fetched_at=fetched_at,
            album_art_url=album_art_url,
            itunes_track_id=itunes_track_id,
            cover_last_error=cover_last_error,
        ))

    return records
