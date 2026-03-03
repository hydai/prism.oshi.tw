"""Tests for mizukilens.db_client — Admin API client + db CLI commands.

Coverage:
  - AdminApiClient initialization (env vars, missing config)
  - get_approved_songs() — success, HTTP errors, invalid JSON
  - get_approved_streams() — success
  - get_stats() — success
  - CLI: db export — success, dry-run, API errors
  - CLI: db status — success, API errors
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner

from mizukilens.cli import main
from mizukilens.db_client import AdminApiClient, AdminApiError


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

SAMPLE_SONGS = [
    {
        "id": "song-2",
        "title": "ドライフラワー",
        "originalArtist": "優里",
        "tags": [],
        "performances": [
            {
                "id": "p2-1",
                "streamId": "stream-2025-01-01",
                "date": "2025-01-01",
                "streamTitle": "【歌枠】New Year Karaoke",
                "videoId": "abc123",
                "timestamp": 100,
                "endTimestamp": 350,
                "note": "",
            }
        ],
    },
    {
        "id": "song-1",
        "title": "誰",
        "originalArtist": "李友廷",
        "tags": ["中文"],
        "performances": [
            {
                "id": "p1-1",
                "streamId": "stream-2025-03-26",
                "date": "2025-03-26",
                "streamTitle": "【午後歌枠】Karaoke",
                "videoId": "lVAiHsvF8z8",
                "timestamp": 263,
                "endTimestamp": 506,
                "note": "",
            }
        ],
    },
]

SAMPLE_STREAMS = [
    {
        "id": "stream-2025-01-01",
        "title": "【歌枠】New Year Karaoke",
        "date": "2025-01-01",
        "videoId": "abc123",
        "youtubeUrl": "https://www.youtube.com/watch?v=abc123",
    },
    {
        "id": "stream-2025-03-26",
        "title": "【午後歌枠】Karaoke",
        "date": "2025-03-26",
        "videoId": "lVAiHsvF8z8",
        "youtubeUrl": "https://www.youtube.com/watch?v=lVAiHsvF8z8",
        "credit": {
            "author": "@hydai",
            "authorUrl": "UCL96VcILiOIp4PAYIPzotoQ",
            "commentUrl": "https://www.youtube.com/watch?v=lVAiHsvF8z8&lc=xxx",
        },
    },
]

SAMPLE_STATS = {
    "songs": {"approved": 42, "pending": 5, "rejected": 2},
    "streams": {"approved": 10, "pending": 1, "rejected": 0},
}


def _make_response(status_code: int = 200, json_data=None, text: str = "") -> MagicMock:
    """Build a mock httpx.Response."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = text or json.dumps(json_data or {})
    if json_data is not None:
        resp.json.return_value = json_data
    else:
        resp.json.side_effect = ValueError("No JSON")
    return resp


# ---------------------------------------------------------------------------
# AdminApiClient — unit tests
# ---------------------------------------------------------------------------

class TestAdminApiClientInit:
    """Client initialization and configuration."""

    def test_missing_base_url(self):
        with patch.dict("os.environ", {}, clear=True):
            with pytest.raises(AdminApiError, match="ADMIN_API_URL"):
                AdminApiClient(base_url="", token="tok")

    def test_missing_token(self):
        with patch.dict("os.environ", {}, clear=True):
            with pytest.raises(AdminApiError, match="ADMIN_API_TOKEN"):
                AdminApiClient(base_url="https://api.example.com", token="")

    def test_from_env(self):
        with patch.dict("os.environ", {
            "ADMIN_API_URL": "https://api.example.com/",
            "ADMIN_API_TOKEN": "secret",
        }):
            client = AdminApiClient()
            assert client.base_url == "https://api.example.com"
            assert client.token == "secret"
            client.close()

    def test_explicit_params(self):
        client = AdminApiClient(base_url="https://x.com", token="t")
        assert client.base_url == "https://x.com"
        client.close()


