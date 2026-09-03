import { html, raw } from 'hono/html';
import type { ApprovedStreamer } from './types';
import { DARK_MODE_CSS, SPARKLE_SVG, svgIcon, themeToggleHTML } from './theme';
import { VOD_FIELD_LIMITS, validateSlug } from './validate';
import { escapeHtml } from '../../shared/web/html';
import { pageShell } from '../../shared/web/page-shell';

const PAGE_CSS = `    /* video fields left, fetched-video card right (one DOM card, re-flowed under the URL on mobile) */
    .vod-form { padding: 24px 32px 32px; }
    .vod-top { display: grid; grid-template-columns: minmax(0, 1fr) 300px; grid-template-rows: auto 1fr; gap: 18px 32px; }
    .vod-col-a { grid-column: 1; grid-row: 1; }
    .vod-col-b { grid-column: 1; grid-row: 2; }
    .video-preview { grid-column: 2; grid-row: 1 / 3; }
    .video-sticky { position: sticky; top: 24px; display: flex; flex-direction: column; gap: 8px; }
    .video-card { display: flex; flex-direction: column; gap: 10px; padding: 12px; }
    .video-thumb { width: 100%; aspect-ratio: 16 / 9; border-radius: var(--radius-lg); object-fit: cover; border: 1px solid var(--border-glass); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1); background: var(--bg-surface-frosted); }
    .video-text { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .video-title { font-size: 13px; font-weight: 700; line-height: 1.4; color: var(--text-primary); word-break: break-word; }
    .video-title:empty { display: none; }

    .songs-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
    .songs-textarea { min-height: 120px; }
    .songs-preview { padding: 12px 8px 8px; min-height: 120px; }
    .songs-preview:empty { display: flex; align-items: center; justify-content: center; padding: 12px; }
    .songs-preview:empty::before { content: '貼上時間戳後，解析出的歌曲會顯示在這裡'; font-size: 12px; color: var(--text-tertiary); text-align: center; }
    .songs-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 0 8px 8px; }
    .songs-head-hint { font-size: 11px; color: var(--text-tertiary); }
    .songs-cols, .song-row { display: grid; grid-template-columns: 24px minmax(0, 1fr) 60px 60px; gap: 0; align-items: center; }
    .songs-cols { padding: 0 8px 6px; border-bottom: 1px solid var(--border-table); }
    .songs-cols > :nth-child(2) { padding-left: 8px; }
    .song-row { padding: 6px 8px; border-radius: 8px; }
    .song-row .cell { padding-left: 8px; }
    .song-title { font-size: 13px; font-weight: 700; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .song-artist { font-size: 11px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .right { text-align: right; }
    .form-hint code { font-family: var(--font-mono); font-size: 11px; }
    .link-pill svg, .btn-primary svg { flex-shrink: 0; }

    /* 800px, not 640px: below that the fields column drops under the 300px Turnstile widget. */
    @media (max-width: 800px) {
      .vod-form { padding: 8px 16px 24px; }
      .vod-top { grid-template-columns: 1fr; grid-template-rows: none; gap: 18px; }
      .vod-col-a, .vod-col-b, .video-preview { grid-column: auto; grid-row: auto; }
      .video-sticky { position: static; }
      .video-card { flex-direction: row; align-items: center; padding: 12px 14px; }
      .video-thumb { width: 96px; height: 54px; aspect-ratio: auto; border-radius: 8px; flex-shrink: 0; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1); }
      .video-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .songs-grid { grid-template-columns: 1fr; }
    }
`;

