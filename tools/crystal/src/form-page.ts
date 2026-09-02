import { html, raw } from 'hono/html';
import { DARK_MODE_CSS, SPARKLE_SVG, svgIcon, themeToggleHTML } from './theme';
import { TICKET_FIELD_LIMITS } from './validate';
import { pageShell } from '../../shared/web/page-shell';

// Discord brand mark — lucide ships no Discord icon. Path from Discord's official
// brand assets (same as app/components/DiscordIcon.tsx on the prism site).
const DISCORD_SVG = '<svg class="discord-mark" width="22" height="17" viewBox="0 0 127.14 96.36" fill="currentColor" aria-hidden="true"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/></svg>';

const TYPE_TILES = [
  { type: 'bug', icon: 'bug', label: 'Bug 回報', hint: '功能壞掉或跑出錯誤' },
  { type: 'feat', icon: 'lightbulb', label: '功能建議', hint: '想要的新功能' },
  { type: 'ui', icon: 'layout', label: 'UI 問題', hint: '畫面或操作怪怪的' },
  { type: 'other', icon: 'message', label: '其他', hint: '任何想說的' },
] as const;

function typeTileButtons(): string {
  return TYPE_TILES.map(({ type, icon, label, hint }) => {
    const active = type === 'bug';
    return `<button type="button" class="type-btn${active ? ' active' : ''}" data-type="${type}" aria-pressed="${active ? 'true' : 'false'}">
              <span class="type-tile type-${type}">${svgIcon(icon, 16)}</span>
              <span class="type-btn-text"><span class="type-btn-label">${label}</span><span class="type-btn-hint">${hint}</span></span>
            </button>`;
  }).join('\n            ');
}

// Constant icon markup handed to the similar-tickets script (keyed by the
// allow-listed type, so nothing user-controlled ever reaches innerHTML).
function typeIconJson(): string {
  return JSON.stringify(Object.fromEntries(TYPE_TILES.map(({ type, icon }) => [type, svgIcon(icon, 13)])));
}

