import { html, raw } from 'hono/html';
import { DARK_MODE_CSS, DARK_MODE_DETECT_SCRIPT, themeToggleHTML } from './theme';

export function renderFormPage(siteKey: string) {
  return html`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prism Crystal — 回報 / 建議</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap" rel="stylesheet" />
  <script>${raw(DARK_MODE_DETECT_SCRIPT)}</script>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>
    :root {
      --accent-pink: #EC4899;
      --accent-pink-light: #F472B6;
      --accent-blue: #3B82F6;
      --accent-blue-light: #60A5FA;
      --accent-purple: #8B5CF6;
      --accent-purple-light: #A78BFA;
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
      --border-accent-purple: #DDD6FE;
      --radius-lg: 12px;
      --radius-xl: 16px;
      --radius-2xl: 20px;
    }

    ${raw(DARK_MODE_CSS)}

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
      border-color: var(--border-accent-purple);
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
    }
    textarea.form-input { resize: vertical; min-height: 100px; }

    .form-label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }
    .form-label .required { color: var(--accent-purple); }

    .form-hint {
      font-size: 11px;
      color: var(--text-tertiary);
      margin-top: 4px;
    }

    .btn-submit {
      width: 100%;
      padding: 12px 24px;
      border: none;
      border-radius: var(--radius-lg);
      background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
      color: white;
      font-family: inherit;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s, box-shadow 0.2s;
      box-shadow: 0 4px 14px rgba(139, 92, 246, 0.25);
    }
    .btn-submit:hover { opacity: 0.92; box-shadow: 0 6px 20px rgba(139, 92, 246, 0.3); }
    .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }

    .type-selector {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
    }
    .type-btn {
      padding: 8px 12px;
      border: 1px solid var(--border-glass);
      border-radius: var(--radius-lg);
      background: var(--bg-surface-frosted);
      font-family: inherit;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s;
      text-align: center;
    }
    .type-btn:hover { border-color: var(--border-accent-purple); }
    .type-btn.active {
      background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
      color: white;
      border-color: transparent;
    }

    .toggle-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      background: var(--bg-surface-frosted);
      border: 1px solid var(--border-glass);
      border-radius: var(--radius-lg);
      cursor: pointer;
    }
    .toggle-row input[type="checkbox"] {
      width: 18px;
      height: 18px;
      accent-color: var(--accent-purple);
      cursor: pointer;
    }
    .toggle-label {
      font-size: 14px;
      color: var(--text-primary);
      user-select: none;
    }
    .toggle-hint {
      font-size: 12px;
      color: var(--text-tertiary);
    }

    .contact-field { transition: max-height 0.3s ease, opacity 0.3s ease; overflow: hidden; }
    .contact-field.visible { max-height: 120px; opacity: 1; }
    .contact-field.hidden { max-height: 0; opacity: 0; }

    #result {
      margin-top: 16px;
      padding: 12px 16px;
      border-radius: var(--radius-lg);
      font-size: 14px;
      display: none;
    }
    #result.success { display: block; background: #ECFDF5; color: #065F46; border: 1px solid #A7F3D0; }
    #result.error { display: block; background: #FEF2F2; color: #991B1B; border: 1px solid #FECACA; }

    .cross-links {
      display: flex;
      justify-content: center;
      gap: 16px;
      margin-top: 16px;
      font-size: 13px;
    }
    .cross-links a {
      color: var(--accent-purple);
      text-decoration: none;
      transition: opacity 0.2s;
    }
    .cross-links a:hover { opacity: 0.7; }

    @media (max-width: 480px) {
      .type-selector { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>

  <div style="max-width: 640px; margin: 0 auto; padding: 48px 16px;">
    <!-- Header -->
    <div style="text-align: center; margin-bottom: 32px;">
      <div style="display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 8px; position: relative;">
        <div style="
          width: 40px; height: 40px; border-radius: var(--radius-lg);
          background: linear-gradient(135deg, var(--accent-purple-light), var(--accent-blue-light));
          display: flex; align-items: center; justify-content: center;
        ">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <span style="
          font-size: 28px; font-weight: 700; letter-spacing: -0.5px;
          background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text;
        ">Prism Crystal</span>
        <div style="position: absolute; right: 0; top: 50%; transform: translateY(-50%);">
          ${raw(themeToggleHTML())}
        </div>
      </div>
      <p style="color: var(--text-secondary); font-size: 14px;">
        回報問題或建議新功能，幫助我們讓 Prism 更好
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
      <form id="crystal-form" style="display: flex; flex-direction: column; gap: 20px;">

        <!-- Type selector -->
        <div>
          <label class="form-label">類型 <span class="required">*</span></label>
          <div class="type-selector">
            <button type="button" class="type-btn active" data-type="bug">Bug 回報</button>
            <button type="button" class="type-btn" data-type="feat">功能建議</button>
            <button type="button" class="type-btn" data-type="ui">UI 問題</button>
            <button type="button" class="type-btn" data-type="other">其他</button>
          </div>
        </div>

        <!-- Title -->
        <div>
          <label class="form-label" for="title">標題 <span class="required">*</span></label>
          <input type="text" id="title" class="form-input" placeholder="簡短描述問題或建議" maxlength="200" required />
        </div>

        <!-- Body -->
        <div>
          <label class="form-label" for="body">詳細描述 <span class="required">*</span></label>
          <textarea id="body" class="form-input" rows="5" placeholder="請描述你遇到的問題或想要的功能…" required></textarea>
        </div>

        <!-- Nickname -->
        <div>
          <label class="form-label" for="nickname">暱稱</label>
          <input type="text" id="nickname" class="form-input" placeholder="選填，Q&A 公開回覆時顯示" maxlength="50" />
        </div>

        <!-- Public reply toggle -->
        <div>
          <label class="toggle-row" for="public-toggle">
            <input type="checkbox" id="public-toggle" checked />
            <div>
              <div class="toggle-label">允許公開回覆</div>
              <div class="toggle-hint">勾選後你的問題與官方回覆將顯示在 Q&A 頁面</div>
            </div>
          </label>
        </div>

        <!-- Contact (shown when public reply is NOT allowed) -->
        <div id="contact-wrapper" class="contact-field hidden">
          <label class="form-label" for="contact">聯絡方式 <span class="required">*</span></label>
          <input type="text" id="contact" class="form-input" placeholder="Email / Discord / Twitter 等，讓我們能回覆你" />
          <p class="form-hint">不公開回覆時必須提供聯絡方式</p>
        </div>

        <!-- Turnstile -->
        <div class="cf-turnstile" data-sitekey="${siteKey}" data-theme="auto"></div>

        <!-- Submit -->
        <button type="submit" class="btn-submit" id="submit-btn">送出回報</button>

        <div id="result"></div>
      </form>
    </div>

    <div class="cross-links">
      <a href="/qa">查看 Q&A</a>
      <span style="color: var(--text-tertiary);">|</span>
      <a href="https://nova.oshi.tw" target="_blank">提議新 VTuber</a>
      <span style="color: var(--text-tertiary);">|</span>
      <a href="https://prism.oshi.tw" target="_blank">前往 Prism 歌單</a>
    </div>
    <p style="text-align: center; font-size: 11px; color: var(--text-tertiary); margin-top: 16px;">
      Prism &mdash; 為你喜愛的 VTuber 打造歌單頁面
    </p>
  </div>

  <script>
    const form = document.getElementById('crystal-form');
    const resultEl = document.getElementById('result');
    const submitBtn = document.getElementById('submit-btn');
    const publicToggle = document.getElementById('public-toggle');
    const contactWrapper = document.getElementById('contact-wrapper');
    let selectedType = 'bug';

    // Type selector
    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedType = btn.dataset.type;
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
          document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
          document.querySelector('[data-type="bug"]').classList.add('active');
          selectedType = 'bug';
          // Reset contact visibility
          contactWrapper.classList.remove('visible');
          contactWrapper.classList.add('hidden');
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
  </script>
</body>
</html>`;
}