const VOD_SCRIPT = String.raw`
    (function() {
      var form = document.getElementById('vod-form');
      var urlInput = form.querySelector('[name="video_url"]');
      var titleInput = form.querySelector('[name="stream_title"]');
      var dateInput = form.querySelector('[name="stream_date"]');
      var streamerSelect = form.querySelector('[name="streamer_slug"]');
      var urlCheck = document.getElementById('url-check');
      var submitBtn = document.getElementById('submit-btn');
      var submitLabel = document.getElementById('submit-label');
      var resultDiv = document.getElementById('result');
      var songsTextarea = document.getElementById('songs-textarea');
      var songsPreview = document.getElementById('songs-preview');
      var videoPreview = document.getElementById('video-preview');
      var videoThumb = document.getElementById('video-preview-thumb');
      var videoTitle = document.getElementById('video-preview-title');
      var videoDate = document.getElementById('video-preview-date');
      var thumbnailUrl = '';

      // --- Inline parser (ported from lib/parse.ts) ---
      var LINE_TS_RE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})/;
      var RANGE_END_RE = /^(?:~|-|\u2013|\u2014)\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})/;

      function secondsToTimestamp(sec) {
        var h = Math.floor(sec / 3600);
        var rem = sec % 3600;
        var m = Math.floor(rem / 60);
        var s = rem % 60;
        var mm = String(m).padStart(2, '0');
        var ss = String(s).padStart(2, '0');
        return h ? h + ':' + mm + ':' + ss : m + ':' + ss;
      }

      function splitArtist(info) {
        var slashM = info.match(/\s*\/\s+|\s+\/\s*/);
        if (slashM) return [info.slice(0, slashM.index).trim(), info.slice(slashM.index + slashM[0].length).trim()];
        var dashM = info.match(/\s+-\s+/);
        if (dashM) return [info.slice(0, dashM.index).trim(), info.slice(dashM.index + dashM[0].length).trim()];
        var bare = info.indexOf('/');
        if (bare !== -1) {
          var n = info.slice(0, bare).trim(), a = info.slice(bare + 1).trim();
          if (n && a) return [n, a];
        }
        return [info.trim(), ''];
      }

      function parseSongLine(line) {
        line = line.trim();
        if (!line) return null;
        line = line.replace(/^[\u2500-\u257F\s]+/, '');
        if (!line) return null;
        line = line.replace(/^(?:\d+\.\s*|\d+\)\s+|#\d+\s+)/, '');
        line = line.replace(/^[-*+]\s+/, '');
        var tsM = line.match(LINE_TS_RE);
        if (!tsM) return null;
        var h = tsM[1] ? parseInt(tsM[1], 10) : 0;
        var startSec = h * 3600 + parseInt(tsM[2], 10) * 60 + parseInt(tsM[3], 10);
        var rest = line.slice(tsM[0].length).trim();
        var endSec = null;
        var rangeM = rest.match(RANGE_END_RE);
        if (rangeM) {
          var rh = rangeM[1] ? parseInt(rangeM[1], 10) : 0;
          endSec = rh * 3600 + parseInt(rangeM[2], 10) * 60 + parseInt(rangeM[3], 10);
          rest = rest.slice(rangeM[0].length).trim();
        }
        var sepM = rest.match(/^(?:-\s+|\u2013\s+|\u2014\s+)/);
        if (sepM) rest = rest.slice(sepM[0].length).trim();
        if (!rest) return null;
        var parts = splitArtist(rest);
        return { startSeconds: startSec, endSeconds: endSec, songName: parts[0], artist: parts[1] };
      }

      function parseTextToSongs(text) {
        var raw = [];
        var lines = text.split('\n');
        for (var i = 0; i < lines.length; i++) {
          var p = parseSongLine(lines[i]);
          if (p) raw.push(p);
        }
        var result = [];
        for (var i = 0; i < raw.length; i++) {
          var s = raw[i];
          var end = s.endSeconds;
          if (end === null && i + 1 < raw.length) end = raw[i + 1].startSeconds;
          result.push({
            songName: s.songName,
            artist: s.artist,
            startSeconds: s.startSeconds,
            endSeconds: end,
            startTimestamp: secondsToTimestamp(s.startSeconds),
            endTimestamp: end !== null ? secondsToTimestamp(end) : null,
          });
        }
        return result;
      }

      // Every node is built with createElement/textContent: song names and artists are user text.
      function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
      }

      function renderPreview(songs) {
        songsPreview.textContent = '';
        if (!songs.length) return;

        var head = el('div', 'songs-head');
        head.appendChild(el('span', 'badge badge-pink', '已解析 ' + songs.length + ' 首'));
        head.appendChild(el('span', 'songs-head-hint', '確認歌名、原唱與時間無誤後再提交'));
        songsPreview.appendChild(head);

        var cols = el('div', 'songs-cols');
        ['#', '歌名 / 原唱', '開始', '結束'].forEach(function(label, i) {
          cols.appendChild(el('div', 'section-label' + (i >= 2 ? ' right' : ''), label));
        });
        songsPreview.appendChild(cols);

        var list = el('div', 'prism-list');
        for (var i = 0; i < songs.length; i++) {
          var s = songs[i];
          var row = el('div', 'prism-row song-row');
          row.appendChild(el('span', 'mono mono-muted', String(i + 1)));
          var text = el('div', 'cell cell-stack');
          text.appendChild(el('div', 'song-title', s.songName));
          text.appendChild(el('div', 'song-artist', s.artist || '—'));
          row.appendChild(text);
          row.appendChild(el('span', 'mono right', s.startTimestamp));
          row.appendChild(el('span', 'mono mono-muted right', s.endTimestamp || '—'));
          list.appendChild(row);
        }
        songsPreview.appendChild(list);
      }

      songsTextarea.addEventListener('input', function() {
        renderPreview(parseTextToSongs(this.value));
      });

      // Fetched video card: thumbnail only from YouTube image hosts, text via textContent.
      function showVideoPreview(info) {
        var thumb = typeof info.thumbnail === 'string' ? info.thumbnail : '';
        if (/^https:\/\/(i\.ytimg\.com|img\.youtube\.com)\//.test(thumb)) {
          videoThumb.src = thumb;
          videoThumb.style.display = '';
        } else {
          videoThumb.removeAttribute('src');
          videoThumb.style.display = 'none';
        }
        videoTitle.textContent = info.title || '';
        videoDate.textContent = info.date || '';
        videoPreview.style.display = (info.title || thumb) ? '' : 'none';
      }

      function hideVideoPreview() {
        videoThumb.removeAttribute('src');
        videoTitle.textContent = '';
        videoDate.textContent = '';
        videoPreview.style.display = 'none';
      }

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
              urlCheck.style.display = '';
              if (data.inAdmin && data.adminStatus === 'approved') {
                urlCheck.className = 'check-line check-ok';
                urlCheck.textContent = '此 VOD 已收錄於歌單中，無需再提交';
              } else if (data.exists && data.hasApproved) {
                urlCheck.className = 'check-line check-exists';
                urlCheck.textContent = '此 VOD 已通過審核，無需重複提交';
              } else if (data.exists && data.pendingCount > 0) {
                urlCheck.className = 'check-line check-resubmit';
                urlCheck.textContent = '此 VOD 已有 ' + data.pendingCount + ' 筆提交（審核中），你仍可提交新版本';
              } else if (data.exists && data.rejectedCount > 0) {
                urlCheck.className = 'check-line check-exists';
                urlCheck.textContent = '此 VOD 先前的提交已被拒絕，歡迎重新提交修正版本';
              } else if (data.inAdmin && (data.adminStatus === 'pending' || data.adminStatus === 'extracted')) {
                // Pipeline state alone does not mean a Nova submission exists.
                urlCheck.style.display = 'none';
                urlCheck.textContent = '';
              } else {
                urlCheck.className = 'check-line check-ok';
                urlCheck.textContent = '此 VOD 尚未被提交';
              }
            })
            .catch(function() { urlCheck.style.display = 'none'; });
        }

        // Auto-fetch video info (only once per URL)
        if (url === lastFetchedUrl) return;
        lastFetchedUrl = url;

        urlCheck.style.display = '';
        urlCheck.className = 'check-line check-loading';
        urlCheck.textContent = '正在取得影片資訊…';

        var requestedUrl = url;
        fetch('/vod/api/video-info?url=' + encoded)
          .then(function(r) { return r.json(); })
          .then(function(info) {
            // The field changed while this lookup was in flight (edited or re-submitted): drop the stale answer.
            if (requestedUrl !== urlInput.value.trim()) return;
            if (info.title && !titleInput.value) {
              titleInput.value = info.title;
            }
            if (info.date && !dateInput.value) {
              dateInput.value = info.date;
            }
            if (info.thumbnail) {
              thumbnailUrl = info.thumbnail;
            }
            showVideoPreview(info);
          })
          .catch(function() {});
      });

      // Collect songs from textarea
      function collectSongs() {
        var parsed = parseTextToSongs(songsTextarea.value);
        return parsed.map(function(s) {
          // Format as H:MM:SS for backend parseTimestamp()
          var fmtStart = secondsToHMS(s.startSeconds);
          var fmtEnd = s.endSeconds !== null ? secondsToHMS(s.endSeconds) : null;
          return {
            song_title: s.songName,
            original_artist: s.artist,
            start_timestamp: fmtStart,
            end_timestamp: fmtEnd,
          };
        });
      }

      function secondsToHMS(sec) {
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      }

      // Form submission
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
        submitLabel.textContent = '提交中…';
        resultDiv.style.display = 'none';
        resultDiv.className = '';

        var turnstileInput = form.querySelector('[name="cf-turnstile-response"]');
        var token = turnstileInput ? turnstileInput.value : '';

        var body = {
          streamer_slug: streamerSelect.value,
          video_url: urlInput.value.trim(),
          stream_title: titleInput.value.trim(),
          stream_date: dateInput.value,
          submitter_note: form.querySelector('[name="submitter_note"]').value.trim(),
          songs: songs,
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

          if (res.ok) {
            resultDiv.className = 'result-msg result-success';
            resultDiv.textContent = '提交成功！ID: ' + data.id + '。感謝你的幫助！';
            form.reset();
            songsTextarea.value = '';
            songsPreview.textContent = '';
            thumbnailUrl = '';
            hideVideoPreview();
            if (window.turnstile) turnstile.reset();
          } else if (res.status === 409) {
            if (data.inAdmin && (data.adminStatus === 'pending' || data.adminStatus === 'extracted')) {
              // Keep pipeline-only conflicts silent until they can be distinguished from submissions.
              resultDiv.style.display = 'none';
              resultDiv.textContent = '';
            } else {
              resultDiv.className = 'result-msg result-warning';
              resultDiv.textContent = data.inAdmin
                ? '此 VOD 已收錄於歌單中，無需再提交'
                : '此 VOD 已通過審核，無需重複提交';
            }
          } else {
            resultDiv.className = 'result-msg result-error';
            resultDiv.textContent = data.error || '提交失敗，請稍後再試';
          }
        } catch(err) {
          resultDiv.className = 'result-msg result-error';
          resultDiv.textContent = '網路錯誤，請檢查連線後再試';
        } finally {
          resultDiv.style.display = resultDiv.textContent ? '' : 'none';
          submitBtn.disabled = false;
          submitLabel.textContent = '提交 VOD';
        }
      });
    })();
`;

