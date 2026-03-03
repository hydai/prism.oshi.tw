import { html } from 'hono/html';

export function renderPage(siteKey: string) {
  return html`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prism Nova — VTuber 提交</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap" rel="stylesheet" />
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>
    :root {
      --accent-pink: #EC4899;
      --accent-pink-dark: #DB2777;
      --accent-pink-light: #F472B6;
      --accent-blue: #3B82F6;
      --accent-blue-light: #60A5FA;
      --bg-page-start: #FFF0F5;
      --bg-page-mid: #F0F8FF;
      --bg-page-end: #E6E6FA;
      --bg-surface-glass: #FFFFFF66;
      --bg-surface-frosted: #FFFFFF99;
      --text-primary: #1E293B;
      --text-secondary: #64748B;
      --text-tertiary: #94A3B8;
      --border-default: #E2E8F0;
      --border-glass: #FFFFFF66;
      --border-accent-pink: #FBCFE8;
      --radius-lg: 12px;
      --radius-xl: 16px;
      --radius-2xl: 20px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'DM Sans', sans-serif;
      background: linear-gradient(135deg, var(--bg-page-start) 0%, var(--bg-page-mid) 50%, var(--bg-page-end) 100%);
      background-attachment: fixed;
      min-height: 100vh;
      color: var(--text-primary);
    }

    .form-input {
      width: 100%;
      padding: 10px 16px;
      background: var(--bg-surface-frosted);
      border: 1px solid var(--border-glass);
      border-radius: var(--radius-lg);
      font-family: inherit;
      font-size: 14px;
      color: var(--text-primary);
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .form-input::placeholder { color: var(--text-tertiary); }
    .form-input:focus {
      border-color: var(--border-accent-pink);
      box-shadow: 0 0 0 3px rgba(236, 72, 153, 0.1);
    }

    textarea.form-input { resize: none; }

    .form-label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }
    .form-label .required { color: var(--accent-pink); }

    .form-hint {
      font-size: 11px;
      color: var(--text-tertiary);
      margin-top: 4px;
    }

    .section-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 12px;
    }

    .btn-submit {
      width: 100%;
      padding: 12px 24px;
      border: none;
      border-radius: var(--radius-lg);
      background: linear-gradient(135deg, var(--accent-pink), var(--accent-blue));
      color: white;
      font-family: inherit;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s, box-shadow 0.2s;
      box-shadow: 0 4px 14px rgba(236, 72, 153, 0.25);
    }
    .btn-submit:hover { opacity: 0.92; box-shadow: 0 6px 20px rgba(236, 72, 153, 0.3); }
    .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }
  </style>
</head>
<body>

  <div style="max-width: 640px; margin: 0 auto; padding: 48px 16px;">
    <!-- Header -->
    <div style="text-align: center; margin-bottom: 32px;">
      <div style="display: inline-flex; align-items: center; gap: 12px; margin-bottom: 8px;">
        <div style="
          width: 40px; height: 40px; border-radius: var(--radius-lg);
          background: linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light));
          display: flex; align-items: center; justify-content: center;
        ">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
          </svg>
        </div>
        <span style="
          font-size: 28px; font-weight: 700; letter-spacing: -0.5px;
          background: linear-gradient(135deg, var(--accent-pink), var(--accent-blue));
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text;
        ">Prism Nova</span>
      </div>
      <p style="color: var(--text-secondary); font-size: 14px;">
        提交你喜愛的 VTuber，讓我們為 TA 建立 Prism 頁面
      </p>
    </div>

    <!-- Form Card -->
    <div style="
      background: var(--bg-surface-glass);
      backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--border-glass);
      border-radius: var(--radius-2xl);
      padding: 32px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.06);
    ">
      <form id="nova-form" style="display: flex; flex-direction: column; gap: 20px;">

        <!-- YouTube Channel URL -->
        <div>
          <label class="form-label">
            YouTube 頻道網址 <span class="required">*</span>
          </label>
          <input type="url" name="youtube_channel_url" required
            placeholder="https://www.youtube.com/@ChannelName"
            class="form-input" />
          <div id="url-check" style="margin-top: 4px; font-size: 13px; display: none;"></div>
        </div>

        <!-- Display Name -->
        <div>
          <label class="form-label">
            顯示名稱 <span class="required">*</span>
          </label>
          <input type="text" name="display_name" required
            placeholder="例：浠Mizuki"
            class="form-input" />
        </div>

        <!-- Slug -->
        <div>
          <label class="form-label">
            Slug（網址用，小寫英數加連字號）<span class="required">*</span>
          </label>
          <input type="text" name="slug" required
            placeholder="例：mizuki"
            pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
            class="form-input" />
          <p class="form-hint">自動從顯示名稱生成，可自行修改</p>
        </div>

        <!-- Group -->
        <div>
          <label class="form-label">箱 / 所屬公司 / 個人勢</label>
          <input type="text" name="group"
            placeholder="例：個人勢、hololive"
            class="form-input" />
        </div>

        <!-- Description -->
        <div>
          <label class="form-label">簡介</label>
          <textarea name="description" rows="3"
            placeholder="關於這位 VTuber 的簡短介紹…"
            class="form-input"></textarea>
        </div>

        <!-- Avatar URL -->
        <div>
          <label class="form-label">頭像圖片網址</label>
          <input type="url" name="avatar_url"
            placeholder="https://..."
            class="form-input" />
        </div>

        <!-- Subscriber Count -->
        <div>
          <label class="form-label">訂閱數</label>
          <input type="text" name="subscriber_count"
            placeholder="例：21.8萬"
            class="form-input" />
        </div>

        <!-- Social Links -->
        <div style="border-top: 1px solid var(--border-glass); padding-top: 20px;">
          <p class="section-label">社群連結（選填）</p>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <input type="url" name="link_youtube" placeholder="YouTube" class="form-input" />
            <input type="url" name="link_twitter" placeholder="Twitter / X" class="form-input" />
            <input type="url" name="link_facebook" placeholder="Facebook" class="form-input" />
            <input type="url" name="link_instagram" placeholder="Instagram" class="form-input" />
            <input type="url" name="link_twitch" placeholder="Twitch" class="form-input" />
          </div>
        </div>

        <!-- Turnstile -->
        <div style="display: flex; justify-content: center;">
          <div class="cf-turnstile" data-sitekey="${siteKey}" data-theme="light"></div>
        </div>

        <!-- Submit -->
        <button type="submit" id="submit-btn" class="btn-submit">
          提交
        </button>

        <!-- Result message -->
        <div id="result" style="display: none; text-align: center; font-size: 13px; padding: 12px 16px; border-radius: var(--radius-lg);"></div>
      </form>
    </div>

    <p style="text-align: center; font-size: 11px; color: var(--text-tertiary); margin-top: 24px;">
      Prism &mdash; 為你喜愛的 VTuber 打造歌單頁面
    </p>
  </div>

  <script>
    (function() {
      const form = document.getElementById('nova-form');
      const urlInput = form.querySelector('[name="youtube_channel_url"]');
      const nameInput = form.querySelector('[name="display_name"]');
      const slugInput = form.querySelector('[name="slug"]');
      const avatarInput = form.querySelector('[name="avatar_url"]');
      const linkYtInput = form.querySelector('[name="link_youtube"]');
      const urlCheck = document.getElementById('url-check');
      const submitBtn = document.getElementById('submit-btn');
      const resultDiv = document.getElementById('result');
      let slugManuallyEdited = false;
      let nameManuallyEdited = false;

      // Track manual edits
      slugInput.addEventListener('input', function() {
        slugManuallyEdited = true;
      });

      nameInput.addEventListener('input', function() {
        nameManuallyEdited = true;
        if (!slugManuallyEdited) {
          slugInput.value = this.value
            .toLowerCase()
            .replace(/[^a-z0-9\\s-]/g, '')
            .replace(/\\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        }
      });

      // Auto-generate slug from a given name string
      function generateSlug(name) {
        return name
          .toLowerCase()
          .replace(/[^a-z0-9\\s-]/g, '')
          .replace(/\\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
      }

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
            urlCheck.style.display = 'block';
            if (data.exists) {
              urlCheck.style.color = '#D97706';
              urlCheck.textContent = '此頻道已於 ' + data.submittedAt + ' 提交（狀態：' + data.status + '）';
            } else {
              urlCheck.style.color = '#059669';
              urlCheck.textContent = '此頻道尚未被提交';
            }
          })
          .catch(() => { urlCheck.style.display = 'none'; });

        // Auto-fetch channel info (only once per URL)
        if (url === lastFetchedUrl) return;
        lastFetchedUrl = url;

        urlCheck.style.display = 'block';
        urlCheck.style.color = 'var(--text-tertiary)';
        urlCheck.textContent = '正在取得頻道資訊…';

        fetch('/api/channel-info?url=' + encoded)
          .then(r => r.json())
          .then(info => {
            if (info.displayName && !nameManuallyEdited) {
              nameInput.value = info.displayName;
              if (!slugManuallyEdited) {
                slugInput.value = generateSlug(info.displayName);
              }
            }
            if (info.avatarUrl && !avatarInput.value) {
              avatarInput.value = info.avatarUrl;
            }
            if (!linkYtInput.value) {
              linkYtInput.value = url;
            }
          })
          .catch(() => {});
      });

      // Form submission
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        submitBtn.disabled = true;
        submitBtn.textContent = '提交中…';
        resultDiv.style.display = 'none';

        const fd = new FormData(form);
        const turnstileInput = form.querySelector('[name="cf-turnstile-response"]');
        const token = turnstileInput ? turnstileInput.value : '';

        const body = {
          youtube_channel_url: fd.get('youtube_channel_url'),
          display_name: fd.get('display_name'),
          slug: fd.get('slug'),
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

          resultDiv.style.display = 'block';
          if (res.ok) {
            resultDiv.style.background = '#F0FDF4';
            resultDiv.style.color = '#15803D';
            resultDiv.textContent = '提交成功！ID: ' + data.id + '。感謝你的推薦！';
            form.reset();
            slugManuallyEdited = false;
            if (window.turnstile) turnstile.reset();
          } else if (res.status === 409) {
            resultDiv.style.background = '#FFFBEB';
            resultDiv.style.color = '#B45309';
            resultDiv.textContent = '此頻道已於 ' + data.submittedAt + ' 提交過（狀態：' + data.status + '）';
          } else {
            resultDiv.style.background = '#FEF2F2';
            resultDiv.style.color = '#DC2626';
            resultDiv.textContent = data.error || '提交失敗，請稍後再試';
          }
        } catch {
          resultDiv.style.display = 'block';
          resultDiv.style.background = '#FEF2F2';
          resultDiv.style.color = '#DC2626';
          resultDiv.textContent = '網路錯誤，請檢查連線後再試';
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = '提交';
        }
      });
    })();
  </script>
</body>
</html>`;
}