class TestGetApprovedSongs:
    """AdminApiClient.get_approved_songs()."""

    def test_success(self):
        client = AdminApiClient(base_url="https://api.example.com", token="tok")
        mock_resp = _make_response(200, SAMPLE_SONGS)
        with patch.object(client._client, "get", return_value=mock_resp) as mock_get:
            result = client.get_approved_songs()
            mock_get.assert_called_once_with("/api/export/songs")
            assert len(result) == 2
            assert result[0]["id"] == "song-2"
        client.close()

    def test_401_unauthorized(self):
        client = AdminApiClient(base_url="https://api.example.com", token="bad")
        mock_resp = _make_response(401, text="Unauthorized")
        with patch.object(client._client, "get", return_value=mock_resp):
            with pytest.raises(AdminApiError, match="Authentication failed"):
                client.get_approved_songs()
        client.close()

    def test_403_forbidden(self):
        client = AdminApiClient(base_url="https://api.example.com", token="bad")
        mock_resp = _make_response(403, text="Forbidden")
        with patch.object(client._client, "get", return_value=mock_resp):
            with pytest.raises(AdminApiError, match="Forbidden"):
                client.get_approved_songs()
        client.close()

    def test_500_server_error(self):
        client = AdminApiClient(base_url="https://api.example.com", token="tok")
        mock_resp = _make_response(500, text="Internal Server Error")
        with patch.object(client._client, "get", return_value=mock_resp):
            with pytest.raises(AdminApiError, match="HTTP 500"):
                client.get_approved_songs()
        client.close()

    def test_invalid_json(self):
        client = AdminApiClient(base_url="https://api.example.com", token="tok")
        resp = MagicMock()
        resp.status_code = 200
        resp.json.side_effect = ValueError("bad json")
        resp.text = "not json"
        with patch.object(client._client, "get", return_value=resp):
            with pytest.raises(AdminApiError, match="Invalid JSON"):
                client.get_approved_songs()
        client.close()

    def test_non_array_response(self):
        client = AdminApiClient(base_url="https://api.example.com", token="tok")
        mock_resp = _make_response(200, {"error": "not an array"})
        with patch.object(client._client, "get", return_value=mock_resp):
            with pytest.raises(AdminApiError, match="Expected a JSON array"):
                client.get_approved_songs()
        client.close()

    def test_connect_error(self):
        import httpx
        client = AdminApiClient(base_url="https://api.example.com", token="tok")
        with patch.object(
            client._client, "get",
            side_effect=httpx.ConnectError("Connection refused"),
        ):
            with pytest.raises(AdminApiError, match="Cannot connect"):
                client.get_approved_songs()
        client.close()

    def test_timeout_error(self):
        import httpx
        client = AdminApiClient(base_url="https://api.example.com", token="tok")
        with patch.object(
            client._client, "get",
            side_effect=httpx.ReadTimeout("timed out"),
        ):
            with pytest.raises(AdminApiError, match="timed out"):
                client.get_approved_songs()
        client.close()


class TestGetApprovedStreams:
    """AdminApiClient.get_approved_streams()."""

    def test_success(self):
        client = AdminApiClient(base_url="https://api.example.com", token="tok")
        mock_resp = _make_response(200, SAMPLE_STREAMS)
        with patch.object(client._client, "get", return_value=mock_resp) as mock_get:
            result = client.get_approved_streams()
            mock_get.assert_called_once_with("/api/export/streams")
            assert len(result) == 2
        client.close()


class TestGetStats:
    """AdminApiClient.get_stats()."""

    def test_success(self):
        client = AdminApiClient(base_url="https://api.example.com", token="tok")
        mock_resp = _make_response(200, SAMPLE_STATS)
        with patch.object(client._client, "get", return_value=mock_resp) as mock_get:
            result = client.get_stats()
            mock_get.assert_called_once_with("/api/stats")
            assert result["songs"]["approved"] == 42
        client.close()

    def test_non_dict_response(self):
        client = AdminApiClient(base_url="https://api.example.com", token="tok")
        mock_resp = _make_response(200, [1, 2, 3])
        with patch.object(client._client, "get", return_value=mock_resp):
            with pytest.raises(AdminApiError, match="Expected a JSON object"):
                client.get_stats()
        client.close()


# ---------------------------------------------------------------------------
# CLI: db export
# ---------------------------------------------------------------------------