export function renderVodPage(siteKey: string, streamers: ApprovedStreamer[], nonce: string) {
  const streamerOptions: string[] = [];
  for (const streamer of streamers) {
    if (validateSlug(streamer.slug)) {
      streamerOptions.push(
        `<option value="${escapeHtml(streamer.slug)}">${escapeHtml(streamer.display_name)}</option>`,
      );
    }
  }
  const streamerSelectOptions = streamerOptions.join('')
    || '<option value="" disabled>暫無可選 VTuber（請聯繫管理員）</option>';

  const hero = String(html`      <div class="prism-hero">
        <div class="prism-hero-tile">${raw(svgIcon('nova', 30))}</div>
        <div class="prism-hero-stack">
          <div class="prism-badge">${raw(SPARKLE_SVG)}提交歌回 VOD</div>
          <h1 class="prism-title">Prism Nova</h1>
          <p class="prism-desc">提交歌回 VOD，幫助我們建立歌曲時間戳</p>
        </div>
        <div class="prism-hero-actions">${raw(themeToggleHTML(nonce))}</div>
      </div>`);

  const body = String(html`      <form id="vod-form" class="form-stack vod-form">
        <div class="vod-top">
          <div class="vod-col-a form-stack">
            <div class="form-section"><span class="section-label">影片</span></div>

            <!-- Streamer Select -->
            <div>
              <label class="form-label" for="f-streamer_slug">
                VTuber <span class="required">*</span>
              </label>
              <div class="input-icon">${raw(svgIcon('users', 16))}<select id="f-streamer_slug" name="streamer_slug" required class="form-select">
                <option value="">選擇 VTuber…</option>
                ${raw(streamerSelectOptions)}
              </select></div>
            </div>

            <!-- YouTube VOD URL -->
            <div>
              <label class="form-label" for="f-video_url">
                YouTube VOD 網址 <span class="required">*</span>
              </label>
              <div class="input-icon">${raw(svgIcon('youtube', 16, 'color:#FF0000;'))}<input id="f-video_url" type="url" name="video_url" required
                placeholder="https://www.youtube.com/watch?v=..."
                class="form-input" maxlength="${VOD_FIELD_LIMITS.video_url}" /></div>
              <div id="url-check" class="check-line" style="display: none;"></div>
            </div>
          </div>

          <!-- Fetched video card (hidden until /vod/api/video-info answers) -->
          <aside id="video-preview" class="video-preview" aria-label="已帶入影片" style="display: none;">
            <div class="video-sticky">
              <div class="section-label">已帶入影片</div>
              <div class="glass-box video-card">
                <img id="video-preview-thumb" class="video-thumb" alt="" style="display: none;" />
                <div class="video-text">
                  <div id="video-preview-title" class="video-title"></div>
                  <div class="cell-meta">${raw(svgIcon('calendar', 12))}<span id="video-preview-date" class="mono"></span></div>
                </div>
              </div>
              <p class="form-hint" style="margin-top: 0;">標題與日期已自動帶入左側欄位，可以直接修改。</p>
            </div>
          </aside>

          <div class="vod-col-b form-stack">
            <!-- Stream Title (auto-filled) -->
            <div>
              <label class="form-label" for="f-stream_title">直播標題</label>
              <div class="input-icon">${raw(svgIcon('note', 16))}<input id="f-stream_title" type="text" name="stream_title"
                placeholder="會自動填入（可修改）"
                class="form-input" maxlength="${VOD_FIELD_LIMITS.stream_title}" /></div>
            </div>

            <div class="form-grid-2">
              <!-- Stream Date (auto-filled) -->
              <div>
                <label class="form-label" for="f-stream_date">直播日期</label>
                <div class="input-icon">${raw(svgIcon('calendar', 16))}<input id="f-stream_date" type="date" name="stream_date" class="form-input" /></div>
              </div>

              <!-- Submitter Note -->
              <div>
                <label class="form-label" for="f-submitter_note">備註</label>
                <div class="input-icon">${raw(svgIcon('pencilLine', 16))}<input id="f-submitter_note" type="text" name="submitter_note"
                  placeholder="任何補充說明（選填）"
                  class="form-input" maxlength="${VOD_FIELD_LIMITS.submitter_note}" /></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Song Timestamps Section -->
        <div class="form-section"><span class="section-label">歌曲時間戳</span></div>
        <div>
          <label class="form-label" for="songs-textarea">貼上時間戳 <span class="required">*</span></label>
          <p class="form-hint" style="margin: -2px 0 8px;">
            貼上
            <a href="https://aurora.oshi.tw" target="_blank" rel="noopener noreferrer">Aurora</a>
            匯出的時間戳格式，或手動輸入；每行一首：<code>序號. 開始 ~ 結束 歌名 / 原唱</code>
          </p>
          <div class="songs-grid">
            <textarea id="songs-textarea" class="form-textarea mono songs-textarea" rows="12" placeholder="01. 0:00:30 ~ 0:05:30 歌名 / 原唱&#10;02. 0:05:30 ~ 0:10:00 另一首歌 / 歌手"></textarea>
            <div id="songs-preview" class="glass-box songs-preview" aria-live="polite"></div>
          </div>
        </div>

        <!-- Turnstile + Submit -->
        <div class="form-footer">
          <div class="cf-turnstile" data-sitekey="${siteKey}" data-theme="auto"></div>
          <button type="submit" id="submit-btn" class="btn-primary"><span id="submit-label">提交 VOD</span>${raw(svgIcon('arrowRight', 16))}</button>
        </div>

        <!-- Result message -->
        <div id="result" style="display: none; text-align: center; font-size: 13px; padding: 12px 16px; border-radius: var(--radius-lg);"></div>
      </form>`);

  const footer = String(html`    <!-- Cross-links -->
    <div class="footer-links">
      <a class="link-pill" href="/">${raw(svgIcon('plus', 14))}推薦新的 VTuber</a>
      <a class="link-pill" href="/status">${raw(svgIcon('list', 14))}提交狀態</a>
      <a class="link-pill" href="https://aurora.oshi.tw" target="_blank" rel="noopener noreferrer">${raw(svgIcon('pencil', 14))}使用完整時間戳編輯器</a>
      <a class="link-pill" href="https://prism.oshi.tw" target="_blank" rel="noopener noreferrer">${raw(svgIcon('external', 14))}前往 Prism 歌單</a>
    </div>
    <p class="footer-tagline">Prism &mdash; 為你喜愛的 VTuber 打造歌單頁面</p>`);

  return raw(pageShell({
    title: 'Prism Nova — VOD 提交',
    turnstileLoader: true,
    darkCss: DARK_MODE_CSS,
    pageCss: PAGE_CSS,
    hero,
    body,
    footer,
    script: VOD_SCRIPT,
    nonce,
  }));
}
