# Discord 後台變動推播通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 後台審核與資料上站時，自動推播到兩個 Discord 頻道 —— 📝 回饋頻道（投稿審核結果，含退回理由）與 📢 公告頻道（新 Streamer、新歌回、訂閱數變動）。

**Architecture:** 雙發送點 hybrid。回饋事件在 admin worker 的審核端點即時發（best-effort `waitUntil`）；公告事件在本地 sync 腳本寫檔前 diff「新建資料 vs 既有 committed JSON」後發。共用 `admin/shared/discord.ts` 的純 embed builder + `postDiscord()`。git-committed 的 JSON 本身就是「上次已通知」的快照，無需 cursor 或狀態表。

**Tech Stack:** TypeScript、Hono（Cloudflare Workers）、tsx 腳本（Node 18+ 全域 `fetch`）、Discord Incoming Webhooks、D1。測試為 `npx tsx <file>.test.ts`（admin 側手寫斷言、tools 側 `node:assert`）。

**Spec:** `docs/superpowers/specs/2026-06-13-discord-notifications-design.md`

---

## File Structure

**新增**
- `admin/shared/discord.ts` — DiscordEmbed 型別、`COLOR`、7 個 embed builder、2 個 `feedbackEmbedFor*` 決策函式、`postDiscord()`。worker 與 sync 共用。
- `admin/shared/discord.test.ts` — builder 與決策函式單測（手寫斷言，workers-types 環境）。
- `tools/shared/announce.ts` — `parseDevVar()`、`loadAnnounceWebhook()`（Node-only）。
- `tools/shared/announce.test.ts` — `parseDevVar` 單測。
- `tools/sync-registry/sync.test.ts` — `diffStreamers` 單測。
- `tools/sync-data/sync.test.ts` — `diffStreams`、`songCountForStream` 單測。

**修改**
- `admin/src/index.ts` — Bindings 加 `DISCORD_WEBHOOK_FEEDBACK`、import discord、兩個 status 端點接通知、VOD 端點補 select `status`。
- `tools/sync-registry/sync.ts` — 加 `diffStreamers`/`readExistingStreamers`/`announceRegistry`；`main` 改 async + `isMainScript` guard。
- `tools/sync-data/sync.ts` — 加 `diffStreams`/`songCountForStream`/`readExistingStreams`/`streamerDisplayName`/`announceData`；`main` 改 async + `isMainScript` guard。
- `admin/package.json` — 加 `test:discord`，併入 `check`。
- `package.json`（root）— 加 `test:announce`、`sync:registry:test`、`sync:data:test`。

**依賴順序：** Task 1 → Task 2 →（Task 3 需 1）→（Task 4、5 需 1+2）→ Task 6（設定／部署／驗收）。

---

## Task 1: Discord embed 共用模組

**Files:**
- Create: `admin/shared/discord.ts`
- Test: `admin/shared/discord.test.ts`
- Modify: `admin/package.json`

- [ ] **Step 1: 寫失敗測試**

Create `admin/shared/discord.test.ts`（注意：admin tsconfig `types` 只有 `@cloudflare/workers-types`，**不可** import `node:assert`／node 全域；比照 `admin/src/helpers.test.ts` 手寫斷言）：

