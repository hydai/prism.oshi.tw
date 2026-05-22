# Crystal UI — Redesign Brief

> **Purpose of this doc.** A faithful description of Crystal's current public UI plus the goals driving its redesign, written for a designer who hasn't seen the code. Goals come first; the current-state documentation is context so the designer can see what to preserve, what to evolve, and what to let go of.
>
> Scope: **public pages only** — the submission form at `/` and the Q&A browser at `/qa`. The admin `CrystalTickets` page is already documented in [`admin-ui-spec.md`](./admin-ui-spec.md) (lines 887–944) and is out of scope here.
>
> Source of truth: `tools/crystal/src/` in this repository. All code citations use `path:line` so the designer (or next developer) can jump straight to the source.

---

## 1. Overview

**Crystal** is a standalone Cloudflare Worker (Hono framework) deployed at `crystal.oshi.tw`. It is Prism's public feedback inbox and Q&A browser: viewers submit bug reports, feature requests, UI issues, or general questions; curators reply; approved threads become a public Q&A archive.

It sits alongside three sibling surfaces in the Prism ecosystem:
- **Prism** (`prism.oshi.tw`) — the main static VTuber song archive (Next.js, static export).
- **Nova** (`nova.oshi.tw`) — VTuber/VOD submission forms (CF Worker).
- **Aurora** (CF Pages) — interactive VOD timestamp editor.
- **Crystal** (`crystal.oshi.tw`) — this system.

All four share the same brand palette foundations (purple + blue gradients, DM Sans, glassmorphism). Crystal is the last of the four to receive a dedicated design pass.

Data lives in a single D1 database (`oshi-crystal`) with one table: `tickets`. The public worker renders HTML server-side as template literals with inline `<style>` blocks; there is no framework, bundler, or separate stylesheet on the public side. See `tools/crystal/schema.sql` for the table shape; see `tools/crystal/src/index.ts` for the five routes (`/`, `/qa`, `POST /api/submit`, `GET /api/qa`, `GET /api/similar`).

Language: **Traditional Chinese (zh-Hant)** throughout. All copy in this document is quoted verbatim from the source.

---

## 2. Redesign Goals

These three goals are the north star. Every design decision should trace back to one of them.

### G1 — Visual Refresh / Brand Alignment
Bring Crystal visually in line with Prism / Nova / Aurora. The current palette and typography share roots with the siblings, but nothing has been formalized: tokens are duplicated across both pages and some are dead (see §6.3). A unified design system — or at least a Crystal-specific token set that knowingly maps to the shared brand — would make future changes propagate rather than fork.
- Consolidate the token set (one source, not duplicated per page).
- Reconcile hardcoded one-off colors (success/error/pending amber) into the token system.
- Decide whether glassmorphism is still the brand direction, or whether Crystal evolves toward a different surface language.

### G2 — Improve Submission UX
The form works but is fairly stark. Reduce friction and reduce duplicate tickets.
- Clearer guidance on what belongs in each field (especially "title vs body" and "public reply vs contact").
- Stronger states: loading, success, error. The current success is a one-line green banner — consider a more celebratory / confirmation-y moment.
- Make the duplicate-detection panel (added in commit `67d4eda`) feel like help, not clutter. Today it appears abruptly the moment enough characters are typed; it could use softer entry, clearer labeling, and a more obvious CTA for "yes, this is my issue."
- Lean into the `?ref=` context-URL plumbing (dormant today) so users can submit from a specific page with provenance attached.

### G3 — Improve Q&A Discoverability
The Q&A browser lists replied tickets in reverse chronological order with a plain keyword search and four type pills. That's thin.
- Search-result quality is already reasonable server-side (scored LIKE search with title-prefix bonus — `tools/crystal/src/db.ts:68-152`), but the UI hides this. There is no live suggestion, no result count, no "why this matched" hint.
- Empty states are minimal. There is no suggested content, no popular questions, no related tickets.
- No category beyond `type`. Tags, streamer attribution, or topic clustering would help browse as well as search.
- No "link to this question" or permalink UX — each ticket is an in-card element, not its own page or anchor.

---

## 3. Primary User Journeys

### Journey A — First-time submitter
**Goal:** report a bug, request a feature, or file a UI issue.

