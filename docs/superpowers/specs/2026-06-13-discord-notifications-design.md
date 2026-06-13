# Discord 後台變動推播通知 — 設計

- **日期**：2026-06-13
- **狀態**：已完成 —— 設計 → 實作計畫（`docs/superpowers/plans/2026-06-13-discord-notifications.md`）→ 實作（見本 PR）
- **作者**：hydai（與 Claude 共同 brainstorm）

## 1. 背景與目標

新開了一個 Discord Server，希望後台資料有變動時自動推播到指定頻道，
讓粉絲與投稿者不必等人工公告。三類來源：

1. Streamer 資料變動 — 新增 Streamer、訂閱數變動
2. 收錄新的 Stream VOD
3. 被拒絕的 Stream VOD（需列出拒絕理由）

### 兩個頻道（已確認）

- **📢 公告頻道（粉絲）**：新 Streamer 上架、新歌回收錄、訂閱數變動
- **📝 回饋頻道（投稿者）**：投稿審核結果（通過／退回 + 理由）

兩個頻道 v1 都是**公開、不點名**（資料庫目前未存任何投稿者身分，無法 @mention 或 DM）。

## 2. 範圍

### 做（v1）

- 投稿審核（streamer / VOD，通過與退回）即時推到 📝 回饋頻道，退回附 `reviewer_note`。
- 新 Streamer 上架、新歌回收錄、訂閱數變動，在**資料上站時**推到 📢 公告頻道。
- 訂閱數「每次有變化都推」，但同一次 sync 合併成一則 digest。

### 不做（YAGNI，明確排除）

- @mention／DM 個別投稿者（沒存身分 → 未來可加「Discord handle」欄位作第二階段）。
- 里程碑式訂閱邏輯（改用每次變動 digest）。
- 已公告歌回內事後新增單曲的二次通知。
- 偵測用 `wrangler d1 execute` 直接改 DB 的變動（繞過 worker 與 sync，不保證通知）。

## 3. 架構：雙發送點 Hybrid

每個事件在它**語意最自然的時點**從對應的程式發出，兩條路徑都是 best-effort
（絕不阻擋或弄壞它所掛載的動作）。

```
📝 回饋頻道 (contributor)              📢 公告頻道 (fans)
   ▲ 審核當下 (review time)              ▲ 上站後 (after git push)
   │                                    │
admin worker（即時 post）             sync 腳本 enqueue → 佇列 → announce:flush（push 後 post）
  PATCH /api/nova/submissions/:id/status   sync-registry.ts → diff registry.json
  PATCH /api/nova/vods/:id/status          sync-data.ts     → diff streams.json
   │                                    │     佇列：data/.pending-announce.json（gitignored）
   └─ DISCORD_WEBHOOK_FEEDBACK          └─ DISCORD_WEBHOOK_ANNOUNCE
      (wrangler secret)                    (admin/.dev.vars，本地)
```

### 為什麼這樣切

- **退回事件只存在於 worker 路徑**：退回的投稿永遠不會進 sync／不會上站，所以
  「退回 + 理由」一定得即時從 worker 發 — 與「審核當下」時點天然吻合。
- **公告的去重由 git 免費提供**：公告的 diff = 「本次新建的資料」−「磁碟上現有的
  committed JSON」。重跑 sync 而 DB 沒變 → 空 diff → 不會重複公告。**不需要 cursor
  或 snapshot 表**：version-controlled 的 JSON 是「**已 commit／已上站**」的狀態快照
  （**不是**「已通知」——通知是 best-effort，見下一點）。
- **公告在 push 之後才送出**：sync 期間只把 embeds **enqueue** 到 gitignored 的
  `data/.pending-announce.json`；資料 commit + push 後，`npm run announce:flush` 才真正
  POST 到 Discord（已接進 `/sync-data`、`/sync-registry`、`/sync-stale` 的最後一步）。
  如此粉絲只會收到「真的上站」的資料通知；**flush 失敗則 embeds 留在佇列等下次重送，
  不會遺失**（這也是為何快照語意是「已上站」而非「已通知」）。
- **訂閱數放公告／上站時點最乾淨**：訂閱數存在 `registry.json`，它的「上站時刻」就是
  `sync-registry`。同一個腳本可同時發「新 Streamer 上架」與「訂閱數變動」。

## 4. 事件路由表（設計核心）

| 事件 | 偵測點 | 觸發時機 | 頻道 | 內容摘要 |
|---|---|---|---|---|
| Streamer 投稿**通過** | worker `submissions/:id/status`，`old≠new` 且 `new=approved` | 審核當下 | 📝 回饋 | ✅ streamer X 投稿通過 |
| Streamer 投稿**退回** | 同上，`new=rejected` | 審核當下 | 📝 回饋 | ❌ X 未通過 · **理由：note** |
| **新 Streamer 上架** | sync-registry diff（registry.json 出現新 slug） | 上站後 | 📢 公告 | 🎉 新 Streamer 上架：X |
| **訂閱數變動** | sync-registry diff（slug 的 `subscriber_count` 字串變了） | 上站後 | 📢 公告 | 📈 digest：X 21.8萬→21.9萬 |
| VOD 投稿**通過** | worker `vods/:id/status`，`old≠new` 且 `new=approved` | 審核當下 | 📝 回饋 | ✅ VOD「title」已收錄 |
| VOD 投稿**退回** | 同上，`new=rejected` | 審核當下 | 📝 回饋 | ❌「title」未通過 · **理由：note** |
| **新歌回收錄** | sync-data：某 stream 首次「已在 streams.json 且 ≥1 首歌」（涵蓋 stream 先核可或歌先核可兩種順序） | 上站後 | 📢 公告 | 🎵 新收錄：X「title」(N 首) |

