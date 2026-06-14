# Admin CSRF（bulk approve 與所有狀態變更端點）強化 — 設計

- **日期**：2026-06-14
- **狀態**：設計完成（已核准）—— brainstorm → 設計（本檔）→ 實作（TDD）
- **作者**：hydai（與 Claude 共同 brainstorm）
- **回報來源**：Codex security finding `b4f11203…`（criticality: high / attack-path: high；commit `b84ed7f`）

## 1. 背景與威脅模型

新加入的 `POST /api/streams/:streamId/approve-all` 是一個**無 request body、高影響力的狀態變更端點**：它一次把某場 stream 底下所有 `pending` 的 performance 與其關聯 song 批次改成 `approved`（見 `admin/src/db.ts` 的 `bulkApproveStream`）。整個 `/api/*` 目前只有 `requireAuth`（讀 Cloudflare Access 注入的 `CF-Access-Authenticated-User-Email`）與該路由的 `requireCurator`，**完全沒有任何瀏覽器請求真實性（CSRF）防護**。

汙染路徑：

```
攻擊者網頁（自動送出的跨站 HTML form）
  → 策展人瀏覽器帶著有效的 Cloudflare Access / session cookie
  → POST /api/streams/stream-YYYY-MM-DD/approve-all（可預測的 stream ID、無 body）
  → Worker 收到 Access 注入的身分標頭，僅 requireAuth + requireCurator 放行
  → bulkApproveStream(DB)
  → 未審核 / 惡意的 pending 歌曲與表演被批准 → 破壞 catalog 完整性
```

**為何 `approve-all` 特別危險**：傳統自動送出的 HTML `<form>` 只能產生「simple request」——不能帶自訂標頭，`Content-Type` 只能是 `application/x-www-form-urlencoded`／`multipart/form-data`／`text/plain`。`approve-all` 不讀 body，所以一個裸 form POST 就能完整觸發它，這是最經典、最低成本的 CSRF。

**核心觀念**：問題不在「身分驗證」（`requireAuth`/`requireCurator` 運作正常——無身分回 401、contributor 回 403、curator 回 200），而在於伺服器無法分辨「這個帶著合法 session 的請求，究竟是不是由我們自己的 admin UI 發出的」。修補就是補上這個「請求真實性」判斷。

### 1.1 範圍其實比單一端點更廣

Finding 已指出底層缺陷更廣。實際比對 `admin/ui/src/api/client.ts` 後確認：

- 還有第二個同型端點 `POST /api/streams/:streamId/unapprove-all`（同樣無 body），finding 未列出，但同樣可被 form CSRF 觸發。
- 其餘狀態變更端點（song/stream/performance/nova/crystal/pipeline/harmonize 的 POST/PUT/PATCH/DELETE）雖然帶 JSON body，但伺服器**並未強制** `Content-Type: application/json`；攻擊者可用 `<form enctype="text/plain">` 夾帶 JSON 形狀的 body 繞過。

因此正確的修補是**對整個 `/api/*` 的狀態變更請求**統一上防護，而非只補 `approve-all`。所有 UI 呼叫都會經過 `client.ts` 的單一 `request()` 出口，所以前端只需改一行即可覆蓋全部端點。

## 2. 範圍

| 檔案 | 角色 | 動作 |
| --- | --- | --- |
| `admin/shared/csrf.ts` | 共用常數（單一事實來源） | **新增**：標頭名稱與值 |
| `admin/src/auth.ts` | Worker 中介層 | **新增** `requireApiRequestAuthenticity` |
| `admin/src/index.ts` | 路由註冊 | 在 `requireAuth` 後 `app.use('/api/*', …)` |
| `admin/ui/src/api/client.ts` | 前端 API 出口 | 在預設 headers 加上該標頭 |
| `admin/src/auth.test.ts` | 測試 | **新增**（tsx + inline assert，比照 `helpers.test.ts`） |
| `admin/package.json` | 測試指令 | 新增 `test:auth`、併入 `check` |

**不在範圍**：CSRF token 儲存、cookie/SameSite 變更、CORS policy、rate limiting——對「同源 SPA → Worker、且位於 Cloudflare Access 之後」的架構皆非必要（YAGNI）。

## 3. 採用方案：自訂標頭（硬性閘門）＋ Origin／Sec-Fetch 縱深防禦

`wrangler.toml` 確認 admin UI 是由**同一個 Worker** 以靜態資產（`./ui/dist`）提供，與 `/api/*` **同源**；且全專案沒有任何 `Access-Control-*`（CORS）標頭。這正是「**自訂請求標頭**」防禦最適用的情境：