```ts
import {
  COLOR,
  feedbackEmbedForSubmission,
  feedbackEmbedForVod,
  newStreamerEmbed,
  newStreamEmbed,
  subscriberDigestEmbed,
  postDiscord,
} from './discord';

declare const process: { exitCode?: number };

let passed = 0;
let failed = 0;

function check(cond: boolean, message: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`✗ ${message}`);
  }
}

// feedbackEmbedForSubmission
check(
  feedbackEmbedForSubmission('pending', 'pending', { display_name: 'X', reviewer_note: '' }) === null,
  'no submission embed when status unchanged',
);
check(
  feedbackEmbedForSubmission('approved', 'pending', { display_name: 'X', reviewer_note: '' }) === null,
  'no submission embed when new status is pending',
);

const subApproved = feedbackEmbedForSubmission('pending', 'approved', { display_name: '浠Mizuki', reviewer_note: '' });
check(subApproved?.color === COLOR.GREEN, 'approved submission embed is green');
check(subApproved?.description?.includes('浠Mizuki') === true, 'approved submission embed names the streamer');

const subRejected = feedbackEmbedForSubmission('pending', 'rejected', { display_name: 'X', reviewer_note: '頻道不符收錄範圍' });
check(subRejected?.color === COLOR.RED, 'rejected submission embed is red');
check(subRejected?.fields?.[0]?.value === '頻道不符收錄範圍', 'rejected submission embed shows the reason');

const subRejectedNoNote = feedbackEmbedForSubmission('pending', 'rejected', { display_name: 'X', reviewer_note: '' });
check(subRejectedNoNote?.fields?.[0]?.value === '（未填理由）', 'rejected submission embed falls back when no reason given');

// feedbackEmbedForVod
const vodApproved = feedbackEmbedForVod('pending', 'approved', { stream_title: '新年歌枠', streamer_slug: 'earendel', reviewer_note: '' });
check(vodApproved?.color === COLOR.GREEN, 'approved VOD embed is green');
check(vodApproved?.description?.includes('新年歌枠') === true, 'approved VOD embed names the stream');

const vodRejected = feedbackEmbedForVod('pending', 'rejected', { stream_title: 'T', streamer_slug: 'earendel', reviewer_note: '時間軸重複' });
check(vodRejected?.fields?.[0]?.value === '時間軸重複', 'rejected VOD embed shows the reason');
check(
  feedbackEmbedForVod('approved', 'approved', { stream_title: 'T', streamer_slug: 's', reviewer_note: '' }) === null,
  'no VOD embed when status unchanged',
);

// newStreamerEmbed
const newStreamer = newStreamerEmbed({ displayName: 'Gabu', group: '個人勢', link: 'https://youtube.com/@gabu' });
check(newStreamer.color === COLOR.PINK, 'new streamer embed is pink');
check(newStreamer.url === 'https://youtube.com/@gabu', 'new streamer embed links the channel');
check(newStreamer.fields?.[0]?.value === '個人勢', 'new streamer embed shows the group');

// subscriberDigestEmbed
const digest = subscriberDigestEmbed([
  { displayName: 'A', from: '1萬', to: '2萬' },
  { displayName: 'B', from: '3萬', to: '4萬' },
]);
check(digest.description?.includes('A') === true && digest.description?.includes('2萬') === true, 'subscriber digest lists each change');

const bigDigest = subscriberDigestEmbed(Array.from({ length: 35 }, (_, i) => ({ displayName: `S${i}`, from: '1', to: '2' })));
check(bigDigest.description?.includes('還有 5 筆') === true, 'subscriber digest truncates beyond 30 entries');

// newStreamEmbed
const newStream = newStreamEmbed({
  displayName: 'earendel',
  streamTitle: 'Acoustic',
  videoId: 'abc123',
  songCount: 12,
  thumbnailUrl: 'https://i.ytimg.com/vi/abc123/mqdefault.jpg',
});
check(newStream.url === 'https://youtu.be/abc123', 'new stream embed links the video');
check(newStream.fields?.[0]?.value === '12 首', 'new stream embed shows the song count');
check(newStream.thumbnail?.url === 'https://i.ytimg.com/vi/abc123/mqdefault.jpg', 'new stream embed sets a thumbnail');

// postDiscord no-op when no webhook configured
const noop = await postDiscord(undefined, [newStream]);
check(noop === undefined, 'postDiscord is a no-op when the webhook URL is missing');

console.log(`discord.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd admin && npx tsx shared/discord.test.ts`
Expected: FAIL —— `Cannot find module './discord'`（檔案尚未建立）。

- [ ] **Step 3: 實作 `admin/shared/discord.ts`**

```ts
/**
 * discord.ts — Discord webhook embed builders + poster.
 *
 * Shared by the admin worker (contributor-feedback channel, review-time) and the
 * sync scripts (fan-announcement channel, publish-time). Builders are pure and
 * unit-tested; postDiscord is the only function that performs network I/O.
 *
 * Uses the global `fetch` (available in both Cloudflare Workers and Node 18+).
 */

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  thumbnail?: { url: string };
}

/** Embed side-bar colors. */
export const COLOR = {
  GREEN: 0x22c55e, // approved
  RED: 0xef4444, // rejected
  BLUE: 0x3b82f6, // new stream
  PINK: 0xec4899, // new streamer
  AMBER: 0xf59e0b, // subscriber digest
} as const;

// Discord hard limits.
const DESC_MAX = 4096;
const FIELD_VALUE_MAX = 1024;
const EMBEDS_PER_MESSAGE = 10;
const DIGEST_MAX_LINES = 30;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// --- Contributor-feedback embeds (review-time, from worker) ---

export function streamerApprovedEmbed(sub: { display_name: string }): DiscordEmbed {
  return {
    title: '✅ Streamer 投稿通過',
    description: truncate(`「${sub.display_name}」已通過審核，稍後將上架。`, DESC_MAX),
    color: COLOR.GREEN,
  };
}

export function streamerRejectedEmbed(sub: { display_name: string; reviewer_note: string }): DiscordEmbed {
  return {
    title: '❌ Streamer 投稿未通過',
    description: truncate(`「${sub.display_name}」未通過審核。`, DESC_MAX),
    color: COLOR.RED,
    fields: [{ name: '理由', value: truncate(sub.reviewer_note || '（未填理由）', FIELD_VALUE_MAX) }],
  };
}

export function vodApprovedEmbed(vod: { stream_title: string; streamer_slug: string }): DiscordEmbed {
  return {
    title: '✅ VOD 投稿已收錄',
    description: truncate(`「${vod.stream_title}」（${vod.streamer_slug}）已通過審核，稍後將上架。`, DESC_MAX),
    color: COLOR.GREEN,
  };
}

export function vodRejectedEmbed(vod: { stream_title: string; streamer_slug: string; reviewer_note: string }): DiscordEmbed {
  return {
    title: '❌ VOD 投稿未通過',
    description: truncate(`「${vod.stream_title}」（${vod.streamer_slug}）未通過審核。`, DESC_MAX),
    color: COLOR.RED,
    fields: [{ name: '理由', value: truncate(vod.reviewer_note || '（未填理由）', FIELD_VALUE_MAX) }],
  };
}

/**
 * Decide the feedback embed for a submission status transition. Returns null when
 * no notification should fire (no real transition, or new status not approved/rejected).
 */
export function feedbackEmbedForSubmission(
  oldStatus: string,
  newStatus: string,
  sub: { display_name: string; reviewer_note: string },
): DiscordEmbed | null {
  if (oldStatus === newStatus) return null;
  if (newStatus === 'approved') return streamerApprovedEmbed(sub);
  if (newStatus === 'rejected') return streamerRejectedEmbed(sub);
  return null;
}