const PAGE_CSS = `    .crystal-form { padding: 24px 32px 32px; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

    /* type selector tiles */
    .type-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .type-btn {
      display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
      padding: 12px; border-radius: var(--radius-xl); text-align: left; cursor: pointer;
      font-family: inherit; background: var(--bg-surface-glass); border: 1px solid var(--border-glass);
      transition: border-color 0.15s, background 0.15s;
    }
    .type-btn:hover { border-color: var(--border-accent-pink); }
    .type-btn:focus-visible { outline: 2px solid var(--accent-pink); outline-offset: 2px; }
    .type-btn.active {
      background: linear-gradient(135deg, var(--bg-accent-pink-muted), var(--bg-accent-blue-muted));
      border-color: var(--border-accent-pink);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
    }
    .type-btn-text { display: flex; flex-direction: column; gap: 2px; }
    .type-btn-label { font-size: 13px; font-weight: 700; color: var(--text-primary); }
    .type-btn.active .type-btn-label { color: var(--accent-pink-dark); }
    .type-btn-hint { font-size: 11px; color: var(--text-secondary); }
    .type-tile { width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; }
    .type-bug { background: #FEE2E2; color: #DC2626; }
    .type-feat { background: #F3E8FF; color: #A855F7; }
    .type-ui { background: var(--bg-accent-blue-muted); color: var(--accent-blue); }
    .type-other { background: #F1F5F9; color: #64748B; }
    html.dark .type-bug { background: rgba(248, 113, 113, 0.15); color: #FCA5A5; }
    html.dark .type-feat { background: rgba(192, 132, 252, 0.15); color: #D8B4FE; }
    html.dark .type-other { background: rgba(148, 163, 184, 0.15); color: #CBD5E1; }

    /* similar-tickets panel (filled by script) */
    .similar-panel { margin-top: 8px; padding: 10px; border-radius: var(--radius-lg); }
    .similar-header { display: flex; align-items: center; gap: 8px; padding: 0 4px 6px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
    .similar-count { font-weight: 400; color: var(--text-tertiary); }
    .similar-dismiss {
      margin-left: auto; background: none; border: none; color: var(--text-tertiary); cursor: pointer;
      font-size: 11px; font-family: inherit; padding: 2px 6px; border-radius: 6px;
    }
    .similar-dismiss:hover { color: var(--text-secondary); background: rgba(0, 0, 0, 0.04); }
    html.dark .similar-dismiss:hover { background: rgba(255, 255, 255, 0.06); }
    .similar-list { display: flex; flex-direction: column; gap: 2px; }
    .similar-item {
      display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: var(--radius-md);
      font-size: 13px; font-weight: 500; color: var(--text-primary); transition: background-color 0.15s;
    }
    .similar-item:hover { background: var(--bg-accent-pink); }
    .similar-tile { width: 24px; height: 24px; border-radius: 6px; }
    .similar-link { text-decoration: none; color: inherit; display: block; }
    .similar-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* reply mode switch (drives the hidden #public-toggle checkbox) */
    .reply-mode { display: flex; align-items: center; gap: 4px; padding: 3px; border-radius: var(--radius-pill); background: var(--bg-surface-muted); border: 1px solid var(--border-glass); width: fit-content; }
    .reply-mode-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 14px;
      border: 0; border-radius: var(--radius-pill); font-family: inherit; font-size: 12px; font-weight: 600;
      cursor: pointer; white-space: nowrap; background: transparent; color: var(--text-secondary);
    }
    .reply-mode-btn[aria-pressed="true"] { background: var(--gradient-accent); color: #FFFFFF; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1); }
    .reply-mode-btn:focus-visible { outline: 2px solid var(--accent-pink); outline-offset: 2px; }
    .reply-mode-wrap { display: flex; flex-direction: column; gap: 6px; }

    .contact-field { transition: max-height 0.3s ease, opacity 0.3s ease; overflow: hidden; }
    .contact-field.visible { max-height: 140px; opacity: 1; }
    .contact-field.hidden { max-height: 0; opacity: 0; }

    .discord-tip { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: var(--radius-lg); font-size: 12px; line-height: 1.5; color: var(--text-secondary); }
    .discord-tip > span { flex: 1; min-width: 160px; }
    .discord-mark { color: #5865F2; flex-shrink: 0; }

    #result { margin-top: 4px; padding: 12px 16px; border-radius: var(--radius-lg); font-size: 14px; display: none; }
    #result.success { display: block; background: #ECFDF5; color: #065F46; border: 1px solid #A7F3D0; }
    #result.error { display: block; background: #FEF2F2; color: #991B1B; border: 1px solid #FECACA; }

    @media (max-width: 640px) {
      .crystal-form { padding: 16px; }
      .type-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .reply-mode { width: 100%; }
      .reply-mode-btn { flex: 1; min-height: 44px; }
      .discord-tip { flex-wrap: wrap; }
    }
`;

