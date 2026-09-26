import * as V from './vision.js';
import * as A from './analysis.js';
import * as DB from './store.js';
import { TEACHER_HASH } from './config.js';
import * as L from './library.js';
import { $, h, toast, sleep, fitCanvas, containMap, drawPose, drawHand, lineChart, segmented, field, groupField, pickFile, fmtScore, cssVar } from './ui.js';

// ───────── 設定 ─────────
const SPORTS = ['羽球', '網球', '桌球', '匹克球', '其他'];
const VIEWS = [['side', '側面'], ['front', '正面'], ['back', '背面']];
const VIEW_TEXT = { side: '側面（鏡頭在持拍手那一側）', front: '正面（面對鏡頭）', back: '背面（背對鏡頭）' };
const HANDS = [['R', '右手'], ['L', '左手']];
const HAND_TEXT = { R: '右手持拍', L: '左手持拍' };
const S = Object.assign({ quality: 'full', fps: 30, hand: 'R', facing: 'user', recSec: 6 }, safeJSON(localStorage.getItem('swing-coach-settings')));
function safeJSON(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }
const APP_VERSION = 'v7（2026-09-26）';
function getRole() { try { return localStorage.getItem('swing-coach-role'); } catch { return null; } }
function isTeacher() { return getRole() === 'teacher'; }
function setRole(role) {
  try { localStorage.setItem('swing-coach-role', role); } catch { /* 無痕模式 */ }
  updateRoleBadge();
}
function setTeacher(on) { setRole(on ? 'teacher' : 'student'); }
function updateRoleBadge() {
  const b = document.getElementById('roleBadge');
  if (!b) return;
  const role = getRole();
  b.hidden = !role;
  b.textContent = role === 'teacher' ? '老師' : '學生';
  b.classList.toggle('student', role !== 'teacher');
}
async function hashPw(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('swing-coach:' + pw));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function requireTeacher() {
  if (isTeacher()) return true;
  toast('新增或刪除示範影片需要老師身分');
  teacherLogin();
  return false;
}
function saveSettings() { try { localStorage.setItem('swing-coach-settings', JSON.stringify(S)); } catch { /* 無痕模式 */ } }

const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  go: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6.5" width="13" height="11" rx="2"/><path d="M15.5 10.5l6-3.5v10l-6-3.5"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
  flip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14-5.3L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15"/><path d="M4 20v-5h5"/></svg>',
};
const svg = (name) => { const s = h('span', { html: ICON[name], style: { display: 'inline-flex' } }); return s; };

// ───────── 畫面切換 ─────────
const main = $('#main');
let cleanups = [];
function onLeave(fn) { cleanups.push(fn); }
function leave() { const c = cleanups; cleanups = []; c.forEach((f) => { try { f(); } catch (e) { console.warn(e); } }); }
function show(...nodes) {
  leave();
  main.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
  window.scrollTo(0, 0);
}
function setTab(tab) {
  document.querySelectorAll('.tabbar a').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'));
  if (location.hash.slice(1) !== tab) history.replaceState(null, '', '#' + tab);
}
const TABS = { swing: swingHome, grip: gripHome, library: libraryHome, history: historyHome };
function route() {
  if (!getRole()) return welcome();
  const tab = location.hash.slice(1) in TABS ? location.hash.slice(1) : 'swing';
  setTab(tab);
  TABS[tab]();
}
window.addEventListener('hashchange', route);
document.querySelectorAll('.tabbar a').forEach((a) => a.addEventListener('click', (e) => {
  if (location.hash.slice(1) === a.dataset.tab) { e.preventDefault(); route(); }
}));

function welcome() {
  setTab('swing');
  show(
    head('歡迎使用我的羽球教練', '請先選擇你的身分。之後可以在右上角「設定」切換。'),
    h('div', { class: 'role-pick' },
      h('button', { class: 'role-card', type: 'button', onclick: () => { setRole('student'); toast('已設定為學生身分'); location.hash = 'swing'; route(); } },
        h('strong', {}, '我是學生'),
        h('span', {}, '選老師的示範影片，錄下自己的揮拍和握拍來比對。')),
      h('button', { class: 'role-card', type: 'button', onclick: () => teacherLogin() },
        h('strong', {}, '我是老師'),
        h('span', {}, '需要老師密碼。可以新增、刪除和發布示範影片。'))),
  );
}

function head(title, sub, back) {
  return h('div', { class: 'screen-head' },
    back ? h('button', { class: 'back', type: 'button', onclick: back }, svg('back'), '返回') : null,
    h('h1', {}, title),
    sub ? h('p', { class: 'lede' }, sub) : null);
}
function btn(text, onclick, cls = '', icon = null) {
  return h('button', { class: 'btn ' + cls, type: 'button', onclick }, icon ? svg(icon) : null, text);
}
function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('h3', {}, title), h('p', {}, text), action ? btn(action[0], action[1]) : null);
}
function chipsFor(t) {
  return h('div', { class: 'chips' },
    h('span', { class: 'chip ' + t.type }, t.type === 'swing' ? '揮拍' : '握拍'),
    h('span', { class: 'chip' }, t.sport),
    h('span', { class: 'chip' }, HAND_TEXT[t.hand]),
    t.view ? h('span', { class: 'chip' }, VIEWS.find((v) => v[0] === t.view)?.[1] || '') : null);
}
function tplRow(t, onclick, extra) {
  const thumb = t.poster ? h('img', { class: 'tpl-thumb', src: t.poster, alt: '' }) : h('div', { class: 'tpl-thumb' });
  const body = [thumb, h('div', {}, h('div', { class: 'tpl-name' }, t.name), chipsFor(t))];
  if (onclick) return h('button', { class: 'tpl-row', type: 'button', onclick }, body, h('span', { class: 'tpl-go', html: ICON.go }));
  return h('div', { class: 'tpl-row', style: { cursor: 'default' } }, body, extra || h('span'));
}
// 示範清單：以共享示範影片庫為準，這台裝置只存下載過的暫存
let libraryOffline = false;
async function templates(type) {
  const local = await DB.all('templates').catch(() => []);
  let index = null;
  try { index = await L.fetchIndex(); libraryOffline = false; } catch (e) { console.warn('讀取示範影片庫失敗', e); libraryOffline = true; }
  let list;
  if (index) {
    const byId = new Map(index.templates.map((e) => [e.id, e]));
    for (const t of local) {
      if (t.remote && (!byId.has(t.id) || byId.get(t.id).rev !== t.rev)) await DB.del('templates', t.id).catch(() => {});
    }
    list = index.templates.map((e) => ({ ...e, _state: 'remote' }));
    if (isTeacher()) local.filter((t) => !t.remote && !byId.has(t.id)).forEach((t) => list.push({ ...t, _state: 'local' }));
  } else {
    list = local.filter((t) => t.remote || isTeacher()).map((t) => ({ ...t, _state: t.remote ? 'remote' : 'local' }));
  }
  return list.filter((t) => !type || t.type === type).sort((a, b) => b.createdAt - a.createdAt);
}
function offlineNote() {
  return libraryOffline ? h('div', { class: 'note-box warn', style: { marginBottom: '14px' } }, '目前連不上示範影片庫，顯示的是這台裝置之前下載過的示範。') : null;
}
async function openEntry(entry, next, back) {
  const cached = await DB.get('templates', entry.id).catch(() => null);
  if (cached && (cached.frames || cached.grip) && (entry._state === 'local' || !entry.rev || cached.rev === entry.rev)) return next(cached);
  const txt = h('p', { class: 'progress-text' }, '下載示範中…');
  show(head(entry.name, null, back), h('div', { class: 'progress' }, h('div', { class: 'indeterminate' })), txt);
  let cancelled = false;
  onLeave(() => { cancelled = true; });
  try {
    const full = await L.fetchTemplate(entry, (m) => { txt.textContent = m; });
    await DB.put('templates', full).catch(console.warn);
    if (!cancelled) next(full);
  } catch (e) {
    console.error(e);
    if (!cancelled) errorScreen('無法下載示範', `請確認網路連線後再試一次。（${e.message}）`, back);
  }
}
function errorScreen(title, msg, back) {
  show(head(title, null, back), h('div', { class: 'note-box warn' }, msg));
}

// ───────── 揮拍：學生端 ─────────
async function swingHome() {
  const list = await templates('swing');
  show(
    head('揮拍比對', '選一段老師的示範，再錄下你自己的揮拍，系統會比對關節角度、揮拍軌跡和速度。'),
    offlineNote(),
    list.length
      ? h('div', { class: 'tpl-list' }, list.map((t) => tplRow(t, () => openEntry(t, swingPrep, swingHome))))
      : isTeacher()
        ? emptyState('還沒有揮拍示範', '到「示範影片庫」錄一段標準揮拍並發布，學生就能開始比對。', ['新增揮拍示範', () => { setTab('library'); newSwingTemplate(); }])
        : emptyState('老師還沒有上傳揮拍示範', '老師發布示範後，大約 1 分鐘內就會出現在這裡。', ['重新整理', swingHome]),
  );
}