export function feedbackEmbedForVod(
  oldStatus: string,
  newStatus: string,
  vod: { stream_title: string; streamer_slug: string; reviewer_note: string },
): DiscordEmbed | null {
  if (oldStatus === newStatus) return null;
  if (newStatus === 'approved') return vodApprovedEmbed(vod);
  if (newStatus === 'rejected') return vodRejectedEmbed(vod);
  return null;
}

// --- Fan-announcement embeds (publish-time, from sync scripts) ---

export function newStreamerEmbed(s: { displayName: string; group: string; link: string }): DiscordEmbed {
  const embed: DiscordEmbed = {
    title: '🎉 新 Streamer 上架',
    description: truncate(`「${s.displayName}」已加入收錄！`, DESC_MAX),
    color: COLOR.PINK,
  };
  if (s.link) embed.url = s.link;
  if (s.group) embed.fields = [{ name: '分類', value: truncate(s.group, FIELD_VALUE_MAX), inline: true }];
  return embed;
}

export function subscriberDigestEmbed(changes: Array<{ displayName: string; from: string; to: string }>): DiscordEmbed {
  const shown = changes.slice(0, DIGEST_MAX_LINES);
  const lines = shown.map((c) => `• ${c.displayName}　${c.from} → ${c.to}`);
  if (changes.length > shown.length) {
    lines.push(`…還有 ${changes.length - shown.length} 筆`);
  }
  return {
    title: '📈 訂閱數更新',
    description: truncate(lines.join('\n'), DESC_MAX),
    color: COLOR.AMBER,
  };
}

export function newStreamEmbed(s: {
  displayName: string;
  streamTitle: string;
  videoId: string;
  songCount: number;
  thumbnailUrl: string;
}): DiscordEmbed {
  const embed: DiscordEmbed = {
    title: '🎵 新收錄歌回',
    description: truncate(`${s.displayName} —「${s.streamTitle}」`, DESC_MAX),
    url: `https://youtu.be/${s.videoId}`,
    color: COLOR.BLUE,
    fields: [{ name: '曲數', value: `${s.songCount} 首`, inline: true }],
  };
  if (s.thumbnailUrl) embed.thumbnail = { url: s.thumbnailUrl };
  return embed;
}

export function newStreamsSummaryEmbed(displayName: string, count: number): DiscordEmbed {
  return {
    title: '🎵 新收錄歌回',
    description: truncate(`${displayName} 本次新增 ${count} 場歌回`, DESC_MAX),
    color: COLOR.BLUE,
  };
}

// --- Network ---

/**
 * POST embeds to a Discord webhook. No-op when the URL is empty or there are no
 * embeds. Throws on a non-2xx response so callers can log; callers must treat
 * notification as best-effort and never let a failure break their main action.
 */
export async function postDiscord(webhookUrl: string | undefined, embeds: DiscordEmbed[]): Promise<void> {
  if (!webhookUrl || embeds.length === 0) return;
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ embeds: embeds.slice(0, EMBEDS_PER_MESSAGE) }),
  });
  if (!res.ok) {
    throw new Error(`Discord webhook returned ${res.status}`);
  }
}
```

- [ ] **Step 4: 跑測試確認通過 + 型別檢查**

Run: `cd admin && npx tsx shared/discord.test.ts`
Expected: `discord.test: 20 passed, 0 failed`

Run: `cd admin && npm run typecheck`
Expected: 無錯誤（`tsc --noEmit` 涵蓋 `shared/**/*.ts`）。

- [ ] **Step 5: 接上 admin `check` 腳本**

Modify `admin/package.json`：在 scripts 內 `test:itunes` 後新增一行，並把 `check` 串上 `test:discord`：

```json
    "test:itunes": "npx tsx src/itunes.test.ts",
    "test:discord": "npx tsx shared/discord.test.ts",
    "check": "npm run typecheck && npm run test:helpers && npm run test:itunes && npm run test:discord"
```

Run: `cd admin && npm run check`
Expected: typecheck + 三組測試全過。

- [ ] **Step 6: Commit**

```bash
cd /Users/hydai/workspace/vibe/vtuber/prism.oshi.tw
npx lineguard admin/shared/discord.ts admin/shared/discord.test.ts
git add admin/shared/discord.ts admin/shared/discord.test.ts admin/package.json
git commit -m "$(cat <<'EOF'
feat(discord): add shared embed builders + webhook poster

Pure builders for the contributor-feedback and fan-announcement channels,
plus a best-effort postDiscord(). feedbackEmbedFor{Submission,Vod} encode the
"only notify on a real transition to approved/rejected" rule so callers stay thin.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 公告 webhook 載入器（tools 共用）

**Files:**
- Create: `tools/shared/announce.ts`
- Test: `tools/shared/announce.test.ts`
- Modify: `package.json`（root）

- [ ] **Step 1: 寫失敗測試**

Create `tools/shared/announce.test.ts`（tools 側可用 `node:assert`）：

