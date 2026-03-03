"""Channel configuration management for PrismLens.

Handles reading, writing, and interactively editing the TOML configuration
file at ~/.config/prismlens/config.toml.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

import tomli_w

# Use the stdlib tomllib on Python 3.11+; fall back to the tomli back-port.
if sys.version_info >= (3, 11):
    import tomllib
else:
    import tomli as tomllib  # type: ignore[no-redef]

CONFIG_DIR = Path.home() / ".config" / "prismlens"
CONFIG_PATH = CONFIG_DIR / "config.toml"

DEFAULT_KEYWORDS: list[str] = ["歌回", "歌枠", "唱歌", "singing", "karaoke"]
DEFAULT_SONGLIST_KEYWORDS: list[str] = [
    "歌單", "歌单", "Songlist", "songlist", "setlist", "Setlist",
]
DEFAULT_CACHE_PATH = "~/.local/share/prismlens/cache.db"
DEFAULT_EXPORT_DIR = "~/.local/share/prismlens/exports"


# ---------------------------------------------------------------------------
# URL / ID parsing
# ---------------------------------------------------------------------------

_CHANNEL_ID_RE = re.compile(r"^UC[a-zA-Z0-9_-]{22}$")

# Patterns that can appear in YouTube channel URLs
_URL_PATTERNS: list[re.Pattern[str]] = [
    # https://www.youtube.com/channel/UCxxxxxxxx
    re.compile(r"youtube\.com/channel/(UC[a-zA-Z0-9_-]{22})"),
    # https://www.youtube.com/@handle  or  youtube.com/@handle
    re.compile(r"youtube\.com/@([a-zA-Z0-9_.-]+)"),
    # https://www.youtube.com/c/custom
    re.compile(r"youtube\.com/c/([a-zA-Z0-9_.-]+)"),
    # https://www.youtube.com/user/legacy
    re.compile(r"youtube\.com/user/([a-zA-Z0-9_.-]+)"),
]


def parse_channel_input(raw: str) -> tuple[str | None, str | None]:
    """Parse a raw user input (URL or channel ID) into (channel_id, handle).

    Returns:
        (channel_id, handle) where channel_id is ``UC…`` when the input
        is already a channel ID or a ``/channel/UC…`` URL, and handle is
        the ``@handle`` / custom name for other URL forms.
        Returns ``(None, None)`` when the input cannot be parsed.
    """
    raw = raw.strip()

    # Direct channel ID (UC + 22 chars)
    if _CHANNEL_ID_RE.match(raw):
        return raw, None

    # URL forms
    for pattern in _URL_PATTERNS:
        m = pattern.search(raw)
        if m:
            captured = m.group(1)
            if _CHANNEL_ID_RE.match(captured):
                return captured, None
            # handle / custom slug — return as handle, no UC id yet
            return None, captured

    return None, None


def is_valid_input(raw: str) -> bool:
    """Return True if *raw* is a parseable channel ID or URL."""
    channel_id, handle = parse_channel_input(raw)
    return channel_id is not None or handle is not None


# ---------------------------------------------------------------------------
# Config read / write
# ---------------------------------------------------------------------------

def _default_config(channel_key: str, channel_id_or_handle: str, channel_name: str) -> dict[str, Any]:
    return {
        "default": {
            "active_channel": channel_key,
        },
        "channels": {
            channel_key: {
                "id": channel_id_or_handle,
                "name": channel_name,
                "keywords": list(DEFAULT_KEYWORDS),
            },
        },
        "cache": {
            "path": DEFAULT_CACHE_PATH,
        },
        "export": {
            "output_dir": DEFAULT_EXPORT_DIR,
        },
        "extraction": {
            "songlist_keywords": list(DEFAULT_SONGLIST_KEYWORDS),
        },
    }


def get_songlist_keywords() -> list[str]:
    """Return the configured songlist keywords, falling back to defaults.

    Checks ``[extraction] songlist_keywords`` in the config file.
    """
    cfg = load_config()
    if cfg:
        keywords = cfg.get("extraction", {}).get("songlist_keywords")
        if isinstance(keywords, list) and keywords:
            return keywords
    return list(DEFAULT_SONGLIST_KEYWORDS)


def load_config() -> dict[str, Any] | None:
    """Load config from disk.  Returns None if the file does not exist."""
    if not CONFIG_PATH.exists():
        return None
    with CONFIG_PATH.open("rb") as fh:
        return tomllib.load(fh)


def save_config(cfg: dict[str, Any]) -> None:
    """Write *cfg* to disk, creating parent directories as needed."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with CONFIG_PATH.open("wb") as fh:
        tomli_w.dump(cfg, fh)


