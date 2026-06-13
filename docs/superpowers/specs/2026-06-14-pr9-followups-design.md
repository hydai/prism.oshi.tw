# PR #9 衍生 issue 修正 — 設計

- **日期**：2026-06-14
- **狀態**：設計中 —— brainstorm → 設計（本檔）→ 實作計畫 → 實作（兩個 PR）
- **作者**：hydai（與 Claude 共同 brainstorm）

## 1. 背景

PR #9（Discord 後台變動推播）合併時，Codex review 切出兩個與通知功能無關、屬於「審核流程／佇列健壯性」的 follow-up，獨立成 issue：

- **#10**（`admin/src/index.ts`）：VOD 核准的匯入若失敗，重試會被跳過，卡在「approved 但沒匯入」。
- **#11**（`tools/shared/announce.ts`）：粉絲公告佇列沒綁定到實際推上去的 commit，放棄 sync 後殘留項目會被誤發。

兩者碰不同子系統（admin worker vs. sync 工具），**分成兩個 PR**，#10 先做（外科手術式、低風險），#11 後做（動到佇列格式）。

---

## 2. Issue #10 — VOD 核准的匯入可在失敗後重試

### 2.1 問題（時序）

`PATCH /api/nova/vods/:id/status`（`admin/src/index.ts:1199`）在「真實轉換到 approved」時把 VOD 匯入 admin DB：

```
1. UPDATE vod_submissions SET status='approved'   ← Nova 先被標記
2. importVodToAdminDb(...)                         ← 若 throw,第 1 步已生效
```

目前 gate（`index.ts:1226`）是 `body.status === 'approved' && existing.status !== 'approved'`。它原本是為了擋「重複核准重跑匯入」（會刪除／重建已策展的 performances）。但引入了新邊界：

- 第 2 步丟例外（例：admin D1 暫時性 batch 失敗）→ Nova 那列已是 `approved`，admin DB 卻什麼都沒進。
- curator 再按一次核准 → `existing.status` 已是 `approved` → gate 為假 → **跳過匯入** → 永遠卡住。

亦即現行 gate 用「重試安全」換到了「不覆蓋安全」，我們兩個都要。

### 2.2 方案：以 admin DB 的「存在性」取代 Nova 狀態當 gate

判斷依據從「Nova 的 status」換成「這支影片在 admin DB 到底有沒有」：

1. 把抓 `vod`／`vodSongs` 的查詢移到 gate 之外（要先有 `video_id`／`streamer_slug` 才能查存在性）。
2. 新增純函式（放在 `admin/src/status.ts`，與 `isValidTransition` 同處）：

   ```ts
   export function shouldImportVod(targetStatus: NovaStatus, alreadyImported: boolean): boolean {
     return targetStatus === 'approved' && !alreadyImported;
   }
   ```

3. 呼叫端：

   ```ts
   const alreadyImported = await videoIdExists(c.env.DB, vod.video_id, vod.streamer_slug);
   if (shouldImportVod(body.status, alreadyImported)) {
     await importVodToAdminDb(c.env.DB, vod, vodSongs, user.email);
   }
   ```

三種情境都正確涵蓋：

| 情境 | admin DB | 行為 |
| --- | --- | --- |
| 首次核准 | 不存在 | 匯入 ✅ |
| 重複核准（已匯入） | 存在 | 跳過，不覆蓋策展資料 ✅ |
| 核准 → 匯入失敗 → 重試 | 不存在（batch 原子回滾） | 重新匯入 ✅ |

### 2.3 為什麼存在性檢查可靠

`importVodToAdminDb`（`admin/src/db.ts:657`）所有寫入都收進一個 `db.batch(stmts)`，而 **D1 的 batch 是原子的**——全進或全不進。所以不存在「匯入一半」的狀態，`videoIdExists` 的真假就是乾淨的重試訊號。