const FORM_SCRIPT = `
    const form = document.getElementById('crystal-form');
    const resultEl = document.getElementById('result');
    const submitBtn = document.getElementById('submit-btn');
    const publicToggle = document.getElementById('public-toggle');
    const contactWrapper = document.getElementById('contact-wrapper');
    let selectedType = 'bug';

    // --- Duplicate detection: fetch similar tickets as the user types the title ---
    const titleInput = document.getElementById('title');
    const similarPanel = document.getElementById('similar-panel');
    const similarList = document.getElementById('similar-list');
    const similarCount = document.getElementById('similar-count');
    const similarDismissBtn = document.getElementById('similar-dismiss');
    const SIMILAR_DEBOUNCE_MS = 250;
    const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
    const VALID_TYPES = { bug: 'Bug', feat: '功能建議', ui: 'UI', other: '其他' };
    const VALID_STATUSES = { pending: '處理中', replied: '已回覆', closed: '已關閉' };
    // Server-rendered constant icon markup per allow-listed type (never user data).
    const TYPE_ICON_SVG = ${typeIconJson()};
    let similarTimer = null;
    let similarAbort = null;
    let similarDismissed = false;

    similarDismissBtn.addEventListener('click', () => {
      similarDismissed = true;
      similarPanel.style.display = 'none';
    });

    titleInput.addEventListener('input', () => {
      similarDismissed = false;
      if (similarTimer) clearTimeout(similarTimer);
      const q = titleInput.value.trim();
      // 2-char minimum if query contains any CJK char, else 3 chars.
      const minChars = CJK_RE.test(q) ? 2 : 3;
      if (q.length < minChars) {
        similarPanel.style.display = 'none';
        return;
      }
      similarTimer = setTimeout(async () => {
        if (similarAbort) similarAbort.abort();
        similarAbort = new AbortController();
        try {
          const res = await fetch('/api/similar?q=' + encodeURIComponent(q) + '&limit=5', {
            signal: similarAbort.signal,
          });
          if (!res.ok) return;
          const json = await res.json();
          renderSimilar(Array.isArray(json.data) ? json.data : []);
        } catch (e) {
          if (e && e.name !== 'AbortError') {
            // Silently swallow — the dedupe hint is a nicety, not a blocker.
          }
        }
      }, SIMILAR_DEBOUNCE_MS);
    });

    function buildSimilarItem(it) {
      // Validate server-side values against known enums before interpolating into class names.
      const typeKey = VALID_TYPES[it.type] ? it.type : 'other';
      const statusKey = VALID_STATUSES[it.status] ? it.status : 'pending';

      const row = document.createElement('div');
      row.className = 'similar-item';

      const typeTile = document.createElement('span');
      typeTile.className = 'type-tile similar-tile type-' + typeKey;
      typeTile.title = VALID_TYPES[typeKey];
      // Constant markup keyed by the allow-listed type — not user input.
      typeTile.innerHTML = TYPE_ICON_SVG[typeKey] || '';
      row.appendChild(typeTile);

      const titleSpan = document.createElement('span');
      titleSpan.className = 'similar-title';
      titleSpan.textContent = String(it.title ?? '');
      row.appendChild(titleSpan);

      const statusBadge = document.createElement('span');
      statusBadge.className = 'badge badge-' + statusKey;
      statusBadge.textContent = VALID_STATUSES[statusKey];
      row.appendChild(statusBadge);

      return { row, statusKey, title: titleSpan.textContent };
    }

    function renderSimilar(items) {
      if (similarDismissed) return;
      if (!items.length) {
        similarPanel.style.display = 'none';
        return;
      }
      similarCount.textContent = '(' + items.length + ')';
      similarList.replaceChildren();
      for (const it of items) {
        const { row, statusKey, title } = buildSimilarItem(it);
        // Replied/closed tickets link to the Q&A page; pending tickets surface as non-interactive signals.
        if (statusKey === 'replied' || statusKey === 'closed') {
          const a = document.createElement('a');
          a.className = 'similar-link';
          a.href = '/qa?q=' + encodeURIComponent(title);
          a.target = '_blank';
          a.rel = 'noopener';
          a.appendChild(row);
          similarList.appendChild(a);
        } else {
          similarList.appendChild(row);
        }
      }
      similarPanel.style.display = 'block';
    }

    // Type selector
    function selectType(type) {
      document.querySelectorAll('.type-btn').forEach(b => {
        const active = b.dataset.type === type;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      selectedType = type;
    }
    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.addEventListener('click', () => selectType(btn.dataset.type));
    });

    // Reply mode switch → hidden checkbox (the submit payload reads publicToggle.checked)
    function syncReplyMode() {
      document.querySelectorAll('.reply-mode-btn').forEach(b => {
        const pressed = (b.dataset.replyMode === 'public') === publicToggle.checked;
        b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      });
    }
    document.querySelectorAll('.reply-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const wantPublic = btn.dataset.replyMode === 'public';
        if (publicToggle.checked !== wantPublic) {
          publicToggle.checked = wantPublic;
          publicToggle.dispatchEvent(new Event('change'));
        }
        syncReplyMode();
      });
    });

    // Toggle contact visibility
    publicToggle.addEventListener('change', () => {
      if (publicToggle.checked) {
        contactWrapper.classList.remove('visible');
        contactWrapper.classList.add('hidden');
      } else {
        contactWrapper.classList.remove('hidden');
        contactWrapper.classList.add('visible');
      }
      syncReplyMode();
    });

    // Get context URL from ?ref= query param
    function getContextUrl() {
      const params = new URLSearchParams(window.location.search);
      return params.get('ref') || '';
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      resultEl.className = '';
      resultEl.style.display = 'none';

      const token = document.querySelector('[name="cf-turnstile-response"]')?.value;
      if (!token) {
        resultEl.textContent = '請完成人機驗證';
        resultEl.className = 'error';
        submitBtn.disabled = false;
        return;
      }

      const payload = {
        type: selectedType,
        title: document.getElementById('title').value,
        body: document.getElementById('body').value,
        nickname: document.getElementById('nickname').value,
        contact: document.getElementById('contact').value,
        is_public_reply_allowed: publicToggle.checked,
        context_url: getContextUrl(),
        turnstile_token: token,
      };

      try {
        const res = await fetch('/api/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await res.json();

        if (res.ok) {
          resultEl.textContent = '感謝你的回報！編號：' + data.id;
          resultEl.className = 'success';
          form.reset();
          // Re-activate default type
          selectType('bug');
          // Reset contact visibility + reply mode (form.reset() restored the checkbox)
          contactWrapper.classList.remove('visible');
          contactWrapper.classList.add('hidden');
          syncReplyMode();
          // Reset Turnstile
          if (window.turnstile) turnstile.reset();
        } else {
          const msg = data.errors ? data.errors.join('、') : (data.error || '提交失敗');
          resultEl.textContent = msg;
          resultEl.className = 'error';
        }
      } catch {
        resultEl.textContent = '網路錯誤，請稍後再試';
        resultEl.className = 'error';
      } finally {
        submitBtn.disabled = false;
      }
    });
  `;