function swingPrep(tpl) {
  const url = tpl.video ? URL.createObjectURL(tpl.video) : null;
  const media = url
    ? h('video', { class: 'stage-media', src: url, muted: true, playsInline: true, loop: true, autoplay: true })
    : h('img', { class: 'stage-img', src: tpl.poster || '', alt: '示範畫面' });
  onLeaveLater(() => url && URL.revokeObjectURL(url));
  show(
    head(tpl.name, null, swingHome),
    h('div', { class: 'stage' }, media, h('div', { class: 'stage-tag' }, '示範')),
    h('ul', { class: 'guide' },
      h('li', {}, `用和示範相同的角度拍攝：${VIEW_TEXT[tpl.view] || '同示範'}。`),
      h('li', {}, '全身都要入鏡，手機固定不動，距離大約 3 到 4 公尺。'),
      h('li', {}, '每段影片只做一次揮拍，前後各保持靜止約半秒。')),
    groupField('你的持拍手', segmented(HANDS, S.hand, (v) => { S.hand = v; saveSettings(); }, '你的持拍手')),
    h('div', { class: 'btn-row' },
      btn('用鏡頭錄影', () => captureSwing({ title: '錄下你的揮拍', back: () => swingPrep(tpl), onBlob: (b) => studentAnalyze(tpl, b) }), '', 'camera'),
      btn('上傳影片', async () => { const f = await pickFile('video/*'); if (f) studentAnalyze(tpl, f); }, 'secondary', 'upload')),
  );
}
// show() 會先執行清理，所以在畫面建立之後才登記的清理要延後
function onLeaveLater(fn) { queueMicrotask(() => onLeave(fn)); }

function studentAnalyze(tpl, blob) {
  trimAnalyze(blob, {
    title: '選取你的揮拍片段',
    back: () => swingPrep(tpl),
    onFrames: (d) => swingResult(tpl, { frames: d.frames, ar: d.ar, blob, hand: S.hand }),
  });
}

// ───────── 相機錄影 ─────────
async function captureSwing({ title, back, onBlob }) {
  const video = h('video', { class: 'stage-media', muted: true, playsInline: true });
  const canvas = h('canvas', { class: 'stage-overlay' });
  const hint = h('div', { class: 'stage-hint' }, '正在開啟鏡頭…');
  const count = h('div', { class: 'stage-count', hidden: true });
  const timeEl = h('div', { class: 'rec-time', hidden: true });
  const stage = h('div', { class: 'stage tall' }, video, canvas, hint, count, timeEl);
  const recBtn = h('button', { class: 'rec-btn', type: 'button', 'aria-label': '開始錄影', disabled: true }, h('span'));
  const flipBtn = btn('切換鏡頭', () => { S.facing = S.facing === 'user' ? 'environment' : 'user'; saveSettings(); start(); }, 'quiet', 'flip');
  show(
    head(title, '按下紅色按鈕後會倒數 3 秒再開始錄影。', back),
    stage,
    h('div', { class: 'controls center' }, recBtn),
    h('div', { class: 'controls center' },
      segmented([[4, '4 秒'], [6, '6 秒'], [10, '10 秒']], S.recSec, (v) => { S.recSec = v; saveSettings(); }, '錄影長度'),
      flipBtn),
  );
  let stream = null, pose = null, running = true, recorder = null, recording = false, wantResult = false, stopTimer = null, tick = null, busy = false;
  onLeave(() => {
    running = false; wantResult = false; clearTimeout(stopTimer); clearInterval(tick);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    V.stopStream(stream);
  });

  async function start() {
    V.stopStream(stream);
    hint.textContent = '正在開啟鏡頭…';
    try { stream = await V.openCamera(video, S.facing); } catch (e) { hint.textContent = '無法開啟鏡頭'; showCamError(e); return; }
    if (!running) { V.stopStream(stream); return; }
    stage.classList.toggle('mirror', S.facing === 'user');
    recBtn.disabled = false;
    if (!pose) {
      hint.textContent = '載入姿勢模型…（第一次需要較久）';
      try { pose = await V.getPose(S.quality); } catch (e) { console.error(e); hint.textContent = '姿勢模型載入失敗，仍可錄影'; }
    }
  }
  function showCamError(e) {
    stage.after(h('div', { class: 'note-box warn' }, V.cameraErrorText(e)));
  }
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    if (!pose || video.readyState < 2 || busy) return;
    busy = true;
    try {
      const r = V.detectPose(pose, video);
      const { ctx, W, H, dpr } = fitCanvas(canvas);
      ctx.clearRect(0, 0, W, H);
      const map = containMap(video.videoWidth, video.videoHeight, W, H);
      if (r) drawPose(ctx, r.i, map, { accent: cssVar('--teacher'), hand: S.hand, lw: 3 * dpr });
      if (!recording) setHint(framingHint(r));
    } catch (e) { console.warn(e); }
    busy = false;
  }
  function setHint([text, ok]) { hint.textContent = text; hint.classList.toggle('ok', !!ok); }
  function framingHint(r) {
    if (!r) return ['找不到人，請站到畫面中間', false];
    const v = (k) => r.i[3 * k + 2], y = (k) => r.i[3 * k + 1];
    if (v(27) < 0.5 && v(28) < 0.5) return ['請退後一點，讓雙腳入鏡', false];
    if (y(0) < 0.04) return ['頭部超出畫面，請退後一點', false];
    return ['全身入鏡，可以開始錄影', true];
  }

  recBtn.addEventListener('click', async () => {
    if (recording) return stopRec();
    recBtn.disabled = true;
    count.hidden = false;
    for (let n = 3; n > 0; n--) { count.textContent = n; await sleep(800); if (!running) return; }
    count.hidden = true;
    recBtn.disabled = false;
    startRec();
  });
  function startRec() {
    const mime = V.pickMime();
    if (mime === null) { toast('這個瀏覽器不支援錄影，請改用「上傳影片」。'); return; }
    try { recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined); }
    catch { try { recorder = new MediaRecorder(stream); } catch { toast('這個瀏覽器不支援錄影，請改用「上傳影片」。'); return; } }
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      if (!wantResult) return;
      const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'video/webm' });
      onBlob(blob);
    };
    recorder.start(250);
    recording = true; wantResult = false;
    recBtn.classList.add('on'); recBtn.setAttribute('aria-label', '停止錄影');
    stage.classList.add('recording');
    hint.textContent = '錄影中，做一次完整揮拍';
    hint.classList.remove('ok');
    const t0 = performance.now();
    timeEl.hidden = false;
    tick = setInterval(() => { timeEl.textContent = ((performance.now() - t0) / 1000).toFixed(1) + ' 秒'; }, 100);
    stopTimer = setTimeout(stopRec, S.recSec * 1000);
  }
  function stopRec() {
    if (!recording) return;
    recording = false; wantResult = true;
    clearTimeout(stopTimer); clearInterval(tick);
    stage.classList.remove('recording');
    recBtn.classList.remove('on');
    hint.textContent = '處理影片中…';
    recorder.stop();
  }
  await start();
  loop();
}