- 同源的 UI `fetch()` 可自由帶上自訂標頭。
- 跨源攻擊者要帶自訂標頭就會觸發 CORS preflight（OPTIONS）；本 Worker 不回任何 `Access-Control-Allow-Origin`，preflight 失敗，瀏覽器**根本不會送出**真正的請求。
- 自訂標頭的安全性來自「自訂標頭會強制 preflight」這個瀏覽器機制，**不來自值的機密性**——所以標頭名稱與值是公開的常數即可。

在此之上再疊一層 Origin／`Sec-Fetch-Site` 驗證做縱深防禦（萬一未來誤設 CORS 也擋得住）。

### 3.1 共用常數（`admin/shared/csrf.ts`，新增）

匯出兩個常數：

- `REQUEST_AUTHENTICITY_HEADER = 'X-Prism-Admin-Request'`
- `REQUEST_AUTHENTICITY_VALUE = 'fetch'`

> 為何放 `shared/`（相對 finding 提案的改良）：finding 的 patch 在 `auth.ts` 定義常數、卻在 `client.ts` 寫死字面字串，兩處會默默 drift。`admin/shared/` 已是 Worker 與 UI 共用的匯入邊界（`client.ts` 匯入 `../../../shared/types`），常數放這裡即為單一事實來源；UI 與 server 都從此匯入。`SAFE_METHODS` 與中介層邏輯只有 server 端需要（依賴 Hono），故留在 `auth.ts`。

### 3.2 中介層（`admin/src/auth.ts`，新增 `requireApiRequestAuthenticity`）

`SAFE_METHODS = new Set(['GET','HEAD','OPTIONS'])`。判斷順序：

1. 方法屬 `SAFE_METHODS` → `next()`（讀取不改變狀態，免驗）。
2. 自訂標頭缺失或值不符 → `403`（**硬性閘門**，跨源不可偽造）。
3. `Sec-Fetch-Site` 存在且 ≠ `same-origin` → `403`。
4. `Origin` 存在且 ≠ `new URL(c.req.url).origin` → `403`。
5. 其餘 → `next()`。

第 3、4 步採「**有才驗、缺不擋**」（reject only on present mismatch）：合法同源請求一定帶著相符的 `Origin`／`same-origin` 的 `Sec-Fetch-Site`，故不會誤殺；缺少時則交由第 2 步的硬性閘門把關，避免對舊瀏覽器或被中間層剝除標頭的請求產生 false positive。

回應格式比照既有：`c.json({ error: '…' }, 403)`。

### 3.3 路由註冊（`admin/src/index.ts`）

```
app.use('/api/*', requireAuth);
app.use('/api/*', requireApiRequestAuthenticity);   // ← 新增，緊接其後
```

順序：先 `requireAuth`（無身分 → 401），再真實性檢查（已驗身分但請求不可信 → 403）。兩者皆為純讀標頭、無副作用，順序不影響安全性，此排列僅為語意清晰且與既有結構一致。

### 3.4 前端出口（`admin/ui/src/api/client.ts`）

`request()` 的預設 headers 加入該標頭（自 `../../../shared/csrf` 匯入常數）：

```
headers: {
  'Content-Type': 'application/json',
  [REQUEST_AUTHENTICITY_HEADER]: REQUEST_AUTHENTICITY_VALUE,
  ...init?.headers,
},
```

因所有呼叫共用此 `request()`，一處即覆蓋全部端點。

## 4. 測試策略（TDD）

新增 `admin/src/auth.test.ts`，比照 `helpers.test.ts` 的慣例（`tsx` 直接執行、inline `assertEqual`、`process.exitCode` 標記失敗、無測試框架）。把 `requireApiRequestAuthenticity` 單獨掛到一個極小 Hono app 上，對 `/api/probe` 發請求並斷言狀態碼：

1. `GET` 不帶標頭 → `200`（safe method 免驗）。
2. `POST` 不帶標頭 → `403`。
3. `POST` 帶**錯誤**標頭值 → `403`。
4. `POST` 帶**正確**標頭、無 `Origin`/`Sec-Fetch-Site` → `200`（缺不擋，無 false positive）。
5. `POST` 帶正確標頭、但 `Sec-Fetch-Site: cross-site` → `403`。
6. `POST` 帶正確標頭、但 `Origin` 與請求 origin 不符 → `403`。
7. `POST` 帶正確標頭、且 `Origin` 同源 + `Sec-Fetch-Site: same-origin` → `200`。

先寫測試 → 跑 → 看它（在中介層尚未存在時）失敗 → 實作至全綠。最後 `npm run check` 必須全綠（typecheck + 所有測試）。