```ts
import * as assert from 'node:assert/strict';

import { parseDevVar } from './announce.ts';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

test('parseDevVar extracts the value', () => {
  assert.equal(parseDevVar('DISCORD_WEBHOOK_ANNOUNCE=https://x/y\n', 'DISCORD_WEBHOOK_ANNOUNCE'), 'https://x/y');
});

test('parseDevVar returns null when the key is absent', () => {
  assert.equal(parseDevVar('OTHER=1\n', 'DISCORD_WEBHOOK_ANNOUNCE'), null);
});

test('parseDevVar ignores commented lines', () => {
  assert.equal(parseDevVar('# DISCORD_WEBHOOK_ANNOUNCE=nope\nDISCORD_WEBHOOK_ANNOUNCE=real\n', 'DISCORD_WEBHOOK_ANNOUNCE'), 'real');
});

test('parseDevVar strips surrounding quotes', () => {
  assert.equal(parseDevVar('DISCORD_WEBHOOK_ANNOUNCE="https://x/y"\n', 'DISCORD_WEBHOOK_ANNOUNCE'), 'https://x/y');
});

test('parseDevVar treats an empty value as null', () => {
  assert.equal(parseDevVar('DISCORD_WEBHOOK_ANNOUNCE=\n', 'DISCORD_WEBHOOK_ANNOUNCE'), null);
});

console.log('announce.test: all passed');
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /Users/hydai/workspace/vibe/vtuber/prism.oshi.tw && npx tsx tools/shared/announce.test.ts`
Expected: FAIL —— 找不到 `./announce.ts`。

- [ ] **Step 3: 實作 `tools/shared/announce.ts`**

```ts
/**
 * announce.ts — resolve the fan-announcement Discord webhook URL for sync scripts.
 *
 * process.env.DISCORD_WEBHOOK_ANNOUNCE wins; otherwise read admin/.dev.vars
 * (gitignored), mirroring how fetch-channel-info reads YOUTUBE_API_KEY. Returns
 * undefined when unset so callers skip announcing.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEV_VARS_PATH = path.resolve(__dirname, '../../admin/.dev.vars');

/** Extract a KEY=value entry from .dev.vars content; null if absent or empty. */
export function parseDevVar(content: string, key: string): string | null {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== key) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value || null;
  }
  return null;
}

/** Resolve the announce webhook URL: process.env wins, else admin/.dev.vars. */
export function loadAnnounceWebhook(): string | undefined {
  const fromEnv = process.env.DISCORD_WEBHOOK_ANNOUNCE?.trim();
  if (fromEnv) return fromEnv;
  try {
    const content = fs.readFileSync(DEV_VARS_PATH, 'utf-8');
    return parseDevVar(content, 'DISCORD_WEBHOOK_ANNOUNCE') ?? undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd /Users/hydai/workspace/vibe/vtuber/prism.oshi.tw && npx tsx tools/shared/announce.test.ts`
Expected: 5 個 ✓，最後印 `announce.test: all passed`。

- [ ] **Step 5: 接上 root 測試腳本**

Modify `package.json`（root）：在 `fetch:channel-info:test` 後新增：

```json
    "fetch:channel-info:test": "npx tsx tools/fetch-channel-info/fetch.test.ts",
    "test:announce": "npx tsx tools/shared/announce.test.ts"
```

Run: `npm run test:announce`
Expected: `announce.test: all passed`。

- [ ] **Step 6: Commit**

```bash
npx lineguard tools/shared/announce.ts tools/shared/announce.test.ts
git add tools/shared/announce.ts tools/shared/announce.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(announce): load DISCORD_WEBHOOK_ANNOUNCE for sync scripts

process.env wins, falling back to admin/.dev.vars (same loader pattern as
fetch-channel-info). Returns undefined when unset so sync skips announcing.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Worker 接通回饋頻道通知

**Files:**
- Modify: `admin/src/index.ts`（Bindings、import、兩個端點）

無新單元測試：通知決策邏輯已由 Task 1 的純函式涵蓋；本任務僅接線，靠 `typecheck` 驗證。

- [ ] **Step 1: Bindings 加 webhook secret 型別**

Modify `admin/src/index.ts`（約 line 92–98）：

```ts
type Bindings = {
  DB: D1Database;
  NOVA_DB: D1Database;
  CRYSTAL_DB: D1Database;
  CURATOR_EMAILS: string;
  YOUTUBE_API_KEY: string;
  DISCORD_WEBHOOK_FEEDBACK: string;
};
```

- [ ] **Step 2: import discord 模組**

Modify `admin/src/index.ts`：在 `import { formatSubscriberCount } from '../shared/format';`（約 line 52）後新增：

```ts
import { feedbackEmbedForSubmission, feedbackEmbedForVod, postDiscord } from '../shared/discord';
```

- [ ] **Step 3: Streamer status 端點接通知**

Modify `admin/src/index.ts` `PATCH /api/nova/submissions/:id/status`：把結尾的 `return c.json(updated);` 換成（在它前面插入通知區塊）：

```ts
  const feedbackEmbed = updated ? feedbackEmbedForSubmission(existing.status, body.status, updated) : null;
  if (feedbackEmbed) {
    c.executionCtx.waitUntil(
      postDiscord(c.env.DISCORD_WEBHOOK_FEEDBACK, [feedbackEmbed]).catch((err) =>
        console.error('discord feedback notify failed', err),
      ),
    );
  }

  return c.json(updated);
```

（`existing` 已 `SELECT id, status`，`updated` 為 `NovaSubmission`，含 `display_name`/`reviewer_note` —— 無需改查詢。）

- [ ] **Step 4: VOD status 端點補舊 status 並接通知**

Modify `admin/src/index.ts` `PATCH /api/nova/vods/:id/status`：

(a) 把 existing 查詢從只取 id 改成取 status：

```ts
  const existing = await c.env.NOVA_DB
    .prepare('SELECT id, status FROM vod_submissions WHERE id = ?')
    .bind(id)
    .first<{ id: string; status: string }>();

  if (!existing) return c.json({ error: 'VOD submission not found' }, 404);