// ───────── 選取片段並擷取骨架 ─────────
async function trimAnalyze(blob, { title, back, onFrames }) {
  const url = URL.createObjectURL(blob);
  const video = h('video', { class: 'stage-media', src: url, muted: true, playsInline: true, preload: 'auto', controls: true });
  const canvas = h('canvas', { class: 'stage-overlay' });
  const stage = h('div', { class: 'stage' }, video, canvas);
  const body = h('div', {}, h('p', { class: 'progress-text' }, '讀取影片中…'));
  show(head(title, '拖動滑桿，只保留一次揮拍的前後片段（最長 15 秒）。', back), stage, body);
  let cancelled = false;
  onLeave(() => { cancelled = true; URL.revokeObjectURL(url); });
  let dur = 0;
  try { dur = await V.ensureReady(video); } catch (e) { console.warn(e); }
  if (cancelled) return;
  if (!(dur > 0) || !isFinite(dur)) {
    body.replaceChildren(h('div', { class: 'note-box warn' }, '無法讀取這段影片的長度。請換一段影片，或用手機內建相機錄影後再上傳。'));
    return;
  }
  let start = 0, end = Math.min(dur, 15);
  const outS = h('output', {}, '0.0'), outE = h('output', {}, end.toFixed(1));
  const rS = h('input', { type: 'range', min: 0, max: dur, step: 0.05, value: 0, 'aria-label': '開始時間' });
  const rE = h('input', { type: 'range', min: 0, max: dur, step: 0.05, value: end, 'aria-label': '結束時間' });
  const onRange = (which) => {
    start = +rS.value; end = +rE.value;
    if (which === 's' && end - start > 15) { end = start + 15; rE.value = end; }
    if (which === 'e' && end - start > 15) { start = end - 15; rS.value = start; }
    if (end - start < 0.5) { if (which === 's') { start = Math.max(0, end - 0.5); rS.value = start; } else { end = Math.min(dur, start + 0.5); rE.value = end; } }
    outS.textContent = start.toFixed(1); outE.textContent = end.toFixed(1);
    video.currentTime = which === 's' ? start : end;
  };
  rS.addEventListener('input', () => onRange('s'));
  rE.addEventListener('input', () => onRange('e'));
  const bar = h('div'), prog = h('div', { class: 'progress', hidden: true }, bar);
  const progText = h('p', { class: 'progress-text', hidden: true });
  const goBtn = btn('開始分析', run);
  body.replaceChildren(
    h('div', { class: 'trim' },
      h('div', { class: 'trim-row' }, h('span', {}, '開始'), rS, outS),
      h('div', { class: 'trim-row' }, h('span', {}, '結束'), rE, outE)),
    h('div', { class: 'btn-row one' }, goBtn), prog, progText,
  );

  async function run() {
    goBtn.disabled = true; rS.disabled = true; rE.disabled = true; video.controls = false; video.pause();
    body.querySelectorAll('.note-box').forEach((n) => n.remove());
    prog.hidden = false; progText.hidden = false;
    progText.textContent = '載入姿勢模型…（第一次需要下載約 10 MB）';
    let frames;
    try {
      await V.getPose(S.quality);
      progText.textContent = '擷取動作節點中…';
      frames = await V.extractPose(video, {
        start, end, fps: S.fps, quality: S.quality, isCancelled: () => cancelled,
        onFrame: (k, total, r) => {
          bar.style.width = (100 * k / total).toFixed(1) + '%';
          progText.textContent = `擷取動作節點中 ${Math.round(100 * k / total)}%`;
          const { ctx, W, H, dpr } = fitCanvas(canvas);
          ctx.clearRect(0, 0, W, H);
          if (r) drawPose(ctx, r.i, containMap(video.videoWidth, video.videoHeight, W, H), { accent: cssVar('--teacher'), lw: 3 * dpr });
        },
      });
    } catch (e) {
      if (cancelled) return;
      console.error(e);
      progText.textContent = '';
      body.append(h('div', { class: 'note-box warn' }, '姿勢模型無法載入。第一次使用需要網路連線，請確認連線後再按一次「開始分析」。'));
      goBtn.disabled = false; rS.disabled = false; rE.disabled = false; video.controls = true;
      return;
    }
    if (cancelled) return;
    const covered = frames.length / Math.max(1, Math.floor((end - start) * S.fps) + 1);
    if (frames.length < 10 || covered < 0.4) {
      progText.textContent = '';
      body.append(h('div', { class: 'note-box warn' }, '大部分畫面都找不到完整的人。請確認全身入鏡、光線充足，再錄一次。'));
      goBtn.disabled = false; rS.disabled = false; rE.disabled = false;
      return;
    }
    const ar = video.videoWidth / video.videoHeight || 16 / 9;
    const snapAt = async (t) => { await V.seek(video, t); return V.snapshot(video, 360, 0.72); };
    await onFrames({ frames, ar, snapAt });
  }
}

// ───────── 骨架重播元件 ─────────
function skeletonPlayer({ seqT, seqS, handT, handS, steps, label, onPos }) {
  const canvas = h('canvas', { class: 'stage-overlay' });
  const phase = h('div', { class: 'stage-hint' }, '');
  const stage = h('div', { class: 'stage tall' }, canvas, phase);
  const playBtn = h('button', { class: 'play-btn', type: 'button', 'aria-label': '播放', html: ICON.play });
  const slider = h('input', { type: 'range', min: 0, max: steps.length - 1, step: 1, value: 0, 'aria-label': '播放位置' });
  let pos = 0, playing = false, last = 0, speed = 0.5, alive = true;
  const draw = () => {
    const { ctx, W, H, dpr } = fitCanvas(canvas);
    ctx.clearRect(0, 0, W, H);
    const s = Math.min(H * 0.19, W * 0.34), cx = W / 2, cy = H * 0.56;
    const map = (x, y) => [cx + x * s, cy + y * s];
    const [i, j] = steps[Math.round(pos)];
    if (seqT) drawPose(ctx, seqT[i], map, { color: cssVar('--teacher'), lw: 4 * dpr, alpha: seqS ? 0.9 : 1 });
    if (seqS && j != null) drawPose(ctx, seqS[j], map, { color: cssVar('--student'), lw: 3.2 * dpr });
    phase.textContent = label(Math.round(pos));
    slider.value = Math.round(pos);
    if (onPos) onPos(Math.round(pos), playing);
  };
  const frame = (now) => {
    if (!alive) return;
    if (playing) {
      const dt = last ? (now - last) / 1000 : 0; last = now;
      pos += dt * 30 * speed;
      if (pos >= steps.length - 1) { pos = 0; }
      draw();
      requestAnimationFrame(frame);
    }
  };
  const setPlaying = (p) => {
    playing = p; last = 0;
    playBtn.innerHTML = p ? ICON.pause : ICON.play;
    playBtn.setAttribute('aria-label', p ? '暫停' : '播放');
    if (p) requestAnimationFrame(frame); else draw();
  };
  playBtn.addEventListener('click', () => setPlaying(!playing));
  slider.addEventListener('input', () => { pos = +slider.value; if (playing) setPlaying(false); else draw(); });
  const ro = new ResizeObserver(() => draw());
  ro.observe(canvas);
  onLeaveLater(() => { alive = false; ro.disconnect(); });
  const el = h('div', {}, stage,
    h('div', { class: 'player-bar' }, playBtn, slider),
    h('div', { class: 'controls' }, h('span', { class: 'field-hint' }, '播放速度'),
      segmented([[0.25, '0.25×'], [0.5, '0.5×'], [1, '1×']], 0.5, (v) => { speed = v; }, '播放速度')));
  return { el, draw, get pos() { return Math.round(pos); } };
}

function scoreboard(total, caption, parts) {
  return h('section', { class: 'scoreboard', 'aria-label': '評分' },
    h('div', { class: 'score-main' },
      h('div', { class: 'score-num' }, fmtScore(total)),
      h('div', { class: 'score-cap' }, h('strong', {}, caption), h('span', {}, '滿分 100'))),
    h('div', { class: 'subscores' }, parts.map((p) => h('div', {},
      h('div', { class: 'sub-name' }, p.label),
      h('div', { class: 'sub-val' }, fmtScore(p.score)),
      h('div', { class: 'sub-bar' }, h('div', { style: { width: fmtScore(p.score) + '%' } }))))));
}
function verdict(x) { return x >= 90 ? '非常接近示範' : x >= 75 ? '大致正確' : x >= 55 ? '有幾處需要調整' : '和示範差異較大'; }
function notesList(items, good) {
  if (!items.length) return h('p', { class: 'field-hint' }, good ? '這次沒有特別突出的項目，繼續練習。' : '沒有明顯需要調整的地方。');
  return h('ul', { class: 'notes' + (good ? ' good' : '') }, items.map((n) => h('li', {}, n.text, n.detail ? h('span', { class: 'detail' }, n.detail) : null)));
}