class TestDbExportCli:
    """CLI integration tests for `mizukilens db export`."""

    @patch("mizukilens.db_client.AdminApiClient")
    def test_export_writes_files(self, MockClient, tmp_path):
        mock_client = MockClient.return_value
        mock_client.get_approved_songs.return_value = list(SAMPLE_SONGS)
        mock_client.get_approved_streams.return_value = list(SAMPLE_STREAMS)

        runner = CliRunner()
        out_dir = str(tmp_path / "out")
        result = runner.invoke(main, ["db", "export", "--output", out_dir])

        assert result.exit_code == 0, result.output
        assert "songs" in result.output.lower() or "Songs" in result.output

        # Verify files
        songs = json.loads((tmp_path / "out" / "songs.json").read_text("utf-8"))
        streams = json.loads((tmp_path / "out" / "streams.json").read_text("utf-8"))

        # Songs sorted by id
        assert songs[0]["id"] == "song-1"
        assert songs[1]["id"] == "song-2"

        # Streams sorted by date descending
        assert streams[0]["date"] >= streams[1]["date"]

    @patch("mizukilens.db_client.AdminApiClient")
    def test_export_dry_run(self, MockClient, tmp_path):
        mock_client = MockClient.return_value
        mock_client.get_approved_songs.return_value = list(SAMPLE_SONGS)
        mock_client.get_approved_streams.return_value = list(SAMPLE_STREAMS)

        runner = CliRunner()
        out_dir = str(tmp_path / "out")
        result = runner.invoke(main, ["db", "export", "--output", out_dir, "--dry-run"])

        assert result.exit_code == 0, result.output
        assert "dry run" in result.output.lower()
        assert not (tmp_path / "out" / "songs.json").exists()

    @patch("mizukilens.db_client.AdminApiClient")
    def test_export_api_error(self, MockClient):
        mock_client = MockClient.return_value
        mock_client.get_approved_songs.side_effect = AdminApiError("Connection refused")

        runner = CliRunner()
        result = runner.invoke(main, ["db", "export"])

        assert result.exit_code != 0
        assert "Connection refused" in result.output

    @patch("mizukilens.db_client.AdminApiClient")
    def test_export_missing_env(self, MockClient):
        MockClient.side_effect = AdminApiError("ADMIN_API_URL is not set")

        runner = CliRunner()
        result = runner.invoke(main, ["db", "export"])

        assert result.exit_code != 0
        assert "ADMIN_API_URL" in result.output

    @patch("mizukilens.db_client.AdminApiClient")
    def test_export_json_format(self, MockClient, tmp_path):
        """Verify output uses ensure_ascii=False and indent=2."""
        mock_client = MockClient.return_value
        mock_client.get_approved_songs.return_value = [SAMPLE_SONGS[1]]  # song with CJK
        mock_client.get_approved_streams.return_value = []

        runner = CliRunner()
        out_dir = str(tmp_path / "out")
        result = runner.invoke(main, ["db", "export", "--output", out_dir])
        assert result.exit_code == 0, result.output

        text = (tmp_path / "out" / "songs.json").read_text("utf-8")
        # CJK characters should not be escaped
        assert "誰" in text
        assert "\\u" not in text
        # Indentation should be 2 spaces
        assert "\n  " in text


# ---------------------------------------------------------------------------
# CLI: db status
# ---------------------------------------------------------------------------

class TestDbStatusCli:
    """CLI integration tests for `mizukilens db status`."""

    @patch("mizukilens.db_client.AdminApiClient")
    def test_status_displays_stats(self, MockClient):
        mock_client = MockClient.return_value
        mock_client.get_stats.return_value = SAMPLE_STATS

        runner = CliRunner()
        result = runner.invoke(main, ["db", "status"])

        assert result.exit_code == 0, result.output
        assert "42" in result.output
        assert "approved" in result.output

    @patch("mizukilens.db_client.AdminApiClient")
    def test_status_api_error(self, MockClient):
        mock_client = MockClient.return_value
        mock_client.get_stats.side_effect = AdminApiError("401 Unauthorized")

        runner = CliRunner()
        result = runner.invoke(main, ["db", "status"])

        assert result.exit_code != 0
        assert "401" in result.output
