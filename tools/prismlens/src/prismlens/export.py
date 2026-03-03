"""Export module for PrismLens — generates Prism Data Contract JSON.

Reads approved streams from the local SQLite cache and exports them as a JSON
file matching §4.3.1 of the PrismLens specification.

Public API
----------
export_approved_streams(conn, *, since, stream_id, output_dir, channel_id)
    Build and write the export JSON, returning an ExportResult.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class ExportResult:
    """Summary of a completed export operation."""

    output_path: Path
    stream_count: int
    song_count: int
    version_count: int


# ---------------------------------------------------------------------------
# ID generators
# ---------------------------------------------------------------------------

def _new_song_id() -> str:
    """Return a ``mlens-song-{8 hex chars}`` ID from a fresh UUID v4."""
    return f"mlens-song-{uuid.uuid4().hex[:8]}"


def _new_version_id() -> str:
    """Return a ``mlens-ver-{8 hex chars}`` ID from a fresh UUID v4."""
    return f"mlens-ver-{uuid.uuid4().hex[:8]}"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _youtube_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def _resolve_output_dir(output_dir: str | Path | None) -> Path:
    """Return an absolute, expanded output directory path.

    Priority: explicit *output_dir* → config → default.
    """
    if output_dir is not None:
        return Path(output_dir).expanduser().resolve()

    # Try loading from config
    try:
        from prismlens.config import load_config, DEFAULT_EXPORT_DIR  # local import
        cfg = load_config()
        if cfg:
            raw = cfg.get("export", {}).get("output_dir")
            if raw:
                return Path(raw).expanduser().resolve()
        return Path(DEFAULT_EXPORT_DIR).expanduser().resolve()
    except Exception:  # noqa: BLE001
        from prismlens.config import DEFAULT_EXPORT_DIR
        return Path(DEFAULT_EXPORT_DIR).expanduser().resolve()


def _export_filename(now: datetime) -> str:
    """Return a filename like ``prismlens-export-2024-03-15-143000.json``."""
    ts = now.strftime("%Y-%m-%d-%H%M%S")
    return f"prismlens-export-{ts}.json"


def _load_approved_streams(
    conn: sqlite3.Connection,
    *,
    since: str | None = None,
    stream_id: str | None = None,
) -> list[sqlite3.Row]:
    """Fetch approved streams, optionally filtered by date or video ID.

    Args:
        conn: Open SQLite connection.
        since: ISO 8601 date string (``YYYY-MM-DD``).  Only streams whose
            ``updated_at`` >= *since* are returned.  Because we use
            ``updated_at`` to track the approval timestamp, this effectively
            filters streams approved on or after *since*.
        stream_id: If given, only return the single stream with this video ID.

    Returns:
        List of stream rows with status ``"approved"``.
    """
    if stream_id is not None:
        cur = conn.execute(
            "SELECT * FROM streams WHERE video_id = ? AND status IN ('approved', 'exported')",
            (stream_id,),
        )
        return cur.fetchall()

    if since is not None:
        cur = conn.execute(
            "SELECT * FROM streams WHERE status = 'approved' AND updated_at >= ? ORDER BY date DESC, video_id",
            (since,),
        )
        return cur.fetchall()

    cur = conn.execute(
        "SELECT * FROM streams WHERE status = 'approved' ORDER BY date DESC, video_id"
    )
    return cur.fetchall()


# ---------------------------------------------------------------------------
# Core export builder
# ---------------------------------------------------------------------------

def build_export_payload(
    conn: sqlite3.Connection,
    *,
    streams: list[sqlite3.Row],
    channel_id: str,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Build the top-level export JSON dict from the provided stream rows.

    Song deduplication is performed here: streams that share the same
    ``(name, artist)`` pair are merged into a single Song entity with
    multiple Version entries.

    Args:
        conn: Open SQLite connection (used to fetch parsed_songs rows).
        streams: Pre-fetched stream rows (must all have status ``"approved"``).
        channel_id: YouTube channel ID written to the top-level ``channelId``.
        now: Export timestamp; defaults to current UTC time.

    Returns:
        A dict matching the Prism Data Contract §4.3.1.
    """
    from prismlens.cache import get_parsed_songs  # local import to avoid cycles

    if now is None:
        now = datetime.now(tz=timezone.utc)

    # exported_at in ISO 8601 with "Z" suffix (UTC)
    exported_at = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    stream_entities: list[dict[str, Any]] = []
    song_map: dict[tuple[str, str], dict[str, Any]] = {}  # (name, artist) → song entity
    version_entities: list[dict[str, Any]] = []

    for stream_row in streams:
        video_id: str = stream_row["video_id"]
        title: str = stream_row["title"] or ""
        date: str = stream_row["date"] or ""

        stream_entity: dict[str, Any] = {
            "id": video_id,
            "youtubeUrl": _youtube_url(video_id),
            "date": date,
            "title": title,
        }

        # Add comment credit when source is "comment" and author info is available
        _comment_author = stream_row["comment_author"] if stream_row["comment_author"] else None
        if _comment_author:
            credit: dict[str, Any] = {"author": _comment_author}
            _author_url = stream_row["comment_author_url"] if stream_row["comment_author_url"] else None
            if _author_url:
                credit["authorUrl"] = _author_url
            _cid = stream_row["comment_id"] if stream_row["comment_id"] else None
            if _cid:
                credit["commentUrl"] = f"https://www.youtube.com/watch?v={video_id}&lc={_cid}"
            stream_entity["commentCredit"] = credit

        stream_entities.append(stream_entity)

        songs_rows = get_parsed_songs(conn, video_id)
        for song_row in songs_rows:
            name: str = song_row["song_name"] or ""
            artist: str = song_row["artist"] or ""
            start_ts: str = song_row["start_timestamp"] or ""
            end_ts: str | None = song_row["end_timestamp"] if song_row["end_timestamp"] else None
            note: str | None = song_row["note"] if song_row["note"] else None

            key = (name, artist)
            if key not in song_map:
                song_map[key] = {
                    "id": _new_song_id(),
                    "name": name,
                    "artist": artist,
                    "tags": [],
                }

            song_entity = song_map[key]
            ver: dict[str, Any] = {
                "id": _new_version_id(),
                "songId": song_entity["id"],
                "streamId": video_id,
                "startTimestamp": start_ts,
            }
            if end_ts is not None:
                ver["endTimestamp"] = end_ts
            if note is not None:
                ver["note"] = note

            version_entities.append(ver)

    return {
        "version": "1.0",
        "exportedAt": exported_at,
        "source": "prismlens",
        "channelId": channel_id,
        "data": {
            "streams": stream_entities,
            "songs": list(song_map.values()),
            "versions": version_entities,
        },
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def export_approved_streams(
    conn: sqlite3.Connection,
    *,
    since: str | None = None,
    stream_id: str | None = None,
    output_dir: str | Path | None = None,
    channel_id: str = "",
) -> ExportResult:
    """Export approved streams to a Prism Data Contract JSON file.

    After writing the file, updates each exported stream's status from
    ``"approved"`` to ``"exported"``.

    Args:
        conn: Open SQLite connection.
        since: ISO 8601 date string; only export streams approved after this.
        stream_id: If given, only export this specific stream.
        output_dir: Directory to write the JSON file.  Defaults to the config
            value or ``~/.local/share/prismlens/exports/``.
        channel_id: YouTube channel ID to embed in the JSON header.

    Returns:
        An :class:`ExportResult` with the output path and counts.

    Raises:
        ValueError: If no approved streams match the given filters.
    """
    from prismlens.cache import update_stream_status  # local import

    streams = _load_approved_streams(conn, since=since, stream_id=stream_id)

    if not streams:
        raise ValueError("no_approved_streams")

    now = datetime.now(tz=timezone.utc)
    payload = build_export_payload(conn, streams=streams, channel_id=channel_id, now=now)

    out_dir = _resolve_output_dir(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    filename = _export_filename(now)
    output_path = out_dir / filename

    with output_path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

    # Update each stream status to "exported" (skip if already exported)
    for stream_row in streams:
        if stream_row["status"] != "exported":
            update_stream_status(conn, stream_row["video_id"], "exported")

    return ExportResult(
        output_path=output_path,
        stream_count=len(payload["data"]["streams"]),
        song_count=len(payload["data"]["songs"]),
        version_count=len(payload["data"]["versions"]),
    )