// ───────── 揮拍結果 ─────────
async function swingResult(tpl, stu) {
  let R;
  try {
    R = A.compareSwing({ frames: tpl.frames, hand: tpl.hand }, { frames: stu.frames, hand: stu.hand }, S.fps);
  } catch (e) {
    console.error(e);
    return errorScreen('無法比對', e.message || '比對時發生錯誤，請重新錄一次。', () => swingPrep(tpl));
  }
  const parts = [
    { label: '姿勢角度', score: R.angleScore },
    { label: '揮拍軌跡', score: R.trajScore },
    { label: '速度與節奏', score: R.speedScore },
  ];
  DB.put('history', {
    id: DB.uid(), type: 'swing', tplId: tpl.id, tplName: tpl.name, date: Date.now(),
    total: R.total, parts: parts.map((p) => ({ label: p.label, score: p.score })), tips: R.improve.slice(0, 3).map((n) => n.text),
  }).catch(console.warn);

  const nT = A.normalizePoseSeq(R.T.frames, tpl.ar, tpl.hand);
  const nS = A.normalizePoseSeq(R.S.frames, stu.ar, stu.hand);
  const path = R.path;
  const momentAt = {};
  for (const [k, { ti }] of Object.entries(R.moments)) momentAt[k] = path.findIndex((p) => p[0] === ti);
  const phaseLabel = (p) => {
    const i = path[p][0];
    if (i < R.ts.top) return '準備';
    if (i < R.ts.peak) return '引拍到前揮';
    if (i === R.ts.peak) return '擊球瞬間';
    return '隨揮收拍';
  };

  // 兩段影片並排（暫停或拖動時同步）
  const vids = [];
  const mkVid = (blob, frames, ar, hand, tag, color, which) => {
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    const v = h('video', { class: 'stage-media', src: url, muted: true, playsInline: true, preload: 'auto' });
    const c = h('canvas', { class: 'stage-overlay' });
    onLeaveLater(() => URL.revokeObjectURL(url));
    vids.push({ v, c, frames, color, hand, which, ready: V.ensureReady(v).catch(() => {}) });
    return h('div', { class: 'stage' }, v, c, h('div', { class: 'stage-tag' + (tag === '你' ? ' student' : '') }, tag));
  };
  const pairEl = h('div', { class: 'pair' },
    mkVid(tpl.video, R.T.frames, tpl.ar, tpl.hand, '示範', '--teacher', 0),
    mkVid(stu.blob, R.S.frames, stu.ar, stu.hand, '你', '--student', 1));
  let syncing = false, pendingSync = null;
  const syncVideos = async (p) => {
    pendingSync = p;
    if (syncing) return;
    syncing = true;
    while (pendingSync != null) {
      const q = pendingSync; pendingSync = null;
      const [i, j] = path[q];
      await Promise.all(vids.map(async (o) => {
        await o.ready;
        const f = o.frames[o.which === 0 ? i : j];
        if (!f) return;
        await V.seek(o.v, f.t);
        const { ctx, W, H, dpr } = fitCanvas(o.c);
        ctx.clearRect(0, 0, W, H);
        drawPose(ctx, f.i, containMap(o.v.videoWidth, o.v.videoHeight, W, H), { color: cssVar(o.color), lw: 2.5 * dpr, hand: o.hand, head: false });
      }));
    }
    syncing = false;
  };

  // 角度曲線
  const featSel = h('select', { 'aria-label': '選擇要看的角度' }, A.SWING_FEATURES.map((F) => h('option', { value: F.key }, F.label)));
  const chart = h('canvas', {});
  let cursor = 0;
  const drawChart = () => {
    const key = featSel.value;
    const off = key === 'turn' ? R.turnOffset : 0;
    lineChart(chart, {
      series: [
        { data: path.map(([i]) => R.T.feats[key][i]), color: cssVar('--teacher') },
        { data: path.map(([, j]) => R.S.feats[key][j] + off), color: cssVar('--student') },
      ],
      markers: Object.entries(A.MOMENTS).filter(([k]) => momentAt[k] >= 0).map(([k, l]) => ({ x: momentAt[k], label: l })),
      cursor,
    });
  };
  featSel.addEventListener('change', drawChart);

  const player = skeletonPlayer({
    seqT: nT, seqS: nS, handT: tpl.hand, handS: stu.hand, steps: path, label: phaseLabel,
    onPos: (p, playing) => { cursor = p; drawChart(); if (!playing) syncVideos(p); },
  });

  const legend = h('div', { class: 'legend' },
    h('span', {}, h('i', { style: { background: cssVar('--teacher') } }), '示範'),
    h('span', {}, h('i', { style: { background: cssVar('--student') } }), '你'));

  const table = h('div', { class: 'table-wrap' }, h('table', { class: 'detail-table' },
    h('thead', {}, h('tr', {}, h('th', {}, '部位'), h('th', { class: 'num' }, '平均差異'), h('th', { class: 'num' }, '分數'))),
    h('tbody', {}, R.features.map((f) => h('tr', {}, h('td', {}, f.label), h('td', { class: 'num' }, Math.round(f.diff) + '°'), h('td', { class: 'num' }, fmtScore(f.score)))),
      h('tr', {}, h('td', {}, '最快揮拍速度（和示範比）'), h('td', { class: 'num' }, Math.round(R.parts.speedRatio * 100) + '%'), h('td', { class: 'num' }, fmtScore(R.parts.speedPart))),
      h('tr', {}, h('td', {}, '引拍與隨揮時間比例'), h('td', { class: 'num' }, Math.round(R.parts.tempoRatio * 100) + '%'), h('td', { class: 'num' }, fmtScore(R.parts.tempoPart))))));

  show(
    head('揮拍比對結果', tpl.name, () => swingPrep(tpl)),
    scoreboard(R.total, verdict(R.total), parts),
    h('h2', {}, '需要調整的地方'), notesList(R.improve, false),
    h('h2', {}, '做得好的地方'), notesList(R.good, true),
    h('h2', {}, '骨架疊圖'),
    h('p', { class: 'field-hint' }, '兩個人的骨架已經對齊身體位置和動作時間，看得出哪一段不一樣。'),
    legend, player.el,
    vids.length ? [h('h2', {}, '影片對照'), h('p', { class: 'field-hint' }, '暫停或拖動上方播放位置時，兩段影片會跳到對應的瞬間。'), pairEl] : null,
    h('h2', {}, '角度變化'),
    h('div', { class: 'chart-box' }, featSel, legend.cloneNode(true), chart),
    h('h2', {}, '各項細節'), table,
    h('div', { class: 'btn-row' }, btn('再錄一次', () => swingPrep(tpl)), btn('換一段示範', swingHome, 'secondary')),
  );
  requestAnimationFrame(() => { player.draw(); drawChart(); });
  const ro = new ResizeObserver(() => drawChart());
  ro.observe(chart);
  onLeave(() => ro.disconnect());
}

// ───────── 握拍：學生端 ─────────
async function gripHome() {
  const list = await templates('grip');
  show(
    head('握拍比對', '跟著引導，從兩個角度拍下握拍的手，並標出握把頭的位置。系統會比對手指彎曲、拇指位置和握把方向。手腕轉動提供老師的示範影片觀看。'),
    offlineNote(),
    list.length
      ? h('div', { class: 'tpl-list' }, list.map((t) => tplRow(t, () => openEntry(t, gripPrep, gripHome))))
      : isTeacher()
        ? emptyState('還沒有握拍示範', '到「示範影片庫」錄一個標準握拍並發布，學生就能開始比對。', ['新增握拍示範', () => { setTab('library'); newGripTemplate(); }])
        : emptyState('老師還沒有上傳握拍示範', '老師發布示範後，大約 1 分鐘內就會出現在這裡。', ['重新整理', gripHome]),
  );
}

function demoVideoBlock(tpl) {
  if (!tpl.demoVideo) return null;
  const url = URL.createObjectURL(tpl.demoVideo);
  onLeaveLater(() => URL.revokeObjectURL(url));
  return [
    h('h2', {}, '手腕轉動示範'),
    h('p', { class: 'field-hint' }, '這段是老師的示範影片，僅供觀看，不列入比對。'),
    h('div', { class: 'stage tall' }, h('video', { class: 'stage-media', src: url, muted: true, playsInline: true, loop: true, controls: true }), h('div', { class: 'stage-tag' }, '示範')),
  ];
}

function gripPrep(tpl) {
  const g = tpl.grip;
  show(
    head(tpl.name, null, gripHome),
    g.views.back?.snap ? h('div', { class: 'stage' }, h('img', { class: 'stage-img', src: g.views.back.snap, alt: '示範握拍' }), h('div', { class: 'stage-tag' }, '示範')) : null,
    h('ul', { class: 'guide' },
      h('li', {}, '手機固定在和手差不多高的位置，手距離鏡頭約 40 到 60 公分。'),
      h('li', {}, '光線要充足，背景越單純越好。'),
      h('li', {}, '每個角度會顯示老師的示範照片，照著擺好後保持不動，系統會自動拍下。'),
      h('li', {}, '拍下後在照片上點出握把頭（握把尾端）和握把上端，比對握把的方向和握的位置。')),
    demoVideoBlock(tpl),
    groupField('你的持拍手', segmented(HANDS, S.hand, (v) => { S.hand = v; saveSettings(); }, '你的持拍手')),
    h('div', { class: 'btn-row one' }, btn('開始握拍比對', () => gripCapture({
      title: '握拍比對', tpl, hand: S.hand, role: 'student', back: () => gripPrep(tpl),
      onDone: (data) => gripResult(tpl, data),
    }), '', 'camera')),
  );
}

const GRIP_STEPS_ALL = [
  { key: 'back', short: '手背', title: '角度一：手背朝向鏡頭', text: '握好球拍，拍頭朝上，手背正對鏡頭，手放在畫面中央。保持不動，系統會自動拍下。' },
  { key: 'thumb', short: '拇指側', title: '角度二：拇指側朝向鏡頭', text: '維持同樣的握法，把手轉 90 度，讓拇指那一側朝向鏡頭，拍頭仍然朝上。' },
  { key: 'rotate', short: '手腕轉動', title: '錄製手腕轉動示範', text: '手臂往前伸、手肘不動，只轉動前臂：拍面向一側轉到底，再轉向另一側，來回兩次。按下開始後倒數 3 秒，錄 5 秒。這段影片只提供學生觀看，不列入比對。' },
];