**核可一筆 VOD 會在兩個時點各發一次**：審核當下發 📝 回饋（給投稿者即時回覆），
上站時發 📢 公告（給粉絲）。語意各自正確，非重複。

## 5. 資料來源細節（實作要對齊的真實程式）

### 5.1 回饋頻道（admin worker）

**Streamer：`admin/src/index.ts` `PATCH /api/nova/submissions/:id/status`**
- 現況：已 `SELECT id, status FROM submissions`（取得 `existing.status`），更新後
  回傳完整 `updated` 列（含 `display_name`、`slug`、`reviewer_note`）。
- 變更：更新成功後，若 `existing.status !== body.status` 且
  `body.status ∈ {approved, rejected}`，建 embed 並
  `c.executionCtx.waitUntil(postDiscord(c.env.DISCORD_WEBHOOK_FEEDBACK, [embed]).catch(logErr))`。

**VOD：`admin/src/index.ts` `PATCH /api/nova/vods/:id/status`**
- 現況：只 `SELECT id FROM vod_submissions`（**沒取舊 status**），更新後回傳完整
  `updated`（含 `stream_title`、`streamer_slug`、`video_id`、`reviewer_note`）。
- 變更：把 existing 查詢改成 `SELECT id, status`，用同一條件判斷真實轉換後推播。
  （避免重複按「核可」造成重複推播。）

### 5.2 公告頻道（sync 腳本）

**`tools/sync-registry/sync.ts`（`main()`，寫檔前）**
- 現況：`queryNovaDb()` → `rowToConfig()` 建出 `StreamerConfig[]`，再 `writeRegistry()`
  覆寫 `data/registry.json`。寫檔前舊檔仍在磁碟。
- 變更：寫檔前讀現有 `registry.json`（若存在）建 `slug → { subscriber_count }` map，
  與新建清單 diff：
  - **新 slug**（新清單有、舊清單無）→ 新 Streamer embed。
  - **既有 slug 且 `subscriber_count` 字串改變**（兩邊都非空）→ 收進訂閱數 digest。
  - 發 `DISCORD_WEBHOOK_ANNOUNCE`，再照原流程 `writeRegistry()` + commit。

**`tools/sync-data/sync.ts`（`main()`，每位 streamer 寫檔前）**
- 現況：`buildSongs()` / `buildStreams()` 後 `writeFileSync` 覆寫
  `data/{slug}/streams.json`（與 `songs.json`）。
- 變更：寫 `streams.json` 前讀現有檔建 stream `id` 集合，與新清單 diff：
  - **新 stream**（新清單有、舊集合無）→ 新歌回 embed；曲數 = 該 stream 在本次建出的
    歌曲／performance 數。
  - 發 `DISCORD_WEBHOOK_ANNOUNCE`，再照原流程寫檔。

## 6. 訊息格式：Discord embeds

採用 embeds（彩色卡片）而非純文字，色碼分流：通過=綠、退回=紅、公告=主題色／藍。

```
📝 回饋頻道 — 退回（紅色邊條）
┌──────────────────────────────────────┐
│ ❌ 投稿未通過                           │
│ VOD「2024 新年歌枠」· streamer：earendel │
│ 理由：時間軸與現有收錄重複，請確認後重投    │
└──────────────────────────────────────┘

📢 公告頻道 — 新歌回（主題色 + 縮圖）
┌──────────────────────────────────────┐
│ 🎵 新收錄歌回                           │
│ earendel —「深夜限定 Acoustic Live」     │
│ 🎶 12 首歌   ▶ youtu.be/xxxx           │ [縮圖]
└──────────────────────────────────────┘

📢 公告頻道 — 訂閱數 digest（一則內列多筆）
┌──────────────────────────────────────┐
│ 📈 訂閱數更新                           │
│ • 浠Mizuki  21.8萬 → 21.9萬            │
│ • Gabu      7.88萬 → 8.01萬            │
└──────────────────────────────────────┘
```

**Discord 限制需遵守**：單則訊息 ≤ 10 embeds、title ≤ 256、description ≤ 4096、
≤ 25 fields。訂閱數 digest 全列在「一個 embed」的 description（逐行），若超過約
30 筆則截斷並附「…還有 N 筆」。

## 7. 元件與檔案變更

