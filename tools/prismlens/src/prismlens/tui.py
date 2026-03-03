"""Review TUI for PrismLens curator workflow.

Implements §3.1.4 of the PrismLens spec: an interactive terminal interface
for curators to review, edit, and approve extracted song data.

Layout:
  ┌─────────────────────────────────────────────┐
  │ PrismLens - 審核模式                [?]幫助 │
  ├──────────────────┬──────────────────────────┤
  │ 場次列表          │ 歌曲明細                 │
  │                  │                          │
  │ ● 2024-03-15     │ # | 時間    | 歌名 | 原唱 │
  │   歌回 Vol.12    │ 1 | 0:03:20 | ...  | ... │
  │ ○ 2024-03-08     │ 2 | 0:08:15 | ...  | ... │
  │   歌回 Vol.11    │ 3 | 0:15:42 | ...  | ... │
  │ ◌ 2024-03-01     │                          │
  │   歌回 Vol.10    │                          │
  │                  │                          │
  ├──────────────────┴──────────────────────────┤
  │ [a]確認 [z]取消 [x]排除 [e]編輯 [r]再擷取         │
  └─────────────────────────────────────────────┘
"""

from __future__ import annotations

import re
import sqlite3
from typing import Any

from rich.markup import escape
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.screen import ModalScreen
from textual.widgets import (
    Button,
    DataTable,
    Footer,
    Header,
    Input,
    Label,
    ListView,
    ListItem,
    Static,
    TextArea,
)

# ---------------------------------------------------------------------------
# Status icons
# ---------------------------------------------------------------------------

STATUS_ICONS: dict[str, str] = {
    "approved":   "●",
    "extracted":  "○",
    "pending":    "◌",
    "excluded":   "✕",
    "discovered": "·",
    "exported":   "◆",
    "imported":   "◇",
}

STATUS_LABELS: dict[str, str] = {
    "approved":   "審核通過",
    "extracted":  "待審核",
    "pending":    "待手動輸入",
    "excluded":   "已排除",
    "discovered": "已探索",
    "exported":   "已匯出",
    "imported":   "已匯入",
}

# Statuses shown by default in the stream list (reviewable)
REVIEWABLE_STATUSES = {"extracted", "pending", "approved", "exported"}

# ---------------------------------------------------------------------------
# Timestamp validation
# ---------------------------------------------------------------------------

_TS_RE = re.compile(r"^(?:\d{1,2}:)?\d{1,2}:\d{2}$")


def is_valid_timestamp(ts: str) -> bool:
    """Return True if *ts* matches H:MM:SS / MM:SS / M:SS format."""
    return bool(_TS_RE.match(ts.strip()))


# ---------------------------------------------------------------------------
# Confirmation dialog
# ---------------------------------------------------------------------------