```

(b) 結尾 `return c.json(updated);` 前插入通知區塊：

```ts
  const feedbackEmbed = updated ? feedbackEmbedForVod(existing.status, body.status, updated) : null;
  if (feedbackEmbed) {
    c.executionCtx.waitUntil(
      postDiscord(c.env.DISCORD_WEBHOOK_FEEDBACK, [feedbackEmbed]).catch((err) =>
        console.error('discord feedback notify failed', err),
      ),
    );
  }

  return c.json(updated);
```

（`updated` 為 `NovaVodSubmission`，含 `stream_title`/`streamer_slug`/`reviewer_note`。）

- [ ] **Step 5: 型別檢查**

Run: `cd admin && npm run check`
Expected: typecheck 無錯、所有測試通過。

> 註：production 若尚未設 `DISCORD_WEBHOOK_FEEDBACK` secret，`c.env.DISCORD_WEBHOOK_FEEDBACK` 在 runtime 為 `undefined` → `postDiscord` 直接 no-op，不會壞掉審核。實際部署在 Task 6。

- [ ] **Step 6: Commit**

```bash
cd /Users/hydai/workspace/vibe/vtuber/prism.oshi.tw
npx lineguard admin/src/index.ts
git add admin/src/index.ts
git commit -m "$(cat <<'EOF'
feat(admin): notify contributor-feedback channel on review

Streamer + VOD status endpoints fire a best-effort Discord webhook via
waitUntil on a real transition to approved/rejected. VOD endpoint now selects
the old status to detect the transition.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: sync-registry 公告（新 Streamer + 訂閱數）

**Files:**
- Modify: `tools/sync-registry/sync.ts`
- Test: `tools/sync-registry/sync.test.ts`
- Modify: `package.json`（root）

- [ ] **Step 1: 寫失敗測試**

Create `tools/sync-registry/sync.test.ts`：

```ts
import * as assert from 'node:assert/strict';

import { diffStreamers } from './sync.ts';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

function cfg(slug: string, displayName: string, subscriberCount: string) {
  return {
    slug,
    displayName,
    description: '',
    avatarUrl: '',
    brandName: '',
    subscriberCount,
    group: '',
    socialLinks: {},
    theme: {} as Record<string, string>,
    enabled: true,
  };
}

test('diffStreamers finds brand-new slugs', () => {
  const diff = diffStreamers([cfg('a', 'A', '1萬')], [cfg('a', 'A', '1萬'), cfg('b', 'B', '2萬')]);
  assert.equal(diff.newStreamers.length, 1);
  assert.equal(diff.newStreamers[0].slug, 'b');
  assert.equal(diff.subscriberChanges.length, 0);
});

test('diffStreamers detects subscriber count changes', () => {
  const diff = diffStreamers([cfg('a', 'A', '1萬')], [cfg('a', 'A', '1.2萬')]);
  assert.equal(diff.newStreamers.length, 0);
  assert.deepEqual(diff.subscriberChanges, [{ displayName: 'A', from: '1萬', to: '1.2萬' }]);
});

test('diffStreamers ignores unchanged subscriber counts', () => {
  const diff = diffStreamers([cfg('a', 'A', '1萬')], [cfg('a', 'A', '1萬')]);
  assert.equal(diff.subscriberChanges.length, 0);
});

test('diffStreamers ignores changes when a count is empty', () => {
  const diff = diffStreamers([cfg('a', 'A', '')], [cfg('a', 'A', '1萬')]);
  assert.equal(diff.subscriberChanges.length, 0);
});

console.log('sync-registry.test: all passed');
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx tsx tools/sync-registry/sync.test.ts`
Expected: FAIL —— `diffStreamers` 尚未匯出（import 取得 undefined → 呼叫時 TypeError）。

- [ ] **Step 3: 加 diff + 公告，並改 main 為 async + guard**

Modify `tools/sync-registry/sync.ts`：

(a) 在現有 import 區塊（`import { seedIfMissing } from '../shared/sync-state.ts';` 之後）新增：

```ts
import { newStreamerEmbed, subscriberDigestEmbed, postDiscord, type DiscordEmbed } from '../../admin/shared/discord.ts';
import { loadAnnounceWebhook } from '../shared/announce.ts';
```

(b) 在 `writeRegistry` 函式定義「之前」新增 diff + 讀舊檔 + 公告區塊：