function holdRing() {
  const C = 2 * Math.PI * 22;
  const el = h('div', { class: 'hold-ring', hidden: true, html: `<svg viewBox="0 0 54 54" aria-hidden="true"><circle class="bg" cx="27" cy="27" r="22"/><circle class="fg" cx="27" cy="27" r="22" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>` });
  const fg = el.querySelector('.fg');
  return { el, set: (p) => { fg.style.strokeDashoffset = String(C * (1 - Math.max(0, Math.min(1, p)))); } };
}

async function gripCapture({ title, tpl, hand, role, back, onDone }) {
  const data = { hand, views: {}, rotationVideo: null };
  const ref = tpl && tpl.grip;
  const GRIP_STEPS = role === 'teacher' ? GRIP_STEPS_ALL : GRIP_STEPS_ALL.filter((s) => s.key !== 'rotate');
  let si = 0;
  const stepsBar = h('div', { class: 'steps' }, GRIP_STEPS.map((s) => h('span', {}, s.short)));
  const stepBox = h('div', { class: 'step-box' });
  const video = h('video', { class: 'stage-media', muted: true, playsInline: true });
  const img = h('img', { class: 'stage-img', alt: '拍下的畫面', hidden: true });
  const canvas = h('canvas', { class: 'stage-overlay' });
  const hint = h('div', { class: 'stage-hint' }, '正在開啟鏡頭…');
  const ring = holdRing();
  const count = h('div', { class: 'stage-count', hidden: true });
  const stage = h('div', { class: 'stage tall' }, video, img, canvas, hint, ring.el, count);
  const controls = h('div', { class: 'controls' });
  const flipBtn = btn('切換鏡頭', () => { S.facing = S.facing === 'user' ? 'environment' : 'user'; saveSettings(); openCam(); }, 'quiet', 'flip');
  show(head(title, null, back), stepsBar, stepBox, stage, controls, h('div', { class: 'controls' }, flipBtn));

  let stream = null, lm = null, running = true, mode = 'idle', prev = null, stableSince = 0, buf = [], last = null;
  let rotStart = 0, marks = [], markView = null, busy = false, confirmBtn = null;
  onLeave(() => { running = false; V.stopStream(stream); });
  stage.addEventListener('click', (e) => onMarkTap(e));

  const setHint = (t, ok) => { hint.textContent = t; hint.classList.toggle('ok', !!ok); };
  async function openCam() {
    V.stopStream(stream);
    try { stream = await V.openCamera(video, S.facing); } catch (e) { setHint('無法開啟鏡頭'); stage.after(h('div', { class: 'note-box warn' }, V.cameraErrorText(e))); return; }
    if (!running) return V.stopStream(stream);
    if (mode !== 'mark') stage.classList.toggle('mirror', S.facing === 'user');
  }
  await openCam();
  setHint('載入手部模型…');
  try { lm = await V.getHand(); } catch (e) { console.error(e); setHint('手部模型載入失敗'); stage.after(h('div', { class: 'note-box warn' }, '手部模型無法載入。第一次使用需要網路連線，請確認連線後重新進入。')); return; }
  if (!running) return;
  renderStep();
  requestAnimationFrame(loop);

  function renderStep() {
    while (si < GRIP_STEPS.length && role === 'student' && ref && !ref.views[GRIP_STEPS[si].key]) si++;
    if (si >= GRIP_STEPS.length) return finish();
    [...stepsBar.children].forEach((el, k) => { el.setAttribute('aria-current', k === si ? 'step' : 'false'); el.classList.toggle('done', k < si); });
    const st = GRIP_STEPS[si];
    const refSnap = ref && ref.views[st.key] && ref.views[st.key].snap;
    stepBox.replaceChildren(
      h('div', {}, h('h2', {}, st.title), h('p', {}, st.text)),
      refSnap ? h('figure', { style: { margin: 0 } }, h('img', { class: 'step-ref', src: refSnap, alt: '老師的示範角度' }), h('figcaption', { class: 'step-ref-cap' }, '示範')) : null,
    );
    prev = null; stableSince = 0; buf = [];
    if (st.key === 'rotate') {
      mode = 'rotate-wait';
      ring.el.hidden = true;
      setHint('按「開始錄製」後轉動前臂');
      controls.replaceChildren(btn('開始錄製', startRotate), btn('略過這一步', () => { si++; renderStep(); }, 'quiet'));
    } else {
      mode = 'still';
      ring.el.hidden = false; ring.set(0);
      controls.replaceChildren(
        btn('立即拍下', () => { if (!last) return toast('畫面中還找不到手'); if (!buf.length) buf = [last]; captureStill(); }, 'secondary'),
        btn('略過這個角度', () => { si++; renderStep(); }, 'quiet'));
    }
  }

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    if (!lm || video.readyState < 2 || mode === 'mark' || mode === 'idle' || busy) return;
    busy = true;
    let r = null;
    try { r = V.detectHand(lm, video); } catch (e) { console.warn(e); }
    busy = false;
    const { ctx, W, H, dpr } = fitCanvas(canvas);
    ctx.clearRect(0, 0, W, H);
    const map = containMap(video.videoWidth, video.videoHeight, W, H);
    if (r) drawHand(ctx, r.i, map, { thumb: cssVar('--teacher'), lw: 3 * dpr });
    last = r;
    const ar = video.videoWidth / video.videoHeight || 1;
    const now = performance.now();
    if (mode === 'still') {
      if (!r) { prev = null; stableSince = 0; buf = []; ring.set(0); return setHint('把握拍的手放到畫面中央'); }
      const palm = Math.hypot((r.i[27] - r.i[0]) * ar, r.i[28] - r.i[1]) || 1e-3;
      let motion = 1;
      if (prev) { let s = 0; for (let k = 0; k < 21; k++) s += Math.hypot((r.i[3 * k] - prev[3 * k]) * ar, r.i[3 * k + 1] - prev[3 * k + 1]); motion = s / 21 / palm; }
      prev = r.i;
      if (palm < 0.08) { stableSince = 0; buf = []; ring.set(0); return setHint('手離鏡頭太遠，請靠近一點'); }
      if (motion < 0.035) {
        if (!stableSince) { stableSince = now; buf = []; }
        buf.push({ i: r.i, w: r.w });
        const p = (now - stableSince) / 1200;
        ring.set(p);
        setHint('很好，保持不動…', true);
        if (p >= 1) captureStill();
      } else { stableSince = 0; buf = []; ring.set(0); setHint('手放穩，保持不動就會自動拍下'); }
    } else if (mode === 'rotating') {
      const t = (now - rotStart) / 1000;
      setHint(`錄製中，剩 ${Math.max(0, 5 - t).toFixed(1)} 秒`, true);
    } else if (mode === 'rotate-wait' && !r) {
      setHint('把握拍的手放到畫面中央');
    }
  }

  function captureStill() {
    const avg = A.averageHand(buf.slice(-15));
    const ar = video.videoWidth / video.videoHeight || 1;
    const view = { hi: avg.hi, hw: avg.hw, ar, snap: V.snapshot(video, 540), racket: null };
    ring.set(0); ring.el.hidden = true;
    const needMark = role === 'teacher' || (ref && ref.views[GRIP_STEPS[si].key] && ref.views[GRIP_STEPS[si].key].racket);
    if (needMark) startMark(view); else finishView(view);
  }

  function drawMark() {
    const { ctx, W, H, dpr } = fitCanvas(canvas);
    ctx.clearRect(0, 0, W, H);
    const map = containMap(markView.ar * 1000, 1000, W, H);
    drawHand(ctx, markView.hi, map, { thumb: cssVar('--teacher'), lw: 2.5 * dpr, alpha: 0.85 });
    const col = role === 'teacher' ? cssVar('--teacher') : cssVar('--student');
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 5 * dpr; ctx.lineCap = 'round';
    if (marks.length === 2) { const [a, b] = marks.map((m) => map(m[0], m[1])); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    marks.forEach((m, k) => { const [x, y] = map(m[0], m[1]); ctx.beginPath(); ctx.arc(x, y, (k === 0 ? 10 : 7) * dpr, 0, Math.PI * 2); ctx.fill(); });
  }
  function onMarkTap(e) {
    if (mode !== 'mark' || marks.length >= 2) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width;
    const map = containMap(markView.ar * 1000, 1000, canvas.width, canvas.height);
    const [x, y] = map.inverse((e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr);
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    marks.push([x, y]);
    drawMark(); markStatus();
  }
  function markStatus() {
    if (marks.length === 0) setHint('點一下握把頭（握把尾端）');
    else if (marks.length === 1) setHint('再點一下握把上端（和拍桿交接處）');
    else setHint('確認線條和握把對齊', true);
    confirmBtn.disabled = marks.length < 2;
  }
  function startMark(view) {
    mode = 'mark'; markView = view; marks = [];
    stage.classList.remove('mirror');
    img.src = view.snap; img.hidden = false; video.style.visibility = 'hidden';
    stepBox.replaceChildren(h('div', {}, h('h2', {}, '標出握把位置'),
      h('p', {}, '在照片上先點握把頭（握把最尾端），再點握把上端和拍桿交接的地方。系統會算出握把的方向和握的位置高低。看不到握把可以略過。')));
    confirmBtn = btn('確認', () => { markView.racket = { butt: marks[0], head: marks[1] }; endMark(); finishView(markView); });
    controls.replaceChildren(confirmBtn,
      btn('重新標記', () => { marks = []; drawMark(); markStatus(); }, 'secondary'),
      btn('不標握把', () => { endMark(); finishView(markView); }, 'quiet'),
      btn('重拍這個角度', () => { endMark(); renderStep(); }, 'quiet'));
    requestAnimationFrame(drawMark);
    markStatus();
  }
  function endMark() {
    img.hidden = true; video.style.visibility = '';
    stage.classList.toggle('mirror', S.facing === 'user');
  }
  function finishView(view) {
    data.views[GRIP_STEPS[si].key] = view;
    toast('已拍下' + GRIP_STEPS[si].short + '角度');
    si++; renderStep();
  }
  async function startRotate() {
    controls.replaceChildren();
    mode = 'rotate-wait';
    count.hidden = false;
    for (let n = 3; n > 0; n--) { count.textContent = n; await sleep(800); if (!running) return; }
    count.hidden = true;
    const mime = V.pickMime();
    let rec = null;
    try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined); }
    catch { try { rec = new MediaRecorder(stream); } catch { toast('這個瀏覽器不支援錄影'); return renderStep(); } }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = res; });
    rec.start(250);
    rotStart = performance.now(); mode = 'rotating';
    stage.classList.add('recording');
    await sleep(5000);
    if (rec.state !== 'inactive') rec.stop();
    await stopped;
    stage.classList.remove('recording');
    if (!running) return;
    mode = 'idle';
    data.rotationVideo = new Blob(chunks, { type: rec.mimeType || mime || 'video/webm' });
    toast('已錄下手腕轉動示範');
    si++; renderStep();
  }
  function finish() {
    mode = 'idle';
    if (!Object.keys(data.views).length && !data.rotationVideo) {
      toast('至少要完成一個步驟');
      si = 0; return renderStep();
    }
    running = false; V.stopStream(stream);
    onDone(data);
  }
}

