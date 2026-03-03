"""Flask web app for interactively stamping end timestamps on parsed songs.

Launch via ``prismlens stamp``.  Reads/writes the SQLite cache only — data
flows through the normal export → import pipeline to reach songs.json.
"""

from __future__ import annotations

from pathlib import Path

from flask import Flask, jsonify, request


def create_app(db_path: str | Path | None = None) -> Flask:
    """Application factory.

    Args:
        db_path: Override the cache DB path (useful for testing).
    """
    app = Flask(
        __name__,
        template_folder=str(Path(__file__).parent / "stamp_templates"),
        static_folder=str(Path(__file__).parent / "stamp_static"),
        static_url_path="/static",
    )

    # Store db_path in app config so routes can access it.
    app.config["DB_PATH"] = db_path

    def _open():
        from prismlens.cache import open_db
        return open_db(app.config["DB_PATH"])

    # ------------------------------------------------------------------
    # Page
    # ------------------------------------------------------------------

    @app.route("/")
    def index():
        return app.send_static_file("../stamp_templates/index.html") if False else \
            _render_index()

    def _render_index():
        from flask import render_template
        return render_template("index.html")

    # ------------------------------------------------------------------
    # API: streams
    # ------------------------------------------------------------------

    @app.route("/api/streams")
    def api_streams():
        """List streams in approved/exported/imported status with pending stamp counts."""
        allowed = {"approved", "exported", "imported"}
        status_param = request.args.get("status")
        if status_param:
            requested = {s.strip() for s in status_param.split(",") if s.strip()}
            statuses = allowed & requested
        else:
            statuses = allowed
        if not statuses:
            return jsonify([])

        conn = _open()
        try:
            placeholders = ",".join("?" for _ in statuses)
            cur = conn.execute(
                "SELECT s.video_id, s.title, s.date, s.status, "
                "  (SELECT COUNT(*) FROM parsed_songs p "
                "   WHERE p.video_id = s.video_id AND p.end_timestamp IS NULL) AS pending "
                "FROM streams s "
                f"WHERE s.status IN ({placeholders}) "
                "ORDER BY s.date DESC, s.video_id",
                tuple(statuses),
            )
            rows = cur.fetchall()
            return jsonify([
                {
                    "videoId": r["video_id"],
                    "title": r["title"],
                    "date": r["date"],
                    "status": r["status"],
                    "pending": r["pending"],
                }
                for r in rows
            ])
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # API: songs for a stream
    # ------------------------------------------------------------------

    @app.route("/api/streams/<video_id>/songs")
    def api_stream_songs(video_id: str):
        """Return parsed songs for a stream, sorted by order_index."""
        conn = _open()
        try:
            cur = conn.execute(
                "SELECT id, order_index, song_name, artist, "
                "       start_timestamp, end_timestamp, note, manual_end_ts, duration "
                "FROM parsed_songs WHERE video_id = ? ORDER BY order_index",
                (video_id,),
            )
            rows = cur.fetchall()
            return jsonify([
                {
                    "id": r["id"],
                    "orderIndex": r["order_index"],
                    "songName": r["song_name"],
                    "artist": r["artist"],
                    "startTimestamp": r["start_timestamp"],
                    "endTimestamp": r["end_timestamp"],
                    "note": r["note"],
                    "manualEndTs": bool(r["manual_end_ts"]),
                    "duration": r["duration"],
                }
                for r in rows
            ])
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # API: set end timestamp
    # ------------------------------------------------------------------

    @app.route("/api/songs/<int:song_pk>/end-timestamp", methods=["PUT"])
    def api_set_end_timestamp(song_pk: int):
        """Set end_timestamp + manual flag for a parsed song."""
        from prismlens.cache import update_song_end_timestamp

        data = request.get_json(silent=True)
        if not data or "endTimestamp" not in data:
            return jsonify({"error": "Missing endTimestamp in request body"}), 400

        end_ts = data["endTimestamp"]
        if not isinstance(end_ts, str) or not end_ts.strip():
            return jsonify({"error": "endTimestamp must be a non-empty string"}), 400

        conn = _open()
        try:
            updated = update_song_end_timestamp(
                conn, song_pk, end_ts.strip(), manual=True
            )
            if not updated:
                return jsonify({"error": f"Song {song_pk} not found"}), 404
            _maybe_reapprove_stream(conn, song_pk)
            return jsonify({"ok": True, "songId": song_pk, "endTimestamp": end_ts.strip()})
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # API: set start timestamp
    # ------------------------------------------------------------------

    @app.route("/api/songs/<int:song_pk>/start-timestamp", methods=["PUT"])
    def api_set_start_timestamp(song_pk: int):
        """Overwrite start_timestamp for a parsed song."""
        from prismlens.cache import update_song_start_timestamp

        data = request.get_json(silent=True)
        if not data or "startTimestamp" not in data:
            return jsonify({"error": "Missing startTimestamp in request body"}), 400

        start_ts = data["startTimestamp"]
        if not isinstance(start_ts, str) or not start_ts.strip():
            return jsonify({"error": "startTimestamp must be a non-empty string"}), 400

        conn = _open()
        try:
            updated = update_song_start_timestamp(conn, song_pk, start_ts.strip())
            if not updated:
                return jsonify({"error": f"Song {song_pk} not found"}), 404
            _maybe_reapprove_stream(conn, song_pk)
            return jsonify({"ok": True, "songId": song_pk, "startTimestamp": start_ts.strip()})
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # API: clear end timestamp
    # ------------------------------------------------------------------

    @app.route("/api/songs/<int:song_pk>/end-timestamp", methods=["DELETE"])
    def api_clear_end_timestamp(song_pk: int):
        """Clear end_timestamp + manual flag (undo)."""
        from prismlens.cache import clear_song_end_timestamp

        conn = _open()
        try:
            updated = clear_song_end_timestamp(conn, song_pk)
            if not updated:
                return jsonify({"error": f"Song {song_pk} not found"}), 404
            _maybe_reapprove_stream(conn, song_pk)
            return jsonify({"ok": True, "songId": song_pk})
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # API: update song details (name / artist)
    # ------------------------------------------------------------------

    @app.route("/api/songs/<int:song_pk>/details", methods=["PUT"])
    def api_update_song_details(song_pk: int):
        """Update song_name and/or artist for a parsed song."""
        from prismlens.cache import update_song_details

        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "Missing request body"}), 400

        song_name = data.get("songName")
        artist_provided = "artist" in data
        artist = data.get("artist")

        if song_name is None and not artist_provided:
            return jsonify({"error": "At least one of songName or artist is required"}), 400

        if song_name is not None:
            if not isinstance(song_name, str) or not song_name.strip():
                return jsonify({"error": "songName must be a non-empty string"}), 400
            song_name = song_name.strip()

        if artist_provided and artist is not None:
            if not isinstance(artist, str):
                return jsonify({"error": "artist must be a string or null"}), 400
            artist = artist.strip() if artist else None

        conn = _open()
        try:
            from prismlens.cache import _SENTINEL
            kwargs: dict = {}
            if song_name is not None:
                kwargs["song_name"] = song_name
            if artist_provided:
                kwargs["artist"] = artist
            else:
                kwargs["artist"] = _SENTINEL

            updated = update_song_details(conn, song_pk, **kwargs)
            if not updated:
                return jsonify({"error": f"Song {song_pk} not found"}), 404
            _maybe_reapprove_stream(conn, song_pk)

            # Read back the updated row
            row = conn.execute(
                "SELECT song_name, artist FROM parsed_songs WHERE id = ?",
                (song_pk,),
            ).fetchone()
            return jsonify({
                "ok": True,
                "songId": song_pk,
                "songName": row["song_name"],
                "artist": row["artist"],
            })
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # API: fetch song duration from iTunes
    # ------------------------------------------------------------------

    @app.route("/api/songs/<int:song_pk>/fetch-duration", methods=["POST"])
    def api_fetch_duration(song_pk: int):
        """Fetch duration from iTunes and store it for a parsed song."""
        from prismlens.cache import update_song_duration, update_song_end_timestamp
        from prismlens.extraction import parse_timestamp, seconds_to_timestamp
        from prismlens.metadata import fetch_itunes_metadata

        conn = _open()
        try:
            row = conn.execute(
                "SELECT song_name, artist, start_timestamp, end_timestamp"
                " FROM parsed_songs WHERE id = ?",
                (song_pk,),
            ).fetchone()
            if not row:
                return jsonify({"error": f"Song {song_pk} not found"}), 404

            result = fetch_itunes_metadata(row["artist"] or "", row["song_name"])

            if result is None:
                return jsonify({"error": "iTunes API error"}), 502

            if result.get("match_confidence") is None:
                return jsonify({"ok": True, "duration": None, "message": "No iTunes match"})

            duration = result.get("trackDuration")
            end_ts = None
            if duration:
                update_song_duration(conn, song_pk, duration)
                if row["end_timestamp"] is None:
                    start_sec = parse_timestamp(row["start_timestamp"])
                    if start_sec is not None:
                        end_ts = seconds_to_timestamp(start_sec + duration)
                        update_song_end_timestamp(conn, song_pk, end_ts)

            return jsonify({"ok": True, "duration": duration, "end_timestamp": end_ts})
        except Exception as exc:
            return jsonify({"error": str(exc)}), 502
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # API: progress stats
    # ------------------------------------------------------------------

    @app.route("/api/stats")
    def api_stats():
        """Return stamp progress: total / filled / remaining."""
        conn = _open()
        try:
            cur = conn.execute(
                "SELECT COUNT(*) as total, "
                "  SUM(CASE WHEN end_timestamp IS NOT NULL THEN 1 ELSE 0 END) as filled "
                "FROM parsed_songs p "
                "JOIN streams s ON p.video_id = s.video_id "
                "WHERE s.status IN ('approved', 'exported', 'imported')"
            )
            row = cur.fetchone()
            total = row["total"]
            filled = row["filled"]
            return jsonify({
                "total": total,
                "filled": filled,
                "remaining": total - filled,
            })
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # API: delete a song
    # ------------------------------------------------------------------

    @app.route("/api/songs/<int:song_pk>", methods=["DELETE"])
    def api_delete_song(song_pk: int):
        """Delete a parsed song by PK and reindex remaining songs."""
        from prismlens.cache import delete_parsed_song

        conn = _open()
        try:
            video_id = delete_parsed_song(conn, song_pk)
            if video_id is None:
                return jsonify({"error": f"Song {song_pk} not found"}), 404
            _maybe_reapprove_stream_by_video_id(conn, video_id)
            return jsonify({"ok": True, "songId": song_pk})
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # API: refetch/re-extract stream timestamps
    # ------------------------------------------------------------------

    @app.route("/api/streams/<video_id>/refetch", methods=["POST"])
    def api_refetch_stream(video_id: str):
        """Re-run timestamp extraction for a stream."""
        from prismlens.cache import get_stream
        from prismlens.extraction import extract_timestamps

        conn = _open()
        try:
            stream = get_stream(conn, video_id)
            if not stream:
                return jsonify({"error": f"Stream {video_id} not found"}), 404

            result = extract_timestamps(conn, video_id)
            return jsonify({
                "ok": True,
                "source": result.source,
                "songCount": len(result.songs),
                "status": result.status,
            })
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # API: clear all end timestamps for a stream
    # ------------------------------------------------------------------

    @app.route("/api/streams/<video_id>/end-timestamps", methods=["DELETE"])
    def api_clear_all_end_timestamps(video_id: str):
        """Clear all end_timestamp + manual flags for every song in a stream."""
        from prismlens.cache import clear_all_end_timestamps, get_stream

        conn = _open()
        try:
            stream = get_stream(conn, video_id)
            if not stream:
                return jsonify({"error": f"Stream {video_id} not found"}), 404
            cleared = clear_all_end_timestamps(conn, video_id)
            _maybe_reapprove_stream_by_video_id(conn, video_id)
            return jsonify({"ok": True, "cleared": cleared})
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Helper: re-approve stream after stamp edit
    # ------------------------------------------------------------------

    def _maybe_reapprove_stream_by_video_id(conn, video_id: str) -> None:
        """Transition a stream to 'approved' after stamp edits."""
        from prismlens.cache import get_stream, update_stream_status

        stream = get_stream(conn, video_id)
        if stream and stream["status"] in ("extracted", "pending", "exported", "imported"):
            update_stream_status(conn, video_id, "approved")

    def _maybe_reapprove_stream(conn, song_pk: int) -> None:
        """Transition the song's parent stream back to 'approved' if needed."""
        row = conn.execute(
            "SELECT video_id FROM parsed_songs WHERE id = ?", (song_pk,)
        ).fetchone()
        if not row:
            return
        _maybe_reapprove_stream_by_video_id(conn, row["video_id"])

    return app