`videoIdExists`（`db.ts:365`）查的是 `SELECT 1 FROM streams WHERE video_id=? AND streamer_id=?`，與 `importVodToAdminDb` 內部的 existing-stream 判斷同源；因此 VOD 路徑經此 gate 後一律走 INSERT 分支，內部的覆蓋分支保留給其它呼叫者。

> 註：語意上「admin DB 已有此 video → 不再動它」比「Nova 狀態已 approved」更貼近原始意圖（不覆蓋已策展資料），故此改動同時更安全。

### 2.4 測試

在現有的 `admin/src/helpers.test.ts`（已單元測 `status.ts` 的 `isValidTransition`／`canHardDeleteStream`）追加 `shouldImportVod` 三情境的 `assertEqual`。沿用現有 harness（無 D1 mock、純函式 top-level assert），自動納入 `npm run check`，不需新測試檔或 `package.json` 改動。

### 2.5 影響檔案與部署

- `admin/src/index.ts`（VOD status endpoint 改 gate）
- `admin/src/status.ts`（新增 `shouldImportVod`）
- `admin/src/helpers.test.ts`（追加 `shouldImportVod` 測試，沿用現有 harness）
- **改完必須 `/deploy-admin`**（Cloudflare Worker，不部署不生效）。

---

## 3. Issue #11 — 公告佇列綁定到實際推上去的 revision

### 3.1 問題

公告在 sync 時算好（檔案覆寫前 diff 新資料 vs 已 commit 的 JSON），但只在 `git push` 之後由 `npm run announce:flush` 送出。佇列 `data/.pending-announce.json`（gitignored）的項目**沒綁定到任何 commit**：

- 若操作者跑了 sync 後**放棄 diff／push 失敗**而沒跑 flush，殘留項目留在佇列。
- 之後任一次成功 flush（在別的 push 後）會把這些 stale 項目一起送出——公告了從未上站／已被 revert 的資料。

現況靠「slash command 在 push 後緊接 flush」縮小視窗，且佇列本就是 best-effort；但它不綁定到已驗證的 revision。

### 3.2 方案（Option A）：flush 從「信任佇列」改成「驗證佇列」

利用一個時序事實：**flush 跑在 `git push` 之後，而 `git push` 成功會更新本地 `origin/master` ref**。於是 flush 可反問每個項目：「我要公告的這份資料，真的已經在 `origin/master` 上嗎？」相符才送，否則丟棄。此方案完全內建於 flush，**不需改 slash command、不依賴操作者紀律**（而那正是 issue 點名的脆弱點）。

### 3.3 佇列格式

`data/.pending-announce.json` 由

```json
{ "embeds": [ /* DiscordEmbed[] */ ] }
```

升級為帶指紋的 batch 陣列：

```json
{ "batches": [ { "embeds": [ ... ], "sources": ["data/mizuki/streams.json"], "hash": "<sha256>" } ] }
```

- `sources`：這則公告對應的 repo 相對資料檔。
- `hash`：enqueue 當下 `sources` 串接內容的 sha256。
- **核心規則：`sources` 為空／不存在 ⇒ 無條件送出**；非空 ⇒ 需驗證。空 `sources` 同時涵蓋兩個用途：
  1. 舊格式（`{ embeds }`）相容：讀進來包成一個無 sources 的 batch（維持現行行為，不退步）。
  2. partial-flush 後的「已驗證殘餘」：本輪已通過驗證、但送一半失敗的 embeds，重寫回佇列時標為無 sources，下輪直接送、不重驗。

### 3.4 `announce.ts` 變更

- `readPendingBatches(path?)`：回傳 `PendingBatch[]`；相容舊格式；ENOENT → `[]`。
- `writePendingBatches(batches, path?)`：空陣列 ⇒ 刪檔。
- `enqueueAnnouncements(batch, path?)`：append；但若已有相同 `sources`（非空、深度相等）的 batch 則**取代**——順手解掉「同一 slug 重跑造成重複公告」。
- `hashSources(sources, read?)`：sha256 of 串接內容；`read` 可注入（預設讀磁碟），測試傳假 reader。
- `partitionByLiveHash(batches, readLive)`：純函式，依「`sources` 空 ⇒ 一律 verified；否則 `hashSources(sources, readLive) === hash`」切成 `{ verified, stale }`；`readLive` 可注入。