1. **`admin/shared/discord.ts`（新增）** — 共用模組。放 `admin/shared/` 因為 tsx sync
   腳本**已能** import `admin/shared`（`tools/fetch-channel-info` 即 import
   `admin/shared/format.ts`）。worker 與 Node 共用同一份格式化邏輯；`fetch` 兩邊皆為全域。
   - 純 embed builder（無 I/O，可單測）：
     - `streamerApprovedEmbed({ displayName, slug })`
     - `streamerRejectedEmbed({ displayName, reviewerNote })`
     - `vodApprovedEmbed({ streamTitle, streamerSlug, videoId })`
     - `vodRejectedEmbed({ streamTitle, streamerSlug, reviewerNote })`
     - `newStreamerEmbed({ displayName, slug, group, link })`
     - `subscriberDigestEmbed(changes: { displayName, from, to }[])`
     - `newStreamEmbed({ displayName, streamTitle, videoId, songCount, thumbnailUrl })`
   - `postDiscord(webhookUrl: string | undefined, embeds: DiscordEmbed[]): Promise<void>`
     — `webhookUrl` 空或 `embeds` 空 → no-op；否則 POST `{ embeds }`，非 2xx 則 throw
     （由呼叫端 catch）。色碼常數（GREEN/RED/THEME）。
2. **`admin/src/index.ts`** — 兩個 status 端點接 `waitUntil(postDiscord(...).catch(log))`；
   **VOD 端點補 `SELECT id, status`**。
3. **`tools/sync-registry/sync.ts`** — 寫檔前讀舊 registry.json、diff、發公告；
   抽出純函式 `diffStreamers(oldConfigs, newConfigs)` → `{ newStreamers, subscriberChanges }`。
4. **`tools/sync-data/sync.ts`** — 寫檔前讀舊 streams.json、diff、發公告；
   抽出純函式 `diffStreams(oldStreams, newStreams)` → `newStreams[]`。
5. **`admin/shared/discord.test.ts`（新增）** — 測純 builder（比照現有 `*.test.ts`）。
6. **sync 腳本的 diff 純函式單測** — 用 fixture 舊／新 JSON 驗證。

## 8. 設定與密鑰

- **`DISCORD_WEBHOOK_FEEDBACK`**（回饋頻道）：`wrangler secret put DISCORD_WEBHOOK_FEEDBACK`
  設到 `prism-admin` worker；本地 `wrangler dev` 則放 `admin/.dev.vars`。
- **`DISCORD_WEBHOOK_ANNOUNCE`**（公告頻道，只給本地 sync 腳本用）：放
  `admin/.dev.vars`（已 gitignore），由 sync 腳本以 `fetch-channel-info` 的同款
  `.dev.vars` 解析方式讀取（亦接受 `process.env` 覆寫）。
- **未設定 webhook → 靜默跳過**（本地開發或功能關閉皆安全）。

## 9. 防呆 / 邊界 / 失敗處理

- **Best-effort**：webhook 失敗只 log；不得阻擋審核 HTTP 回應，也不得弄壞 sync／commit。
- **只在真實狀態轉換時推**（`old≠new`），避免重複按核可重複推。
- **退回 `reviewer_note` 為空**時顯示「（未填理由）」。
- **首次／bootstrap 防洪**：若某 `data/{slug}/streams.json` 是新 scaffold 的空 `[]`
  （新上架 streamer 首次 sync 有大量 backlog），單次 sync 的新歌回 embed **上限 10 則**；
  超過則改發一則彙總「本次新增 N 場歌回」。registry.json／既有 streams.json 已 committed
  且通常與 DB 同步，所以加上 diff 後首次跑多為空 diff。
- **Subrequest 預算**：每次審核動作最多 +1 Discord POST，遠低於 1000 上限；sync 在
  Node 執行，無 Workers subrequest 限制。
- **同影片多次投稿**（migration 0012 允許）：各 `id` 獨立審核，各自推一次，符合預期。

## 10. 測試策略

- `admin/shared/discord.test.ts`：驗證各 builder 的 title／color／description；退回 embed
  含 `reviewerNote`，空理由顯示「（未填理由）」；`postDiscord` 在 url 缺失時 no-op。
- sync diff 純函式：fixture 舊／新 JSON → 驗證 `diffStreamers` 找出新 slug 與訂閱數變動、
  `diffStreams` 找出新 stream。
- 手動驗收：先用**丟棄式測試 webhook**，核可／退回一筆測試投稿、對 scratch 改動跑 sync，
  確認兩頻道訊息正確後再換成正式頻道 webhook。

## 11. 部署

- 設定 `wrangler secret put DISCORD_WEBHOOK_FEEDBACK`，再 `/deploy-admin`
  （改了 `admin/` 一定要部署才生效）。
- `DISCORD_WEBHOOK_ANNOUNCE` 寫入 `admin/.dev.vars`。
- sync 腳本是本地工具，不需部署。

## 12. 開放問題

- `DISCORD_WEBHOOK_ANNOUNCE` 來源最終採「`admin/.dev.vars` 解析」與「`process.env`」何者
  優先：預設 `process.env` 優先、退回 `.dev.vars`，實作時定案即可。
- 公告新歌回的「曲數」定義：以本次建出資料中該 stream 的 distinct 歌曲數為準（實作時確認
  `sync-data` 內部資料結構）。
