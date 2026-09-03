import { html, raw } from 'hono/html';
import { pageShell } from '../../shared/web/page-shell';
import { DARK_MODE_CSS, SPARKLE_SVG, svgIcon, themeToggleHTML } from './theme';
import { LINK_URL_LIMIT, SUBMISSION_FIELD_LIMITS } from './validate';
import { SOCIAL_PROVIDERS, type SocialProvider } from '../../../lib/social-providers';

// Presentation for each provider in lib/social-providers.ts. `key` is typed
// against that list, so a platform this form knows about but the rest of the
// stack does not cannot compile.
const SOCIAL_LINKS: Array<{ key: SocialProvider; label: string; icon: Parameters<typeof svgIcon>[0]; brand: string }> = [
  { key: 'youtube', label: 'YouTube', icon: 'youtube', brand: '#FF0000' },
  { key: 'twitter', label: 'Twitter / X', icon: 'twitter', brand: '#1DA1F2' },
  { key: 'facebook', label: 'Facebook', icon: 'facebook', brand: '#1877F2' },
  { key: 'instagram', label: 'Instagram', icon: 'instagram', brand: '#E4405F' },
  { key: 'twitch', label: 'Twitch', icon: 'twitch', brand: '#9146FF' },
];

const PAGE_CSS = `    /* two-column form: fields left, live preview right (one DOM preview, re-flowed on mobile) */
    .form-layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; grid-template-rows: auto 1fr; gap: 18px 32px; padding: 24px 32px 32px; }
    .form-col-a { grid-column: 1; grid-row: 1; }
    .form-col-b { grid-column: 1; grid-row: 2; }
    .preview-col { grid-column: 2; grid-row: 1 / 3; }
    .preview-sticky { position: sticky; top: 24px; display: flex; flex-direction: column; gap: 8px; }
    .preview-card { display: flex; flex-direction: column; gap: 10px; padding: 20px; }
    .preview-avatar { width: 96px; height: 96px; border-radius: var(--radius-xl); object-fit: cover; flex-shrink: 0; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1); background: var(--bg-surface-frosted); }
    .preview-avatar.avatar-fallback { background: var(--gradient-accent); }
    .preview-name { font-size: 20px; font-weight: 900; letter-spacing: -0.025em; line-height: 1.15; color: var(--text-primary); word-break: break-word; }
    .preview-meta { font-size: 13px; color: var(--text-secondary); }
    .preview-meta strong { font-weight: 600; color: var(--text-primary); }
    .preview-meta .dot { color: var(--text-tertiary); }
    .preview-desc { font-size: 13px; line-height: 1.5; color: var(--text-secondary); white-space: pre-line; word-break: break-word; }
    .preview-desc:empty { display: none; }
    .preview-socials { display: flex; align-items: center; gap: 10px; }
    .preview-social { display: inline-flex; color: var(--text-muted); transition: color 0.15s; }
    .preview-socials-note { font-size: 11px; color: var(--text-tertiary); }
    .form-footer-note { font-size: 11px; color: var(--text-tertiary); }
    .link-pill svg, .btn-primary svg { flex-shrink: 0; }

    /* 800px, not 640px: below that the fields column drops under the 300px Turnstile widget. */
    @media (max-width: 800px) {
      .form-layout { grid-template-columns: 1fr; grid-template-rows: none; gap: 18px; padding: 8px 16px 24px; }
      .form-col-a, .form-col-b, .preview-col { grid-column: auto; grid-row: auto; }
      .preview-sticky { position: static; }
      .preview-card { flex-direction: row; align-items: center; gap: 12px; padding: 12px 14px; }
      .preview-card .prism-badge, .preview-card .preview-desc { display: none; }
      .preview-avatar { width: 44px; height: 44px; border-radius: var(--radius-lg); }
      .preview-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
      .preview-name { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .preview-meta { font-size: 11px; }
      .preview-socials { margin-top: 4px; }
    }
    @media (min-width: 801px) {
      .preview-text { display: contents; }
    }
`;