# ---------------------------------------------------------------------------
# Interactive prompts
# ---------------------------------------------------------------------------

def _prompt(prompt_text: str, default: str | None = None) -> str:
    """Read a non-empty line from stdin, showing *prompt_text*."""
    if default:
        full_prompt = f"{prompt_text} [{default}]: "
    else:
        full_prompt = f"{prompt_text}: "
    while True:
        value = input(full_prompt).strip()
        if not value and default:
            return default
        if value:
            return value


def _prompt_channel() -> tuple[str, str, str]:
    """Interactively ask for a channel URL/ID and a display name.

    Returns:
        (channel_key, channel_id_or_handle, display_name)
    """
    from rich.console import Console

    console = Console()

    while True:
        raw = _prompt("YouTube 頻道 ID 或 URL")
        channel_id, handle = parse_channel_input(raw)

        if channel_id is None and handle is None:
            console.print("[bold red]無法解析頻道 ID，請確認格式[/bold red]")
            continue

        resolved = channel_id if channel_id else handle
        break

    display_name = _prompt("頻道顯示名稱（用於設定檔識別）", default=resolved)

    # Use a slugified version of the display_name as the TOML key
    key = re.sub(r"[^a-zA-Z0-9_-]", "_", display_name).lower().strip("_") or "channel"

    return key, resolved, display_name


# ---------------------------------------------------------------------------
# Public API used by cli.py
# ---------------------------------------------------------------------------

def run_config_command() -> None:
    """Entry point for `prismlens config`."""
    from rich.console import Console
    from rich.table import Table
    from rich import box

    console = Console()
    cfg = load_config()

    if cfg is None:
        # ---- First-time interactive setup --------------------------------
        console.print()
        console.print("[bold cyan]PrismLens — 初始設定[/bold cyan]")
        console.print("尚未找到設定檔，開始互動式設定引導。\n")

        channel_key, channel_id_or_handle, display_name = _prompt_channel()

        cfg = _default_config(channel_key, channel_id_or_handle, display_name)
        save_config(cfg)

        console.print()
        console.print(f"[green]設定檔已儲存至[/green] [bold]{CONFIG_PATH}[/bold]")
        console.print(f"  active_channel = [cyan]{channel_key}[/cyan]")
        console.print(f"  id             = [cyan]{channel_id_or_handle}[/cyan]")
        console.print(f"  name           = [cyan]{display_name}[/cyan]")
        console.print()
        return

    # ---- Display existing config and offer modification ------------------
    _display_config(console, cfg)

    console.print()
    console.print("選項：")
    console.print("  [bold]1[/bold]  修改目前頻道設定")
    console.print("  [bold]2[/bold]  新增頻道")
    console.print("  [bold]3[/bold]  切換啟用頻道")
    console.print("  [bold]q[/bold]  離開（不修改）")
    console.print()

    choice = _prompt("請選擇", default="q")

    if choice == "1":
        _edit_active_channel(console, cfg)
    elif choice == "2":
        _add_channel(console, cfg)
    elif choice == "3":
        _switch_active_channel(console, cfg)
    else:
        console.print("[dim]未作任何修改，已離開。[/dim]")


