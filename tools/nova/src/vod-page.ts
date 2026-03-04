import { html } from 'hono/html';
import type { ApprovedStreamer } from './types';

export function renderVodPage(siteKey: string, streamers: ApprovedStreamer[]) {
  const streamerOptions = streamers
    .map((s) => `<option value="${s.slug}">${s.display_name}</option>`)
    .join('');

  return html`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prism Nova — VOD 提交</title>
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
      --accent-purple: #8B5CF6;
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

    .form-input, .form-select {
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
    .form-input:focus, .form-select:focus {
      border-color: var(--border-accent-pink);
      box-shadow: 0 0 0 3px rgba(236, 72, 153, 0.1);
    }

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

    .btn-secondary {
      padding: 8px 16px;
      border: 1px solid var(--border-default);
      border-radius: var(--radius-lg);
      background: var(--bg-surface-frosted);
      color: var(--text-secondary);
      font-family: inherit;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s, border-color 0.2s;
    }
    .btn-secondary:hover { background: #fff; border-color: var(--accent-pink-light); }

    .btn-danger {
      padding: 4px 8px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--text-tertiary);
      font-size: 16px;
      cursor: pointer;
      transition: color 0.2s, background 0.2s;
    }
    .btn-danger:hover { color: #EF4444; background: #FEF2F2; }

    .song-entry {
      display: grid;
      grid-template-columns: 1fr 1fr 100px 100px auto;
      gap: 8px;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid var(--border-glass);
    }
    .song-entry:last-child { border-bottom: none; }

    @media (max-width: 640px) {
      .song-entry {
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }
      .song-ts-row {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: 1fr 1fr auto;
        gap: 6px;
      }
    }

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
  </style>
</head>
<body>

  <div style="max-width: 720px; margin: 0 auto; padding: 48px 16px;">
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
        提交歌回 VOD，幫助我們建立歌曲時間戳
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
      <form id="vod-form" style="display: flex; flex-direction: column; gap: 20px;">

        <!-- Streamer Select -->
        <div>
          <label class="form-label">
            VTuber <span class="required">*</span>
          </label>
          <select name="streamer_slug" required class="form-select">
            <option value="">選擇 VTuber…</option>
            ${streamerOptions}
          </select>
        </div>

        <!-- YouTube VOD URL -->
        <div>
          <label class="form-label">
            YouTube VOD 網址 <span class="required">*</span>
          </label>
          <input type="url" name="video_url" required
            placeholder="https://www.youtube.com/watch?v=..."
            class="form-input" />
          <div id="url-check" style="margin-top: 4px; font-size: 13px; display: none;"></div>
        </div>

        <!-- Stream Title (auto-filled) -->
        <div>
          <label class="form-label">直播標題</label>
          <input type="text" name="stream_title"
            placeholder="會自動填入（可修改）"
            class="form-input" />
        </div>

        <!-- Stream Date (auto-filled) -->
        <div>
          <label class="form-label">直播日期</label>
          <input type="date" name="stream_date" class="form-input" />
        </div>

        <!-- Submitter Note -->
        <div>
          <label class="form-label">備註</label>
          <input type="text" name="submitter_note"
            placeholder="任何補充說明（選填）"
            class="form-input" />
        </div>

        <!-- Song Timestamps Section -->
        <div style="border-top: 1px solid var(--border-glass); padding-top: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <p class="section-label" style="margin-bottom: 0;">歌曲時間戳（選填）</p>
            <button type="button" id="add-song-btn" class="btn-secondary">+ 新增歌曲</button>
          </div>
          <p class="form-hint" style="margin-bottom: 12px;">
            如果你知道每首歌的時間戳，可以在這裡填寫。也可以之後用
            <a href="https://aurora.oshi.tw" target="_blank" style="color: var(--accent-purple);">Aurora 編輯器</a>
            來編輯。
          </p>
          <div id="songs-container"></div>
        </div>

        <!-- Turnstile -->
        <div style="display: flex; justify-content: center;">
          <div class="cf-turnstile" data-sitekey="${siteKey}" data-theme="light"></div>
        </div>

        <!-- Submit -->
        <button type="submit" id="submit-btn" class="btn-submit">
          提交 VOD
        </button>

        <!-- Result message -->
        <div id="result" style="display: none; text-align: center; font-size: 13px; padding: 12px 16px; border-radius: var(--radius-lg);"></div>
      </form>
    </div>

    <!-- Cross-links -->
    <div class="cross-links">
      <a href="/">推薦新的 VTuber</a>
      <span style="color: var(--text-tertiary);">|</span>
      <a href="https://aurora.oshi.tw" target="_blank">使用完整時間戳編輯器</a>
    </div>

    <p style="text-align: center; font-size: 11px; color: var(--text-tertiary); margin-top: 16px;">
      Prism &mdash; 為你喜愛的 VTuber 打造歌單頁面
    </p>
  </div>

  <script>
    (function() {
      var form = document.getElementById('vod-form');
      var urlInput = form.querySelector('[name="video_url"]');
      var titleInput = form.querySelector('[name="stream_title"]');
      var dateInput = form.querySelector('[name="stream_date"]');
      var streamerSelect = form.querySelector('[name="streamer_slug"]');
      var urlCheck = document.getElementById('url-check');
      var submitBtn = document.getElementById('submit-btn');
      var resultDiv = document.getElementById('result');
      var songsContainer = document.getElementById('songs-container');
      var addSongBtn = document.getElementById('add-song-btn');
      var songCount = 0;
      var thumbnailUrl = '';

      function createInput(name, placeholder, value) {
        var input = document.createElement('input');
        input.type = 'text';
        input.name = name;
        input.placeholder = placeholder;
        input.className = 'form-input';
        if (value) input.value = value;
        return input;
      }

      function addSongEntry(data) {
        songCount++;
        var entry = document.createElement('div');
        entry.className = 'song-entry';

        entry.appendChild(createInput('song_title_' + songCount, '歌名', data ? data.title : ''));
        entry.appendChild(createInput('song_artist_' + songCount, '原唱', data ? data.artist : ''));

        var tsRow = document.createElement('div');
        tsRow.className = 'song-ts-row';
        tsRow.appendChild(createInput('song_start_' + songCount, '開始 0:00:00', data ? data.start : ''));
        tsRow.appendChild(createInput('song_end_' + songCount, '結束（選填）', data ? data.end : ''));

        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-danger';
        delBtn.textContent = '\u00D7';
        delBtn.addEventListener('click', function() { entry.remove(); });
        tsRow.appendChild(delBtn);

        entry.appendChild(tsRow);
        songsContainer.appendChild(entry);
      }

      addSongBtn.addEventListener('click', function() { addSongEntry(); });

      // On URL blur: duplicate check + auto-fetch video info
      var lastFetchedUrl = '';
      urlInput.addEventListener('blur', function() {
        var url = this.value.trim();
        var slug = streamerSelect.value;
        if (!url) {
          urlCheck.style.display = 'none';
          return;
        }

        var encoded = encodeURIComponent(url);

        // Duplicate check
        if (slug) {
          fetch('/vod/api/check?streamer_slug=' + encodeURIComponent(slug) + '&url=' + encoded)
            .then(function(r) { return r.json(); })
            .then(function(data) {
              urlCheck.style.display = 'block';
              if (data.exists && data.canResubmit) {
                urlCheck.style.color = '#2563EB';
                urlCheck.textContent = '此 VOD 先前的提交被拒絕，你可以重新提交';
              } else if (data.exists) {
                urlCheck.style.color = '#D97706';
                urlCheck.textContent = '此 VOD 已於 ' + data.submittedAt + ' 提交（狀態：' + data.status + '）';
              } else {
                urlCheck.style.color = '#059669';
                urlCheck.textContent = '此 VOD 尚未被提交';
              }
            })
            .catch(function() { urlCheck.style.display = 'none'; });
        }

        // Auto-fetch video info (only once per URL)
        if (url === lastFetchedUrl) return;
        lastFetchedUrl = url;

        urlCheck.style.display = 'block';
        urlCheck.style.color = 'var(--text-tertiary)';
        urlCheck.textContent = '正在取得影片資訊…';

        fetch('/vod/api/video-info?url=' + encoded)
          .then(function(r) { return r.json(); })
          .then(function(info) {
            if (info.title && !titleInput.value) {
              titleInput.value = info.title;
            }
            if (info.date && !dateInput.value) {
              dateInput.value = info.date;
            }
            if (info.thumbnail) {
              thumbnailUrl = info.thumbnail;
            }
          })
          .catch(function() {});
      });

      // Collect songs from form
      function collectSongs() {
        var songs = [];
        var entries = songsContainer.querySelectorAll('.song-entry');
        for (var i = 0; i < entries.length; i++) {
          var title = entries[i].querySelector('[name^="song_title_"]');
          var artist = entries[i].querySelector('[name^="song_artist_"]');
          var start = entries[i].querySelector('[name^="song_start_"]');
          var end = entries[i].querySelector('[name^="song_end_"]');
          if (title && title.value.trim() && start && start.value.trim()) {
            songs.push({
              song_title: title.value.trim(),
              original_artist: artist ? artist.value.trim() : '',
              start_timestamp: start.value.trim(),
              end_timestamp: end && end.value.trim() ? end.value.trim() : null,
            });
          }
        }
        return songs;
      }

      // Form submission
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        submitBtn.disabled = true;
        submitBtn.textContent = '提交中…';
        resultDiv.style.display = 'none';

        var turnstileInput = form.querySelector('[name="cf-turnstile-response"]');
        var token = turnstileInput ? turnstileInput.value : '';

        var body = {
          streamer_slug: streamerSelect.value,
          video_url: urlInput.value.trim(),
          stream_title: titleInput.value.trim(),
          stream_date: dateInput.value,
          submitter_note: form.querySelector('[name="submitter_note"]').value.trim(),
          songs: collectSongs(),
          turnstile_token: token,
        };

        if (thumbnailUrl) {
          body.thumbnail_url = thumbnailUrl;
        }

        try {
          var res = await fetch('/vod/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          var data = await res.json();

          resultDiv.style.display = 'block';
          if (res.ok) {
            resultDiv.style.background = '#F0FDF4';
            resultDiv.style.color = '#15803D';
            resultDiv.textContent = data.resubmitted
              ? '重新提交成功！ID: ' + data.id + '。將再次進入審核流程。'
              : '提交成功！ID: ' + data.id + '。感謝你的幫助！';
            form.reset();
            while (songsContainer.firstChild) songsContainer.removeChild(songsContainer.firstChild);
            songCount = 0;
            thumbnailUrl = '';
            if (window.turnstile) turnstile.reset();
          } else if (res.status === 409) {
            resultDiv.style.background = '#FFFBEB';
            resultDiv.style.color = '#B45309';
            resultDiv.textContent = '此 VOD 已於 ' + data.submittedAt + ' 提交過（狀態：' + data.status + '）';
          } else {
            resultDiv.style.background = '#FEF2F2';
            resultDiv.style.color = '#DC2626';
            resultDiv.textContent = data.error || '提交失敗，請稍後再試';
          }
        } catch(err) {
          resultDiv.style.display = 'block';
          resultDiv.style.background = '#FEF2F2';
          resultDiv.style.color = '#DC2626';
          resultDiv.textContent = '網路錯誤，請檢查連線後再試';
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = '提交 VOD';
        }
      });
    })();
  </script>
</body>
</html>`;
}