// ───────── 握拍結果 ─────────
function snapCanvas(view, hand, color, tag) {
  const c = h('canvas', { class: 'stage-overlay' });
  const im = h('img', { class: 'stage-img', src: view.snap, alt: '' });
  const draw = () => {
    const { ctx, W, H, dpr } = fitCanvas(c);
    ctx.clearRect(0, 0, W, H);
    const map = containMap(view.ar * 1000, 1000, W, H);
    drawHand(ctx, view.hi, map, { color: cssVar(color), thumb: cssVar('--line'), lw: 2.5 * dpr });
    if (view.racket) {
      const a = map(...view.racket.head), b = map(...view.racket.butt);
      ctx.strokeStyle = cssVar(color); ctx.lineWidth = 4 * dpr; ctx.setLineDash([8 * dpr, 6 * dpr]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = cssVar(color);
      ctx.beginPath(); ctx.arc(b[0], b[1], 7 * dpr, 0, Math.PI * 2); ctx.fill();
    }
  };
  im.addEventListener('load', draw);
  const ro = new ResizeObserver(draw); ro.observe(c);
  onLeaveLater(() => ro.disconnect());
  return h('div', { class: 'stage' }, im, c, h('div', { class: 'stage-tag' + (tag === '你' ? ' student' : '') }, tag));
}

function gripResult(tpl, data) {
  let R;
  try { R = A.compareGrip(tpl.grip, data); } catch (e) { return errorScreen('無法比對', e.message, () => gripPrep(tpl)); }
  DB.put('history', {
    id: DB.uid(), type: 'grip', tplId: tpl.id, tplName: tpl.name, date: Date.now(),
    total: R.total, parts: R.parts.map((p) => ({ label: p.label, score: p.score })), tips: R.improve.slice(0, 3).map((n) => n.text),
  }).catch(console.warn);

  const JOINT_ROWS = [
    ['idxMCP', '食指根部彎曲'], ['idxPIP', '食指中段彎曲'], ['midMCP', '中指根部彎曲'], ['midPIP', '中指中段彎曲'],
    ['ringMCP', '無名指根部彎曲'], ['pinkyMCP', '小指根部彎曲'], ['thMCP', '拇指根部彎曲'], ['thIP', '拇指指節彎曲'],
    ['spread', '食指與中指張開'], ['thDir', '拇指方向'],
  ];
  const views = R.perView.map((pv) => [
    h('h2', {}, pv.name),
    pv.viewAngle > 40 ? h('div', { class: 'note-box warn' }, `這個角度的手部方向和示範差約 ${Math.round(pv.viewAngle)}°，下面的數字僅供參考。`) : null,
    h('div', { class: 'pair' }, snapCanvas(tpl.grip.views[pv.view], tpl.hand, '--teacher', '示範'), snapCanvas(data.views[pv.view], data.hand, '--student', '你')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'detail-table' },
      h('thead', {}, h('tr', {}, h('th', {}, '項目'), h('th', { class: 'num' }, '示範'), h('th', { class: 'num' }, '你'), h('th', { class: 'num' }, '差異'))),
      h('tbody', {},
        JOINT_ROWS.map(([k, l]) => h('tr', {}, h('td', {}, l), h('td', { class: 'num' }, Math.round(pv.tf[k]) + '°'), h('td', { class: 'num' }, Math.round(pv.sf[k]) + '°'), h('td', { class: 'num' }, (pv.d[k] > 0 ? '+' : '') + Math.round(pv.d[k]) + '°'))),
        pv.racket ? h('tr', {}, h('td', {}, '握把與手的夾角'), h('td', { class: 'num' }, Math.round(pv.racket.t) + '°'), h('td', { class: 'num' }, Math.round(pv.racket.s) + '°'), h('td', { class: 'num' }, (pv.racket.diff > 0 ? '+' : '') + Math.round(pv.racket.diff) + '°')) : null,
        pv.racket && pv.racket.buttT != null ? h('tr', {}, h('td', {}, '握把頭到手腕距離（手掌長倍數）'), h('td', { class: 'num' }, pv.racket.buttT.toFixed(2)), h('td', { class: 'num' }, pv.racket.buttS.toFixed(2)), h('td', { class: 'num' }, (pv.racket.buttDiff > 0 ? '+' : '') + pv.racket.buttDiff.toFixed(2))) : null))),
  ]);

  const rotEl = demoVideoBlock(tpl);

  show(
    head('握拍比對結果', tpl.name, () => gripPrep(tpl)),
    scoreboard(R.total, verdict(R.total), R.parts),
    h('h2', {}, '需要調整的地方'), notesList(R.improve, false),
    h('h2', {}, '做得好的地方'), notesList(R.good, true),
    views, rotEl,
    h('div', { class: 'note-box' }, '系統只看得到手部的關節，看不到拍柄的稜面。要比較握把的角度和握的位置，請記得標出握把頭；細微的差異仍建議請老師在旁確認。'),
    h('div', { class: 'btn-row' }, btn('再做一次', () => gripPrep(tpl)), btn('換一個示範', gripHome, 'secondary')),
  );
}

// ───────── 示範影片庫 ─────────
async function libraryHome() {
  const list = await templates();
  const openT = (t) => openEntry(t, t.type === 'swing' ? swingPrep : gripPrep, libraryHome);
  if (!isTeacher()) {
    show(
      head('示範影片庫', '老師發布的標準動作都在這裡，每位同學看到的內容都一樣。點一下就能開始比對。'),
      offlineNote(),
      list.length ? h('div', { class: 'tpl-list' }, list.map((t) => tplRow(t, () => openT(t))))
        : emptyState('老師還沒有發布示範', '老師發布示範後，大約 1 分鐘內就會出現在這裡。', ['重新整理', libraryHome]),
      h('div', { class: 'note-box' }, '你自己的揮拍影片請到「揮拍比對」錄影或上傳。新增、刪除示範影片需要老師身分。'),
      h('div', { class: 'section-actions', style: { marginTop: '14px' } }, list.length ? btn('重新整理', libraryHome, 'secondary') : null, btn('我是老師，登入', teacherLogin, 'quiet')),
    );
    return;
  }
  const hasToken = !!L.getToken();
  const rows = list.map((t) => tplRow(t, null, h('div', { class: 'row-actions' },
    h('span', { class: 'chip ' + (t._state === 'remote' ? 'pub' : 'unpub') }, t._state === 'remote' ? '已發布' : '尚未發布'),
    t._state === 'local' ? btn('發布', () => publishFlow(t.id), 'secondary') : null,
    btn('刪除', () => deleteFlow(t), 'danger'))));
  show(
    head('示範影片庫', '老師在這裡新增標準動作。發布後，所有學生打開網頁都會看到同樣的示範。'),
    !hasToken ? h('div', { class: 'note-box warn', style: { marginBottom: '14px' } },
      h('p', { style: { margin: '0 0 10px' } }, '還沒有設定共享示範影片庫。現在新增的示範只會存在這台裝置，學生看不到。'),
      btn('設定 GitHub 權杖', tokenDialog, 'secondary')) : null,
    offlineNote(),
    h('div', { class: 'section-actions' }, btn('新增揮拍示範', newSwingTemplate, '', 'camera'), btn('新增握拍示範', newGripTemplate, 'secondary')),
    list.length ? h('div', { class: 'tpl-list' }, rows) : emptyState('還沒有任何示範', '先錄一段標準揮拍或握拍，發布後學生就能開始比對。', null),
    h('div', { class: 'section-actions', style: { marginTop: '14px' } }, btn('重新整理', libraryHome, 'quiet')),
  );
}