def _display_config(console: Any, cfg: dict[str, Any]) -> None:
    """Pretty-print the current configuration using rich."""
    from rich.table import Table
    from rich import box

    active = cfg.get("default", {}).get("active_channel", "(未設定)")
    console.print()
    console.print(f"[bold cyan]PrismLens 設定[/bold cyan]  （設定檔：{CONFIG_PATH}）")
    console.print(f"  啟用頻道：[bold yellow]{active}[/bold yellow]")
    console.print()

    channels = cfg.get("channels", {})
    if channels:
        tbl = Table(box=box.SIMPLE, show_header=True, header_style="bold")
        tbl.add_column("識別名稱", style="cyan")
        tbl.add_column("ID / Handle")
        tbl.add_column("顯示名稱")
        tbl.add_column("關鍵字")
        for key, ch in channels.items():
            marker = "★ " if key == active else "  "
            tbl.add_row(
                marker + key,
                ch.get("id", ""),
                ch.get("name", ""),
                ", ".join(ch.get("keywords", [])),
            )
        console.print(tbl)

    cache_path = cfg.get("cache", {}).get("path", DEFAULT_CACHE_PATH)
    export_dir = cfg.get("export", {}).get("output_dir", DEFAULT_EXPORT_DIR)
    console.print(f"  快取路徑：{cache_path}")
    console.print(f"  匯出目錄：{export_dir}")


def _edit_active_channel(console: Any, cfg: dict[str, Any]) -> None:
    """Allow the user to modify the active channel's settings."""
    active = cfg.get("default", {}).get("active_channel")
    channels = cfg.setdefault("channels", {})

    if not active or active not in channels:
        console.print("[red]找不到目前啟用的頻道設定。[/red]")
        return

    ch = channels[active]
    console.print(f"\n修改頻道 [cyan]{active}[/cyan]（直接按 Enter 保留原值）：")

    new_id = _prompt("頻道 ID 或 URL", default=ch.get("id", ""))
    channel_id, handle = parse_channel_input(new_id)
    if channel_id is None and handle is None:
        console.print("[bold red]無法解析頻道 ID，請確認格式[/bold red]")
        return
    ch["id"] = channel_id if channel_id else handle

    ch["name"] = _prompt("顯示名稱", default=ch.get("name", active))

    keywords_raw = _prompt(
        "關鍵字（逗號分隔）",
        default=",".join(ch.get("keywords", DEFAULT_KEYWORDS)),
    )
    ch["keywords"] = [k.strip() for k in keywords_raw.split(",") if k.strip()]

    save_config(cfg)
    console.print(f"\n[green]頻道 {active} 的設定已更新。[/green]")


def _add_channel(console: Any, cfg: dict[str, Any]) -> None:
    """Add a new channel entry to the config."""
    console.print("\n新增頻道：")
    channel_key, channel_id_or_handle, display_name = _prompt_channel()

    channels = cfg.setdefault("channels", {})
    if channel_key in channels:
        console.print(f"[yellow]頻道識別名稱 {channel_key!r} 已存在，將覆蓋其設定。[/yellow]")

    channels[channel_key] = {
        "id": channel_id_or_handle,
        "name": display_name,
        "keywords": list(DEFAULT_KEYWORDS),
    }

    # Ask if should switch active channel
    switch = _prompt(f"是否切換啟用頻道至 {channel_key}？(y/n)", default="n")
    if switch.lower() == "y":
        cfg.setdefault("default", {})["active_channel"] = channel_key

    save_config(cfg)
    console.print(f"\n[green]頻道 {channel_key} 已新增。[/green]")


def _switch_active_channel(console: Any, cfg: dict[str, Any]) -> None:
    """Switch the active channel to a different configured channel."""
    channels = cfg.get("channels", {})
    if not channels:
        console.print("[red]尚未設定任何頻道。[/red]")
        return

    console.print("\n可用頻道：")
    keys = list(channels.keys())
    for i, key in enumerate(keys, 1):
        console.print(f"  [bold]{i}[/bold]  {key}  ({channels[key].get('name', '')})")

    raw = _prompt("選擇頻道編號或識別名稱")

    chosen: str | None = None
    if raw.isdigit():
        idx = int(raw) - 1
        if 0 <= idx < len(keys):
            chosen = keys[idx]
    elif raw in channels:
        chosen = raw

    if chosen is None:
        console.print("[red]無效的選擇。[/red]")
        return

    cfg.setdefault("default", {})["active_channel"] = chosen
    save_config(cfg)
    console.print(f"\n[green]啟用頻道已切換至 {chosen}。[/green]")