```ts
// --- Announce diff (publish-time, fan channel) ---

interface SubscriberChange {
  displayName: string;
  from: string;
  to: string;
}

export interface StreamerDiff {
  newStreamers: StreamerConfig[];
  subscriberChanges: SubscriberChange[];
}

/** Diff previously-published streamers vs the freshly-built list. */
export function diffStreamers(oldStreamers: StreamerConfig[], newStreamers: StreamerConfig[]): StreamerDiff {
  const oldBySlug = new Map(oldStreamers.map((s) => [s.slug, s]));
  const result: StreamerDiff = { newStreamers: [], subscriberChanges: [] };
  for (const s of newStreamers) {
    const prev = oldBySlug.get(s.slug);
    if (!prev) {
      result.newStreamers.push(s);
    } else if (s.subscriberCount && prev.subscriberCount && s.subscriberCount !== prev.subscriberCount) {
      result.subscriberChanges.push({ displayName: s.displayName, from: prev.subscriberCount, to: s.subscriberCount });
    }
  }
  return result;
}

function readExistingStreamers(): StreamerConfig[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8')) as { streamers?: StreamerConfig[] };
    return parsed.streamers ?? [];
  } catch {
    return [];
  }
}

async function announceRegistry(diff: StreamerDiff): Promise<void> {
  const webhook = loadAnnounceWebhook();
  if (!webhook) return;

  const embeds: DiscordEmbed[] = [];
  for (const s of diff.newStreamers) {
    embeds.push(newStreamerEmbed({ displayName: s.displayName, group: s.group, link: s.socialLinks.youtube ?? s.externalUrl ?? '' }));
  }
  if (diff.subscriberChanges.length > 0) {
    embeds.push(subscriberDigestEmbed(diff.subscriberChanges));
  }
  if (embeds.length === 0) return;

  try {
    await postDiscord(webhook, embeds);
    console.log(`  📢 announced ${diff.newStreamers.length} new streamer(s), ${diff.subscriberChanges.length} subscriber change(s)`);
  } catch (err) {
    console.warn(`  ⚠ Discord announce failed: ${(err as Error).message}`);
  }
}
```

(c) 把 `function main(): void {` 改成 `async function main(): Promise<void> {`，在建立 `streamers` 之前讀舊檔、在三個 write 之後公告：

```ts
async function main(): Promise<void> {
  console.log('sync-registry: querying Nova DB for approved submissions...');
  const rows = queryNovaDb();

  if (rows.length === 0) {
    console.error('ERROR: No approved+enabled submissions found in Nova DB.');
    process.exit(1);
  }

  console.log(`  found ${rows.length} approved streamer(s): ${rows.map((r) => r.slug).join(', ')}`);

  const oldStreamers = readExistingStreamers();
  const streamers = rows.map(rowToConfig);

  // Fall back to mizuki's theme for streamers with all-#000000 placeholder themes
  const mizuki = streamers.find((s) => s.slug === 'mizuki');
  if (mizuki) {
    for (const s of streamers) {
      if (s.slug !== 'mizuki' && isAllBlackTheme(s.theme)) {
        console.log(`  ⚠ ${s.slug} has placeholder theme (all #000000), using mizuki theme as default`);
        s.theme = { ...mizuki.theme };
      }
    }
  }

  writeRegistry(streamers);
  writeSlugs(streamers);
  scaffoldDataDirs(streamers);

  await announceRegistry(diffStreamers(oldStreamers, streamers));

  console.log('sync-registry: done.');
}
```

(d) 把檔尾的 `main();` 換成 guard（避免 test import 時執行 main 打 DB）：

```ts
function isMainScript(): boolean {
  const entry = process.argv[1] ?? '';
  return entry.endsWith('tools/sync-registry/sync.ts') || entry.endsWith('tools/sync-registry/sync.js');
}

if (isMainScript()) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx tsx tools/sync-registry/sync.test.ts`
Expected: 4 個 ✓，最後印 `sync-registry.test: all passed`。

- [ ] **Step 5: 接上 root 測試腳本**

Modify `package.json`（root）：在 `test:announce` 後新增：

```json
    "test:announce": "npx tsx tools/shared/announce.test.ts",
    "sync:registry:test": "npx tsx tools/sync-registry/sync.test.ts"
```

Run: `npm run sync:registry:test`
Expected: `sync-registry.test: all passed`。

- [ ] **Step 6: Commit**

```bash
npx lineguard tools/sync-registry/sync.ts tools/sync-registry/sync.test.ts
git add tools/sync-registry/sync.ts tools/sync-registry/sync.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(sync-registry): announce new streamers + subscriber changes

Diffs the freshly-built registry against the committed registry.json before
overwriting, then posts new streamers and a subscriber-change digest to the
announce channel. main() is now async + guarded so the diff is unit-testable.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: sync-data 公告（新歌回）

**Files:**
- Modify: `tools/sync-data/sync.ts`
- Test: `tools/sync-data/sync.test.ts`
- Modify: `package.json`（root）

- [ ] **Step 1: 寫失敗測試**

Create `tools/sync-data/sync.test.ts`：

```ts
import * as assert from 'node:assert/strict';

import { diffStreams, songCountForStream } from './sync.ts';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

const streamA = { id: 's1', title: 'A', date: '2024-01-01', videoId: 'v1', youtubeUrl: 'u1' };
const streamB = { id: 's2', title: 'B', date: '2024-02-01', videoId: 'v2', youtubeUrl: 'u2' };

test('diffStreams returns streams whose id is new', () => {
  assert.deepEqual(diffStreams([streamA], [streamA, streamB]), [streamB]);
});

test('diffStreams returns empty when nothing is new', () => {
  assert.deepEqual(diffStreams([streamA, streamB], [streamA, streamB]), []);
});

test('diffStreams treats an empty old list as all-new', () => {
  assert.deepEqual(diffStreams([], [streamA]), [streamA]);
});

test('songCountForStream counts distinct songs performed in the stream', () => {
  const perf = (id: string, streamId: string) => ({
    id,
    streamId,
    date: '',
    streamTitle: '',
    videoId: '',
    timestamp: 0,
    endTimestamp: null,
    note: '',
  });
  const songs = [
    { id: 'song1', title: 'X', originalArtist: '', tags: [], performances: [perf('p1', 's1')] },
    { id: 'song2', title: 'Y', originalArtist: '', tags: [], performances: [perf('p2', 's2')] },
    { id: 'song3', title: 'Z', originalArtist: '', tags: [], performances: [perf('p3', 's1')] },
  ];
  assert.equal(songCountForStream(songs, 's1'), 2);
  assert.equal(songCountForStream(songs, 's2'), 1);
});

console.log('sync-data.test: all passed');
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx tsx tools/sync-data/sync.test.ts`
Expected: FAIL —— `diffStreams`/`songCountForStream` 尚未匯出。