## 5. 相容性:誰會呼叫 admin `/api/*`(會不會誤傷 NOVA 等工具?)

中介層掛在 `/api/*` 上是 global 的,所以上線前必須確認:**沒有任何「非 admin SPA」的呼叫者**會用狀態變更方法(POST/PUT/PATCH/DELETE)打 admin Worker 的 `/api/*`——否則它們會在缺標頭時收到 403。已逐一查證如下。

### 5.1 多 Worker 架構:每個服務有各自的 `/api/*`

本專案是多個獨立部署的 Worker,各自有自己的 `/api/*` 命名空間與網域。本次修改**只在 admin Worker**(`admin/src/index.ts`),不影響其他 Worker:

| 服務 | Codebase | 網域 | 是否受影響 |
| --- | --- | --- | --- |
| **admin** | `admin/src/` | `admin.oshi.tw` | ✅ 唯一修改對象 |
| **NOVA** | `tools/nova/src/` | `nova.oshi.tw` | ❌ 獨立 Worker(`/api/submit`、`/vod/api/submit`… 是它自己的) |
| **Crystal** | `tools/crystal/src/` | crystal 網域 | ❌ 獨立 Worker |
| **prismlens** | `tools/prismlens/`(Python) | 本地 | ❌ 自帶本地 server 的 `/api/*` |

### 5.2 關鍵區別:D1 binding(直連)vs. HTTP `/api/*`

中介層是 **HTTP 層**攔截器,只看得到進入 Worker 的 HTTP 請求。admin 與 NOVA／Crystal 的資料互通是透過 **D1 binding 直連資料庫**(`admin/wrangler.toml` 綁了 `DB`/`NOVA_DB`/`CRYSTAL_DB`),例如 `c.env.NOVA_DB.prepare(...)`——這是平台層直連,**不是 HTTP 請求**,中介層看不到也擋不到。

```
admin SPA ──HTTP(同源,帶標頭)──▶ admin /api/nova/submissions ──D1 binding──▶ NOVA 的 D1
```

### 5.3 Offline 工具走 `wrangler d1`,不碰 HTTP API

所有同步／匯出工具皆以 `wrangler d1 execute` 直連資料庫,**完全不經過 admin 的 HTTP `/api/*`**:

| 工具 | 存取方式(證據) |
| --- | --- |
| `tools/sync-data/sync.ts` | `wrangler d1 execute oshi-prism-db --remote`（L93） |
| `tools/fetch-channel-info/fetch.ts` | `wrangler d1 execute oshi-prism-nova --remote`（L104） |
| `tools/inbox-status/status.ts` | `wrangler d1 execute … --remote`（L182） |
| `tools/sync-status/detect.ts` | `wrangler d1 execute oshi-prism-db --remote`（L70） |

`fetch-channel-info` 的設計文件並明確記載:當初已**否決**「用 Cloudflare Access service token 驅動部署的 worker」,改採本地腳本直連 D1。

### 5.4 結論(已查證)

- admin Worker 的 `/api/*` 在整個 repo 中**唯一的 HTTP 呼叫者就是 admin SPA**(`admin/ui/src/api/client.ts`),而本修補正是在該 SPA 的 `request()` 出口加標頭。
- 無任何程式碼把 `admin.oshi.tw` 當 fetch 目標(僅 ARCHITECTURE.md 文件圖出現)。
- admin Worker 不會 fetch 自己的 `/api/*`(其 `fetch()` 僅打 iTunes／YouTube 外部 API:`itunes.ts:36`、`youtube.ts:114`)。
- 無任何 `CF-Access-Client-*` service token 的程式化呼叫。

→ 因此 global 掛在 `/api/*` 是安全的:唯一行為改變是「跨站偽造請求由 200 變 403」,即預期效果。

## 6. 風險與限制

- 自訂標頭防禦的前提是「Worker 沒有寬鬆的 CORS policy」。本次已確認無任何 `Access-Control-*`；若未來新增 CORS，須確保不把攻擊者 origin 列入允許清單（第 3、4 步的 Origin/Sec-Fetch 縱深防禦可在此情境補上一層）。
- `Sec-Fetch-*` 由瀏覽器發送，舊瀏覽器可能不帶；本設計以「缺不擋」處理，安全性仍由自訂標頭硬性閘門保證，不依賴 `Sec-Fetch` 的存在。
- 修補只在 admin Worker 的 `/api/*`；Nova／Crystal 等其他 Worker 若有同型風險需各自比照。
- **部署提醒**：依 `CLAUDE.md`，`admin/` 變更須執行 `/deploy-admin` 才會生效（同時前端 `client.ts` 需重新 build 進 `ui/dist`）。