1. User arrives at `crystal.oshi.tw/`. No login, no onboarding. The page is a single centered column with a logo header, a tagline, and a glass form card. See `tools/crystal/src/form-page.ts:245` (container wrapper).
2. **Type selector** — 4-button grid. Default: `Bug 回報` is active. Labels: `Bug 回報 / 功能建議 / UI 問題 / 其他` (`form-page.ts:290-293`).
3. **Title** — single-line input, `maxlength="200"`, placeholder `簡短描述問題或建議` (`form-page.ts:300`).
4. As the user types the title, the **similar-panel** appears directly below the input showing up to 5 matching existing tickets (§4.5). Users can dismiss this panel.
5. **Body** — textarea, 5 rows, placeholder `請描述你遇到的問題或想要的功能…` (`form-page.ts:314`).
6. **Nickname** — optional, `maxlength="50"`, placeholder `選填，Q&A 公開回覆時顯示` (`form-page.ts:320`). Blank nicknames render as `匿名` on the Q&A.
7. **Public-reply toggle** — card-shaped checkbox, **checked by default** (`form-page.ts:326`). Label `允許公開回覆`; hint `勾選後你的問題與官方回覆將顯示在 Q&A 頁面`.
8. If the toggle is **unchecked**, the **contact** field slides open (animated `max-height` + `opacity`, 0.3s ease — `form-page.ts:153-155`). Contact becomes required. Placeholder `Email / Discord / Twitter 等，讓我們能回覆你`.
9. **Turnstile** widget (Cloudflare's human-verification challenge) with `data-theme="auto"` (`form-page.ts:342`).
10. **Submit** — full-width purple→blue gradient button `送出回報` (`form-page.ts:345`).
11. **Success** — green banner `感謝你的回報！編號：crys-xxxxxxxx`. Form resets, Bug type reactivated, contact hidden, Turnstile re-issues (`form-page.ts:530-542`).
12. **Error** — red banner with server-returned error messages joined by `、` (`form-page.ts:543-547`).

**Friction points / opportunities (→ goals):**
- No indication of typical response time. User submits and waits in silence. [G2]
- "Public reply" defaults to on, but the consequence isn't explained until the toggle hint. A visual preview of how the Q&A entry will look could help. [G2, G3]
- Success banner is easy to miss — it's a single-line toast-style message. Consider a dedicated confirmation state with ticket ID prominently shown and "save this ID" guidance. [G2]
- Users who chose NOT to publish their ticket have no way to check status later — there's no ID-lookup UI. [G2]
- Crystal and its siblings (Prism, Nova) are linked in the footer but the experience is unconnected. A returning user has no "welcome back" thread. [G1, G2]

### Journey B — Answer seeker
**Goal:** find an existing answer.

1. User arrives at `/qa` (via cross-link `查看 Q&A` from form, or directly). Centered column, slightly wider than form (720 px vs 640 px — `qa-page.ts:204`).
2. Same logo header, but wordmark reads `Crystal Q&A` (`qa-page.ts:224`). Subtitle: `已回覆的問題與建議`.
3. **Search** — a pill-shaped input with a leading magnifier icon and placeholder `搜尋問題…（按 Enter 搜尋）` (`qa-page.ts:242-250`). Implemented as a plain `<form method="get">` — press Enter to submit, full page reload. No live search, no type-ahead.
4. **Filter bar** — 5 pill anchors: `全部 / Bug / 功能建議 / UI / 其他` (`qa-page.ts:255-261`). Selected chip uses the purple→blue gradient. Clicking a chip navigates with the `type` query param preserved.
5. **Ticket cards** — a column with `gap: 16px`. Each card: type badge + status badge + `nickname · YYYY-MM-DD` (top row), title (h3), body (paragraph with `\n → <br/>`), and a purple-left-border `admin-reply` panel showing the curator's response and its date. See `qa-page.ts:49-83`.
6. **Pagination** — only rendered when there's more than one page. Row of 36×36 square buttons (`qa-page.ts:279-283`). Active page uses the gradient; others are frosted glass.
7. **Empty states** (`qa-page.ts:263-275`):
   - With query: `找不到符合「{q}」的結果` + a `清除搜尋` link that drops the `q` param but keeps the type filter.
   - Without query: `目前還沒有已回覆的問題`.
8. **Cross-links** + footer: `提交新回報 | 前往 Prism 歌單` and tagline `Prism — 為你喜愛的 VTuber 打造歌單頁面`.

**Friction points / opportunities (→ goals):**
- Press-Enter-to-search is unusual on modern UIs. No scent that you need to press Enter; no loading state. [G3]
- No result count ("找到 12 筆結果"), no score/match-reason hints. Search ranking is sophisticated internally but invisible externally. [G3]
- Empty state offers only "clear search" — no suggestions, no popular questions, no "didn't find it? submit a new one" CTA linking to `/`. [G2, G3]
- Tickets are not independently linkable — no permalink or anchor per card. [G3]
- No way to sort (always `replied_at DESC`). No way to see *your* submissions. [G3]
- Filter bar is a single axis (type). Status (replied vs closed) isn't surfaced — both appear intermixed. [G3]

### Journey C — Duplicate dissuasion
**Goal:** let submitters discover that their issue already exists *before* they finish writing.

1. User starts typing the title on `/`. Debounce fires 250 ms after each keystroke (`form-page.ts:377, 400`).
2. Minimum query length: **2 chars if the query contains any CJK codepoint, else 3 chars** (`form-page.ts:378, 394-396`). This is the key localization rule — Chinese 2-character compounds (e.g. `登入`) are often meaningful and shouldn't be discarded like short Latin strings.
3. Below the threshold: nothing happens. Above: `fetch('/api/similar?q=…&limit=5')` with an `AbortController` that cancels any in-flight request from the previous keystroke (`form-page.ts:401-406`).
4. Server handles this at `tools/crystal/src/index.ts:73-99`, running the same scored LIKE search as the Q&A but in `public_all` scope — so **pending tickets show up**, not just replied ones. Response is lean (`id, type, title, status, replied_at, submitted_at`) — no body, no contact, no admin reply, for PII + payload reasons.
5. The panel renders inside the form, directly below the title input (`form-page.ts:301-308`). Header: `類似的既有回報 (N)` with an inline `隱藏` dismiss button.
6. Each row shows: type badge + status badge + truncated title.
7. **Interaction rule** (intentional, encoded in the client — `form-page.ts:452-466`):
   - If status is `replied` or `closed`: the row is wrapped in `<a href="/qa?q={title}" target="_blank">`. Clicking opens the Q&A pre-filtered to this question's title.
   - If status is `pending`: the row is **inert** — it's a signal ("someone reported this already, but we haven't answered yet"), not a link to a dead end.
8. The `隱藏` button sets a per-session dismissed flag so the panel stays hidden until the user edits the title again (`form-page.ts:385-391`).

**Friction points / opportunities (→ goals):**
- The panel's appearance is abrupt — it pops in with no transition. Subtler entry would read as "helping" rather than "interrupting." [G2]
- Inert pending rows look identical to linked ones (same row structure). Users may try clicking and get confused. Consider a visual affordance difference: "⏳ reported, awaiting reply" vs "→ see answer". [G2, G3]
- No result states are differentiated beyond "has results / has no results". "3 similar — 2 answered, 1 pending" would be useful summary. [G2]
- "Is this my issue?" is the core decision, but the panel doesn't lead the user toward that decision — no "this is the same, don't submit" CTA. [G2]

---

## 4. Page 1: Submission Form (`/`)

### 4.1 Layout & chrome
- Document language: `zh-Hant` (`form-page.ts:6`).
- Font: **DM Sans** (Google Fonts, weights 400/500/600/700 + italic 400), preconnected (`form-page.ts:11-13`).
- Page background: **135° linear gradient**, `#FFF0F5` → `#F0F8FF` → `#E6E6FA` (lavender → alice blue → lavender), `background-attachment: fixed` (`form-page.ts:45-47`). In dark mode: `#0F0A1A` → `#0D1117` → `#0A0E1A` (`theme.ts:15-17`).
- Content container: **`max-width: 640px; margin: 0 auto; padding: 48px 16px`** (`form-page.ts:245`).
- Turnstile challenge script loaded asynchronously from `https://challenges.cloudflare.com/turnstile/v0/api.js` (`form-page.ts:15`).
- No-flash dark-mode detect script runs inline in `<head>` before body paint (`form-page.ts:14` + `theme.ts:51`).

### 4.2 Sections (top to bottom)
1. **Logo header** (`form-page.ts:247-273`)
   - 40×40 rounded tile with `radius-lg` (12px), gradient background `var(--accent-purple-light) → var(--accent-blue-light)`, containing a 22×22 white-stroke SVG of three stacked diamonds (layers icon, `M12 2L2 7l10 5 10-5-10-5z` + two more paths — `form-page.ts:254-258`).
   - Wordmark text `Prism Crystal`, 28 px, weight 700, letter-spacing `-0.5px`, purple→blue 135° gradient clipped onto the text (`form-page.ts:260-265`).
   - **Theme toggle** — absolutely positioned to the right of the header row (`form-page.ts:266-268`, `theme.ts:53-99`). See §6.7.
   - Tagline paragraph, 14 px, `--text-secondary`: `回報問題或建議新功能，幫助我們讓 Prism 更好`.

2. **Glass form card** (`form-page.ts:275-349`)
   - Background `var(--bg-surface-glass)` (white at 40% alpha in light mode); `backdrop-filter: blur(16px)`.
   - Border: `1px solid var(--border-glass)`.
   - `border-radius: var(--radius-2xl)` (20 px), `padding: 32px`, `box-shadow: 0 8px 32px rgba(0,0,0,0.06)`.
   - Contains the entire `<form id="crystal-form">` with `display: flex; flex-direction: column; gap: 20px`.

3. **Cross-links row** (`form-page.ts:351-357`)
   - Centered flex row, `gap: 16px`, 13 px.
   - `查看 Q&A` (internal) | `提議新 VTuber` (→ `nova.oshi.tw`, new tab) | `前往 Prism 歌單` (→ `prism.oshi.tw`, new tab).
   - Purple links, separated by `--text-tertiary` pipe characters.

4. **Footer tagline** (`form-page.ts:358-360`): 11 px, tertiary, centered — `Prism — 為你喜愛的 VTuber 打造歌單頁面`.

### 4.3 Form fields

| # | Field | Kind | Required | Maxlen | Placeholder | Default |
|---|-------|------|----------|--------|-------------|---------|
| 1 | `類型 *` | 4 toggle buttons (grid) | Yes | — | — | `bug` active (`form-page.ts:290`) |
| 2 | `標題 *` | `<input type=text>` | Yes | 200 | `簡短描述問題或建議` | empty |
| 3 | `詳細描述 *` | `<textarea rows=5>` | Yes | — | `請描述你遇到的問題或想要的功能…` | empty |
| 4 | `暱稱` | `<input type=text>` | No | 50 | `選填，Q&A 公開回覆時顯示` | empty |
| 5 | `允許公開回覆` | checkbox (card-shaped) | — | — | label `允許公開回覆`; hint `勾選後你的問題與官方回覆將顯示在 Q&A 頁面` | **checked** (`form-page.ts:326`) |
| 6 | `聯絡方式 *` | `<input type=text>` (conditional) | Yes **when step 5 is unchecked** | — | `Email / Discord / Twitter 等，讓我們能回覆你`; hint `不公開回覆時必須提供聯絡方式` | hidden |
| 7 | Turnstile | CF challenge widget | Yes | — | `data-theme="auto"` | — |
| 8 | Submit | full-width button | — | — | label `送出回報` (`form-page.ts:345`) | idle |

Hidden payload fields added at submit time (`form-page.ts:510-519`):
- `context_url` — read from `?ref=` query param via `getContextUrl()` at `form-page.ts:491-494`. **Currently dormant** — the main site doesn't append `?ref=` on its Crystal links.
- `turnstile_token` — read from the `[name="cf-turnstile-response"]` hidden input the widget injects.

### 4.4 Validation

Client-side (HTML5 + JS):
- `required` attributes on title / body (`form-page.ts:300, 314`).
- `maxlength` enforced on title (200) and nickname (50).
- JS checks `cf-turnstile-response` exists before POSTing; if not, shows `請完成人機驗證` (`form-page.ts:502-507`).

Server-side (`tools/crystal/src/validate.ts`):
| Condition | Error message (verbatim zh-Hant) |
|-----------|----------------------------------|
| Title missing/empty | `標題為必填` |
| Body missing/empty | `描述為必填` |
| Invalid type | `類型無效，請選擇 bug / feat / ui / other` |
| Turnstile token missing | `請完成驗證` |
| Non-public reply without contact | `不公開回覆時，聯絡方式為必填（讓我們能回覆你）` |
| Turnstile verification failed | `驗證失敗，請重試` (from `index.ts:32`) |
| Network error | `網路錯誤，請稍後再試` (client catch at `form-page.ts:549`) |
| Unknown server error | `提交失敗` (fallback at `form-page.ts:544`) |

All validation errors returned in one response as `400 { errors: string[] }`. Client joins with `、`.

### 4.5 Similar panel (duplicate detection)

The newest and most nuanced feature — added in commit `67d4eda`. Sits directly below the title input; behavior detailed in Journey C (§3).

**Visual spec** (`form-page.ts:181-236`):
- Container: frosted glass (`--bg-surface-frosted`), `1px solid var(--border-glass)`, `radius-lg` (12 px), `padding: 12px`, `margin-top: 10px`.
- Header row: `類似的既有回報` (12 px secondary) + `(N)` (tertiary) + `隱藏` dismiss button (pushed right with `margin-left: auto`, 11 px tertiary, no border, hover `rgba(0,0,0,0.04)` light / `rgba(255,255,255,0.06)` dark).
- Row container: flex column, `gap: 6px`.
- Each row: flex row, `gap: 8px`, `padding: 8px 10px`, `--bg-surface-glass`, `1px solid var(--border-glass)`, `radius-lg`. Contains type badge + status badge + title (flex:1, ellipsized with `white-space: nowrap`).
- If row is a link: outer `<a class="similar-link">` with no underline; hover turns child row border `var(--accent-purple)`.
- The **status-pending** style is defined only in this page (not shared in `theme.ts`): text `#D97706`, border `rgba(217, 119, 6, 0.25)` light; `#FBBF24` / `rgba(251, 191, 36, 0.25)` dark (`form-page.ts:235-236`).

**Safety notes for the designer:** the client whitelists the `type` and `status` enum values before interpolating them into class names (`form-page.ts:419-421, 379-380`) and uses `textContent` (not `innerHTML`) for titles. Any redesign that introduces new status values or row layouts needs to preserve this defense.

### 4.6 Submit flow & result banner
- Submit button: full-width (`width: 100%`), `padding: 12px 24px`, radius-lg, no border, purple→blue 135° gradient, white text at 15 px weight 600, `box-shadow: 0 4px 14px rgba(139,92,246,0.25)` (`form-page.ts:85-100`).
- Hover: `opacity: 0.92`, shadow deepens to `0 6px 20px rgba(139,92,246,0.3)`.
- Disabled (during submission): `opacity: 0.5`, `cursor: not-allowed`.
- `#result` banner (`form-page.ts:157-165`):
  - Hidden by default.
  - **Success variant**: `bg #ECFDF5`, text `#065F46`, border `1px solid #A7F3D0`. Dark: `bg rgba(22, 163, 74, 0.10)`, text `#6EE7B7`, border `rgba(110, 231, 183, 0.20)` (`theme.ts:28-29`).
  - **Error variant**: `bg #FEF2F2`, text `#991B1B`, border `1px solid #FECACA`. Dark: `bg rgba(220, 38, 38, 0.10)`, text `#FCA5A5`, border `rgba(252, 165, 165, 0.20)`.
  - Success text is literally: `感謝你的回報！編號：crys-{8-hex}` (`form-page.ts:531`). IDs are generated as `crys-` + 8 random hex chars (`tools/crystal/src/db.ts:4-9`).

---

## 5. Page 2: Q&A Browser (`/qa`)

### 5.1 Layout
- Same language (`zh-Hant`), font (DM Sans), background gradient, and dark-mode machinery as the form.
- Content container: **`max-width: 720px`** (wider than form by 80 px), `margin: 0 auto; padding: 48px 16px` (`qa-page.ts:204`).
- URL accepts three query params (`index.ts:45-55`): `type` (one of `bug|feat|ui|other`, else ignored), `page` (1-based, default 1), `q` (search string, trimmed). `limit` is fixed at 20 for the HTML page; the JSON twin `/api/qa` accepts `limit` up to 50 (`index.ts:62`).

### 5.2 Sections
1. **Logo header** — identical layout to form but wordmark text reads `Crystal Q&A` (`qa-page.ts:224`). Subtitle: `已回覆的問題與建議`.
2. **Search form** (`qa-page.ts:234-252`)
   - `<form method="get" action="/qa">`. Pressing Enter submits; no JS.
   - If a `type` filter is active, it's preserved via `<input type="hidden" name="type" value="…">`.
   - Input wrapper uses `position: relative` with a 16×16 magnifier SVG absolutely positioned `left: 14px` (`qa-page.ts:237-241`).
   - Input class `qa-search-input` — `radius: 999px`, `padding: 10px 16px 10px 40px`, `maxlength="100"`, `autocomplete="off"`, placeholder `搜尋問題…（按 Enter 搜尋）` (`qa-page.ts:143-159, 242-250`).
3. **Filter bar** — 5 pill anchors (`qa-page.ts:255-261`). See §6.4 for filter button styles.
4. **Ticket list** — flex column, `gap: 16px` (`qa-page.ts:264`). Empty states per §3 Journey B.
5. **Pagination** — only when `totalPages > 1` (`qa-page.ts:279-283`). Row of 36×36 square buttons, `gap: 6px`, centered.
6. **Cross-links** + **Footer** — `提交新回報 | 前往 Prism 歌單` (`qa-page.ts:285-292`), plus the shared tagline.

### 5.3 Ticket card anatomy (`qa-page.ts:42-83`)

```
┌──────────────────────────────────────────────────────┐
│ [type] [status]                 nickname · YYYY-MM-DD │  ← header row
│                                                      │
│ Title (h3, 16px, weight 600)                         │
│                                                      │
│ Body paragraph, 14px, --text-secondary, line-height  │
│ 1.6. \n renders as <br/>.                            │
│                                                      │
│ ┌──────────────────────────────────────────┐         │
│ │ 官方回覆 · YYYY-MM-DD (12px purple kicker) │         │
│ │ Admin reply paragraph, 14px primary        │         │
│ └──────────────────────────────────────────┘         │
│ (purple left-border, 3px, bg rgba(139,92,246,0.06)) │
└──────────────────────────────────────────────────────┘
```

- Card surface: `--bg-surface-glass`, `backdrop-filter: blur(12px)`, `1px solid var(--border-glass)`, `radius-xl` (16 px), `padding: 24px`, `box-shadow: 0 4px 16px rgba(0,0,0,0.04)`.
- Header row is a wrapping flex row; date string is right-aligned with `margin-left: auto`.
- Anonymous nicknames render as literal `匿名` (`qa-page.ts:45`).
- Status label: `已回覆` (status=`replied`) or `已關閉` (status=`closed`) — `qa-page.ts:46`.
- **Admin reply panel** (`theme.ts:47-48`): `padding: 16px`, `radius-lg`, `border-left: 3px solid var(--accent-purple)`, `background: rgba(139, 92, 246, 0.06)` (light) / `rgba(192, 132, 252, 0.08)` (dark).

All user-supplied text passes through `escapeHtml()` (`qa-page.ts:21-28`) which escapes `& < > "` and converts `\n` to `<br/>`. The designer should assume multi-line bodies render as hard-wrapped paragraphs.

### 5.4 Empty states (`qa-page.ts:263-275`)

Both are centered blocks with `padding: 48px 16px`, `color: var(--text-tertiary)`, `font-size: 14px`.

- **With query, no results:**
  ```
  找不到符合「{q}」的結果

  清除搜尋   ← purple link, 13 px
  ```
  The "clear search" link navigates to `/qa` (drops the `q` param) but preserves the type filter.

- **No query, no data at all:** `目前還沒有已回覆的問題`. No CTA.

---

## 6. Design System Reference

### 6.1 Color tokens

All tokens are declared as CSS custom properties. **Currently duplicated** across both pages — `form-page.ts:17-38` and `qa-page.ts:113-130`. Dark-mode overrides live in a single shared string (`DARK_MODE_CSS` at `theme.ts:6-26`) injected into both pages. A key redesign goal (G1) is consolidating this.

| Token | Light (hex) | Dark (hex) | Source |
|-------|-------------|------------|--------|
| `--accent-pink` | `#EC4899` | `#F472B6` | `form-page.ts:18` / `theme.ts:9` |
| `--accent-pink-light` | `#F472B6` | `#F9A8D4` | `form-page.ts:19` / `theme.ts:10` |
| `--accent-blue` | `#3B82F6` | `#60A5FA` | `form-page.ts:20` / `theme.ts:11` |
| `--accent-blue-light` | `#60A5FA` | `#93C5FD` | `form-page.ts:21` / `theme.ts:12` |
| `--accent-purple` | `#8B5CF6` | `#C084FC` | `form-page.ts:22` / `theme.ts:13` |
| `--accent-purple-light` | `#A78BFA` | `#D8B4FE` | `form-page.ts:23` / `theme.ts:14` |
| `--bg-page-start` | `#FFF0F5` (lavender blush) | `#0F0A1A` | `form-page.ts:24` / `theme.ts:15` |
| `--bg-page-mid` | `#F0F8FF` (alice blue) | `#0D1117` | `form-page.ts:25` / `theme.ts:16` |
| `--bg-page-end` | `#E6E6FA` (lavender) | `#0A0E1A` | `form-page.ts:26` / `theme.ts:17` |
| `--bg-surface-glass` | `#FFFFFF66` (white @ 40%) | `rgba(30,31,52,0.60)` | `form-page.ts:27` / `theme.ts:18` |
| `--bg-surface-frosted` | `#FFFFFF99` (white @ 60%) | `rgba(26,27,46,0.85)` | `form-page.ts:28` / `theme.ts:19` |
| `--text-primary` | `#1E293B` | `#E8EAF0` | `form-page.ts:29` / `theme.ts:20` |
| `--text-secondary` | `#64748B` | `#9CA3AF` | `form-page.ts:30` / `theme.ts:21` |
| `--text-tertiary` | `#94A3B8` | `#6B7280` | `form-page.ts:31` / `theme.ts:22` |
| `--border-default` | `#E2E8F0` | `rgba(255,255,255,0.10)` | `form-page.ts:32` / `theme.ts:23` |
| `--border-glass` | `#FFFFFF66` | `rgba(255,255,255,0.08)` | `form-page.ts:33` / `theme.ts:24` |
| `--border-accent-purple` | `#DDD6FE` | `rgba(192,132,252,0.25)` | `form-page.ts:34` / `theme.ts:25` |

**Hardcoded (non-tokenized) feedback colors** — redesign candidates for promotion to tokens (G1):

| Use | Light | Dark | Source |
|-----|-------|------|--------|
| Success banner bg / text / border | `#ECFDF5` / `#065F46` / `#A7F3D0` | `rgba(22,163,74,0.10)` / `#6EE7B7` / `rgba(110,231,183,0.20)` | `form-page.ts:164` + `theme.ts:28` |
| Error banner bg / text / border | `#FEF2F2` / `#991B1B` / `#FECACA` | `rgba(220,38,38,0.10)` / `#FCA5A5` / `rgba(252,165,165,0.20)` | `form-page.ts:165` + `theme.ts:29` |
| Status-pending text / border | `#D97706` / `rgba(217,119,6,0.25)` | `#FBBF24` / `rgba(251,191,36,0.25)` | `form-page.ts:235-236` |

### 6.2 Type & status badge colors (`theme.ts:31-45`)

**Type badges** — solid fill, white text, `2px 10px` padding, `border-radius: 20px`, 12 px weight 600.

| Class | Light bg | Dark bg |
|-------|----------|---------|
| `.type-bug` | `#EF4444` | `#F87171` |
| `.type-feat` | `#8B5CF6` | `#C084FC` |
| `.type-ui` | `#3B82F6` | `#60A5FA` |
| `.type-other` | `#64748B` | `#9CA3AF` |

**Status badges** — outlined (no fill), colored text + 1 px semi-transparent border, same shape as type badges but 12 px weight 500.

| Class | Light color | Dark color |
|-------|-------------|------------|
| `.status-replied` | `#059669` | `#4ADE80` |
| `.status-closed` | `#64748B` | `#9CA3AF` |
| `.status-pending` (similar-panel only) | `#D97706` | `#FBBF24` |

### 6.3 Dead / underutilized tokens (G1 opportunity)

- `--accent-pink` and `--accent-pink-light` are declared on both pages but **never referenced** in any CSS rule (verify: grep for `accent-pink` in `tools/crystal/src/`). Either repurpose (e.g. for a tertiary accent on a new feature) or delete.
- `--border-default` is declared but only used implicitly — no direct references in CSS rules (all surfaces use `--border-glass` or `--border-accent-purple`). Delete or start using it.

### 6.4 Typography

Font family: **DM Sans** (loaded from Google Fonts with weights 400/500/600/700 + italic 400, opsz 9..40 — `form-page.ts:13`, `qa-page.ts:111`).

Type ladder actually used:

| Role | Size | Weight | Color token |
|------|------|--------|-------------|
| Wordmark (`Prism Crystal` / `Crystal Q&A`) | 28 px | 700 | gradient-clipped |
| Ticket card title (h3) | 16 px | 600 | `--text-primary` |
| Submit button | 15 px | 600 | white |
| Form input / textarea / body paragraph / toggle label | 14 px | 400–500 | `--text-primary` / `--text-secondary` |
| Cross-link / filter-btn / similar row / tagline | 13 px | 400–500 | `--accent-purple` / `--text-secondary` |
| Type/status badge / form-label / toggle-hint / similar-header / date meta | 12 px | 500–600 | varies |
| Form hint / similar-dismiss / footer | 11 px | 400 | `--text-tertiary` |

Letter-spacing: only applied to the wordmark (`-0.5px`). Line-height: 1.6 on ticket body + admin reply.

### 6.5 Radii

| Token | Value | Used for |
|-------|-------|----------|
| `--radius-lg` | `12px` | Inputs, buttons, small cards, pill rows |
| `--radius-xl` | `16px` | Ticket cards on Q&A |
| `--radius-2xl` | `20px` | Main form card |
| (override) | `999px` | Q&A search input |
| (override) | `20px` | Filter button + badge pills |

### 6.6 Glassmorphism & elevation

**Recipe:**
```
background: var(--bg-surface-glass or frosted);
backdrop-filter: blur(Npx); -webkit-backdrop-filter: blur(Npx);
border: 1px solid var(--border-glass);
border-radius: var(--radius-…);
```

Three blur tiers in use:
- **16 px** — main form card (`form-page.ts:278`).
- **12 px** — Q&A ticket cards (`qa-page.ts:52`).
- **8 px** — theme toggle button (`theme.ts:57`).

**Shadows:**
- Form card: `0 8px 32px rgba(0,0,0,0.06)` (`form-page.ts:282`).
- Ticket card: `0 4px 16px rgba(0,0,0,0.04)` (`qa-page.ts:56`).
- Submit button idle: `0 4px 14px rgba(139,92,246,0.25)` (`form-page.ts:97`).
- Submit button hover: `0 6px 20px rgba(139,92,246,0.3)` (`form-page.ts:99`).

### 6.7 Gradients

All linear, **135°** (top-left → bottom-right):
- **Page background:** `var(--bg-page-start)` → `var(--bg-page-mid)` (50%) → `var(--bg-page-end)` (`form-page.ts:45-47`).
- **Wordmark text (clipped):** `var(--accent-purple)` → `var(--accent-blue)` (`form-page.ts:262-264`).
- **Logo tile background:** `var(--accent-purple-light)` → `var(--accent-blue-light)` (`form-page.ts:251`).
- **Active button (type-btn active / filter-btn active / submit / pagination current):** `var(--accent-purple)` → `var(--accent-blue)` (`form-page.ts:90, 122` and `qa-page.ts:94, 182`).

### 6.8 Dark mode behavior

- No-flash detect script runs in `<head>` before body paint (`theme.ts:51`): reads `localStorage.theme`; if `'dark'` or (not set AND `prefers-color-scheme: dark`), adds `html.dark`.
- Toggle button (§6.9) persists the user's explicit choice to `localStorage.theme` (`'dark' | 'light'`).
- System preference change listener (`theme.ts:91-97`) auto-updates only when there is **no explicit override**.

### 6.9 Theme toggle (`theme.ts:53-99`)

- 32×32 circular button, `border-radius: 50%`, no border, `background: var(--bg-surface-glass)` with `backdrop-filter: blur(8px)`.
- Two SVG icons absolute inside — moon (default, light mode) and sun (dark mode). `update()` swaps their `display` on each toggle.
- `aria-label="Toggle dark mode"`.
- Positioned absolutely to the right of the logo row (`form-page.ts:266-268`, `qa-page.ts:225-227`).

---

## 7. Component Inventory

Every reusable piece, with key dimensions, states, and source.

### 7.1 Logo header + wordmark
- 40×40 logo tile + 28 px gradient wordmark + 32×32 theme toggle, in a centered flex row with `gap: 12px`, `position: relative`.
- Tagline paragraph below (14 px secondary).
- **Variants:** `Prism Crystal` (form) · `Crystal Q&A` (Q&A).

### 7.2 Theme toggle
See §6.9. Identical on both pages.

### 7.3 Type selector + `.type-btn` (`form-page.ts:102-125`)
- Grid of 4 buttons, `repeat(4, 1fr)`, `gap: 8px`. Collapses to `repeat(2, 1fr)` at `max-width: 480px` (`form-page.ts:238-240`) — the ONLY media query in the app.
- Button: `8px 12px`, frosted bg, glass border, radius-lg, 13 px weight 500, secondary color.
- **Hover:** border → `var(--border-accent-purple)`.
- **Active:** purple→blue 135° gradient, white text, transparent border.
- Buttons carry `data-type="{bug|feat|ui|other}"`; JS ensures only one active.

### 7.4 Form input / textarea (`form-page.ts:51-68`)
- Full-width, `10px 16px`, `--bg-surface-frosted`, glass border, radius-lg.
- 14 px, `--text-primary`.
- Placeholder: `--text-tertiary`.
- **Focus:** border → `--border-accent-purple`, `box-shadow: 0 0 0 3px rgba(139,92,246,0.1)`.
- Textarea: `resize: vertical; min-height: 100px`.

### 7.5 Form label + required mark + hint (`form-page.ts:70-83`)
- Label: 13 px weight 500, `--text-secondary`, `margin-bottom: 6px`.
- Required `*`: `--accent-purple`.
- Hint: 11 px `--text-tertiary`, `margin-top: 4px`.

### 7.6 Submit button (primary CTA)
See §4.6. Full width, gradient, white, weight 600.

### 7.7 Toggle row (checkbox-as-card) (`form-page.ts:127-151`)
- Flex row, `gap: 10px`, `padding: 12px 16px`, frosted bg, glass border, radius-lg.
- 18×18 checkbox with `accent-color: var(--accent-purple)`.
- Right side: `.toggle-label` (14 px primary) + `.toggle-hint` (12 px tertiary) stacked.
- Entire row is a `<label>`, so clicks anywhere toggle the checkbox.

### 7.8 Contact field (animated reveal) (`form-page.ts:153-155`)
- `transition: max-height 0.3s ease, opacity 0.3s ease; overflow: hidden`.
- `.visible` → `max-height: 120px; opacity: 1`.
- `.hidden` → `max-height: 0; opacity: 0`.
- Toggled by the public-reply checkbox change handler (`form-page.ts:480-488`).

### 7.9 Similar panel
See §4.5. Two row variants: linked (wrapped `<a>`, hover purple border) vs inert (for pending status).

### 7.10 Result banner
See §4.6. Success + error variants; Display toggled by setting class `success` or `error`.

### 7.11 Q&A search input
See §5.2. Pill-shaped, leading SVG icon, press-Enter-to-submit.

### 7.12 Filter bar + `.filter-btn` (`qa-page.ts:161-185`)
- Flex row, `gap: 8px`, `flex-wrap: wrap`, centered.
- Button (actually `<a>`): `6px 16px`, frosted bg, glass border, `border-radius: 20px`, 13 px weight 500, `--text-secondary`.
- **Hover:** border and text → `var(--accent-purple)`.
- **Active:** purple→blue gradient, white text, transparent border.

### 7.13 Ticket card
See §5.3.

### 7.14 Admin reply panel
See §5.3 and §6.2. Purple left-border, tinted purple background, kicker + reply body.

### 7.15 Pagination button (`qa-page.ts:85-100`)
- 36×36 square, `radius-lg`, 14 px weight 500.
- Idle: frosted bg, glass border, `--text-secondary`.
- Active: purple→blue gradient, white, no border.
- `gap: 6px` between buttons.

### 7.16 Cross-links row
See §4.2(3) and §5.2(6). Centered flex row, purple links, tertiary pipe separators.

---

## 8. Interaction States (consolidated)

| Element | Hover | Focus | Active | Disabled | Source |
|---------|-------|-------|--------|----------|--------|
| `.type-btn` | border → `--border-accent-purple` | (no explicit focus style) | purple→blue gradient + white | — | `form-page.ts:120-125` |
| `.filter-btn` | border + text → `--accent-purple` | (no explicit focus style) | purple→blue gradient + white | — | `qa-page.ts:180-185` |
| `.form-input` | (none) | border → `--border-accent-purple`, ring `0 0 0 3px rgba(139,92,246,0.1)` | — | — | `form-page.ts:64-67` |
| `.qa-search-input` | (none) | border → `--accent-purple`, ring `0 0 0 3px rgba(139,92,246,0.1)` | — | — | `qa-page.ts:156-159` |
| `.btn-submit` | `opacity: 0.92`, shadow deepens | (default browser) | (= idle) | `opacity: 0.5`, `cursor: not-allowed` | `form-page.ts:99-100` |
| `.cross-links a` | `opacity: 0.7` | — | — | — | `form-page.ts:179` / `qa-page.ts:199` |
| `.similar-link` | child `.similar-item` border → `--accent-purple` | — | — | — | `form-page.ts:228` |
| `.similar-dismiss` | text → secondary, bg `rgba(0,0,0,0.04)` / dark `rgba(255,255,255,0.06)` | — | — | — | `form-page.ts:208-209` |
| Theme toggle | (no explicit hover; transitions `background 0.2s`) | — | — | — | `theme.ts:55-59` |
| Pagination active page | (none defined) | — | — | — | `qa-page.ts:85-100` |

**Loading:** no spinners anywhere. Submit button just disables during the POST. Similar-panel fetches are silent.

**Empty states:** see §5.4.

**Error banners:** see §4.6 + §4.4 table.

Note for the designer: focus rings are applied on inputs but **not** on `type-btn` / `filter-btn` / cross-links / pagination buttons. This is an accessibility gap — those are keyboard-navigable anchors/buttons and should have visible focus. Consider a consistent focus-ring token in the redesign.

---

## 9. Responsive Behavior

**What exists today:**
- Single explicit breakpoint at `max-width: 480px`: type selector collapses from 4 columns to 2 (`form-page.ts:238-240`).
- Filter bar uses `flex-wrap: wrap` so chips naturally reflow (`qa-page.ts:164`).
- Content columns are fluid (640 px / 720 px max-width with 16 px horizontal padding), so narrow viewports get a single-column layout automatically.

**What's missing (G2/G3 opportunity):**
- No tablet-specific layout; nothing between 480 px and 640 px viewport is optimized.
- Typography scale doesn't adjust — 28 px wordmark and 14 px body apply at all sizes.
- Touch targets on small rows (type buttons at 2 columns, filter pills) are on the small side.
- No horizontal scroll strategy for long ticket titles on narrow screens beyond `text-overflow: ellipsis` on the similar-panel title only — full cards allow titles to wrap freely.
- Theme toggle is absolutely positioned relative to the logo row; on very narrow screens the header crowds toward it.

---

## 10. Copy & Microcopy (verbatim)

All Chinese copy is Traditional (zh-Hant). Punctuation uses full-width characters in places (`，。「」`).

### Form page (`/`)
- Tab: `Prism Crystal — 回報 / 建議`
- Wordmark: `Prism Crystal`
- Subtitle: `回報問題或建議新功能，幫助我們讓 Prism 更好`
- Labels: `類型 *` · `標題 *` · `詳細描述 *` · `暱稱` · `聯絡方式 *`
- Type button labels: `Bug 回報` · `功能建議` · `UI 問題` · `其他`
- Placeholders:
  - Title: `簡短描述問題或建議`
  - Body: `請描述你遇到的問題或想要的功能…`
  - Nickname: `選填，Q&A 公開回覆時顯示`
  - Contact: `Email / Discord / Twitter 等，讓我們能回覆你`
- Toggle: `允許公開回覆` / hint `勾選後你的問題與官方回覆將顯示在 Q&A 頁面`
- Contact hint: `不公開回覆時必須提供聯絡方式`
- Submit button: `送出回報`
- Similar panel header: `類似的既有回報` · dismiss button: `隱藏` · aria-label: `隱藏類似回報`
- Similar panel type labels (in JS enum map, `form-page.ts:379`): `Bug` · `功能建議` · `UI` · `其他`
- Similar panel status labels (in JS enum map, `form-page.ts:380`): `處理中` · `已回覆` · `已關閉`
- Success banner: `感謝你的回報！編號：{id}` (where `{id}` is e.g. `crys-a1b2c3d4`)
- Client-only errors: `請完成人機驗證` · `網路錯誤，請稍後再試` · `提交失敗`
- Server errors (see §4.4 for full table)
- Cross-links: `查看 Q&A` · `提議新 VTuber` · `前往 Prism 歌單`
- Footer: `Prism — 為你喜愛的 VTuber 打造歌單頁面`
- Theme toggle aria-label: `Toggle dark mode`

### Q&A page (`/qa`)
- Tab: `Prism Crystal — Q&A`
- Wordmark: `Crystal Q&A`
- Subtitle: `已回覆的問題與建議`
- Search placeholder: `搜尋問題…（按 Enter 搜尋）`
- Filter chips: `全部` · `Bug` · `功能建議` · `UI` · `其他`
- Ticket status labels (server-rendered, `qa-page.ts:46`): `已回覆` (replied) · `已關閉` (closed) — only these two since Q&A scope excludes `pending`
- Anonymous fallback: `匿名`
- Admin-reply kicker: `官方回覆 · YYYY-MM-DD`
- Empty (with query): `找不到符合「{q}」的結果` + `清除搜尋`
- Empty (no data): `目前還沒有已回覆的問題`
- Cross-links: `提交新回報` · `前往 Prism 歌單`
- Footer: `Prism — 為你喜愛的 VTuber 打造歌單頁面`

---

## 11. Open Questions & Opportunities

Each item tagged to the goal(s) it primarily affects.

1. **Context-URL is plumbed but dormant** (G2). `context_url` is a live DB column and payload field; the form reads `?ref=` at submit time (`form-page.ts:491-494`). But the main site's Crystal link doesn't set `?ref=`. **Q:** Should the redesign expose ticket provenance (e.g. "submitted from `/mizuki/songs`")? Should Prism set `?ref=` on every out-link?
2. **No "my submissions" view** (G2). A non-public submitter gets only a ticket ID in the success banner. If they return later to check status, there's no lookup UI. **Q:** Add a minimal "enter ticket ID" lookup? Email-linked status check? Persistent submitter identity (Discord OAuth?)?
3. **Dead/hardcoded tokens** (G1). `--accent-pink*` and `--border-default` declared but never referenced. Success/error/pending colors hardcoded rather than tokenized. **Q:** Unify the token set; promote hardcoded colors; decide pink's fate.
4. **Only one breakpoint** (G1, G2, G3). Mobile layout works by accident of fluid columns rather than by design. **Q:** Formalize a responsive scale (typography, spacing, touch targets).
5. **Similar-panel interaction model** (G2). Replied/closed = linked, pending = inert. Today both look identical. **Q:** Differentiate visually (icon, affordance). Add a "this is my issue — don't submit" CTA that dismisses the form. Soften the panel's entrance.
6. **Search UX is thin** (G3). No live suggestions, no recent searches, no result count, no "why this matched" hints. **Q:** Live dropdown suggestions? Result-count badge? Highlighted matched terms?
7. **No categorization beyond type** (G3). Four types (Bug / Feature / UI / Other) are coarse. **Q:** Tags? Streamer attribution? Topic clustering (auto or curator-assigned)?
8. **No permalinks** (G3). Q&A cards are in-page elements; there's no URL per ticket. **Q:** Add `/qa/{id}` pages with shareable URLs.
9. **No rate-limit feedback** (G2). Turnstile is the only spam/abuse control. **Q:** "You've submitted a lot recently — please wait" UX? Client-side cooldown?
10. **Accessibility audit** (G1). Aria-labels exist on toggle + dismiss. Focus rings exist on inputs but not on pills/anchors. Contrast on glass surfaces in dark mode should be verified. Keyboard-only flow through the form (type buttons → title → similar-panel → body) needs a pass. **Q:** Commission an a11y pass during the redesign.
11. **The `crys-XXXXXXXX` ID** (G2). 8 random hex chars (`db.ts:4-9`). Short and memorable but never shown anywhere after the success banner. **Q:** Keep format but show it more prominently; offer a copy button; put it in the URL if permalinks land (#8).
12. **Q&A status intermixing** (G3). `已回覆` and `已關閉` both appear in the list; filter bar only slices by type. **Q:** Add a status filter? Visually de-emphasize closed tickets? Group by status?

---

## 12. Source References (Appendix)

For the designer or next developer who wants to jump to the code.

### Primary source files (tools/crystal/src/)
- `form-page.ts` — submission page: HTML + inline CSS + client JS (558 lines)
- `qa-page.ts` — Q&A page: HTML + inline CSS (297 lines)
- `theme.ts` — dark-mode tokens + toggle script (100 lines)
- `index.ts` — Hono router: `/`, `/qa`, `POST /api/submit`, `GET /api/qa`, `GET /api/similar`
- `validate.ts` — server-side validation + zh-Hant error copy
- `db.ts` — D1 queries: `generateId`, `insertTicket`, `listPublicReplied`, `searchTickets`
- `turnstile.ts` — Cloudflare Turnstile verification
- `types.ts` — shared types (`TicketRow`, `TicketType`, `TicketStatus`, `SubmitTicketBody`, `Bindings`)
- `tools/crystal/schema.sql` — `tickets` table schema + indexes
- `tools/crystal/wrangler.toml` — worker deploy config (name `oshi-prism-crystal`, D1 binding `DB`)

### Key deep links
- CSS token block (light mode): `form-page.ts:17-38` / `qa-page.ts:113-130`
- Dark-mode tokens: `theme.ts:6-26`
- Dark-mode no-flash detect script: `theme.ts:51`
- Badge styles (shared): `theme.ts:31-45`
- Admin-reply panel styles: `theme.ts:47-48`
- Glassmorphism — form card: `form-page.ts:275-283`
- Glassmorphism — ticket card: `qa-page.ts:49-57`
- Similar-panel CSS: `form-page.ts:181-236`
- Similar-panel client logic (debounce, abort, render): `form-page.ts:371-468`
- Similar-panel interaction rule (linked vs inert): `form-page.ts:452-466`
- Submit-flow client logic: `form-page.ts:496-554`
- Form-input + focus ring: `form-page.ts:51-68`
- Submit button: `form-page.ts:85-100`
- Type selector + active state: `form-page.ts:102-125`
- Toggle row: `form-page.ts:127-151`
- Contact reveal animation: `form-page.ts:153-155`
- Result banner success/error hex: `form-page.ts:164-165` + `theme.ts:28-29`
- Single media query (480 px): `form-page.ts:238-240`
- Q&A ticket card template: `qa-page.ts:42-83`
- Q&A search + filter bar: `qa-page.ts:143-185, 234-261`
- Q&A empty states: `qa-page.ts:263-275`
- Pagination buttons: `qa-page.ts:85-100`
- Search ranking constants: `db.ts:73-78` (PREFIX_SCORE=10, TITLE_SCORE=3, BODY_SCORE=1, REPLY_SCORE=1, MAX_TOKENS=4, MAX_Q_LEN=100)
- `/api/similar` handler + CJK min-chars rule: `index.ts:73-99`
- Validation error copy: `validate.ts:13-32`
- ID generator (`crys-XXXXXXXX`): `db.ts:4-9`
- Data model: `schema.sql:1-18`

### Related docs
- `ARCHITECTURE.md:295-486` — system-wide context for Crystal + Nova + Aurora + admin
- `admin-ui-spec.md:887-944` — admin CrystalTickets page (out of scope here)
- Commit `67d4eda` — "feat(crystal): add Q&A search and submission-form duplicate detection" (most recent feature)

---

*End of brief. Questions for the designer: see §11. Non-design-scope questions (API shapes, DB schema, scaling) belong in `ARCHITECTURE.md`.*