- [ ] **Step 3: 加 diff + 公告，並改 main 為 async + guard**

Modify `tools/sync-data/sync.ts`：

(a) 在現有 import 區塊（`import { syncStatePath, upsertEntry, type SyncStateEntry } from '../shared/sync-state.ts';` 之後）新增：

```ts
import { newStreamEmbed, newStreamsSummaryEmbed, postDiscord, type DiscordEmbed } from '../../admin/shared/discord.ts';
import { loadAnnounceWebhook } from '../shared/announce.ts';
```

(b) 在 `querySnapshot` 函式定義「之後」、`main` 之前新增：

```ts
// --- Announce diff (publish-time, fan channel) ---

const ANNOUNCE_FLOOD_CAP = 10;

/** New streams = streams whose id was not in the previously-published file. */
export function diffStreams(oldStreams: FanSiteStream[], newStreams: FanSiteStream[]): FanSiteStream[] {
  const oldIds = new Set(oldStreams.map((s) => s.id));
  return newStreams.filter((s) => !oldIds.has(s.id));
}

/** Count distinct songs performed in a given stream. */
export function songCountForStream(songs: FanSiteSong[], streamId: string): number {
  return songs.filter((song) => song.performances.some((p) => p.streamId === streamId)).length;
}

function readExistingStreams(streamsPath: string): FanSiteStream[] {
  try {
    return JSON.parse(fs.readFileSync(streamsPath, 'utf-8')) as FanSiteStream[];
  } catch {
    return [];
  }
}

function streamerDisplayName(slug: string): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'data/registry.json'), 'utf-8')) as {
      streamers?: Array<{ slug: string; displayName: string }>;
    };
    return parsed.streamers?.find((s) => s.slug === slug)?.displayName ?? slug;
  } catch {
    return slug;
  }
}

async function announceData(slug: string, newStreams: FanSiteStream[], songs: FanSiteSong[]): Promise<void> {
  const webhook = loadAnnounceWebhook();
  if (!webhook || newStreams.length === 0) return;

  const displayName = streamerDisplayName(slug);
  let embeds: DiscordEmbed[];
  if (newStreams.length > ANNOUNCE_FLOOD_CAP) {
    embeds = [newStreamsSummaryEmbed(displayName, newStreams.length)];
  } else {
    embeds = newStreams.map((s) =>
      newStreamEmbed({
        displayName,
        streamTitle: s.title,
        videoId: s.videoId,
        songCount: songCountForStream(songs, s.id),
        thumbnailUrl: `https://i.ytimg.com/vi/${s.videoId}/mqdefault.jpg`,
      }),
    );
  }

  try {
    await postDiscord(webhook, embeds);
    console.log(`  📢 announced ${newStreams.length} new stream(s)`);
  } catch (err) {
    console.warn(`  ⚠ Discord announce failed: ${(err as Error).message}`);
  }
}
```

(c) 把 `function main(): void {` 改成 `async function main(): Promise<void> {`，在覆寫 `streams.json` 之前讀舊檔、在寫檔與既有 snapshot 流程之後公告。具體：在 `const streamsPath = path.join(dataDir, 'streams.json');` 後、`fs.writeFileSync(songsPath, ...)` 前插入一行讀舊檔；並在 `upsertEntry(...)` / `stamped` log 之後、`console.log('sync-data: done.')` 前插入公告：

```ts
  const songsPath = path.join(dataDir, 'songs.json');
  const streamsPath = path.join(dataDir, 'streams.json');

  const oldStreams = readExistingStreams(streamsPath);

  fs.writeFileSync(songsPath, JSON.stringify(songs, null, 2) + '\n', 'utf-8');
  fs.writeFileSync(streamsPath, JSON.stringify(streams, null, 2) + '\n', 'utf-8');
```

…（中間原本的 log / snapshot / upsertEntry 不動）…

```ts
  upsertEntry(ROOT, slug, entry);
  console.log(`  stamped ${syncStatePath(ROOT)}`);

  await announceData(slug, diffStreams(oldStreams, streams), songs);

  console.log('sync-data: done.');
}
```

(d) 把檔尾的 `main();` 換成 guard：

```ts
function isMainScript(): boolean {
  const entry = process.argv[1] ?? '';
  return entry.endsWith('tools/sync-data/sync.ts') || entry.endsWith('tools/sync-data/sync.js');
}

if (isMainScript()) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx tsx tools/sync-data/sync.test.ts`
Expected: 4 個 ✓，最後印 `sync-data.test: all passed`。

- [ ] **Step 5: 接上 root 測試腳本**

Modify `package.json`（root）：在 `sync:registry:test` 後新增：

```json
    "sync:registry:test": "npx tsx tools/sync-registry/sync.test.ts",
    "sync:data:test": "npx tsx tools/sync-data/sync.test.ts"
```

Run: `npm run sync:data:test`
Expected: `sync-data.test: all passed`。

- [ ] **Step 6: Commit**

```bash
npx lineguard tools/sync-data/sync.ts tools/sync-data/sync.test.ts
git add tools/sync-data/sync.ts tools/sync-data/sync.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(sync-data): announce newly collected streams

Diffs against the committed streams.json before overwriting; posts one embed
per new stream (with song count + thumbnail), collapsing to a summary above 10
to avoid flooding on a new streamer's backlog. main() is now async + guarded.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 設定 secrets、部署、手動驗收

**Files:** 無程式碼變更（設定與驗證）。

- [ ] **Step 1: 在 Discord 建立兩個 webhook**

於 Discord Server → 各頻道 → 編輯頻道 → 整合 → Webhook → 新增 Webhook，複製 URL：
- 📝 回饋頻道 → 之後設為 `DISCORD_WEBHOOK_FEEDBACK`
- 📢 公告頻道 → 之後設為 `DISCORD_WEBHOOK_ANNOUNCE`

> 建議：先用**丟棄式測試頻道**的 webhook 跑完驗收，再換正式頻道 URL。

- [ ] **Step 2: 設定公告 webhook（本地 sync 用）**

把公告 webhook 寫入 `admin/.dev.vars`（已 gitignore）。可用編輯器新增一行：

```
DISCORD_WEBHOOK_ANNOUNCE=<貼上公告頻道 webhook URL>
```

驗證載入：

Run: `npx tsx -e "import('./tools/shared/announce.ts').then(m => console.log(Boolean(m.loadAnnounceWebhook())))"`
Expected: `true`

- [ ] **Step 3: 設定回饋 webhook（worker secret）**

Run: `cd admin && npx wrangler secret put DISCORD_WEBHOOK_FEEDBACK`
貼上回饋頻道 webhook URL。
（如需本地 `wrangler dev` 測試，另在 `admin/.dev.vars` 加 `DISCORD_WEBHOOK_FEEDBACK=<同一 URL>`。）

- [ ] **Step 4: 部署 admin worker**

請 hydai 在對話列輸入 slash command：`/deploy-admin`
（依 CLAUDE.md，`admin/` 改動必須部署才生效。Claude 不自行執行部署。）

- [ ] **Step 5: 驗收回饋頻道**

在 admin UI 對一筆**測試** VOD 投稿按「退回」並填理由 → 確認 📝 回饋頻道出現紅色「❌ VOD 投稿未通過」且顯示理由。再對一筆按「核可」→ 確認綠色「✅ VOD 投稿已收錄」。

- [ ] **Step 6: 驗收公告頻道**

- 訂閱數／新 streamer：`npm run sync:registry`，若 Nova DB 自上次 sync 後有訂閱數變動或新 streamer，確認 📢 出現 📈／🎉。（無變動則無訊息，屬正常。）
- 新歌回：對某 streamer 跑 `npm run sync:data -- <slug>`，若有新核可的 stream，確認 📢 出現 🎵（含曲數與縮圖）。

- [ ] **Step 7: 換正式 webhook（若 Step 1 用測試頻道）**

把 `admin/.dev.vars` 的 `DISCORD_WEBHOOK_ANNOUNCE` 換成正式公告頻道 URL；重設 `cd admin && npx wrangler secret put DISCORD_WEBHOOK_FEEDBACK` 為正式回饋頻道 URL，並再次 `/deploy-admin`。

---

## Self-Review

**1. Spec coverage**
- 投稿審核通過／退回（含理由）→ 回饋頻道：Task 1（`feedbackEmbedFor*` + reject 帶 `reviewer_note`）+ Task 3（worker 接線）。✓
- 新 Streamer 上架 → 公告：Task 1（`newStreamerEmbed`）+ Task 4（`diffStreamers` 新 slug）。✓
- 訂閱數變動（每次變化）→ 公告 digest：Task 1（`subscriberDigestEmbed`）+ Task 4（`diffStreamers` subscriberChanges）。✓
- 新歌回收錄 → 公告：Task 1（`newStreamEmbed`/summary）+ Task 5（`diffStreams`）。✓
- Best-effort／不阻擋：Task 3（`waitUntil` + `.catch`）、Task 4/5（try/catch warn）、`postDiscord` 無 webhook no-op。✓
- 只在真實轉換時推：`feedbackEmbedFor*` 的 `oldStatus === newStatus` 守門 + VOD 端點補 `SELECT status`。✓
- 防洪上限 10：Task 5 `ANNOUNCE_FLOOD_CAP`。✓
- Secrets／部署：Task 6。✓

**2. Placeholder scan**：無 TBD／TODO；每個 code step 均為完整可貼上的程式碼。✓

**3. Type consistency**
- 回饋 builder 收 snake_case（`display_name`/`reviewer_note`/`stream_title`/`streamer_slug`），對齊 `NovaSubmission`/`NovaVodSubmission`，worker 直接傳 `updated`。✓
- 公告 builder 收 camelCase（`displayName`/`subscriberCount`/`videoId`），對齊 sync 端 `StreamerConfig`/`FanSiteStream`/`FanSiteSong`。✓
- `diffStreamers` 回傳 `StreamerDiff{ newStreamers, subscriberChanges }`，Task 4 測試與 `announceRegistry` 用同欄位名。✓
- `postDiscord(webhookUrl, embeds)` 簽名在 worker 與兩支 sync 一致。✓
- admin 測試不可用 `node:assert`（tsconfig types 僅 workers-types）→ 已用手寫 `check`；tools 測試用 `node:assert`。✓
