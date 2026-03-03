"""Tests for mizukilens CLI entry point and stub commands."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner

from mizukilens.cli import main


class TestCliHelp:
    """Verify the root --help output."""

    def test_help_shows_all_subcommands(self) -> None:
        runner = CliRunner()
        result = runner.invoke(main, ["--help"])
        assert result.exit_code == 0
        for cmd in ("config", "fetch", "extract", "review", "export", "import", "status", "cache"):
            assert cmd in result.output

    def test_module_invocable(self) -> None:
        """Ensure the entry-point function exists and is callable."""
        assert callable(main)


class TestStubCommands:
    """Stub commands should exit cleanly and print an informational message."""

    def test_fetch_no_mode_shows_error(self) -> None:
        """fetch without a mode flag (--all/--recent/--after) should show an error."""
        runner = CliRunner()
        result = runner.invoke(main, ["fetch"])
        # exits with non-zero (sys.exit(1)) and shows mode requirement
        assert result.exit_code != 0 or "モード" in result.output or "エラー" in result.output

    def test_review_launches_tui(self, tmp_path: Path) -> None:
        from mizukilens.cache import open_db
        db_path = tmp_path / "review_test.db"
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

    def test_export_stub(self) -> None:
        runner = CliRunner()
        result = runner.invoke(main, ["export"])
        assert result.exit_code == 0

    def test_import_no_file_shows_error(self) -> None:
        runner = CliRunner()
        result = runner.invoke(main, ["import"])
        # No FILE argument: should show an error (non-zero exit) or error message
        assert result.exit_code != 0 or "エラー" in result.output or "FILE" in result.output

    def test_status_stub(self) -> None:
        runner = CliRunner()
        result = runner.invoke(main, ["status"])
        assert result.exit_code == 0

    def test_cache_clear_stub(self) -> None:
        runner = CliRunner()
        # Answer "n" to the confirmation prompt — should exit cleanly
        result = runner.invoke(main, ["cache", "clear"], input="n\n")
        assert result.exit_code == 0


class TestExtractCommand:
    """Tests for the extract subcommand."""

    def test_extract_no_mode_shows_error(self) -> None:
        runner = CliRunner()
        result = runner.invoke(main, ["extract"])
        assert result.exit_code != 0
        assert "エラー" in result.output

    def test_extract_stream_not_in_cache_shows_error(self, tmp_path: Path) -> None:
        from mizukilens.cache import open_db
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)
        conn.close()

        with patch("mizukilens.cache.open_db", return_value=open_db(db_path)):
            runner = CliRunner()
            result = runner.invoke(main, ["extract", "--stream", "nonexistent_vid"])
            assert result.exit_code != 0
            assert "見つかりません" in result.output

    def test_extract_stream_success(self, tmp_path: Path) -> None:
        from mizukilens.cache import open_db, upsert_stream
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)
        upsert_stream(conn, video_id="vid_test", status="discovered", title="Test Stream")
        conn.close()

        good_comment = (
            "0:00 Song A\n1:30 Song B\n3:00 Song C\n5:00 Song D\n"
        )

        def mock_open_db(*args, **kwargs):
            return open_db(db_path)

        mock_comment = {
            "cid": "c1", "text": good_comment, "votes": "100",
            "is_pinned": False, "author": "u", "channel": "ch",
            "replies": "0", "photo": "", "heart": False, "reply": False,
        }
        mock_downloader = MagicMock()
        mock_downloader.get_comments.return_value = iter([mock_comment])

        with (
            patch("mizukilens.cache.open_db", side_effect=mock_open_db),
            patch(
                "youtube_comment_downloader.YoutubeCommentDownloader",
                return_value=mock_downloader,
            ),
        ):
            runner = CliRunner()
            result = runner.invoke(main, ["extract", "--stream", "vid_test"])

        assert result.exit_code == 0
        assert "完了" in result.output

    def test_extract_all_no_discovered_streams(self, tmp_path: Path) -> None:
        from mizukilens.cache import open_db
        db_path = tmp_path / "test.db"
        conn = open_db(db_path)
        conn.close()

        def mock_open_db(*args, **kwargs):
            return open_db(db_path)

        with patch("mizukilens.cache.open_db", side_effect=mock_open_db):
            runner = CliRunner()
            result = runner.invoke(main, ["extract", "--all"])

        assert result.exit_code == 0
        assert "ありません" in result.output


class TestConfigCommand:
    """Integration tests for the config subcommand."""

    def test_config_first_run_prompts(self, tmp_path: Path) -> None:
        """When no config exists, config command should prompt the user."""
        runner = CliRunner()
        missing_cfg = tmp_path / "config.toml"

        # Provide valid UC channel ID via stdin
        with (
            patch("mizukilens.config.CONFIG_PATH", missing_cfg),
            patch("mizukilens.config.CONFIG_DIR", tmp_path),
        ):
            result = runner.invoke(
                main,
                ["config"],
                input="UCxxxxxxxxxxxxxxxxxxxxxx\nMizuki Test\n",
                catch_exceptions=False,
            )

        assert result.exit_code == 0
        assert missing_cfg.exists(), "Config file should have been created"

    def test_config_first_run_invalid_url_shows_error(self, tmp_path: Path) -> None:
        """Invalid channel input should show the error message and re-prompt."""
        runner = CliRunner()
        missing_cfg = tmp_path / "config.toml"

        with (
            patch("mizukilens.config.CONFIG_PATH", missing_cfg),
            patch("mizukilens.config.CONFIG_DIR", tmp_path),
        ):
            # First input is invalid, second is valid
            result = runner.invoke(
                main,
                ["config"],
                input="not-a-channel\nUCxxxxxxxxxxxxxxxxxxxxxx\nMizuki\n",
                catch_exceptions=False,
            )

        assert result.exit_code == 0
        assert "無法解析頻道 ID，請確認格式" in result.output

    def test_config_existing_shows_settings(self, tmp_path: Path) -> None:
        """When config already exists, the command shows current settings."""
        import sys
        if sys.version_info >= (3, 11):
            import tomllib
        else:
            import tomli as tomllib
        import tomli_w

        cfg_file = tmp_path / "config.toml"
        cfg: dict[str, Any] = {
            "default": {"active_channel": "mizuki"},
            "channels": {
                "mizuki": {
                    "id": "UCxxxxxxxxxxxxxxxxxxxxxx",
                    "name": "Mizuki",
                    "keywords": ["歌回"],
                },
            },
            "cache": {"path": "~/.local/share/mizukilens/cache.db"},
            "export": {"output_dir": "~/.local/share/mizukilens/exports"},
        }
        with cfg_file.open("wb") as fh:
            tomli_w.dump(cfg, fh)

        runner = CliRunner()
        with (
            patch("mizukilens.config.CONFIG_PATH", cfg_file),
            patch("mizukilens.config.CONFIG_DIR", tmp_path),
        ):
            # Choose 'q' to quit without modification
            result = runner.invoke(
                main,
                ["config"],
                input="q\n",
                catch_exceptions=False,
            )

        assert result.exit_code == 0
        # Current config should be displayed
        assert "mizuki" in result.output

    def test_config_url_with_at_handle(self, tmp_path: Path) -> None:
        """@handle URL should be accepted and saved."""
        runner = CliRunner()
        missing_cfg = tmp_path / "config.toml"

        with (
            patch("mizukilens.config.CONFIG_PATH", missing_cfg),
            patch("mizukilens.config.CONFIG_DIR", tmp_path),
        ):
            result = runner.invoke(
                main,
                ["config"],
                input="https://www.youtube.com/@MizukiStar\nMizuki\n",
                catch_exceptions=False,
            )

        assert result.exit_code == 0
        assert missing_cfg.exists()

        import sys
        if sys.version_info >= (3, 11):
            import tomllib
        else:
            import tomli as tomllib

        with missing_cfg.open("rb") as fh:
            saved = tomllib.load(fh)

        # The handle should be stored
        active_key = saved["default"]["active_channel"]
        assert saved["channels"][active_key]["id"] == "MizukiStar"

    def test_config_toml_structure_matches_spec(self, tmp_path: Path) -> None:
        """Saved TOML should have [default], [channels.*], [cache], [export] sections."""
        runner = CliRunner()
        missing_cfg = tmp_path / "config.toml"

        with (
            patch("mizukilens.config.CONFIG_PATH", missing_cfg),
            patch("mizukilens.config.CONFIG_DIR", tmp_path),
        ):
            result = runner.invoke(
                main,
                ["config"],
                input="UCxxxxxxxxxxxxxxxxxxxxxx\nMizuki\n",
                catch_exceptions=False,
            )

        assert result.exit_code == 0

        import sys
        if sys.version_info >= (3, 11):
            import tomllib
        else:
            import tomli as tomllib

        with missing_cfg.open("rb") as fh:
            saved = tomllib.load(fh)

        # Spec §4.3.3 required keys
        assert "default" in saved
        assert "active_channel" in saved["default"]
        assert "channels" in saved
        active_ch = saved["default"]["active_channel"]
        assert active_ch in saved["channels"]
        ch = saved["channels"][active_ch]
        assert "id" in ch
        assert "name" in ch
        assert "keywords" in ch
        assert isinstance(ch["keywords"], list)
        assert "cache" in saved
        assert "path" in saved["cache"]
        assert "export" in saved
        assert "output_dir" in saved["export"]


# ===========================================================================
# Candidates CLI commands
# ===========================================================================


class TestCandidatesCLI:
    """Tests for the ``mizukilens candidates`` command group."""

    def _make_db_with_candidates(self, tmp_path: Path) -> Path:
        from mizukilens.cache import open_db, upsert_stream, save_candidate_comments

        db_path = tmp_path / "cand_test.db"
        conn = open_db(db_path)
        upsert_stream(conn, video_id="cv1", status="discovered", title="Test Stream")
        save_candidate_comments(conn, "cv1", [
            {
                "comment_cid": "cid_001",
                "comment_author": "歌單bot",
                "comment_author_url": None,
                "comment_text": "歌單：\n0:00 Song A\n2:00 Song B\n4:00 Song C",
                "keywords_matched": ["歌單"],
            },
            {
                "comment_cid": "cid_002",
                "comment_author": "SetlistFan",
                "comment_author_url": None,
                "comment_text": "Songlist coming soon",
                "keywords_matched": ["Songlist"],
            },
        ])
        conn.close()
        return db_path

    def test_candidates_list_empty(self, tmp_path: Path) -> None:
        from mizukilens.cache import open_db

        db_path = tmp_path / "empty_cand.db"
        conn = open_db(db_path)
        conn.close()

        runner = CliRunner()
        with patch("mizukilens.cache._resolve_cache_path", return_value=db_path):
            result = runner.invoke(main, ["candidates"], catch_exceptions=False)
        assert result.exit_code == 0
        assert "ありません" in result.output

    def test_candidates_list_shows_results(self, tmp_path: Path) -> None:
        db_path = self._make_db_with_candidates(tmp_path)

        runner = CliRunner()
        with patch("mizukilens.cache._resolve_cache_path", return_value=db_path):
            result = runner.invoke(main, ["candidates"], catch_exceptions=False)
        assert result.exit_code == 0
        assert "歌單bot" in result.output
        assert "SetlistFan" in result.output

    def test_candidates_list_filter_by_video(self, tmp_path: Path) -> None:
        db_path = self._make_db_with_candidates(tmp_path)

        runner = CliRunner()
        with patch("mizukilens.cache._resolve_cache_path", return_value=db_path):
            result = runner.invoke(
                main, ["candidates", "--video", "cv1"], catch_exceptions=False
            )
        assert result.exit_code == 0
        assert "歌單bot" in result.output

    def test_candidates_show(self, tmp_path: Path) -> None:
        db_path = self._make_db_with_candidates(tmp_path)

        # Get the candidate ID
        from mizukilens.cache import open_db, list_candidate_comments
        conn = open_db(db_path)
        rows = list_candidate_comments(conn, video_id="cv1")
        cand_id = rows[0]["id"]
        conn.close()

        runner = CliRunner()
        with patch("mizukilens.cache._resolve_cache_path", return_value=db_path):
            result = runner.invoke(
                main, ["candidates", "show", str(cand_id)], catch_exceptions=False
            )
        assert result.exit_code == 0
        assert "Song A" in result.output

    def test_candidates_approve(self, tmp_path: Path) -> None:
        db_path = self._make_db_with_candidates(tmp_path)

        from mizukilens.cache import open_db, list_candidate_comments
        conn = open_db(db_path)
        rows = list_candidate_comments(conn, video_id="cv1")
        cand_id = rows[0]["id"]
        conn.close()

        runner = CliRunner()
        with patch("mizukilens.cache._resolve_cache_path", return_value=db_path):
            result = runner.invoke(
                main, ["candidates", "approve", str(cand_id)], catch_exceptions=False
            )
        assert result.exit_code == 0
        assert "完了" in result.output or "曲" in result.output

        # Verify candidate is now approved
        conn = open_db(db_path)
        from mizukilens.cache import get_candidate_comment
        cand = get_candidate_comment(conn, cand_id)
        assert cand["status"] == "approved"
        conn.close()

    def test_candidates_reject(self, tmp_path: Path) -> None:
        db_path = self._make_db_with_candidates(tmp_path)

        from mizukilens.cache import open_db, list_candidate_comments
        conn = open_db(db_path)
        rows = list_candidate_comments(conn, video_id="cv1")
        cand_id = rows[1]["id"]
        conn.close()

        runner = CliRunner()
        with patch("mizukilens.cache._resolve_cache_path", return_value=db_path):
            result = runner.invoke(
                main, ["candidates", "reject", str(cand_id)], catch_exceptions=False
            )
        assert result.exit_code == 0
        assert "却下" in result.output

        # Verify candidate is now rejected
        conn = open_db(db_path)
        from mizukilens.cache import get_candidate_comment
        cand = get_candidate_comment(conn, cand_id)
        assert cand["status"] == "rejected"
        conn.close()

    def test_candidates_command_in_help(self) -> None:
        """Verify the candidates command is registered in the CLI."""
        runner = CliRunner()
        result = runner.invoke(main, ["--help"])
        assert "candidates" in result.output


# ---------------------------------------------------------------------------
# extract --from-text tests
# ---------------------------------------------------------------------------


class TestExtractFromTextCLI:
    """Tests for the ``extract --from-text FILE`` CLI option."""

    def test_from_text_requires_stream_flag(self, tmp_path: Path) -> None:
        """--from-text without --stream should error."""
        text_file = tmp_path / "songs.txt"
        text_file.write_text("5:30 Song A - Artist\n")

        runner = CliRunner()
        result = runner.invoke(
            main, ["extract", "--from-text", str(text_file)]
        )
        assert result.exit_code != 0
        assert "エラー" in result.output

    def test_from_text_mutually_exclusive_with_all(self, tmp_path: Path) -> None:
        """--from-text + --all should error."""
        text_file = tmp_path / "songs.txt"
        text_file.write_text("5:30 Song A - Artist\n")

        runner = CliRunner()
        result = runner.invoke(
            main,
            ["extract", "--from-text", str(text_file), "--stream", "vid01", "--all"],
        )
        assert result.exit_code != 0
        assert "エラー" in result.output

    def test_from_text_with_stream_succeeds(self, tmp_path: Path) -> None:
        """Happy path: --from-text + --stream extracts successfully."""
        from mizukilens.cache import open_db, upsert_stream

        text_file = tmp_path / "songs.txt"
        text_file.write_text(
            "5:30 買你 - 魏如萱\n17:00 ただ君に晴れ - ヨルシカ\n1:01:30 怪物 - YOASOBI\n"
        )

        db_path = tmp_path / "test.db"
        conn = open_db(db_path)
        upsert_stream(conn, video_id="txtvid", status="discovered", title="Test")
        conn.close()

        def mock_open_db(*args, **kwargs):
            return open_db(db_path)

        with patch("mizukilens.cache.open_db", side_effect=mock_open_db):
            runner = CliRunner()
            result = runner.invoke(
                main,
                ["extract", "--stream", "txtvid", "--from-text", str(text_file)],
            )

        assert result.exit_code == 0
        assert "3 曲" in result.output
        assert "完了" in result.output