### 3.5 `flush.ts` 變更

1. `readPendingBatches()`。
2. `partitionByLiveHash(batches, readLive)`，其中 `readLive(src) = git show origin/master:<src>`（可注入；`git show` 丟例外 ⇒ 視為 live 內容缺失 ⇒ 該 batch 歸 stale）。
3. 記 log 丟棄的 stale batch（數量 + sources），**立即把佇列重寫成只剩 verified**。
4. 把 verified 的 embeds 攤平，沿用現有「逐則 Discord 訊息送出 + 每次成功後 checkpoint」邏輯；送一半失敗時，把剩餘 embeds 重寫成一個無 `sources` 的 batch（下輪無條件送，不重驗，維持原本「不重複送已送出批次」保證）。

驗證的判定矩陣：

| 情境 | `origin/master` 上的內容 | 判定 |
| --- | --- | --- |
| 正常 sync → commit → push | == 入列時的新內容 | hash 相符 → 送出 ✅ |
| 放棄 diff（revert 檔案） | 維持舊內容 | hash 不符 → 丟棄 ✅ |
| push 失敗 | `origin/master` ref 未前進，仍是舊內容 | hash 不符／缺檔 → 丟棄 ✅ |

> 為什麼比對 `origin/master` 而非本地工作目錄？因為「push 失敗」時本地檔案其實已是新內容（commit 過了），用本地比對會誤判成「該送」。只有 `origin/master` 代表「真的推上去、粉絲網站真的會更新」的那份。

### 3.6 呼叫端（sources 的選定）

- `tools/sync-data/sync.ts`：`sources = ['data/<slug>/songs.json', 'data/<slug>/streams.json']`（兩檔同一次 sync 一起寫、一起上站；新歌回公告以此為準）。
- `tools/sync-registry/sync.ts`：`sources = ['data/registry.json']`（新 streamer／訂閱 digest 皆源自 registry）。

兩處皆：sync 寫完檔 → `hashSources(sources)` → `enqueueAnnouncements({ embeds, sources, hash })`。

### 3.7 測試

擴充 `tools/shared/announce.test.ts`（全單元級、不碰 git／網路）：

- `enqueueAnnouncements` 的 append／replace-by-sources 去重。
- `readPendingBatches` 舊格式（`{ embeds }`）相容。
- `hashSources` 以假 reader 算值穩定。
- `partitionByLiveHash` 以假 `readLive` 覆蓋三情境（相符送、revert 丟、缺檔丟）+ 空 sources 一律送。

### 3.8 影響檔案

- `tools/shared/announce.ts`、`tools/announce-flush/flush.ts`
- `tools/sync-data/sync.ts`、`tools/sync-registry/sync.ts`
- `tools/shared/announce.test.ts`

---

## 4. 交付

- **PR #1（#10）**：admin worker 修正 + 測試 →（review/merge）→ `/deploy-admin`。
- **PR #2（#11）**：sync 工具佇列驗證 + 測試。
- 每個 PR commit 前跑該子系統全部測試 + `npm run lint`；commit 後關閉對應 issue。

## 5. 明確不做（YAGNI）

- 不把 VOD 核准的「狀態更新 + 匯入」改成跨 D1（Nova／admin）的兩階段交易；以「存在性 gate + batch 原子性」達成等效重試安全即可。
- 不為 `#11` 引入 cursor／狀態表或資料庫；git 的 `origin/master` 即「已上站快照」，沿用 PR #9「committed JSON = 上次已通知」的同一思路。
- 不改 sync slash command 文件；驗證內建於 flush。
- 不對 announce 佇列做加密／簽章；它是 gitignored、短命的本機 sidecar。