const PAGE_SCRIPT = `
    (function() {
      const form = document.getElementById('nova-form');
      const urlInput = form.querySelector('[name="youtube_channel_url"]');
      const nameInput = form.querySelector('[name="display_name"]');
      const groupInput = form.querySelector('[name="group"]');
      const descInput = form.querySelector('[name="description"]');
      const avatarInput = form.querySelector('[name="avatar_url"]');
      const subsInput = form.querySelector('[name="subscriber_count"]');
      const linkYtInput = form.querySelector('[name="link_youtube"]');
      const urlCheck = document.getElementById('url-check');
      const submitBtn = document.getElementById('submit-btn');
      const submitLabel = document.getElementById('submit-label');
      const resultDiv = document.getElementById('result');
      let nameManuallyEdited = false;

      // --- Live preview: mirrors the form into the Prism-page card (textContent only, never HTML) ---
      const previewAvatar = document.getElementById('preview-avatar');
      const previewAvatarFallback = document.getElementById('preview-avatar-fallback');
      const previewName = document.getElementById('preview-name');
      const previewGroup = document.getElementById('preview-group');
      const previewSubs = document.getElementById('preview-subs');
      const previewDesc = document.getElementById('preview-desc');
      const SOCIAL_KEYS = ${JSON.stringify(SOCIAL_PROVIDERS)};
      function syncPreview() {
        previewName.textContent = nameInput.value.trim() || '—';
        previewGroup.textContent = groupInput.value.trim() || '—';
        previewSubs.textContent = subsInput.value.trim() || '—';
        previewDesc.textContent = descInput.value.trim();
        const avatar = avatarInput.value.trim();
        if (/^https:\\/\\//.test(avatar)) {
          previewAvatar.src = avatar;
          previewAvatar.style.display = '';
          previewAvatarFallback.style.display = 'none';
        } else {
          previewAvatar.removeAttribute('src');
          previewAvatar.style.display = 'none';
          previewAvatarFallback.style.display = 'flex';
        }
        SOCIAL_KEYS.forEach(function(key) {
          const icon = document.getElementById('preview-social-' + key);
          const value = form.querySelector('[name="link_' + key + '"]').value.trim();
          icon.style.color = value ? icon.getAttribute('data-brand') : '';
        });
      }
      form.addEventListener('input', syncPreview);
      syncPreview();

      nameInput.addEventListener('input', function() {
        nameManuallyEdited = true;
      });

      // On URL blur: dedup check + auto-fetch channel info
      let lastFetchedUrl = '';
      urlInput.addEventListener('blur', function() {
        const url = this.value.trim();
        if (!url) {
          urlCheck.style.display = 'none';
          return;
        }

        const encoded = encodeURIComponent(url);

        // Dedup check
        fetch('/api/check?url=' + encoded)
          .then(r => r.json())
          .then(data => {
            urlCheck.style.display = '';
            if (data.exists && data.canResubmit) {
              urlCheck.className = 'check-line check-resubmit';
              urlCheck.textContent = '此頻道先前的提交被拒絕，你可以重新提交';
            } else if (data.exists) {
              urlCheck.className = 'check-line check-exists';
              urlCheck.textContent = '此頻道已於 ' + data.submittedAt + ' 提交（狀態：' + data.status + '）';
            } else {
              urlCheck.className = 'check-line check-ok';
              urlCheck.textContent = '此頻道尚未被提交';
            }
          })
          .catch(() => { urlCheck.style.display = 'none'; });

        // Auto-fetch channel info (only once per URL)
        if (url === lastFetchedUrl) return;
        lastFetchedUrl = url;
        urlCheck.style.display = '';
        urlCheck.className = 'check-line check-loading';
        urlCheck.textContent = '正在取得頻道資訊…';

        const requestedUrl = url;
        fetch('/api/channel-info?url=' + encoded)
          .then(r => r.json())
          .then(info => {
            // The field changed while this lookup was in flight (edited or re-submitted): drop the stale answer.
            if (requestedUrl !== urlInput.value.trim()) return;
            if (info.displayName && !nameManuallyEdited) {
              nameInput.value = info.displayName;
            }
            if (info.avatarUrl && !avatarInput.value) {
              avatarInput.value = info.avatarUrl;
            }
            if (!linkYtInput.value) {
              linkYtInput.value = url;
            }
            syncPreview();
          })
          .catch(() => {});
      });

      // Form submission
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        submitBtn.disabled = true;
        submitLabel.textContent = '提交中…';
        resultDiv.style.display = 'none';
        resultDiv.className = '';

        const fd = new FormData(form);
        const turnstileInput = form.querySelector('[name="cf-turnstile-response"]');
        const token = turnstileInput ? turnstileInput.value : '';

        const body = {
          youtube_channel_url: fd.get('youtube_channel_url'),
          display_name: fd.get('display_name'),
          group: fd.get('group') || '',
          description: fd.get('description') || '',
          avatar_url: fd.get('avatar_url') || '',
          subscriber_count: fd.get('subscriber_count') || '',
          link_youtube: fd.get('link_youtube') || '',
          link_twitter: fd.get('link_twitter') || '',
          link_facebook: fd.get('link_facebook') || '',
          link_instagram: fd.get('link_instagram') || '',
          link_twitch: fd.get('link_twitch') || '',
          turnstile_token: token,
        };

        try {
          const res = await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await res.json();

          if (res.ok) {
            resultDiv.className = 'result-msg result-success';
            resultDiv.textContent = data.resubmitted
              ? '重新提交成功！ID: ' + data.id + '。將再次進入審核流程。'
              : '提交成功！ID: ' + data.id + '。感謝你的推薦！';
            form.reset();
            nameManuallyEdited = false;
            syncPreview();
            if (window.turnstile) turnstile.reset();
          } else if (res.status === 409) {
            resultDiv.className = 'result-msg result-warning';
            resultDiv.textContent = '此頻道已於 ' + data.submittedAt + ' 提交過（狀態：' + data.status + '）';
          } else {
            resultDiv.className = 'result-msg result-error';
            resultDiv.textContent = data.error || '提交失敗，請稍後再試';
          }
        } catch {
          resultDiv.className = 'result-msg result-error';
          resultDiv.textContent = '網路錯誤，請檢查連線後再試';
        } finally {
          submitBtn.disabled = false;
          submitLabel.textContent = '提交';
          resultDiv.style.display = resultDiv.textContent ? '' : 'none';
        }
      });
    })();
  `;

