import { html } from 'hono/html';

export function renderPage(siteKey: string) {
  return html`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prism Nova — VTuber 提交</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,700;1,9..40,400&display=swap" rel="stylesheet" />
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>
    body { font-family: 'DM Sans', sans-serif; }
  </style>
</head>
<body class="min-h-screen" style="background: linear-gradient(135deg, #FFF0F5 0%, #F0F8FF 50%, #E6E6FA 100%);">

  <div class="max-w-2xl mx-auto px-4 py-12">
    <!-- Header -->
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold bg-gradient-to-r from-pink-500 to-blue-500 bg-clip-text text-transparent">
        Prism Nova
      </h1>
      <p class="text-gray-600 mt-2">提交你喜愛的 VTuber，讓我們為 TA 建立 Prism 頁面</p>
    </div>

    <!-- Form Card -->
    <div class="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 md:p-8">
      <form id="nova-form" class="space-y-5">

        <!-- YouTube Channel URL -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">
            YouTube 頻道網址 <span class="text-pink-500">*</span>
          </label>
          <input type="url" name="youtube_channel_url" required
            placeholder="https://www.youtube.com/@ChannelName"
            class="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-transparent transition" />
          <div id="url-check" class="mt-1 text-sm hidden"></div>
        </div>

        <!-- Display Name -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">
            顯示名稱 <span class="text-pink-500">*</span>
          </label>
          <input type="text" name="display_name" required
            placeholder="例：水月稜鏡"
            class="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-transparent transition" />
        </div>

        <!-- Slug -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">
            Slug（網址用，小寫英數加連字號）<span class="text-pink-500">*</span>
          </label>
          <input type="text" name="slug" required
            placeholder="例：mizuki-prism"
            pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
            class="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-transparent transition" />
          <p class="text-xs text-gray-400 mt-1">自動從顯示名稱生成，可自行修改</p>
        </div>

        <!-- Group -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">箱 / 所屬公司 / 個人勢</label>
          <input type="text" name="group"
            placeholder="例：個人勢、hololive"
            class="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-transparent transition" />
        </div>

        <!-- Description -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">簡介</label>
          <textarea name="description" rows="3"
            placeholder="關於這位 VTuber 的簡短介紹…"
            class="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-transparent transition resize-none"></textarea>
        </div>

        <!-- Avatar URL -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">頭像圖片網址</label>
          <input type="url" name="avatar_url"
            placeholder="https://..."
            class="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-transparent transition" />
        </div>

        <!-- Subscriber Count -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">訂閱數</label>
          <input type="text" name="subscriber_count"
            placeholder="例：21.8萬"
            class="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-transparent transition" />
        </div>

        <!-- Social Links -->
        <div class="border-t border-gray-100 pt-5">
          <h3 class="text-sm font-medium text-gray-700 mb-3">社群連結（選填）</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input type="url" name="link_youtube" placeholder="YouTube 連結"
              class="px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-transparent transition" />
            <input type="url" name="link_twitter" placeholder="Twitter / X 連結"
              class="px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-transparent transition" />
            <input type="url" name="link_facebook" placeholder="Facebook 連結"
              class="px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-transparent transition" />
            <input type="url" name="link_instagram" placeholder="Instagram 連結"
              class="px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-transparent transition" />
            <input type="url" name="link_twitch" placeholder="Twitch 連結"
              class="px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-transparent transition" />
          </div>
        </div>

        <!-- Turnstile -->
        <div class="flex justify-center">
          <div class="cf-turnstile" data-sitekey="${siteKey}" data-theme="light"></div>
        </div>

        <!-- Submit -->
        <button type="submit" id="submit-btn"
          class="w-full py-3 px-6 text-white font-medium rounded-xl bg-gradient-to-r from-pink-500 to-blue-500 hover:from-pink-600 hover:to-blue-600 transition shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed">
          提交
        </button>

        <!-- Result message -->
        <div id="result" class="hidden text-center text-sm py-3 px-4 rounded-xl"></div>
      </form>
    </div>

    <p class="text-center text-xs text-gray-400 mt-6">
      Prism &mdash; 為你喜愛的 VTuber 打造歌單頁面
    </p>
  </div>

  <script>
    (function() {
      const form = document.getElementById('nova-form');
      const urlInput = form.querySelector('[name="youtube_channel_url"]');
      const nameInput = form.querySelector('[name="display_name"]');
      const slugInput = form.querySelector('[name="slug"]');
      const urlCheck = document.getElementById('url-check');
      const submitBtn = document.getElementById('submit-btn');
      const resultDiv = document.getElementById('result');
      let slugManuallyEdited = false;

      // Auto-generate slug from display name
      slugInput.addEventListener('input', function() {
        slugManuallyEdited = true;
      });

      nameInput.addEventListener('input', function() {
        if (!slugManuallyEdited) {
          slugInput.value = this.value
            .toLowerCase()
            .replace(/[^a-z0-9\\s-]/g, '')
            .replace(/\\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        }
      });

      // Real-time dedup check on URL blur
      let checkTimeout;
      urlInput.addEventListener('blur', function() {
        const url = this.value.trim();
        if (!url) {
          urlCheck.classList.add('hidden');
          return;
        }
        clearTimeout(checkTimeout);
        checkTimeout = setTimeout(async () => {
          try {
            const res = await fetch('/api/check?url=' + encodeURIComponent(url));
            const data = await res.json();
            urlCheck.classList.remove('hidden');
            if (data.exists) {
              urlCheck.className = 'mt-1 text-sm text-amber-600';
              urlCheck.textContent = '此頻道已於 ' + data.submittedAt + ' 提交（狀態：' + data.status + '）';
            } else {
              urlCheck.className = 'mt-1 text-sm text-green-600';
              urlCheck.textContent = '此頻道尚未被提交';
            }
          } catch {
            urlCheck.classList.add('hidden');
          }
        }, 300);
      });

      // Form submission
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        submitBtn.disabled = true;
        submitBtn.textContent = '提交中…';
        resultDiv.classList.add('hidden');

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

          resultDiv.classList.remove('hidden');
          if (res.ok) {
            resultDiv.className = 'text-center text-sm py-3 px-4 rounded-xl bg-green-50 text-green-700';
            resultDiv.textContent = '提交成功！ID: ' + data.id + '。感謝你的推薦！';
            form.reset();
            slugManuallyEdited = false;
            if (window.turnstile) turnstile.reset();
          } else if (res.status === 409) {
            resultDiv.className = 'text-center text-sm py-3 px-4 rounded-xl bg-amber-50 text-amber-700';
            resultDiv.textContent = '此頻道已於 ' + data.submittedAt + ' 提交過（狀態：' + data.status + '）';
          } else {
            resultDiv.className = 'text-center text-sm py-3 px-4 rounded-xl bg-red-50 text-red-600';
            resultDiv.textContent = data.error || '提交失敗，請稍後再試';
          }
        } catch {
          resultDiv.classList.remove('hidden');
          resultDiv.className = 'text-center text-sm py-3 px-4 rounded-xl bg-red-50 text-red-600';
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