function publishError(e) {
  if (e.code === 'no-token') return '還沒有設定 GitHub 權杖。';
  if (e.code === 'no-repo') return '目前的網址不是 GitHub Pages，無法判斷要存到哪個專案。';
  if (e.status === 401) return 'GitHub 權杖無效或已過期，請重新產生並設定。';
  if (e.status === 403 || e.status === 404) return '這個權杖沒有寫入這個專案的權限。請確認權杖有選到這個專案，且 Contents 權限是 Read and write。';
  if (e.status === 413 || e.status === 422) return '檔案太大或格式不符。單一影片上限 100 MB，請把影片剪短再試。';
  return `上傳失敗：${e.detail || e.message}。請確認網路連線後再試。`;
}

async function publishFlow(id, after = libraryHome) {
  if (!requireTeacher()) return;
  const t = await DB.get('templates', id);
  if (!t) return toast('找不到這個示範');
  if (!L.getToken()) {
    setTab('library'); await after();
    toast('示範已存在這台裝置，設定權杖後按「發布」學生才看得到');
    return tokenDialog();
  }
  const txt = h('p', { class: 'progress-text' }, '準備上傳…');
  show(head('發布示範', t.name),
    h('p', {}, '正在把示範上傳到共享示範影片庫，請不要關閉畫面。'),
    h('div', { class: 'progress' }, h('div', { class: 'indeterminate' })), txt);
  try {
    const { entry } = await L.publishTemplate(t, (m) => { txt.textContent = m; });
    await DB.put('templates', { ...t, remote: true, rev: entry.rev });
    toast('已發布，學生約 1 分鐘後就會看到');
    setTab('library'); after();
  } catch (e) {
    console.error(e);
    show(head('發布失敗', t.name, libraryHome),
      h('div', { class: 'note-box warn' }, publishError(e)),
      h('div', { class: 'btn-row' }, btn('再試一次', () => publishFlow(id, after)), btn('設定權杖', tokenDialog, 'secondary')),
      h('p', { class: 'field-hint' }, '示範已經存在這台裝置上，之後也可以在示範影片庫按「發布」。'));
  }
}

async function deleteFlow(t) {
  if (!requireTeacher()) return;
  const shared = t._state === 'remote';
  if (!confirm(`要刪除「${t.name}」嗎？${shared ? '刪除後所有學生都看不到這個示範。' : ''}刪除後無法復原。`)) return;
  if (shared) {
    if (!L.getToken()) { toast('刪除共享示範需要先設定 GitHub 權杖'); return tokenDialog(); }
    toast('正在刪除…', 8000);
    try { await L.unpublishTemplate(t.id); } catch (e) { console.error(e); return toast(publishError(e), 6000); }
  }
  await DB.del('templates', t.id).catch(() => {});
  toast('已刪除'); libraryHome();
}