export function renderPage(siteKey: string) {
  const socialInputs = SOCIAL_LINKS.map(({ key, label, icon }) => `
            <div class="input-icon">${svgIcon(icon, 16)}<input type="url" name="link_${key}" placeholder="${label}" aria-label="${label}" class="form-input" maxlength="${LINK_URL_LIMIT}" /></div>`).join('');
  const previewSocials = SOCIAL_LINKS.map(({ key, icon, brand }) =>
    `<span id="preview-social-${key}" class="preview-social" data-brand="${brand}">${svgIcon(icon, 16)}</span>`).join('');

  const hero = String(html`      <div class="prism-hero">
        <div class="prism-hero-tile">${raw(svgIcon('nova', 30))}</div>
        <div class="prism-hero-stack">
          <div class="prism-badge">${raw(SPARKLE_SVG)}推薦 VTuber</div>
          <h1 class="prism-title">Prism Nova</h1>
          <p class="prism-desc">提交你喜愛的 VTuber，讓我們為他／她建立 Prism 頁面</p>
        </div>
        <div class="prism-hero-actions">${raw(themeToggleHTML())}</div>
      </div>`);

  const body = String(html`      <form id="nova-form" class="form-layout">
        <div class="form-col-a form-stack">
          <div class="form-section"><span class="section-label">頻道</span></div>

          <!-- YouTube Channel URL -->
          <div>
            <label class="form-label" for="f-youtube_channel_url">
              YouTube 頻道網址 <span class="required">*</span>
            </label>
            <div class="input-icon">${raw(svgIcon('youtube', 16, 'color:#FF0000;'))}<input id="f-youtube_channel_url" type="url" name="youtube_channel_url" required
              placeholder="https://www.youtube.com/@ChannelName"
              class="form-input" maxlength="${SUBMISSION_FIELD_LIMITS.youtube_channel_url}" /></div>
            <div id="url-check" class="check-line" style="display: none;"></div>
            <p class="form-hint">輸入後會自動帶入頻道名稱、頭像與 YouTube 連結，都可以再修改。</p>
          </div>

          <div class="form-grid-2">
            <!-- Display Name -->
            <div>
              <label class="form-label" for="f-display_name">
                顯示名稱 <span class="required">*</span>
              </label>
              <div class="input-icon">${raw(svgIcon('user', 16))}<input id="f-display_name" type="text" name="display_name" required
                placeholder="例：浠Mizuki"
                class="form-input" maxlength="${SUBMISSION_FIELD_LIMITS.display_name}" /></div>
            </div>

            <!-- Group -->
            <div>
              <label class="form-label" for="f-group">箱 / 所屬公司 / 個人勢</label>
              <div class="input-icon">${raw(svgIcon('building', 16))}<input id="f-group" type="text" name="group"
                placeholder="例：個人勢、hololive"
                class="form-input" maxlength="${SUBMISSION_FIELD_LIMITS.group}" /></div>
            </div>
          </div>
        </div>

        <!-- Live preview of the Prism page (desktop: sticky card; mobile: compact row under the channel fields) -->
        <aside class="preview-col" aria-label="Prism 頁面預覽">
          <div class="preview-sticky">
            <div class="section-label">預覽</div>
            <div class="glass-box preview-card">
              <div class="preview-avatar-wrap" style="display: flex; flex-shrink: 0;">
                <img id="preview-avatar" class="preview-avatar" alt="" style="display: none;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
                <div id="preview-avatar-fallback" class="preview-avatar avatar-fallback" aria-hidden="true">${raw(SPARKLE_SVG.replace('width="12" height="12"', 'width="36" height="36"'))}</div>
              </div>
              <div class="preview-text">
                <div class="prism-badge">${raw(SPARKLE_SVG)}VTuber</div>
                <div id="preview-name" class="preview-name">—</div>
                <div class="preview-meta"><span id="preview-group">—</span> <span class="dot">·</span> <strong id="preview-subs">—</strong> 訂閱者</div>
                <div id="preview-desc" class="preview-desc"></div>
                <div class="preview-socials">${raw(previewSocials)}</div>
              </div>
            </div>
            <p class="form-hint" style="margin-top: 0;">審核通過後，Prism 首頁會以這個樣子呈現這位 VTuber。</p>
          </div>
        </aside>

        <div class="form-col-b form-stack">
          <div class="form-section"><span class="section-label">介紹</span></div>

          <!-- Description -->
          <div>
            <label class="form-label" for="f-description">簡介</label>
            <textarea id="f-description" name="description" rows="3"
              placeholder="關於這位 VTuber 的簡短介紹…"
              class="form-textarea" maxlength="${SUBMISSION_FIELD_LIMITS.description}"></textarea>
          </div>

          <div class="form-grid-2">
            <!-- Avatar URL -->
            <div>
              <label class="form-label" for="f-avatar_url">頭像圖片網址</label>
              <div class="input-icon">${raw(svgIcon('image', 16))}<input id="f-avatar_url" type="url" name="avatar_url"
                placeholder="https://..."
                class="form-input" maxlength="${SUBMISSION_FIELD_LIMITS.avatar_url}" /></div>
            </div>

            <!-- Subscriber Count -->
            <div>
              <label class="form-label" for="f-subscriber_count">訂閱數</label>
              <div class="input-icon">${raw(svgIcon('users', 16))}<input id="f-subscriber_count" type="text" name="subscriber_count"
                placeholder="例：21.8萬"
                class="form-input" maxlength="${SUBMISSION_FIELD_LIMITS.subscriber_count}" /></div>
            </div>
          </div>

          <!-- Social Links -->
          <div class="form-section"><span class="section-label">社群連結（選填）</span></div>
          <div class="form-grid-2" style="gap: 12px;">${raw(socialInputs)}
          </div>

          <!-- Turnstile + Submit -->
          <div class="form-footer">
            <div class="cf-turnstile" data-sitekey="${siteKey}" data-theme="auto"></div>
            <button type="submit" id="submit-btn" class="btn-primary"><span id="submit-label">提交</span>${raw(svgIcon('arrowRight', 16))}</button>
          </div>

          <!-- Result message -->
          <div id="result" style="display: none; text-align: center; font-size: 13px; padding: 12px 16px; border-radius: var(--radius-lg);"></div>
        </div>
      </form>`);

  const footer = String(html`    <div class="footer-links">
      <a class="link-pill" href="/vod">${raw(svgIcon('film', 14))}提交歌回 VOD</a>
      <a class="link-pill" href="/status">${raw(svgIcon('list', 14))}提交狀態</a>
      <a class="link-pill" href="https://prism.oshi.tw" target="_blank" rel="noopener noreferrer">${raw(svgIcon('external', 14))}前往 Prism 歌單</a>
    </div>
    <p class="footer-tagline">Prism &mdash; 為你喜愛的 VTuber 打造歌單頁面</p>`);

  return raw(pageShell({
    title: 'Prism Nova — VTuber 提交',
    turnstileLoader: true,
    darkCss: DARK_MODE_CSS,
    pageCss: PAGE_CSS,
    hero,
    body,
    footer,
    script: PAGE_SCRIPT,
  }));
}
