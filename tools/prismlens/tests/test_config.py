"""Tests for mizukilens.config module."""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from mizukilens.config import (
    CONFIG_PATH,
    DEFAULT_KEYWORDS,
    _default_config,
    is_valid_input,
    load_config,
    parse_channel_input,
    save_config,
)


# ---------------------------------------------------------------------------
# parse_channel_input / is_valid_input
# ---------------------------------------------------------------------------

class TestParseChannelInput:
    """Tests for parse_channel_input()."""

    def test_valid_channel_id_direct(self) -> None:
        """A bare UC-prefixed 24-char ID should parse as channel_id."""
        cid, handle = parse_channel_input("UCxxxxxxxxxxxxxxxxxxxxxx")
        assert cid == "UCxxxxxxxxxxxxxxxxxxxxxx"
        assert handle is None

    def test_valid_channel_url(self) -> None:
        """youtube.com/channel/UC... URLs return the channel ID."""
        url = "https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx"
        cid, handle = parse_channel_input(url)
        assert cid == "UCxxxxxxxxxxxxxxxxxxxxxx"
        assert handle is None

    def test_handle_url_at_sign(self) -> None:
        """youtube.com/@handle URLs return a handle, not a UC id."""
        url = "https://www.youtube.com/@MizukiStar"
        cid, handle = parse_channel_input(url)
        assert cid is None
        assert handle == "MizukiStar"

    def test_handle_url_c_custom(self) -> None:
        """youtube.com/c/custom URLs return a handle."""
        url = "https://www.youtube.com/c/mizukimusic"
        cid, handle = parse_channel_input(url)
        assert cid is None
        assert handle == "mizukimusic"

    def test_invalid_input_plain_string(self) -> None:
        """A random plain string is invalid."""
        cid, handle = parse_channel_input("notachannelid")
        assert cid is None
        assert handle is None

    def test_invalid_input_empty(self) -> None:
        """Empty string returns (None, None)."""
        cid, handle = parse_channel_input("")
        assert cid is None
        assert handle is None

    def test_invalid_url_no_youtube(self) -> None:
        """Non-YouTube URLs are rejected."""
        cid, handle = parse_channel_input("https://example.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx")
        assert cid is None
        assert handle is None

    def test_strips_whitespace(self) -> None:
        """Leading / trailing whitespace in input is stripped."""
        cid, handle = parse_channel_input("  UCxxxxxxxxxxxxxxxxxxxxxx  ")
        assert cid == "UCxxxxxxxxxxxxxxxxxxxxxx"

    def test_is_valid_for_channel_id(self) -> None:
        assert is_valid_input("UCxxxxxxxxxxxxxxxxxxxxxx") is True

    def test_is_valid_for_at_url(self) -> None:
        assert is_valid_input("https://youtube.com/@handle") is True

    def test_is_invalid_for_garbage(self) -> None:
        assert is_valid_input("not-a-channel") is False


# ---------------------------------------------------------------------------
# save_config / load_config
# ---------------------------------------------------------------------------

class TestSaveLoadConfig:
    """Tests for round-trip config serialisation."""

    def test_round_trip(self, tmp_path: Path) -> None:
        """Data saved then loaded should be identical."""
        cfg = _default_config("mizuki", "UCxxxxxxxxxxxxxxxxxxxxxx", "Mizuki")

        config_file = tmp_path / "config.toml"
        # Patch CONFIG_PATH and CONFIG_DIR so writes go to tmp_path
        with (
            patch("mizukilens.config.CONFIG_PATH", config_file),
            patch("mizukilens.config.CONFIG_DIR", tmp_path),
        ):
            save_config(cfg)
            loaded = load_config()

        assert loaded is not None
        assert loaded["default"]["active_channel"] == "mizuki"
        assert loaded["channels"]["mizuki"]["id"] == "UCxxxxxxxxxxxxxxxxxxxxxx"
        assert loaded["channels"]["mizuki"]["name"] == "Mizuki"
        assert loaded["channels"]["mizuki"]["keywords"] == DEFAULT_KEYWORDS

    def test_load_config_returns_none_when_missing(self, tmp_path: Path) -> None:
        """load_config() returns None when no config file exists."""
        missing_path = tmp_path / "does_not_exist.toml"
        with patch("mizukilens.config.CONFIG_PATH", missing_path):
            result = load_config()
        assert result is None

    def test_multiple_channels(self, tmp_path: Path) -> None:
        """Config can hold multiple channels."""
        cfg: dict[str, Any] = {
            "default": {"active_channel": "channel_a"},
            "channels": {
                "channel_a": {"id": "UCaaaaaaaaaaaaaaaaaaaaaaa", "name": "A", "keywords": []},
                "channel_b": {"id": "UCbbbbbbbbbbbbbbbbbbbbbbb", "name": "B", "keywords": []},
            },
            "cache": {"path": "~/.local/share/mizukilens/cache.db"},
            "export": {"output_dir": "~/.local/share/mizukilens/exports"},
        }
        config_file = tmp_path / "config.toml"
        with (
            patch("mizukilens.config.CONFIG_PATH", config_file),
            patch("mizukilens.config.CONFIG_DIR", tmp_path),
        ):
            save_config(cfg)
            loaded = load_config()
        assert loaded is not None
        assert "channel_a" in loaded["channels"]
        assert "channel_b" in loaded["channels"]


# ---------------------------------------------------------------------------
# _default_config
# ---------------------------------------------------------------------------

class TestDefaultConfig:
    """Tests for the _default_config() factory."""

    def test_structure(self) -> None:
        cfg = _default_config("mizuki", "UCxxxxxxxxxxxxxxxxxxxxxx", "Mizuki")
        assert cfg["default"]["active_channel"] == "mizuki"
        assert cfg["channels"]["mizuki"]["id"] == "UCxxxxxxxxxxxxxxxxxxxxxx"
        assert cfg["channels"]["mizuki"]["name"] == "Mizuki"
        assert set(cfg["channels"]["mizuki"]["keywords"]) == set(DEFAULT_KEYWORDS)
        assert "cache" in cfg
        assert "export" in cfg