function tokenDialog() {
  const r = L.repoInfo();
  const dlg = h('dialog', { class: 'sheet' });
  const close = () => dlg.close();
  const input = h('input', { type: 'password', autocomplete: 'off', placeholder: 'github_pat_…' });
  const msg = h('p', { class: 'field-hint' });
  const save = async () => {
    const v = input.value.trim();
    if (!v) return input.focus();
    msg.style.color = ''; msg.textContent = '檢查中…';
    const res = await L.testToken(v);
    msg.textContent = res.msg;
    msg.style.color = res.ok ? 'var(--good)' : '#B3261E';
    if (res.ok) {
      L.setToken(v);
      toast('已設定共享示範影片庫');
      setTimeout(() => { close(); if (location.hash.slice(1) === 'library') libraryHome(); }, 900);
    }
  };
  dlg.append(h('div', { class: 'sheet-body' },
    h('div', { class: 'sheet-head' }, h('h2', {}, '共享示範影片庫'), btn('關閉', close, 'quiet')),
    h('p', {}, r ? `示範會存到 GitHub 專案「${r.owner}/${r.repo}」的 library 資料夾，學生打開網頁就會讀到。` : '目前的網址不是 GitHub Pages。請用 GitHub Pages 的網址開啟，或在 js/config.js 設定 LIBRARY。'),
    h('p', { class: 'field-hint' }, L.getToken() ? '這台裝置已經設定權杖。要更換時，貼上新的權杖即可。' : '這台裝置還沒有設定權杖。'),
    field('GitHub 權杖（Fine-grained token）', input, '只會存在這台裝置。學生的裝置不需要設定。'), msg,
    h('div', { class: 'btn-row one' }, btn('檢查並儲存', save)),
    L.getToken() ? h('div', { class: 'section-actions', style: { marginTop: '10px' } }, btn('移除這台裝置的權杖', () => { L.setToken(''); toast('已移除權杖'); close(); }, 'quiet')) : null));
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

// ───────── 老師身分 ─────────
function teacherLogin() {
  const dlg = h('dialog', { class: 'sheet' });
  const pw = h('input', { type: 'password', autocomplete: 'current-password' });
  const err = h('p', { class: 'field-hint', style: { color: '#B3261E' }, hidden: true }, '密碼不正確，請再試一次。');
  const close = () => dlg.close();
  const submit = async () => {
    if (!pw.value) return pw.focus();
    if ((await hashPw(pw.value)) === TEACHER_HASH) {
      setTeacher(true); close(); toast('已切換為老師身分'); route();
    } else { err.hidden = false; pw.select(); }
  };
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  dlg.append(h('div', { class: 'sheet-body' },
    h('div', { class: 'sheet-head' }, h('h2', {}, '老師登入'), btn('取消', close, 'quiet')),
    field('老師密碼', pw), err,
    h('div', { class: 'btn-row one' }, btn('登入', submit)),
    h('p', { class: 'field-hint' }, '登入後，這台裝置會保持老師身分，直到在設定中切換為學生身分。')));
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  pw.focus();
}

function changePassword() {
  const dlg = h('dialog', { class: 'sheet' });
  const p1 = h('input', { type: 'password', autocomplete: 'new-password' });
  const p2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const out = h('div');
  const close = () => dlg.close();
  const make = async () => {
    if (p1.value.length < 8) return toast('密碼至少要 8 個字元');
    if (p1.value !== p2.value) return toast('兩次輸入的密碼不一樣');
    const line = `export const TEACHER_HASH = '${await hashPw(p1.value)}';`;
    const code = h('textarea', { readonly: true, rows: 3, style: { width: '100%', fontSize: '13px', padding: '8px', borderRadius: '4px', border: '2px solid #CBD4D0' } }, line);
    out.replaceChildren(
      h('p', {}, '請把 GitHub 上 js/config.js 裡的 TEACHER_HASH 那一行，整行換成下面的內容：'),
      code,
      h('div', { class: 'btn-row one' }, btn('複製設定碼', async () => {
        try { await navigator.clipboard.writeText(line); toast('已複製'); } catch { code.select(); toast('請長按選取後複製'); }
      })),
      h('p', { class: 'field-hint' }, '上傳到 GitHub 約 1 到 2 分鐘後生效。已經登入的老師裝置不受影響，新密碼用在下次登入。'));
  };
  dlg.append(h('div', { class: 'sheet-body' },
    h('div', { class: 'sheet-head' }, h('h2', {}, '變更老師密碼'), btn('關閉', close, 'quiet')),
    field('新密碼', p1, '至少 8 個字元，建議英文加數字'), field('再輸入一次', p2),
    h('div', { class: 'btn-row one' }, btn('產生設定碼', make)), out));
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

function templateForm(kind, onNext) {
  const name = h('input', { type: 'text', placeholder: kind === 'swing' ? '例：羽球正手高遠球' : '例：羽球正手握拍', maxlength: 40 });
  const sport = h('select', {}, SPORTS.map((s) => h('option', { value: s }, s)));
  const meta = { view: 'side', hand: 'R' };
  const formEls = [
    field('示範名稱', name),
    field('球種', sport),
    kind === 'swing' ? groupField('拍攝角度', segmented(VIEWS, meta.view, (v) => { meta.view = v; }, '拍攝角度')) : null,
    groupField('老師的持拍手', segmented(HANDS, meta.hand, (v) => { meta.hand = v; }, '老師的持拍手')),
  ];
  const collect = () => {
    const n = name.value.trim();
    if (!n) { toast('請先輸入示範名稱'); name.focus(); return null; }
    return { ...meta, name: n, sport: sport.value };
  };
  return { formEls, collect };
}

function newSwingTemplate() {
  if (!requireTeacher()) return;
  const { formEls, collect } = templateForm('swing');
  const go = (fromCamera) => async () => {
    const meta = collect(); if (!meta) return;
    const next = (blob) => teacherAnalyze(meta, blob);
    if (fromCamera) captureSwing({ title: '錄製揮拍示範', back: newSwingTemplate, onBlob: next });
    else { const f = await pickFile('video/*'); if (f) next(f); }
  };
  show(
    head('新增揮拍示範', '錄一次標準揮拍。學生之後要用同樣的角度拍攝，所以請選一個容易重現的位置。', libraryHome),
    formEls,
    h('div', { class: 'btn-row' }, btn('用鏡頭錄製', go(true), '', 'camera'), btn('上傳影片', go(false), 'secondary', 'upload')),
  );
}

function teacherAnalyze(meta, blob) {
  trimAnalyze(blob, {
    title: '選取示範片段',
    back: newSwingTemplate,
    onFrames: async (d) => {
      const series = A.swingSeries(A.resampleFrames(d.frames, S.fps), meta.hand);
      const seg = A.detectSegment(series);
      let poster = null;
      try { poster = await d.snapAt(series.t[seg.peak]); } catch { /* 縮圖非必要 */ }
      teacherReview(meta, d, blob, series, seg, poster);
    },
  });
}

function teacherReview(meta, d, blob, series, seg, poster) {
  const seq = A.normalizePoseSeq(series.frames, d.ar, meta.hand);
  const steps = []; for (let k = seg.start; k <= seg.end; k++) steps.push([k, null]);
  const player = skeletonPlayer({ seqT: seq, seqS: null, handT: meta.hand, steps, label: (p) => {
    const i = steps[p][0]; return i < seg.top ? '準備' : i < seg.peak ? '引拍到前揮' : i === seg.peak ? '擊球瞬間' : '隨揮收拍';
  } });
  const t = (k) => series.t[k].toFixed(2);
  show(
    head('確認示範', meta.name, newSwingTemplate),
    h('p', {}, `系統找到的揮拍：從 ${t(seg.start)} 秒開始，${t(seg.peak)} 秒時手腕最快（視為擊球瞬間），${t(seg.end)} 秒收拍。`),
    player.el,
    h('div', { class: 'note-box' }, '如果骨架播放的不是完整揮拍，請返回重新選取片段，讓影片只包含一次揮拍。'),
    h('div', { class: 'btn-row' },
      btn('儲存示範', async () => {
        if (!requireTeacher()) return;
        const id = DB.uid();
        await DB.put('templates', { id, type: 'swing', ...meta, frames: d.frames, ar: d.ar, video: blob, poster, fps: S.fps, createdAt: Date.now(), remote: false });
        publishFlow(id);
      }),
      btn('重新錄製', newSwingTemplate, 'secondary')),
  );
  requestAnimationFrame(() => player.draw());
}

function newGripTemplate() {
  if (!requireTeacher()) return;
  const { formEls, collect } = templateForm('grip');
  show(
    head('新增握拍示範', '接下來會依序拍兩個角度的握拍照片並標出握把頭，再錄一段手腕轉動示範影片。學生比對時會看到這些照片，手腕轉動影片只供觀看。', libraryHome),
    formEls,
    h('div', { class: 'btn-row one' }, btn('開始錄製握拍', () => {
      const meta = collect(); if (!meta) return;
      gripCapture({
        title: '錄製握拍示範', tpl: null, hand: meta.hand, role: 'teacher', back: newGripTemplate,
        onDone: async (grip) => {
          if (!requireTeacher()) return;
          const { rotationVideo, ...g } = grip;
          const id = DB.uid();
          await DB.put('templates', { id, type: 'grip', ...meta, view: null, grip: g, demoVideo: rotationVideo || null, poster: g.views.back?.snap || g.views.thumb?.snap || null, createdAt: Date.now(), remote: false });
          publishFlow(id);
        },
      });
    }, '', 'camera')),
  );
}

// ───────── 練習紀錄 ─────────
async function historyHome() {
  const rows = (await DB.all('history')).sort((a, b) => b.date - a.date);
  const fmt = new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  show(
    head('練習紀錄', '每次比對的分數都會記錄在這台裝置上。'),
    rows.length
      ? h('div', {}, rows.map((r) => h('div', { class: 'history-row' },
        h('div', {},
          h('div', { class: 'tpl-name' }, r.tplName),
          h('div', { class: 'history-meta' }, `${r.type === 'swing' ? '揮拍' : '握拍'}，${fmt.format(new Date(r.date))}`),
          r.tips && r.tips[0] ? h('div', { class: 'history-tip' }, r.tips[0]) : null),
        h('div', { class: 'history-score' }, fmtScore(r.total)))),
      h('div', { class: 'section-actions', style: { marginTop: '20px' } }, btn('清除所有紀錄', async () => {
        if (!confirm('要清除所有練習紀錄嗎？')) return;
        await DB.clear('history'); historyHome();
      }, 'danger')))
      : emptyState('還沒有練習紀錄', '完成一次揮拍或握拍比對後，分數就會出現在這裡。', ['開始揮拍比對', () => { location.hash = 'swing'; }]),
  );
}

// ───────── 設定 ─────────
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });

function openSettings() {
  const dlg = h('dialog', { class: 'sheet' });
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.append(h('div', { class: 'sheet-body' },
    h('div', { class: 'sheet-head' }, h('h2', {}, '設定'), btn('完成', close, 'quiet')),
    groupField('姿勢辨識精度', segmented([['full', '精準'], ['lite', '快速']], S.quality, (v) => { S.quality = v; saveSettings(); }, '姿勢辨識精度')),
    h('p', { class: 'field-hint', style: { marginTop: '-8px' } }, '較舊的手機選「快速」會比較順。老師和學生建議用同一種設定。'),
    groupField('分析幀率', segmented([[30, '每秒 30 張'], [60, '每秒 60 張']], S.fps, (v) => { S.fps = v; saveSettings(); }, '分析幀率')),
    h('p', { class: 'field-hint', style: { marginTop: '-8px' } }, '揮拍很快時選 60 較準，但分析時間加倍，影片本身也要是 60fps。'),
    groupField('我的持拍手', segmented(HANDS, S.hand, (v) => { S.hand = v; saveSettings(); }, '我的持拍手')),
    groupField('預設鏡頭', segmented([['user', '前鏡頭'], ['environment', '後鏡頭']], S.facing, (v) => { S.facing = v; saveSettings(); }, '預設鏡頭')),
    groupField('身分', isTeacher()
      ? h('div', {}, h('p', { style: { margin: '0 0 8px' } }, `目前是老師身分，可以新增和刪除示範影片。共享示範影片庫：${L.getToken() ? '已設定' : '尚未設定'}。`),
        h('div', { class: 'section-actions', style: { margin: 0 } },
          btn('共享示範影片庫設定', () => { close(); tokenDialog(); }, 'secondary'),
          btn('切換為學生身分', () => { setTeacher(false); close(); toast('已切換為學生身分'); route(); }, 'secondary'),
          btn('變更老師密碼', () => { close(); changePassword(); }, 'quiet')))
      : h('div', {}, h('p', { style: { margin: '0 0 8px' } }, '目前是學生身分。'),
        btn('老師登入', () => { close(); teacherLogin(); }, 'secondary'))),
    installEvent ? h('div', { class: 'btn-row one' }, btn('安裝到這台裝置', async () => { installEvent.prompt(); await installEvent.userChoice; installEvent = null; close(); })) : null,
    h('p', { class: 'field-hint' }, `目前版本：${APP_VERSION}`),
    h('div', { class: 'note-box' }, '學生的影片和動作分析都在這台裝置上完成，不會上傳。老師發布的示範影片會存放在網站的 GitHub 專案中，任何知道網址的人都能看到。第一次使用需要網路下載辨識模型。'),
    h('div', { class: 'section-actions', style: { marginTop: '16px' } }, btn('清除所有資料', async () => {
      if (!confirm('要刪除這台裝置上的練習紀錄和示範暫存嗎？共享示範影片庫不會受影響。')) return;
      await DB.clear('templates'); await DB.clear('history'); close(); route();
    }, 'danger'))));
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}
$('#btnSettings').addEventListener('click', openSettings);

// ───────── 啟動 ─────────
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => reg && reg.update())
    .catch((e) => console.warn('Service worker 註冊失敗', e));
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
}
updateRoleBadge();
route();
