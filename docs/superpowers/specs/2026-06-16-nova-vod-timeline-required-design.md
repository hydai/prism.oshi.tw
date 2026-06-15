# Nova VOD Submit — Require a Timeline (Block Empty Submissions)

Date: 2026-06-16
Status: Proposed

## Problem

`POST /vod/api/submit` (`tools/nova/src/index.ts`) accepts a VOD
submission that contains **zero song timestamps**.

Root cause: songs are only parsed inside
`if (body.songs && body.songs.length > 0)`, and the result
(`parsedSongs`) is never checked for emptiness before
`insertVodSubmission`. So a request with no `songs` field, an empty
`songs` array, or songs whose titles are all blank (each skipped by the
loop's `continue`) inserts a VOD with no performances and returns `201`.

The client form (`tools/nova/src/vod-page.ts`) compounds this: the
timeline textarea is labelled `歌曲時間戳（選填）` ("optional") and
`collectSongs()` may return `[]` with no warning, so a user can submit
with an empty timeline by accident.

A timeline-less VOD is useless to curators — the whole point of a VOD
submission is the song/timestamp list. Empty submissions should be
rejected, not accepted.

### Secondary finding (in the same handler)

The VOD form's result messages never become visible. `#result`
(`vod-page.ts:584`) carries an **inline** `style="display:none"`. The
submit handler sets `resultDiv.style.display = 'none'` at start
(`vod-page.ts:234`) and the result branches only set `className` /
`textContent` — they never clear the inline `display`. Because
`.result-msg { display:block }` lives in a stylesheet (`theme.ts:28`)
and inline styles outrank class styles (no `!important`), the inline
`display:none` wins and every message (success / duplicate-409 / error)
stays hidden. A new client-side warning would be invisible for the same
reason, so this must be fixed for the feature to work.

## Decision

Require **at least one song with a (trimmed, non-empty) title** for a
VOD submission to be accepted. Enforce on **both** layers:

- **Server** — authoritative integrity guard; protects against direct
  API calls that bypass the form.
- **Client** — UX guard; blocks early with a visible message before
  spending a Turnstile token or a network round-trip.

Also fix the result-message visibility bug for the whole VOD form (per
user decision: `vod-page.ts` only; leave the identical bug in
`page.ts` out of scope).

## Changes

### 1. Server guard — `tools/nova/src/index.ts`

Insert immediately after the existing `validateRequired` block
(after line ~356), **before** the Turnstile verification and any DB
call:

```ts
// Block timeline-less submissions: require at least one titled song.
const hasSong = Array.isArray(body.songs) && body.songs.some((s) => s?.song_title?.trim());
if (!hasSong) {
  return c.json({ error: '請至少提供一首歌曲的時間戳' }, 400);
}
```

Placement rationale:
- **Fail fast / fewer subrequests** — returns before the Turnstile
  `verifyTurnstile` fetch and before the `listApprovedStreamers` /
  duplicate-check DB queries. Relevant to the Workers subrequest budget.
- **Unit-testable with no mocks** — runs before any `env`-dependent
  call, so a test only needs a body and a stub env.
- The existing per-song timestamp-format `400`s remain unchanged. Given
  this guard guarantees ≥1 titled song, after the parse loop
  `parsedSongs` is either non-empty or the request has already returned
  `400` on a bad timestamp — so no separate post-loop guard is needed.

### 2. Client guard — `tools/nova/src/vod-page.ts`

At the top of the submit handler (after `e.preventDefault()`, before
`submitBtn.disabled = true`):

```js
var songs = collectSongs();
if (!songs.length) {
  resultDiv.style.display = '';                 // clear inline none → visible
  resultDiv.className = 'result-msg result-error';
  resultDiv.textContent = '請至少提供一首歌曲的時間戳再提交';
  return;
}
```

Then reuse `songs` when building the request body (`songs: songs`)
instead of calling `collectSongs()` a second time.

### 3. Timeline field → required label — `tools/nova/src/vod-page.ts`

- Change the section label (line ~563) from
  `歌曲時間戳（選填）` to `歌曲時間戳 <span class="required">*</span>`,
  matching the red-asterisk pattern used by the VTuber and VOD-URL
  fields.
- Widen the asterisk colour rule (line ~365) so it applies in the
  section label, not only `.form-label`:
  `.form-label .required, .section-label .required { color: var(--accent-pink); }`

### 4. Result-message visibility — `tools/nova/src/vod-page.ts`

In the submit handler's `finally` block (line ~282), add one line so
every network-path result (success / 409 / error / catch) un-hides:

```js
resultDiv.style.display = '';
```

(The new client guard at step 2 returns before the `try`, so it sets
its own `display` inline as shown.)

## Edge cases

- `body.songs` absent, `[]`, or all rows blank-titled → server `400`
  `請至少提供一首歌曲的時間戳`. Client blocks the same cases before send.
- One titled song with a malformed timestamp → existing per-song `400`
  (`開始時間格式無效`) still fires; behaviour unchanged.
- A titled song with a valid timestamp plus extra blank-titled rows →
  accepted; blank rows are skipped as today.
- Direct API caller (no form) sending empty songs → server `400`
  (client guard does not apply, server guard does).

## Verification

- **New unit test** in `tools/nova/src/index.test.ts`:
  `app.request('/vod/api/submit', { method:'POST', body })` with a
  valid `streamer_slug` + `video_url` but no `songs` → assert status
  `400` and the `請至少提供一首歌曲的時間戳` error. Wire into `main()`.
  Runs via `npm run test:video-info` (file already covered there); also
  confirm `tools/nova` tests run in CI (`.github/workflows/ci.yml`) —
  if not, that is a separate gap to note, not fix here.
- `npm run typecheck` (in `tools/nova`) passes.
- Manual smoke after deploy: submit with an empty timeline → see the
  inline warning; submit with one valid song → success message now
  actually appears.

## Deployment

Nova is a Cloudflare Worker — edits are inert until deployed. After
implementation run `/deploy-nova` (per project CLAUDE.md).
