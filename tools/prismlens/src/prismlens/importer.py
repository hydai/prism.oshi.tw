"""Import module for PrismLens — imports exported JSON into Prism data files.

Reads a PrismLens export JSON (§4.3.1) and merges it into Prism's
static data files (data/songs.json, data/streams.json), applying field
mapping transformations per §3.1.6.

Public API
----------
validate_export_json(payload)
    Validate the export JSON structure; raise ValueError on failure.

load_mizukiprism_data(songs_path, streams_path)
    Load existing Prism songs and streams.

compute_import_plan(payload, existing_songs, existing_streams)
    Compute what will change without writing anything.

execute_import(plan, songs_path, streams_path, conn=None, video_ids=None)
    Apply the import plan to the data files.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Timestamp conversion
# ---------------------------------------------------------------------------

def timestamp_to_seconds(ts: str) -> int:
    """Convert 'H:MM:SS' or 'MM:SS' to seconds.

    Examples::

        timestamp_to_seconds("1:23:45")  # 5025
        timestamp_to_seconds("3:45")     # 225
        timestamp_to_seconds("0:03:20")  # 200
    """
    parts = ts.strip().split(":")
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    elif len(parts) == 2:
        return int(parts[0]) * 60 + int(parts[1])
    raise ValueError(f"Invalid timestamp: {ts!r}")


# ---------------------------------------------------------------------------
# JSON schema validation
# ---------------------------------------------------------------------------

def validate_export_json(payload: Any) -> None:
    """Validate the PrismLens export JSON structure.

    Raises:
        ValueError: With a descriptive message if any required field is missing
            or has the wrong type.
    """
    errors: list[str] = []

    if not isinstance(payload, dict):
        raise ValueError("Export JSON must be a JSON object (dict), got: " + type(payload).__name__)

    # Top-level required keys
    for key in ("version", "source", "data"):
        if key not in payload:
            errors.append(f"Missing top-level key: '{key}'")

    if errors:
        raise ValueError("Export JSON validation failed:\n" + "\n".join(f"  - {e}" for e in errors))

    data = payload.get("data", {})
    if not isinstance(data, dict):
        raise ValueError("'data' must be a JSON object")

    for key in ("streams", "songs", "versions"):
        if key not in data:
            errors.append(f"Missing data key: '{key}'")
        elif not isinstance(data[key], list):
            errors.append(f"'data.{key}' must be an array")

    if errors:
        raise ValueError("Export JSON validation failed:\n" + "\n".join(f"  - {e}" for e in errors))

    # Validate each stream
    for i, stream in enumerate(data["streams"]):
        if not isinstance(stream, dict):
            errors.append(f"data.streams[{i}] must be an object")
            continue
        for key in ("id", "date", "title"):
            if key not in stream:
                errors.append(f"data.streams[{i}] missing required field '{key}'")
            elif not isinstance(stream[key], str):
                errors.append(f"data.streams[{i}].{key} must be a string")
        # commentCredit is optional; validate structure if present
        if "commentCredit" in stream:
            cc = stream["commentCredit"]
            if not isinstance(cc, dict):
                errors.append(f"data.streams[{i}].commentCredit must be an object")
            elif "author" not in cc or not isinstance(cc.get("author"), str):
                errors.append(f"data.streams[{i}].commentCredit.author must be a string")

    # Validate each song
    for i, song in enumerate(data["songs"]):
        if not isinstance(song, dict):
            errors.append(f"data.songs[{i}] must be an object")
            continue
        for key in ("id", "name"):
            if key not in song:
                errors.append(f"data.songs[{i}] missing required field '{key}'")
            elif not isinstance(song[key], str):
                errors.append(f"data.songs[{i}].{key} must be a string")
        if "artist" in song and not isinstance(song["artist"], str):
            errors.append(f"data.songs[{i}].artist must be a string")

    # Validate each version
    for i, ver in enumerate(data["versions"]):
        if not isinstance(ver, dict):
            errors.append(f"data.versions[{i}] must be an object")
            continue
        for key in ("id", "songId", "streamId", "startTimestamp"):
            if key not in ver:
                errors.append(f"data.versions[{i}] missing required field '{key}'")
            elif not isinstance(ver[key], str):
                errors.append(f"data.versions[{i}].{key} must be a string")

    if errors:
        raise ValueError("Export JSON validation failed:\n" + "\n".join(f"  - {e}" for e in errors))


# ---------------------------------------------------------------------------
# ID helpers
# ---------------------------------------------------------------------------

def _max_id_number(entities: list[dict], prefix: str) -> int:
    """Return the maximum N from IDs of the form '{prefix}-{N}' in *entities*.

    Returns 0 if no matching IDs are found.
    """
    max_n = 0
    for entity in entities:
        eid = entity.get("id", "")
        if isinstance(eid, str) and eid.startswith(prefix + "-"):
            suffix = eid[len(prefix) + 1:]
            try:
                n = int(suffix)
                if n > max_n:
                    max_n = n
            except ValueError:
                pass
    return max_n


def _next_stream_id(existing_streams: list[dict], date: str) -> str:
    """Generate a date-based stream ID, appending a suffix on collision.

    Format: ``stream-YYYY-MM-DD``.  If that already exists, try
    ``stream-YYYY-MM-DD-a``, ``-b``, etc.
    """
    existing_ids = {s.get("id", "") for s in existing_streams}
    base = f"stream-{date}"
    if base not in existing_ids:
        return base
    for suffix in "abcdefghijklmnopqrstuvwxyz":
        candidate = f"{base}-{suffix}"
        if candidate not in existing_ids:
            return candidate
    raise ValueError(f"Too many streams on {date}")


def _next_song_id(existing_songs: list[dict]) -> str:
    """Generate next song ID continuing from existing max."""
    n = _max_id_number(existing_songs, "song") + 1
    return f"song-{n}"


def _make_performance_id(song_index: int, perf_index: int) -> str:
    """Generate performance ID following Prism convention: 'p{songIdx}-{perfIdx}'."""
    return f"p{song_index}-{perf_index}"


# ---------------------------------------------------------------------------
# Import plan dataclasses
# ---------------------------------------------------------------------------

@dataclass
class ConflictInfo:
    """Describes a stream ID conflict (videoId already present)."""
    video_id: str
    existing_stream_id: str
    existing_stream_title: str
    incoming_title: str


@dataclass
class ImportPlan:
    """Computed plan for an import operation."""
    new_songs: list[dict[str, Any]] = field(default_factory=list)
    updated_songs: list[dict[str, Any]] = field(default_factory=list)  # songs with new performances added
    new_streams: list[dict[str, Any]] = field(default_factory=list)
    conflicts: list[ConflictInfo] = field(default_factory=list)

    # Internal mapping: prismlens song ID → target Prism song dict
    _song_id_map: dict[str, dict[str, Any]] = field(default_factory=dict, repr=False)
    # prismlens stream ID → target Prism stream dict
    _stream_id_map: dict[str, dict[str, Any]] = field(default_factory=dict, repr=False)
    # All songs after merge (existing + new)
    _merged_songs: list[dict[str, Any]] = field(default_factory=list, repr=False)
    # All streams after merge (existing + new)
    _merged_streams: list[dict[str, Any]] = field(default_factory=list, repr=False)

    @property
    def new_song_count(self) -> int:
        return len(self.new_songs)

    @property
    def new_stream_count(self) -> int:
        return len(self.new_streams)

    @property
    def new_version_count(self) -> int:
        """Total count of new performances being added."""
        count = 0
        for song in self.new_songs:
            count += len(song.get("performances", []))
        for song in self.updated_songs:
            # Only count newly added performances
            count += song.get("_new_perf_count", 0)
        return count


# ---------------------------------------------------------------------------
# Load existing Prism data
# ---------------------------------------------------------------------------

def load_mizukiprism_data(
    songs_path: str | Path,
    streams_path: str | Path,
) -> tuple[list[dict], list[dict]]:
    """Load existing Prism songs and streams JSON files.

    Returns:
        (songs, streams) — both as lists of dicts.

    Raises:
        FileNotFoundError: If a data file does not exist.
        ValueError: If the file is not valid JSON or not a list.
    """
    songs_path = Path(songs_path)
    streams_path = Path(streams_path)

    try:
        songs_text = songs_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise FileNotFoundError(f"Prism songs file not found: {songs_path}")

    try:
        streams_text = streams_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise FileNotFoundError(f"Prism streams file not found: {streams_path}")

    try:
        songs = json.loads(songs_text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"songs.json is not valid JSON: {exc}") from exc

    try:
        streams = json.loads(streams_text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"streams.json is not valid JSON: {exc}") from exc

    if not isinstance(songs, list):
        raise ValueError("songs.json must be a JSON array")
    if not isinstance(streams, list):
        raise ValueError("streams.json must be a JSON array")

    return songs, streams


# ---------------------------------------------------------------------------
# Core import plan computation
# ---------------------------------------------------------------------------

def compute_import_plan(
    payload: dict[str, Any],
    existing_songs: list[dict],
    existing_streams: list[dict],
) -> ImportPlan:
    """Compute what will change without writing anything.

    This is a pure function (no side effects) that analyzes the export payload
    against the existing Prism data and returns an ImportPlan.

    Song matching: title + originalArtist (Prism) vs name + artist (export).
    Stream conflict: same videoId already exists.

    Args:
        payload: Validated PrismLens export JSON.
        existing_songs: Current data/songs.json content.
        existing_streams: Current data/streams.json content.

    Returns:
        An :class:`ImportPlan` describing what will be added/updated.
    """
    import copy

    plan = ImportPlan()

    # Work on deep copies so we don't mutate caller's data
    merged_songs: list[dict] = copy.deepcopy(existing_songs)
    merged_streams: list[dict] = copy.deepcopy(existing_streams)

    data = payload["data"]
    export_streams: list[dict] = data["streams"]
    export_songs: list[dict] = data["songs"]
    export_versions: list[dict] = data["versions"]

    # Build lookup: existing videoId → stream dict
    existing_video_ids: dict[str, dict] = {
        s["videoId"]: s for s in merged_streams if "videoId" in s
    }

    # Build lookup: (title, originalArtist) → song dict
    existing_song_lookup: dict[tuple[str, str], dict] = {
        (s.get("title", ""), s.get("originalArtist", "")): s
        for s in merged_songs
        if s.get("title")
    }

    # --- Step 1: Map export streams to Prism streams ---
    mlens_stream_to_prism: dict[str, dict] = {}  # mlens video_id → prism stream dict

    for export_stream in export_streams:
        mlens_video_id: str = export_stream["id"]  # YouTube video ID in export
        stream_title: str = export_stream.get("title", "")
        stream_date: str = export_stream.get("date", "")

        if mlens_video_id in existing_video_ids:
            # Conflict: this stream's videoId already exists
            existing_stream = existing_video_ids[mlens_video_id]
            plan.conflicts.append(ConflictInfo(
                video_id=mlens_video_id,
                existing_stream_id=existing_stream["id"],
                existing_stream_title=existing_stream.get("title", ""),
                incoming_title=stream_title,
            ))
            # Map to existing stream for version resolution
            mlens_stream_to_prism[mlens_video_id] = existing_stream
        else:
            # New stream: generate ID
            new_stream_id = _next_stream_id(merged_streams, stream_date)
            new_stream: dict[str, Any] = {
                "id": new_stream_id,
                "title": stream_title,
                "date": stream_date,
                "videoId": mlens_video_id,
                "youtubeUrl": f"https://www.youtube.com/watch?v={mlens_video_id}",
            }

            # Map commentCredit → credit on the Prism stream
            comment_credit = export_stream.get("commentCredit")
            if isinstance(comment_credit, dict) and comment_credit.get("author"):
                credit: dict[str, Any] = {"author": comment_credit["author"]}
                if comment_credit.get("authorUrl"):
                    credit["authorUrl"] = comment_credit["authorUrl"]
                if comment_credit.get("commentUrl"):
                    credit["commentUrl"] = comment_credit["commentUrl"]
                new_stream["credit"] = credit

            merged_streams.append(new_stream)
            existing_video_ids[mlens_video_id] = new_stream  # prevent duplicate if same video_id appears twice
            mlens_stream_to_prism[mlens_video_id] = new_stream
            plan.new_streams.append(new_stream)

    # --- Step 2: Build song id map (mlens song id → export song dict) ---
    mlens_song_by_id: dict[str, dict] = {s["id"]: s for s in export_songs}

    # Map mlens song id → prism song dict
    mlens_song_to_prism: dict[str, dict] = {}

    for export_song in export_songs:
        mlens_song_id: str = export_song["id"]
        name: str = export_song.get("name", "")
        artist: str = export_song.get("artist", "")

        # Match against existing by title + originalArtist
        match_key = (name, artist)
        if match_key in existing_song_lookup:
            mlens_song_to_prism[mlens_song_id] = existing_song_lookup[match_key]
        else:
            # New song: generate ID
            new_song_id = _next_song_id(merged_songs)
            new_song: dict[str, Any] = {
                "id": new_song_id,
                "title": name,
                "originalArtist": artist,
                "tags": list(export_song.get("tags", [])),
                "performances": [],
            }
            merged_songs.append(new_song)
            existing_song_lookup[match_key] = new_song  # prevent dup if same song appears twice
            mlens_song_to_prism[mlens_song_id] = new_song
            plan.new_songs.append(new_song)

    # --- Step 3: Map versions to performances and embed in songs ---
    # Track which songs got new performances for reporting
    songs_updated_perf_counts: dict[str, int] = {}  # prism song id → new perf count

    for export_ver in export_versions:
        mlens_song_id: str = export_ver["songId"]
        mlens_stream_id: str = export_ver["streamId"]

        # Resolve target prism song
        target_song = mlens_song_to_prism.get(mlens_song_id)
        if target_song is None:
            continue  # orphaned version, skip

        # Resolve target prism stream
        target_stream = mlens_stream_to_prism.get(mlens_stream_id)
        if target_stream is None:
            continue  # orphaned version, skip

        # Skip performances for conflicted streams (will be handled in execute based on user choice)
        is_conflict = any(c.video_id == mlens_stream_id for c in plan.conflicts)
        if is_conflict:
            continue

        # Find song index in merged_songs
        try:
            song_idx = next(
                i + 1  # 1-based index matching Prism convention (song-1 → p1-N)
                for i, s in enumerate(merged_songs)
                if s["id"] == target_song["id"]
            )
        except StopIteration:
            song_idx = 1

        # Count existing performances in this song
        existing_perf_count = len(target_song.get("performances", []))
        new_perf_index = existing_perf_count + 1

        # Build performance object
        start_ts_str: str = export_ver.get("startTimestamp", "0:00:00")
        end_ts_str: str | None = export_ver.get("endTimestamp")

        try:
            timestamp_seconds = timestamp_to_seconds(start_ts_str)
        except ValueError:
            timestamp_seconds = 0

        end_timestamp: int | None = None
        if end_ts_str:
            try:
                end_timestamp = timestamp_to_seconds(end_ts_str)
            except ValueError:
                end_timestamp = None

        perf_id = _make_performance_id(song_idx, new_perf_index)

        performance: dict[str, Any] = {
            "id": perf_id,
            "streamId": target_stream["id"],
            "date": target_stream.get("date", ""),
            "streamTitle": target_stream.get("title", ""),
            "videoId": target_stream.get("videoId", ""),
            "timestamp": timestamp_seconds,
            "endTimestamp": end_timestamp,
            "note": export_ver.get("note", ""),
        }

        target_song.setdefault("performances", []).append(performance)

        # Track count for reporting
        prism_song_id = target_song["id"]
        songs_updated_perf_counts[prism_song_id] = songs_updated_perf_counts.get(prism_song_id, 0) + 1

    # --- Step 4: Tag updated (existing) songs with new perf counts ---
    new_song_ids = {s["id"] for s in plan.new_songs}
    for prism_song_id, new_count in songs_updated_perf_counts.items():
        if prism_song_id not in new_song_ids:
            # Find the song in merged_songs
            for s in merged_songs:
                if s["id"] == prism_song_id:
                    updated_copy = dict(s)
                    updated_copy["_new_perf_count"] = new_count
                    plan.updated_songs.append(updated_copy)
                    break

    plan._merged_songs = merged_songs
    plan._merged_streams = merged_streams

    # Build the song/stream ID maps for execute_import
    plan._song_id_map = mlens_song_to_prism
    plan._stream_id_map = mlens_stream_to_prism

    return plan


# ---------------------------------------------------------------------------
# Conflict resolution: re-run with overwrite for specific streams
# ---------------------------------------------------------------------------

def _add_performances_for_stream(
    payload: dict[str, Any],
    plan: ImportPlan,
    mlens_stream_id: str,
) -> None:
    """Add performances for a conflicting stream to the plan's merged songs.

    Called when the user chooses to overwrite a conflicting stream.
    Mutates plan._merged_songs in place.
    """
    data = payload["data"]
    export_versions: list[dict] = data["versions"]
    merged_songs = plan._merged_songs

    target_stream = plan._stream_id_map.get(mlens_stream_id)
    if target_stream is None:
        return

    for export_ver in export_versions:
        if export_ver["streamId"] != mlens_stream_id:
            continue

        mlens_song_id: str = export_ver["songId"]
        target_song = plan._song_id_map.get(mlens_song_id)
        if target_song is None:
            continue

        # Find song index in merged_songs
        try:
            song_idx = next(
                i + 1
                for i, s in enumerate(merged_songs)
                if s["id"] == target_song["id"]
            )
        except StopIteration:
            song_idx = 1

        existing_perf_count = len(target_song.get("performances", []))
        new_perf_index = existing_perf_count + 1

        start_ts_str: str = export_ver.get("startTimestamp", "0:00:00")
        end_ts_str: str | None = export_ver.get("endTimestamp")

        try:
            timestamp_seconds = timestamp_to_seconds(start_ts_str)
        except ValueError:
            timestamp_seconds = 0

        end_timestamp: int | None = None
        if end_ts_str:
            try:
                end_timestamp = timestamp_to_seconds(end_ts_str)
            except ValueError:
                end_timestamp = None

        perf_id = _make_performance_id(song_idx, new_perf_index)

        performance: dict[str, Any] = {
            "id": perf_id,
            "streamId": target_stream["id"],
            "date": target_stream.get("date", ""),
            "streamTitle": target_stream.get("title", ""),
            "videoId": target_stream.get("videoId", ""),
            "timestamp": timestamp_seconds,
            "endTimestamp": end_timestamp,
            "note": export_ver.get("note", ""),
        }

        target_song.setdefault("performances", []).append(performance)


# ---------------------------------------------------------------------------
# Execute import (write to files)
# ---------------------------------------------------------------------------

@dataclass
class ImportResult:
    """Summary of a completed import operation."""

    songs_path: Path
    streams_path: Path
    new_song_count: int
    new_version_count: int
    new_stream_count: int
    conflict_count: int
    overwritten_count: int
    skipped_count: int


def execute_import(
    plan: ImportPlan,
    songs_path: str | Path,
    streams_path: str | Path,
    conn: sqlite3.Connection | None = None,
    overwrite_video_ids: set[str] | None = None,
    skip_video_ids: set[str] | None = None,
    payload: dict[str, Any] | None = None,
) -> ImportResult:
    """Apply the import plan, write data files, and update cache.

    Creates .bak backups of the original files before writing.

    Args:
        plan: The computed import plan.
        songs_path: Path to Prism's data/songs.json.
        streams_path: Path to Prism's data/streams.json.
        conn: Optional open SQLite connection for cache status updates.
        overwrite_video_ids: Set of conflicting video IDs to overwrite.
        skip_video_ids: Set of conflicting video IDs to skip.
        payload: Original export payload (needed for overwrite conflict resolution).

    Returns:
        An :class:`ImportResult` with operation summary.
    """
    import copy

    songs_path = Path(songs_path)
    streams_path = Path(streams_path)
    overwrite_video_ids = overwrite_video_ids or set()
    skip_video_ids = skip_video_ids or set()

    # Apply conflict resolution on a copy of the plan's merged data
    merged_songs = copy.deepcopy(plan._merged_songs)
    merged_streams = copy.deepcopy(plan._merged_streams)

    # Rebuild _song_id_map and _stream_id_map pointing to the deep copies
    # so _add_performances_for_stream can mutate them
    id_to_merged_song: dict[str, dict] = {s["id"]: s for s in merged_songs}
    id_to_merged_stream: dict[str, dict] = {s["id"]: s for s in merged_streams}

    # Re-create proxy maps pointing to deep copies
    proxy_plan = ImportPlan(
        new_songs=plan.new_songs,
        updated_songs=plan.updated_songs,
        new_streams=plan.new_streams,
        conflicts=plan.conflicts,
    )
    proxy_plan._merged_songs = merged_songs
    proxy_plan._merged_streams = merged_streams
    proxy_plan._song_id_map = {
        k: id_to_merged_song[v["id"]]
        for k, v in plan._song_id_map.items()
        if v["id"] in id_to_merged_song
    }
    proxy_plan._stream_id_map = {
        k: id_to_merged_stream[v["id"]]
        for k, v in plan._stream_id_map.items()
        if v["id"] in id_to_merged_stream
    }

    overwritten_count = 0
    skipped_count = 0

    if payload is not None:
        for conflict in plan.conflicts:
            if conflict.video_id in overwrite_video_ids:
                _add_performances_for_stream(payload, proxy_plan, conflict.video_id)
                overwritten_count += 1
            else:
                skipped_count += 1

    # Remove internal metadata keys before writing
    def _clean_song(song: dict) -> dict:
        return {k: v for k, v in song.items() if not k.startswith("_")}

    clean_songs = [_clean_song(s) for s in merged_songs]
    clean_streams = list(merged_streams)

    # Backup originals
    if songs_path.exists():
        shutil.copy2(songs_path, songs_path.with_suffix(".json.bak"))
    if streams_path.exists():
        shutil.copy2(streams_path, streams_path.with_suffix(".json.bak"))

    # Write updated files
    with songs_path.open("w", encoding="utf-8") as fh:
        json.dump(clean_songs, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    with streams_path.open("w", encoding="utf-8") as fh:
        json.dump(clean_streams, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    # Update cache status for imported streams
    if conn is not None:
        for stream in plan.new_streams:
            video_id = stream.get("videoId")
            if video_id:
                _update_cache_imported(conn, video_id)

        for video_id in overwrite_video_ids:
            _update_cache_imported(conn, video_id)

    # Compute actual counts
    new_version_count = plan.new_version_count
    if payload is not None:
        # Add versions from overwritten conflicts
        for conflict in plan.conflicts:
            if conflict.video_id in overwrite_video_ids:
                data = payload.get("data", {})
                versions = data.get("versions", [])
                new_version_count += sum(
                    1 for v in versions if v.get("streamId") == conflict.video_id
                )

    return ImportResult(
        songs_path=songs_path,
        streams_path=streams_path,
        new_song_count=plan.new_song_count,
        new_version_count=new_version_count,
        new_stream_count=plan.new_stream_count,
        conflict_count=len(plan.conflicts),
        overwritten_count=overwritten_count,
        skipped_count=skipped_count,
    )


def _update_cache_imported(conn: sqlite3.Connection, video_id: str) -> None:
    """Attempt to update a stream's cache status to 'imported'.

    Silently ignores errors (stream may not be in cache if imported from
    an external file).
    """
    try:
        from prismlens.cache import get_stream, update_stream_status
        stream = get_stream(conn, video_id)
        if stream is not None:
            current_status = stream["status"]
            # Allow exported → imported or approved → imported (via exported)
            if current_status in ("exported", "approved"):
                # Need to go through exported first if currently approved
                if current_status == "approved":
                    update_stream_status(conn, video_id, "exported")
                update_stream_status(conn, video_id, "imported")
    except Exception:  # noqa: BLE001
        pass