export function renderFormPage(siteKey: string) {
  const hero = String(html`      <div class="prism-hero">
        <div class="prism-hero-tile">${raw(svgIcon('crystal', 30))}</div>
        <div class="prism-hero-stack">
          <div class="prism-badge">${raw(SPARKLE_SVG)}回報與建議</div>
          <h1 class="prism-title">Prism Crystal</h1>
          <p class="prism-desc">回報問題或建議新功能，幫助我們讓 Prism 更好</p>
        </div>
        <div class="prism-hero-actions">${raw(themeToggleHTML())}</div>
      </div>`);

  const body = String(html`      <form id="crystal-form" class="form-stack crystal-form">

        <!-- Type selector -->
        <div>
          <span class="form-label" id="type-label">類型 <span class="required">*</span></span>
          <div class="type-tiles" role="group" aria-labelledby="type-label">
            ${raw(typeTileButtons())}
          </div>
        </div>

        <!-- Title -->
        <div>
          <label class="form-label" for="title">標題 <span class="required">*</span></label>
          <div class="input-icon">
            ${raw(svgIcon('pencilLine', 16))}
            <input type="text" id="title" class="form-input" placeholder="簡短描述問題或建議" maxlength="${TICKET_FIELD_LIMITS.title}" required />
          </div>
          <div id="similar-panel" class="glass-box similar-panel" style="display: none;">
            <div class="similar-header">
              <span>類似的既有回報</span>
              <span id="similar-count" class="similar-count"></span>
              <button type="button" id="similar-dismiss" class="similar-dismiss" aria-label="隱藏類似回報">隱藏</button>
            </div>
            <div id="similar-list" class="similar-list"></div>
          </div>
        </div>

        <!-- Body -->
        <div>
          <label class="form-label" for="body">詳細描述 <span class="required">*</span></label>
          <textarea id="body" class="form-textarea" rows="5" placeholder="請描述你遇到的問題或想要的功能…" maxlength="${TICKET_FIELD_LIMITS.body}" required></textarea>
        </div>

        <!-- Reply mode (public Q&A vs. private) -->
        <div class="form-section"><span class="section-label">回覆方式</span></div>
        <div class="reply-mode-wrap">
          <div class="reply-mode" role="group" aria-label="回覆方式">
            <button type="button" class="reply-mode-btn" data-reply-mode="public" aria-pressed="true">${raw(svgIcon('globe', 14))}公開在 Q&amp;A</button>
            <button type="button" class="reply-mode-btn" data-reply-mode="private" aria-pressed="false">${raw(svgIcon('lock', 14))}私下回覆</button>
          </div>
          <input type="checkbox" id="public-toggle" class="sr-only" checked tabindex="-1" aria-hidden="true" />
          <p class="form-hint" style="margin-top: 0;">你的問題與官方回覆會顯示在 Q&amp;A 頁面；選「私下回覆」會多出聯絡方式欄位（必填），只有管理員看得到。</p>
        </div>

        <!-- Contact (shown when public reply is NOT allowed) -->
        <div id="contact-wrapper" class="contact-field hidden">
          <label class="form-label" for="contact">聯絡方式 <span class="required">*</span></label>
          <div class="input-icon">
            ${raw(svgIcon('message', 16))}
            <input type="text" id="contact" class="form-input" placeholder="Email / Discord / Twitter 等，讓我們能回覆你" maxlength="${TICKET_FIELD_LIMITS.contact}" />
          </div>
          <p class="form-hint">不公開回覆時必須提供聯絡方式</p>
        </div>

        <!-- Nickname -->
        <div>
          <label class="form-label" for="nickname">暱稱</label>
          <div class="input-icon">
            ${raw(svgIcon('user', 16))}
            <input type="text" id="nickname" class="form-input" placeholder="選填，Q&amp;A 公開回覆時顯示" maxlength="${TICKET_FIELD_LIMITS.nickname}" />
          </div>
        </div>

        <!-- Discord tip (always visible) -->
        <div class="glass-box discord-tip">
          ${raw(DISCORD_SVG)}
          <span>也可以加入我們的 Discord 伺服器，直接在伺服器裡討論與回覆。</span>
          <a class="link-pill" href="https://discord.gg/bUYva8q7Jr" target="_blank" rel="noopener noreferrer">加入 Discord ${raw(svgIcon('external', 12))}</a>
        </div>

        <!-- Turnstile + Submit -->
        <div class="form-footer">
          <div class="cf-turnstile" data-sitekey="${siteKey}" data-theme="auto"></div>
          <button type="submit" class="btn-primary" id="submit-btn">送出回報 ${raw(svgIcon('arrowRight', 16))}</button>
        </div>

        <div id="result"></div>
      </form>`);

  const footer = String(html`    <div class="footer-links">
      <a class="link-pill" href="/qa">${raw(svgIcon('message', 14))}查看 Q&amp;A</a>
      <a class="link-pill" href="https://nova.oshi.tw" target="_blank" rel="noopener noreferrer">${raw(svgIcon('plus', 14))}提議新 VTuber</a>
      <a class="link-pill" href="https://prism.oshi.tw" target="_blank" rel="noopener noreferrer">${raw(svgIcon('external', 14))}前往 Prism 歌單</a>
    </div>
    <p class="footer-tagline">Prism &mdash; 為你喜愛的 VTuber 打造歌單頁面</p>`);

  return raw(pageShell({
    title: 'Prism Crystal — 回報 / 建議',
    narrow: true,
    turnstileLoader: true,
    darkCss: DARK_MODE_CSS,
    pageCss: PAGE_CSS,
    hero,
    body,
    footer,
    script: FORM_SCRIPT,
  }));
}