class ConfirmDialog(ModalScreen[bool]):
    """A simple Yes/No modal confirmation dialog."""

    DEFAULT_CSS = """
    ConfirmDialog {
        align: center middle;
    }
    ConfirmDialog > Vertical {
        background: $surface;
        border: tall $primary;
        padding: 1 2;
        width: 60;
        height: auto;
    }
    ConfirmDialog Label {
        width: 100%;
        text-align: center;
        margin-bottom: 1;
    }
    ConfirmDialog Horizontal {
        width: 100%;
        align: center middle;
        margin-top: 1;
    }
    ConfirmDialog Button {
        margin: 0 1;
    }
    """

    def __init__(self, message: str, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._message = message

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label(self._message)
            with Horizontal():
                yield Button("はい / Yes [Y]", id="yes", variant="success")
                yield Button("いいえ / No [N]", id="no", variant="error")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        self.dismiss(event.button.id == "yes")

    def on_key(self, event: Any) -> None:
        if event.key in ("y", "Y", "enter"):
            self.dismiss(True)
        elif event.key in ("n", "N", "escape", "q"):
            self.dismiss(False)


# ---------------------------------------------------------------------------
# Help dialog
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Candidate list dialog
# ---------------------------------------------------------------------------


class CandidateListDialog(ModalScreen[int | None]):
    """A modal showing keyword-matched candidate comments for a stream.

    Returns the candidate ID if approved, or None if dismissed.
    """

    DEFAULT_CSS = """
    CandidateListDialog {
        align: center middle;
    }
    CandidateListDialog > Vertical {
        background: $surface;
        border: tall $primary;
        padding: 1 2;
        width: 80;
        height: 20;
    }
    CandidateListDialog Label#cand-title {
        text-align: center;
        text-style: bold;
        margin-bottom: 1;
    }
    CandidateListDialog DataTable {
        height: 1fr;
    }
    CandidateListDialog Horizontal {
        width: 100%;
        align: center middle;
        margin-top: 1;
    }
    CandidateListDialog Button {
        margin: 0 1;
    }
    """

    def __init__(self, candidates: list[dict], **kwargs) -> None:
        super().__init__(**kwargs)
        self._candidates = candidates

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("候選留言 (Candidate Comments)", id="cand-title")
            yield DataTable(id="cand-table", cursor_type="row")
            with Horizontal(id="cand-buttons"):
                yield Button("承認 / Approve", id="cand-approve", variant="success")
                yield Button("却下 / Reject", id="cand-reject", variant="error")

    def on_mount(self) -> None:
        table = self.query_one("#cand-table", DataTable)
        table.add_columns("ID", "著者", "キーワード", "状態", "プレビュー")
        for c in self._candidates:
            text_preview = (c.get("comment_text") or "")[:50].replace("\n", " ")
            if len(c.get("comment_text") or "") > 50:
                text_preview += "..."
            table.add_row(
                str(c["id"]),
                c.get("comment_author") or "",
                c.get("keywords_matched") or "",
                c.get("status", "pending"),
                text_preview,
            )

    def on_key(self, event: Any) -> None:
        if event.key == "escape":
            self.dismiss(None)

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        self._approve_selected()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "cand-approve":
            self._approve_selected()
        elif event.button.id == "cand-reject":
            self._reject_selected()

    def _get_selected_candidate_id(self) -> int | None:
        table = self.query_one("#cand-table", DataTable)
        if not self._candidates:
            return None
        row_idx = table.cursor_row
        if row_idx is not None and 0 <= row_idx < len(self._candidates):
            return self._candidates[row_idx]["id"]
        return None

    def _approve_selected(self) -> None:
        cand_id = self._get_selected_candidate_id()
        if cand_id is not None:
            self.dismiss(cand_id)

    def _reject_selected(self) -> None:
        from prismlens.cache import update_candidate_status

        cand_id = self._get_selected_candidate_id()
        if cand_id is None:
            return
        # Find the connection from the parent app
        app = self.app
        if hasattr(app, "_conn"):
            try:
                update_candidate_status(app._conn, cand_id, "rejected")
                # Remove from display and refresh
                self._candidates = [
                    c for c in self._candidates if c["id"] != cand_id
                ]
                table = self.query_one("#cand-table", DataTable)
                table.clear()
                for c in self._candidates:
                    text_preview = (c.get("comment_text") or "")[:50].replace("\n", " ")
                    if len(c.get("comment_text") or "") > 50:
                        text_preview += "..."
                    table.add_row(
                        str(c["id"]),
                        c.get("comment_author") or "",
                        c.get("keywords_matched") or "",
                        c.get("status", "pending"),
                        text_preview,
                    )
                self.notify("候補留言を却下しました")
            except (ValueError, KeyError) as exc:
                self.notify(f"エラー: {exc}", severity="error")


# ---------------------------------------------------------------------------
# Help dialog
# ---------------------------------------------------------------------------


class HelpDialog(ModalScreen[None]):
    """A modal screen showing keybinding help."""

    DEFAULT_CSS = """
    HelpDialog {
        align: center middle;
    }
    HelpDialog > Vertical {
        background: $surface;
        border: tall $primary;
        padding: 1 2;
        width: 70;
        height: auto;
    }
    HelpDialog Label {
        width: 100%;
        margin-bottom: 0;
    }
    HelpDialog #title {
        text-align: center;
        text-style: bold;
        margin-bottom: 1;
    }
    HelpDialog Button {
        margin-top: 1;
        align-horizontal: center;
    }
    """

    HELP_TEXT = """[bold]操作キー / Keybindings[/bold]

[bold cyan]場次操作 / Stream actions:[/bold cyan]
  [a]  確認 (Approve) — ストリームを承認
  [z]  取消承認 (Unapprove) — 承認を取り消して再審核
  [x]  排除 (Exclude) — ストリームを対象外にする
  [r]  再擷取 (Re-fetch) — コメント/説明を再取得して再解析
  [c]  候選留言 (Candidates) — キーワード一致コメントを表示
  [u]  URL複製 (Copy URL) — VODのYouTube URLをクリップボードにコピー

[bold cyan]歌曲操作 / Song actions:[/bold cyan]
  [e]  編輯 (Edit) — 選択した曲を編集
  [n]  新增 (New) — 新しい曲エントリを追加
  [d]  刪除 (Delete) — 選択した曲を削除（確認あり）
  [t]  終了時刻クリア (Clear Ends) — 全曲の終了時刻をクリア

[bold cyan]移動 / Navigation:[/bold cyan]
  [↑/↓]   場次・曲の選択
  [Tab]   場次リストと曲一覧の切り替え
  [[]      前の年 (Previous year)
  []]      次の年 (Next year)

[bold cyan]其他 / Other:[/bold cyan]
  [?]  このヘルプを表示
  [q]  終了

[bold]凡例 / Legend:[/bold]
  ●  approved（承認済み）
  ○  extracted（待審核）
  ◌  pending（待手動入力）
  ✕  excluded（排除済み）"""

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("PrismLens 幫助 / Help", id="title")
            yield Static(self.HELP_TEXT)
            yield Button("閉じる / Close [Esc]", id="close", variant="primary")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        self.dismiss(None)

    def on_key(self, event: Any) -> None:
        if event.key in ("escape", "q", "?"):
            self.dismiss(None)


# ---------------------------------------------------------------------------
# Edit song dialog
# ---------------------------------------------------------------------------


class EditSongDialog(ModalScreen[dict[str, Any] | None]):
    """Modal dialog for editing a single song entry."""

    DEFAULT_CSS = """
    EditSongDialog {
        align: center middle;
    }
    EditSongDialog > Vertical {
        background: $surface;
        border: tall $primary;
        padding: 1 2;
        width: 70;
        height: auto;
    }
    EditSongDialog Label.field-label {
        margin-top: 1;
    }
    EditSongDialog Input {
        margin-top: 0;
    }
    EditSongDialog .error {
        color: $error;
        margin-top: 0;
    }
    EditSongDialog Horizontal {
        width: 100%;
        align: center middle;
        margin-top: 1;
    }
    EditSongDialog Button {
        margin: 0 1;
    }
    """

    def __init__(
        self,
        song: dict[str, Any],
        title: str = "歌曲編輯 / Edit Song",
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._song = dict(song)
        self._title = title

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label(self._title, id="edit-title")
            yield Label("歌名 / Song Name:", classes="field-label")
            yield Input(
                value=self._song.get("song_name", ""),
                id="song-name",
                placeholder="歌名を入力...",
            )
            yield Label("原唱 / Artist:", classes="field-label")
            yield Input(
                value=self._song.get("artist", "") or "",
                id="artist",
                placeholder="アーティスト名（任意）",
            )
            yield Label("開始時刻 / Start Timestamp:", classes="field-label")
            yield Input(
                value=self._song.get("start_timestamp", ""),
                id="start-ts",
                placeholder="例: 0:03:20 または 3:20",
            )
            yield Label("終了時刻 / End Timestamp:", classes="field-label")
            yield Input(
                value=self._song.get("end_timestamp", "") or "",
                id="end-ts",
                placeholder="例: 0:08:15（空白で終端まで）",
            )
            yield Label("メモ / Note:", classes="field-label")
            yield Input(
                value=self._song.get("note", "") or "",
                id="note",
                placeholder="メモ（任意）",
            )
            yield Label("", id="ts-error", classes="error")
            with Horizontal():
                yield Button("保存 / Save [Enter]", id="save", variant="success")
                yield Button("キャンセル / Cancel [Esc]", id="cancel", variant="error")

    def on_key(self, event: Any) -> None:
        if event.key == "escape":
            self.dismiss(None)
        elif event.key == "enter":
            self._try_save()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "save":
            self._try_save()
        else:
            self.dismiss(None)

    def on_input_changed(self, event: Input.Changed) -> None:
        """Validate timestamps in real-time."""
        if event.input.id in ("start-ts", "end-ts"):
            self._validate_timestamps()

    def _validate_timestamps(self) -> None:
        start_input = self.query_one("#start-ts", Input)
        end_input = self.query_one("#end-ts", Input)
        error_label = self.query_one("#ts-error", Label)

        start_val = start_input.value.strip()
        end_val = end_input.value.strip()

        errors: list[str] = []
        if start_val and not is_valid_timestamp(start_val):
            errors.append("開始時刻の形式が無効です (例: 0:03:20)")
        if end_val and not is_valid_timestamp(end_val):
            errors.append("終了時刻の形式が無効です (例: 0:08:15)")

        error_label.update(" / ".join(errors) if errors else "")

    def _try_save(self) -> None:
        song_name = self.query_one("#song-name", Input).value.strip()
        artist = self.query_one("#artist", Input).value.strip()
        start_ts = self.query_one("#start-ts", Input).value.strip()
        end_ts = self.query_one("#end-ts", Input).value.strip()
        note = self.query_one("#note", Input).value.strip()

        # Validate
        errors: list[str] = []
        if not song_name:
            errors.append("歌名は必須です")
        if not start_ts:
            errors.append("開始時刻は必須です")
        elif not is_valid_timestamp(start_ts):
            errors.append("開始時刻の形式が無効です (例: 0:03:20)")
        if end_ts and not is_valid_timestamp(end_ts):
            errors.append("終了時刻の形式が無効です")

        error_label = self.query_one("#ts-error", Label)
        if errors:
            error_label.update(" / ".join(errors))
            return

        result = dict(self._song)
        result["song_name"] = song_name
        result["artist"] = artist or None
        result["start_timestamp"] = start_ts
        result["end_timestamp"] = end_ts or None
        result["note"] = note or None
        self.dismiss(result)


# ---------------------------------------------------------------------------
# Paste import dialog
# ---------------------------------------------------------------------------


class PasteImportDialog(ModalScreen[list[dict[str, Any]] | None]):
    """Modal dialog for pasting formatted song text and importing it."""

    DEFAULT_CSS = """
    PasteImportDialog {
        align: center middle;
    }
    PasteImportDialog > Vertical {
        background: $surface;
        border: tall $primary;
        padding: 1 2;
        width: 90;
        height: 30;
    }
    PasteImportDialog Label#paste-title {
        text-align: center;
        text-style: bold;
        margin-bottom: 1;
    }
    PasteImportDialog TextArea {
        height: 1fr;
    }
    PasteImportDialog .error {
        color: $error;
        margin-top: 0;
    }
    PasteImportDialog Horizontal {
        width: 100%;
        align: center middle;
        margin-top: 1;
    }
    PasteImportDialog Button {
        margin: 0 1;
    }
    """

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("貼り付けインポート / Paste Import", id="paste-title")
            yield Label(
                "タイムスタンプ付きの歌リストを貼り付けてください。\n"
                "形式: 5:30 歌名 - アーティスト",
                id="paste-hint",
            )
            yield TextArea(id="paste-area")
            yield Label("", id="paste-error", classes="error")
            with Horizontal():
                yield Button("解析＆インポート / Parse & Import", id="parse", variant="success")
                yield Button("キャンセル / Cancel [Esc]", id="cancel", variant="error")

    def on_key(self, event: Any) -> None:
        if event.key == "escape":
            self.dismiss(None)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "parse":
            self._try_parse()
        else:
            self.dismiss(None)

    def _try_parse(self) -> None:
        from prismlens.extraction import parse_text_to_songs

        text = self.query_one("#paste-area", TextArea).text.strip()
        if not text:
            self.query_one("#paste-error", Label).update("テキストが空です")
            return

        songs = parse_text_to_songs(text)
        if not songs:
            self.query_one("#paste-error", Label).update(
                "タイムスタンプが見つかりません"
            )
            return

        self.dismiss(songs)


# ---------------------------------------------------------------------------
# Main TUI App
# ---------------------------------------------------------------------------


class ReviewApp(App[None]):
    """PrismLens curator review TUI application."""

    TITLE = "PrismLens - 審核模式"
    CSS = """
    Screen {
        layout: vertical;
    }
    #main-area {
        layout: horizontal;
        height: 1fr;
    }
    #stream-panel {
        width: 35;
        min-width: 25;
        border-right: tall $primary;
    }
    #stream-header {
        background: $primary;
        color: $text;
        padding: 0 1;
        height: 1;
        text-style: bold;
    }
    #stream-list {
        height: 1fr;
        border: none;
    }
    #song-panel {
        width: 1fr;
    }
    #song-header {
        background: $primary;
        color: $text;
        padding: 0 1;
        height: 1;
        text-style: bold;
    }
    #song-table {
        height: 1fr;
    }
    #status-bar {
        background: $surface;
        border-top: tall $primary;
        padding: 0 1;
        height: 1;
    }
    #legend-bar {
        background: $surface;
        padding: 0 1;
        height: 1;
    }
    ListItem {
        padding: 0 1;
        height: 2;
    }
    ListItem.--highlight {
        background: $accent;
    }
    """

    BINDINGS = [
        Binding("a", "approve_stream", "確認", show=True),
        Binding("z", "unapprove_stream", "取消承認 (Unapprove)", show=True),
        Binding("x", "exclude_stream", "排除", show=True),
        Binding("e", "edit_song", "編輯", show=True),
        Binding("n", "new_song", "新增", show=True),
        Binding("d", "delete_song", "刪除", show=True),
        Binding("r", "refetch_stream", "再擷取", show=True),
        Binding("c", "show_candidates", "候選留言", show=True),
        Binding("p", "paste_songs", "貼上匯入", show=True),
        Binding("t", "clear_end_timestamps", "終了時刻クリア", show=True),
        Binding("u", "copy_vod_url", "複製URL", show=True),
        Binding("left_square_bracket", "prev_year", "前の年", show=False),
        Binding("right_square_bracket", "next_year", "次の年", show=False),
        Binding("question_mark", "show_help", "幫助", show=True),
        Binding("q", "quit", "終了", show=True),
    ]

    def __init__(
        self,
        conn: sqlite3.Connection,
        show_all: bool = False,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._conn = conn
        self._show_all = show_all
        self._all_streams: list[sqlite3.Row] = []  # Status-filtered master list
        self._streams: list[sqlite3.Row] = []  # Year-filtered display list
        self._current_stream_idx: int = -1
        self._songs: list[sqlite3.Row] = []
        self._selected_song_idx: int = -1
        self._focus_on_songs: bool = False  # Track which panel has logical focus
        self._year_filter: str | None = None  # None = all years, else "2024" etc.
        self._available_years: list[str] = []  # Unique years sorted DESC

    # -----------------------------------------------------------------------
    # Compose
    # -----------------------------------------------------------------------

    def compose(self) -> ComposeResult:
        yield Header(show_clock=False)
        with Horizontal(id="main-area"):
            with Vertical(id="stream-panel"):
                yield Static("場次列表", id="stream-header")
                yield ListView(id="stream-list")
            with Vertical(id="song-panel"):
                yield Static("歌曲明細", id="song-header")
                yield DataTable(id="song-table", cursor_type="row")
        yield Static("", id="status-bar")
        yield Static(
            "● approved  ○ extracted  ◌ pending  ✕ excluded",
            id="legend-bar",
        )
        yield Footer()

    # -----------------------------------------------------------------------
    # Lifecycle
    # -----------------------------------------------------------------------

    def on_mount(self) -> None:
        """Load initial data after app is mounted."""
        self._setup_song_table()
        self._load_streams()
        # Start with focus on stream list
        self.query_one("#stream-list", ListView).focus()

    def _setup_song_table(self) -> None:
        table = self.query_one("#song-table", DataTable)
        table.add_columns("#", "開始時刻", "終了時刻", "歌名", "原唱", "メモ")

    # -----------------------------------------------------------------------
    # Data loading
    # -----------------------------------------------------------------------

    def _load_streams(self) -> None:
        """Load streams from the database, apply status + year filters."""
        from prismlens.cache import list_streams

        if self._show_all:
            self._all_streams = list(list_streams(self._conn))
        else:
            all_streams = list(list_streams(self._conn))
            self._all_streams = [
                s for s in all_streams if s["status"] in REVIEWABLE_STATUSES
            ]

        # Extract unique years sorted DESC
        years: set[str] = set()
        for s in self._all_streams:
            d = s["date"]
            if d and len(d) >= 4 and d[:4].isdigit():
                years.add(d[:4])
        self._available_years = sorted(years, reverse=True)

        self._apply_year_filter()

    def _apply_year_filter(self) -> None:
        """Filter ``_all_streams`` by ``_year_filter`` and rebuild the list."""
        if self._year_filter is None:
            self._streams = list(self._all_streams)
        else:
            self._streams = [
                s for s in self._all_streams
                if s["date"] and s["date"][:4] == self._year_filter
            ]

        lv = self.query_one("#stream-list", ListView)
        lv.clear()

        for stream in self._streams:
            status = stream["status"] or "discovered"
            icon = STATUS_ICONS.get(status, "?")
            date = stream["date"] or "日付不明"
            if stream["date"] and stream["date_source"] != "precise":
                date = f"{date}~"
            title = stream["title"] or stream["video_id"] or "タイトル不明"
            if len(title) > 28:
                title = title[:25] + "..."
            label = f"{icon} {date}\n  {escape(title)}"
            lv.append(ListItem(Label(label)))

        self._update_stream_header()

        if self._streams:
            self._current_stream_idx = 0
            lv.index = 0
            self._load_songs(0)
        else:
            self._current_stream_idx = -1
            self._update_status_bar()

    def _update_stream_header(self) -> None:
        """Update the stream panel header with year filter and count."""
        header = self.query_one("#stream-header", Static)
        year_label = "全年" if self._year_filter is None else self._year_filter
        header.update(f"場次列表 [{year_label}] ({len(self._streams)})")

    def _cycle_year(self, direction: int) -> None:
        """Cycle the year filter.  *direction*: +1 = older / next, -1 = newer / prev."""
        # Sequence: None → newest → … → oldest → None (wrapping)
        options: list[str | None] = [None, *self._available_years]
        if not self._available_years:
            return
        try:
            idx = options.index(self._year_filter)
        except ValueError:
            idx = 0
        idx = (idx + direction) % len(options)
        self._year_filter = options[idx]
        self._apply_year_filter()

    def _load_songs(self, stream_idx: int) -> None:
        """Load songs for the stream at *stream_idx*."""
        from prismlens.cache import get_parsed_songs

        table = self.query_one("#song-table", DataTable)
        table.clear()

        if stream_idx < 0 or stream_idx >= len(self._streams):
            self._songs = []
            self._update_status_bar()
            return

        stream = self._streams[stream_idx]
        self._songs = list(get_parsed_songs(self._conn, stream["video_id"]))

        # Update song header with extraction source and attribution
        source = stream["source"] or "未設定"
        source_label_map = {
            "comment": "留言区",
            "description": "概要欄",
        }
        source_display = source_label_map.get(source, source)
        header = self.query_one("#song-header", Static)

        # Show comment author attribution when available
        comment_author = stream["comment_author"] if source == "comment" else None
        if comment_author:
            header.update(
                f"歌曲明細 — ソース: {source_display} — {len(self._songs)} 曲\n"
                f"  Timestamps by: {comment_author}"
            )
        else:
            header.update(f"歌曲明細 — ソース: {source_display} — {len(self._songs)} 曲")

        for song in self._songs:
            row_idx = song["order_index"] + 1
            table.add_row(
                str(row_idx),
                song["start_timestamp"] or "",
                song["end_timestamp"] or "—",
                song["song_name"] or "",
                song["artist"] or "",
                song["note"] or "",
            )

        self._selected_song_idx = 0 if self._songs else -1
        self._update_status_bar()

    def _update_status_bar(self) -> None:
        """Update the bottom status bar with context-relevant info."""
        bar = self.query_one("#status-bar", Static)

        if self._current_stream_idx < 0 or not self._streams:
            bar.update("[dim]場次がありません[/dim]")
            return

        stream = self._streams[self._current_stream_idx]
        status = stream["status"] or "unknown"
        icon = STATUS_ICONS.get(status, "?")
        status_label = STATUS_LABELS.get(status, status)
        title = stream["title"] or stream["video_id"] or ""
        if len(title) > 40:
            title = title[:37] + "..."
        bar.update(
            f"{icon} {escape(title)}  |  状態: {status_label}  |  "
            f"[dim]a:確認 z:取消 x:排除 e:編輯 n:新増 d:刪除 r:再擷取 c:候選 ?:幫助[/dim]"
        )

    # -----------------------------------------------------------------------
    # Event handlers
    # -----------------------------------------------------------------------

    def on_list_view_selected(self, event: ListView.Selected) -> None:
        """Handle stream selection changes."""
        lv = self.query_one("#stream-list", ListView)
        idx = lv.index
        if idx is not None and idx != self._current_stream_idx:
            self._current_stream_idx = idx
            self._load_songs(idx)

    def on_list_view_highlighted(self, event: ListView.Highlighted) -> None:
        """Handle stream highlight (cursor movement) changes."""
        lv = self.query_one("#stream-list", ListView)
        idx = lv.index
        if idx is not None and idx != self._current_stream_idx:
            self._current_stream_idx = idx
            self._load_songs(idx)

    def on_data_table_row_highlighted(self, event: DataTable.RowHighlighted) -> None:
        """Track the selected song row."""
        if event.cursor_row is not None:
            self._selected_song_idx = event.cursor_row

    # -----------------------------------------------------------------------
    # Actions
    # -----------------------------------------------------------------------

    def action_approve_stream(self) -> None:
        """Approve (mark as 'approved') the current stream."""
        if self._current_stream_idx < 0:
            return
        stream = self._streams[self._current_stream_idx]
        current_status = stream["status"]
        if current_status == "approved":
            self.notify("このストリームはすでに承認済みです。")
            return
        if current_status not in ("extracted", "pending"):
            self.notify(f"承認できません（状態: {current_status}）")
            return
        self._do_approve_stream(stream["video_id"])

    def _do_approve_stream(self, video_id: str) -> None:
        from prismlens.cache import update_stream_status, is_valid_transition, get_stream

        stream = get_stream(self._conn, video_id)
        if stream is None:
            return
        current = stream["status"]
        if not is_valid_transition(current, "approved"):
            self.notify(f"承認できません（{current} → approved は無効な遷移）")
            return
        try:
            update_stream_status(self._conn, video_id, "approved")
            self.notify("ストリームを承認しました ●")
            self._load_streams_preserving_selection()
        except (ValueError, KeyError) as exc:
            self.notify(f"エラー: {exc}", severity="error")

    def action_unapprove_stream(self) -> None:
        """Revert an approved stream back to extracted for re-review."""
        if self._current_stream_idx < 0:
            return
        stream = self._streams[self._current_stream_idx]
        video_id = stream["video_id"]
        self._do_unapprove_stream(video_id)

    def _do_unapprove_stream(self, video_id: str) -> None:
        from prismlens.cache import update_stream_status, is_valid_transition, get_stream

        stream = get_stream(self._conn, video_id)
        if stream is None:
            return
        current = stream["status"]
        if not is_valid_transition(current, "extracted"):
            self.notify(f"取消承認できません（{current} → extracted は無効な遷移）")
            return
        try:
            update_stream_status(self._conn, video_id, "extracted")
            self.notify("承認を取り消しました ○")
            self._load_streams_preserving_selection()
        except (ValueError, KeyError) as exc:
            self.notify(f"エラー: {exc}", severity="error")

    def action_exclude_stream(self) -> None:
        """Exclude the current stream."""
        if self._current_stream_idx < 0:
            return
        stream = self._streams[self._current_stream_idx]
        current_status = stream["status"]
        if current_status == "excluded":
            self.notify("このストリームはすでに排除済みです。")
            return

        def _confirm_callback(confirmed: bool) -> None:
            if confirmed:
                self._do_exclude_stream(stream["video_id"])

        self.push_screen(
            ConfirmDialog(f"このストリームを排除しますか?\n{stream['title'] or stream['video_id']}"),
            _confirm_callback,
        )

    def _do_exclude_stream(self, video_id: str) -> None:
        from prismlens.cache import update_stream_status, is_valid_transition, get_stream

        stream = get_stream(self._conn, video_id)
        if stream is None:
            return
        current = stream["status"]
        if not is_valid_transition(current, "excluded"):
            self.notify(f"排除できません（{current} → excluded は無効な遷移）")
            return
        try:
            update_stream_status(self._conn, video_id, "excluded")
            self.notify("ストリームを排除しました ✕")
            self._load_streams_preserving_selection()
        except (ValueError, KeyError) as exc:
            self.notify(f"エラー: {exc}", severity="error")

    def action_edit_song(self) -> None:
        """Open the edit dialog for the currently selected song."""
        if not self._songs or self._selected_song_idx < 0:
            # If no songs yet, open a new song dialog
            self.action_new_song()
            return
        if self._selected_song_idx >= len(self._songs):
            return

        song = self._songs[self._selected_song_idx]
        song_dict = dict(song)

        def _save_callback(result: dict[str, Any] | None) -> None:
            if result is not None:
                self._save_edited_song(self._selected_song_idx, result)

        self.push_screen(
            EditSongDialog(song_dict, title="歌曲編輯 / Edit Song"),
            _save_callback,
        )

    def _save_edited_song(self, song_idx: int, updated: dict[str, Any]) -> None:
        """Persist edited song data to the database."""
        from prismlens.cache import upsert_parsed_songs

        if self._current_stream_idx < 0:
            return

        stream = self._streams[self._current_stream_idx]
        video_id = stream["video_id"]

        # Build updated song list
        songs_data = []
        for i, song in enumerate(self._songs):
            if i == song_idx:
                songs_data.append({
                    "order_index": song["order_index"],
                    "song_name": updated["song_name"],
                    "artist": updated.get("artist"),
                    "start_timestamp": updated["start_timestamp"],
                    "end_timestamp": updated.get("end_timestamp"),
                    "note": updated.get("note"),
                })
            else:
                songs_data.append({
                    "order_index": song["order_index"],
                    "song_name": song["song_name"],
                    "artist": song["artist"],
                    "start_timestamp": song["start_timestamp"],
                    "end_timestamp": song["end_timestamp"],
                    "note": song["note"],
                })

        try:
            upsert_parsed_songs(self._conn, video_id, songs_data)
            self.notify("歌曲を保存しました")
            self._load_songs(self._current_stream_idx)
        except Exception as exc:  # noqa: BLE001
            self.notify(f"保存エラー: {exc}", severity="error")

    def action_new_song(self) -> None:
        """Add a new song entry at/after the current position."""
        if self._current_stream_idx < 0:
            return

        # Prepare a blank song dict
        empty_song: dict[str, Any] = {
            "song_name": "",
            "artist": "",
            "start_timestamp": "",
            "end_timestamp": "",
            "note": "",
            "order_index": len(self._songs),
        }

        def _save_callback(result: dict[str, Any] | None) -> None:
            if result is not None:
                self._insert_new_song(result)

        self.push_screen(
            EditSongDialog(empty_song, title="新增歌曲 / Add Song"),
            _save_callback,
        )

    def _insert_new_song(self, new_song: dict[str, Any]) -> None:
        """Insert a new song into the database at the appropriate position."""
        from prismlens.cache import upsert_parsed_songs, update_stream_status, get_stream, is_valid_transition

        if self._current_stream_idx < 0:
            return

        stream = self._streams[self._current_stream_idx]
        video_id = stream["video_id"]

        # Determine insert position: after selected song, or at end
        insert_after = self._selected_song_idx
        if insert_after < 0 or not self._songs:
            insert_after = len(self._songs) - 1

        # Build new song list with insertion
        songs_data: list[dict[str, Any]] = []
        inserted = False
        next_idx = 0

        for i, song in enumerate(self._songs):
            songs_data.append({
                "order_index": next_idx,
                "song_name": song["song_name"],
                "artist": song["artist"],
                "start_timestamp": song["start_timestamp"],
                "end_timestamp": song["end_timestamp"],
                "note": song["note"],
            })
            next_idx += 1
            if i == insert_after and not inserted:
                songs_data.append({
                    "order_index": next_idx,
                    "song_name": new_song["song_name"],
                    "artist": new_song.get("artist"),
                    "start_timestamp": new_song["start_timestamp"],
                    "end_timestamp": new_song.get("end_timestamp"),
                    "note": new_song.get("note"),
                })
                next_idx += 1
                inserted = True

        if not inserted:
            # Append at end if list was empty or insert point not reached
            songs_data.append({
                "order_index": next_idx,
                "song_name": new_song["song_name"],
                "artist": new_song.get("artist"),
                "start_timestamp": new_song["start_timestamp"],
                "end_timestamp": new_song.get("end_timestamp"),
                "note": new_song.get("note"),
            })

        try:
            upsert_parsed_songs(self._conn, video_id, songs_data)
            # If stream was "pending", and songs have been added, we can keep "pending"
            # The curator will approve manually when done
            self.notify("歌曲を追加しました")
            self._load_songs(self._current_stream_idx)
        except Exception as exc:  # noqa: BLE001
            self.notify(f"追加エラー: {exc}", severity="error")

    def action_delete_song(self) -> None:
        """Delete the currently selected song (with confirmation)."""
        if not self._songs or self._selected_song_idx < 0:
            self.notify("削除する曲が選択されていません")
            return
        if self._selected_song_idx >= len(self._songs):
            return

        song = self._songs[self._selected_song_idx]
        song_name = song["song_name"] or "（無題）"

        def _confirm_callback(confirmed: bool) -> None:
            if confirmed:
                self._do_delete_song(self._selected_song_idx)

        self.push_screen(
            ConfirmDialog(f"この曲を削除しますか?\n「{song_name}」"),
            _confirm_callback,
        )

    def _do_delete_song(self, song_idx: int) -> None:
        """Remove the song at *song_idx* and reindex."""
        from prismlens.cache import upsert_parsed_songs

        if self._current_stream_idx < 0:
            return

        stream = self._streams[self._current_stream_idx]
        video_id = stream["video_id"]

        songs_data: list[dict[str, Any]] = []
        for i, song in enumerate(self._songs):
            if i == song_idx:
                continue  # Skip the deleted song
            songs_data.append({
                "order_index": len(songs_data),
                "song_name": song["song_name"],
                "artist": song["artist"],
                "start_timestamp": song["start_timestamp"],
                "end_timestamp": song["end_timestamp"],
                "note": song["note"],
            })

        try:
            upsert_parsed_songs(self._conn, video_id, songs_data)
            self.notify("歌曲を削除しました")
            self._load_songs(self._current_stream_idx)
        except Exception as exc:  # noqa: BLE001
            self.notify(f"削除エラー: {exc}", severity="error")

    def action_clear_end_timestamps(self) -> None:
        """Clear all end timestamps for the current stream (with confirmation)."""
        if self._current_stream_idx < 0:
            return

        stream = self._streams[self._current_stream_idx]

        def _confirm_callback(confirmed: bool) -> None:
            if confirmed:
                self._do_clear_end_timestamps()

        self.push_screen(
            ConfirmDialog(
                "全曲の終了時刻をクリアしますか?\n"
                f"{stream['title'] or stream['video_id']}"
            ),
            _confirm_callback,
        )

    def _do_clear_end_timestamps(self) -> None:
        """Clear all end_timestamp values for the current stream's songs."""
        from prismlens.cache import clear_all_end_timestamps

        if self._current_stream_idx < 0:
            return

        stream = self._streams[self._current_stream_idx]
        video_id = stream["video_id"]

        try:
            count = clear_all_end_timestamps(self._conn, video_id)
            self.notify(f"終了時刻を{count}件クリアしました")
            self._load_songs(self._current_stream_idx)
        except Exception as exc:  # noqa: BLE001
            self.notify(f"クリアエラー: {exc}", severity="error")

    def action_refetch_stream(self) -> None:
        """Re-fetch and re-extract timestamps for the current stream."""
        if self._current_stream_idx < 0:
            return

        stream = self._streams[self._current_stream_idx]

        def _confirm_callback(confirmed: bool) -> None:
            if confirmed:
                self._do_refetch_stream(stream["video_id"])

        self.push_screen(
            ConfirmDialog(
                "このストリームのコメント/説明を再取得しますか?\n"
                "既存の解析データは上書きされます。\n"
                f"{stream['title'] or stream['video_id']}"
            ),
            _confirm_callback,
        )

    def _do_refetch_stream(self, video_id: str) -> None:
        """Perform the actual re-fetch operation."""
        from prismlens.extraction import extract_timestamps
        from prismlens.cache import update_stream_status, get_stream, is_valid_transition

        self.notify("再取得中...")
        try:
            result = extract_timestamps(self._conn, video_id)
            if result.status == "extracted":
                source_label = "留言区" if result.source == "comment" else "概要欄"
                self.notify(
                    f"再取得完了: {source_label}から {len(result.songs)} 曲を抽出",
                    severity="information",
                )
            else:
                self.notify(
                    "再取得完了: タイムスタンプを自動抽出できませんでした（pending）",
                    severity="warning",
                )
            self._load_streams_preserving_selection()
            self._load_songs(self._current_stream_idx)
        except KeyError as exc:
            self.notify(f"再取得エラー: {exc}", severity="error")
        except Exception as exc:  # noqa: BLE001
            self.notify(f"再取得エラー: {exc}", severity="error")

    def action_show_candidates(self) -> None:
        """Show candidate comments for the current stream."""
        if self._current_stream_idx < 0:
            self.notify("場次が選択されていません")
            return

        from prismlens.cache import list_candidate_comments

        stream = self._streams[self._current_stream_idx]
        video_id = stream["video_id"]

        rows = list_candidate_comments(self._conn, video_id=video_id)
        if not rows:
            self.notify("この場次の候補留言はありません")
            return

        candidates = [dict(r) for r in rows]

        def _candidate_callback(candidate_id: int | None) -> None:
            if candidate_id is not None:
                self._do_approve_candidate(video_id, candidate_id)

        self.push_screen(CandidateListDialog(candidates), _candidate_callback)

    def _do_approve_candidate(self, video_id: str, candidate_id: int) -> None:
        """Re-extract from the approved candidate and refresh."""
        from prismlens.extraction import extract_from_candidate

        try:
            result = extract_from_candidate(self._conn, video_id, candidate_id)
            if result.songs:
                self.notify(
                    f"候補留言から {len(result.songs)} 曲を抽出しました",
                    severity="information",
                )
                self._load_streams_preserving_selection()
                self._load_songs(self._current_stream_idx)
            else:
                self.notify(
                    "この候補留言からタイムスタンプを抽出できませんでした",
                    severity="warning",
                )
        except (KeyError, ValueError) as exc:
            self.notify(f"エラー: {exc}", severity="error")

    def action_copy_vod_url(self) -> None:
        """Copy the YouTube VOD URL for the current stream to clipboard."""
        if self._current_stream_idx < 0:
            return
        video_id = self._streams[self._current_stream_idx]["video_id"]
        url = f"https://www.youtube.com/watch?v={video_id}"
        import sys
        if sys.platform == "darwin":
            import subprocess
            try:
                subprocess.run(
                    ["pbcopy"],
                    input=url.encode(),
                    check=True,
                    timeout=2,
                )
            except (subprocess.SubprocessError, FileNotFoundError, OSError):
                self.copy_to_clipboard(url)  # fallback to OSC 52
        else:
            self.copy_to_clipboard(url)
        self.notify(f"URLをコピーしました: {url}")

    def action_paste_songs(self) -> None:
        """Open paste import dialog to add songs from pasted text."""
        if self._current_stream_idx < 0:
            self.notify("場次が選択されていません")
            return

        def _paste_callback(songs: list[dict[str, Any]] | None) -> None:
            if songs is None:
                return
            # Check if stream already has songs — confirm overwrite
            if self._songs:
                def _confirm_callback(confirmed: bool) -> None:
                    if confirmed:
                        self._do_paste_songs(songs)

                self.push_screen(
                    ConfirmDialog(
                        f"既存の曲を上書きしますか？({len(self._songs)}曲)"
                    ),
                    _confirm_callback,
                )
            else:
                self._do_paste_songs(songs)

        self.push_screen(PasteImportDialog(), _paste_callback)

    def _do_paste_songs(self, songs: list[dict[str, Any]]) -> None:
        """Persist pasted songs to the database."""
        from prismlens.cache import upsert_parsed_songs, update_stream_status, get_stream, is_valid_transition
        from prismlens.extraction import _songs_to_cache_format

        if self._current_stream_idx < 0:
            return

        stream = self._streams[self._current_stream_idx]
        video_id = stream["video_id"]

        songs_data = _songs_to_cache_format(songs, video_id)

        try:
            upsert_parsed_songs(self._conn, video_id, songs_data)

            # Transition pending/discovered → extracted
            current_stream = get_stream(self._conn, video_id)
            if current_stream:
                current_status = current_stream["status"]
                if current_status in ("pending", "discovered") and is_valid_transition(current_status, "extracted"):
                    update_stream_status(self._conn, video_id, "extracted")

            self._load_streams_preserving_selection()
            self._load_songs(self._current_stream_idx)
            self.notify(f"{len(songs)}曲を貼り付けました")
        except Exception as exc:  # noqa: BLE001
            self.notify(f"貼り付けエラー: {exc}", severity="error")

    def action_prev_year(self) -> None:
        """Cycle to newer year / All."""
        self._cycle_year(-1)

    def action_next_year(self) -> None:
        """Cycle to older year / All."""
        self._cycle_year(1)

    def action_show_help(self) -> None:
        """Show the help dialog."""
        self.push_screen(HelpDialog())

    def action_quit(self) -> None:
        """Exit the TUI."""
        self.exit()

    # -----------------------------------------------------------------------
    # Helpers
    # -----------------------------------------------------------------------

    def _load_streams_preserving_selection(self) -> None:
        """Reload stream list, trying to keep the current selection."""
        current_video_id: str | None = None
        old_index = self._current_stream_idx
        if old_index >= 0 and self._streams:
            current_video_id = self._streams[old_index]["video_id"]

        self._load_streams()

        # Try to restore selection by video_id
        if current_video_id:
            for i, s in enumerate(self._streams):
                if s["video_id"] == current_video_id:
                    self._current_stream_idx = i
                    lv = self.query_one("#stream-list", ListView)
                    lv.index = i
                    self._load_songs(i)
                    return
            # Stream no longer in list (e.g. excluded) — select nearest item
            if self._streams:
                new_idx = min(old_index, len(self._streams) - 1)
                self._current_stream_idx = new_idx
                lv = self.query_one("#stream-list", ListView)
                lv.index = new_idx
                self._load_songs(new_idx)


# ---------------------------------------------------------------------------
# Public launch function
# ---------------------------------------------------------------------------


def launch_review_tui(
    conn: sqlite3.Connection,
    show_all: bool = False,
) -> None:
    """Launch the review TUI application.

    Parameters
    ----------
    conn:
        Open SQLite connection (from :func:`cache.open_db`).
    show_all:
        If True, show all streams regardless of status.
        If False (default), show only reviewable statuses.
    """
    app = ReviewApp(conn=conn, show_all=show_all)
    app.run()
