# Nova VOD Timeline-Required Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject Nova VOD submissions that contain no song timestamps, on both the server (authoritative) and the client (UX), and fix the VOD form's hidden-result-message bug.

**Architecture:** Add an early `hasSong` guard in the `POST /vod/api/submit` handler (before Turnstile/DB) that returns 400 when no titled song is present. Mirror the check in the form's submit handler so it blocks before sending. Make the timeline field a required-labelled field, and clear the result box's inline `display:none` so messages actually render.

**Tech Stack:** Cloudflare Workers + Hono (`tools/nova`), TypeScript, plain-DOM form JS embedded as a template string, `tsx` test runner via `npm run test:video-info`.

Spec: `docs/superpowers/specs/2026-06-16-nova-vod-timeline-required-design.md`

---

## File Structure

- `tools/nova/src/index.ts` — add the server-side `hasSong` guard in the submit handler.
- `tools/nova/src/index.test.ts` — add a mock-free regression test for the guard.
- `tools/nova/src/vod-page.ts` — client guard, required label, CSS tweak, result-visibility fix (all in the embedded page/script/style).

Server change (Task 1) and client change (Task 2) are independent concerns → separate commits.

---

### Task 1: Server-side guard rejects empty timelines

**Files:**
- Modify: `tools/nova/src/index.ts` (insert after the `validateRequired` block, after line 356)
- Test: `tools/nova/src/index.test.ts` (new test function + wire into `main()`)

- [ ] **Step 1: Write the failing test**

In `tools/nova/src/index.test.ts`, add this function above `async function main()`:

```ts
// === VOD submit: a timeline is mandatory =====================================
async function testSubmitRequiresTimeline(): Promise<void> {
  installMockFetch();
  try {
    const base = {
      streamer_slug: 'mizuki',
      video_url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA',
    };
    const post = (payload: unknown) =>
      app.request(
        '/vod/api/submit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        makeEnv(),
      );

    // (a) songs omitted entirely → 400, before any subrequest
    const resNone = await post({ ...base });
    assertEqual(resNone.status, 400, 'submission with no songs field is rejected (400)');
    const bodyNone = (await resNone.json()) as { error: string };
    assert(bodyNone.error.includes('請至少提供一首歌曲的時間戳'), 'error states a timeline is required');
    assertEqual(fetchCalls.length, 0, 'rejection happens before Turnstile/DB (no outbound fetch)');

    // (b) songs present but every title is blank → 400
    const resBlank = await post({ ...base, songs: [{ song_title: '   ', start_timestamp: '0:30' }] });
    assertEqual(resBlank.status, 400, 'submission whose songs are all title-less is rejected (400)');

    // (c) a titled song clears the timeline guard and reaches the Turnstile check
    const resOk = await post({ ...base, songs: [{ song_title: '歌名', start_timestamp: '0:30' }] });
    assertEqual(resOk.status, 400, 'titled song passes timeline guard, then fails Turnstile (400)');
    const bodyOk = (await resOk.json()) as { error: string };
    assert(bodyOk.error.includes('人機驗證'), 'past the timeline guard the next gate is Turnstile');
  } finally {
    restoreFetch();
  }
  console.log('✓ /vod/api/submit requires at least one song timestamp');
}
```

Wire it into `main()` (add the call before the final `console.log`):

```ts
  await testGateStillRejectsForeignRequests();
  await testSubmitRequiresTimeline();
  console.log('✓ nova video-info quota-drain guards');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix tools/nova run test:video-info`
Expected: FAIL at case (a) — currently the handler does not reject empty songs, so it proceeds past the (missing) guard and either reaches Turnstile (no token → 400 `請完成人機驗證`, so `bodyNone.error.includes('請至少提供…')` fails) or touches `c.env.DB` and throws. Either way `testSubmitRequiresTimeline` throws.

- [ ] **Step 3: Write minimal implementation**

In `tools/nova/src/index.ts`, immediately after the `validateRequired` block (the `if (errors.length > 0) { … }` ending at line 356), insert:

```ts
  // Block timeline-less submissions: require at least one titled song.
  const hasSong = Array.isArray(body.songs) && body.songs.some((s) => s?.song_title?.trim());
  if (!hasSong) {
    return c.json({ error: '請至少提供一首歌曲的時間戳' }, 400);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix tools/nova run test:video-info`
Expected: PASS — prints `✓ /vod/api/submit requires at least one song timestamp` and the existing four guards.

Also run: `npm --prefix tools/nova run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add tools/nova/src/index.ts tools/nova/src/index.test.ts
git commit -m "fix(nova): reject VOD submissions with no song timestamps

Server guard in POST /vod/api/submit returns 400 unless at least one
titled song is present, placed before Turnstile/DB so it fails fast.
Adds a mock-free regression test.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Client guard, required label, and result-visibility fix

**Files:**
- Modify: `tools/nova/src/vod-page.ts` (submit handler, section label, `.required` CSS rule)

No unit harness exists for the embedded page string; verification is `typecheck` + manual smoke after deploy.

- [ ] **Step 1: Add the client-side guard in the submit handler**

In `tools/nova/src/vod-page.ts`, the handler currently begins:

```js
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        submitBtn.disabled = true;
        submitBtn.textContent = '提交中…';
```

Replace those four lines with:

```js
      form.addEventListener('submit', async function(e) {
        e.preventDefault();

        var songs = collectSongs();
        if (!songs.length) {
          resultDiv.style.display = '';
          resultDiv.className = 'result-msg result-error';
          resultDiv.textContent = '請至少提供一首歌曲的時間戳再提交';
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = '提交中…';
```

- [ ] **Step 2: Reuse `songs` in the request body**

Still in the handler, change the body field from `collectSongs()` to the already-collected `songs`:

```js
          songs: songs,
```

(was `songs: collectSongs(),`)

- [ ] **Step 3: Make result messages visible (the inline-display bug)**

In the same handler's `finally` block:

```js
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = '提交 VOD';
        }
```

add one line so success / 409 / error messages un-hide:

```js
        } finally {
          resultDiv.style.display = '';
          submitBtn.disabled = false;
          submitBtn.textContent = '提交 VOD';
        }
```

- [ ] **Step 4: Mark the timeline field required (label)**

Change the section label (line ~563):

```js
          <p class="section-label">歌曲時間戳（選填）</p>
```

to:

```js
          <p class="section-label">歌曲時間戳 <span class="required">*</span></p>
```

- [ ] **Step 5: Make the asterisk render in the section label (CSS)**

Change the rule at line ~365:

```css
    .form-label .required { color: var(--accent-pink); }
```

to:

```css
    .form-label .required, .section-label .required { color: var(--accent-pink); }
```

- [ ] **Step 6: Verify typecheck passes**

Run: `npm --prefix tools/nova run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add tools/nova/src/vod-page.ts
git commit -m "feat(nova): require a timeline in the VOD submit form

Block submit when no song is parsed, mark the timeline field required,
and clear the result box's inline display:none so success/error/duplicate
messages actually render.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Deploy

- [ ] **Step 1: Deploy the Nova worker**

Nova is a Cloudflare Worker — edits are inert until deployed. Run the `/deploy-nova` slash command (or `npm --prefix tools/nova run deploy`).

- [ ] **Step 2: Manual smoke test**

On the deployed `/vod` form:
- Submit with an empty timeline → the inline warning `請至少提供一首歌曲的時間戳再提交` appears; nothing is sent.
- Submit one valid song → success message now actually shows.
- (Optional) `curl -X POST .../vod/api/submit` with `{streamer_slug, video_url}` and no songs → `400 請至少提供一首歌曲的時間戳`.

---

## Notes / Out of Scope

- `tools/nova/src/page.ts` (streamer-submission form) has the identical result-visibility bug; per the brainstorming decision it is **out of scope** here.
- CI: confirm whether `.github/workflows/ci.yml` runs the Nova test (`test:video-info`). If it does not, that is a pre-existing coverage gap to note separately, not to fix in this plan.
