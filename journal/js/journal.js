// 我的羽球練習日誌：看老師的示範影片自主練習，練習後記錄時間與揮拍次數（照片只存在學生自己的手機，不會上傳）
// 介面與「我的羽球教練」一致；示範影片庫、學校帳號綁定、Google 試算表後台都和它共用
import * as TR from '../../js/tracking.js';
import * as L from '../../js/library.js';
import * as DB from './jstore.js';
import { $, h, toast, field, groupField, segmented } from '../../js/ui.js';

const APP_VERSION = 'j5（2026-10-12）';
const NS = 'swing-journal';
const lsGet = (k, d = null) => { try { const v = localStorage.getItem(`${NS}-${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(`${NS}-${k}`); else localStorage.setItem(`${NS}-${k}`, JSON.stringify(v)); } catch { /* 無痕模式 */ } };

const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  go: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9.5" r="1.8"/><path d="M21 16l-5-5-9 9"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>',
};
const svg = (name) => h('span', { html: ICON[name], style: { display: 'inline-flex' } });
function btn(text, onclick, cls = '', icon = null) {
  return h('button', { class: 'btn ' + cls, type: 'button', onclick }, icon ? svg(icon) : null, text);
}
function head(title, sub, back) {
  return h('div', { class: 'screen-head' },
    back ? h('button', { class: 'back', type: 'button', onclick: back }, svg('back'), '返回') : null,
    h('h1', {}, title),
    sub ? h('p', { class: 'lede' }, sub) : null);
}
function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('h3', {}, title), h('p', {}, text), action ? btn(action[0], action[1]) : null);
}

// ───────── 畫面切換 ─────────
const main = $('#main');
let cleanups = [];
function onLeave(fn) { cleanups.push(fn); }
function show(...nodes) {
  const c = cleanups; cleanups = [];
  c.forEach((f) => { try { f(); } catch (e) { console.warn(e); } });
  main.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
  window.scrollTo(0, 0);
}
function setTab(tab) {
  document.querySelectorAll('.tabbar a').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'));
  if (location.hash.slice(1) !== tab) history.replaceState(null, '', '#' + tab);
}

const TABS = { demos: demosHome, log: () => logForm(), history: historyHome };
function route() {
  if (!lsGet('started')) return welcome();
  const tab = location.hash.slice(1) in TABS ? location.hash.slice(1) : 'demos';
  setTab(tab);
  TABS[tab]();
}
window.addEventListener('hashchange', route);
document.querySelectorAll('.tabbar a').forEach((a) => a.addEventListener('click', (e) => {
  if (location.hash.slice(1) === a.dataset.tab) { e.preventDefault(); route(); }
}));

function welcome() {
  setTab('demos');
  show(
    head('歡迎使用我的羽球練習日誌', '課餘時間看老師的示範影片自主練習，練習完記一筆日誌。'),
    h('ol', { class: 'jr-steps' },
      h('li', {}, h('b', {}, '看示範'), h('span', {}, '在「示範影片」看老師的標準動作，可以慢速播放。')),
      h('li', {}, h('b', {}, '自主練習'), h('span', {}, '照著示範的動作，反覆練習揮拍。')),
      h('li', {}, h('b', {}, '寫日誌'), h('span', {}, '填上練習時間和揮拍次數送出給老師。可以加一張練習照片，照片只存在你的手機，不會上傳。'))),
    h('div', { class: 'btn-row one' }, btn('開始使用', async () => {
      lsSet('started', true);
      location.hash = 'demos';
      await TR.loadConfig();
      if (TR.enabled() && !TR.account()) accountScreen({ first: true }); else route();
    })),
  );
}

// ───────── 示範影片（和「我的羽球教練」共用同一份示範影片庫） ─────────
const VIEW_TEXT = { side: '側面', front: '正面', back: '背面' };
const HAND_TEXT = { R: '右手持拍', L: '左手持拍' };
let libraryOffline = false;
async function demoList() {
  let index = null;
  try { index = await L.fetchIndex(); lsSet('index', index); libraryOffline = false; }
  catch (e) { console.warn('讀取示範影片庫失敗', e); libraryOffline = true; index = lsGet('index'); }
  const list = (index && index.templates) || [];
  if (index && !libraryOffline) {
    // 老師更新或刪除的示範，清掉這台裝置的舊暫存
    const byId = new Map(list.map((e) => [e.id, e]));
    for (const t of await DB.all('templates').catch(() => [])) {
      if (!byId.has(t.id) || byId.get(t.id).rev !== t.rev) await DB.del('templates', t.id).catch(() => {});
    }
  }
  return list.slice().sort((a, b) => b.createdAt - a.createdAt);
}
function chipsFor(t) {
  return h('div', { class: 'chips' },
    h('span', { class: 'chip ' + t.type }, t.type === 'swing' ? '揮拍' : '握拍'),
    t.sport ? h('span', { class: 'chip' }, t.sport) : null,
    t.hand ? h('span', { class: 'chip' }, HAND_TEXT[t.hand]) : null,
    t.view ? h('span', { class: 'chip' }, VIEW_TEXT[t.view] || '') : null);
}
function tplRow(t, onclick) {
  const thumb = t.poster ? h('img', { class: 'tpl-thumb', src: t.poster, alt: '' }) : h('div', { class: 'tpl-thumb' });
  return h('button', { class: 'tpl-row', type: 'button', onclick }, thumb, h('div', {}, h('div', { class: 'tpl-name' }, t.name), chipsFor(t)), h('span', { class: 'tpl-go', html: ICON.go }));
}

async function demosHome() {
  show(head('示範影片', '老師的標準動作都在這裡。看清楚再練習，練習完記得寫日誌。'), h('p', { class: 'progress-text' }, '讀取示範中…'));
  const list = await demoList();
  if (location.hash.slice(1) !== 'demos') return;
  show(
    head('示範影片', '老師的標準動作都在這裡。看清楚再練習，練習完記得寫日誌。'),
    accountBanner(),
    libraryOffline ? h('div', { class: 'note-box warn', style: { marginBottom: '14px' } }, '目前連不上示範影片庫，顯示的是之前讀到的清單；沒下載過的影片需要網路。') : null,
    list.length ? h('div', { class: 'tpl-list' }, list.map((t) => tplRow(t, () => demoScreen(t))))
      : emptyState('老師還沒有發布示範', '老師發布示範後，大約 1 分鐘內就會出現在這裡。', ['重新整理', demosHome]),
    list.length ? h('div', { class: 'section-actions', style: { marginTop: '14px' } }, btn('重新整理', demosHome, 'quiet')) : null,
  );
}

async function demoScreen(entry) {
  const back = () => { setTab('demos'); demosHome(); };
  let tpl = await DB.get('templates', entry.id).catch(() => null);
  if (!tpl || tpl.rev !== entry.rev) {
    const txt = h('p', { class: 'progress-text' }, '下載示範中…');
    show(head(entry.name, null, back), h('div', { class: 'progress' }, h('div', { class: 'indeterminate' })), txt);
    let cancelled = false;
    onLeave(() => { cancelled = true; });
    try {
      tpl = await L.fetchTemplate(entry, (m) => { txt.textContent = m; });
      tpl.rev = entry.rev;
      await DB.put('templates', tpl).catch(console.warn);
    } catch (e) {
      console.error(e);
      if (!cancelled) show(head('無法下載示範', entry.name, back), h('div', { class: 'note-box warn' }, `請確認網路連線後再試一次。（${e.message}）`));
      return;
    }
    if (cancelled) return;
  }
  const blob = tpl.video || tpl.demoVideo || null;
  let stage;
  let speedCtl = null;
  let url = null;
  if (blob) {
    url = URL.createObjectURL(blob);
    const v = h('video', { class: 'stage-media', src: url, muted: true, playsInline: true, loop: true, controls: true, autoplay: true, preload: 'auto' });
    stage = h('div', { class: 'stage jr-stage' }, v);
    v.addEventListener('loadedmetadata', () => { if (v.videoHeight > v.videoWidth) stage.classList.add('tall'); });
    speedCtl = groupField('播放速度', segmented([[0.25, '0.25 倍'], [0.5, '0.5 倍'], [1, '正常']], 1, (x) => { v.playbackRate = x; }, '播放速度'));
  } else {
    const views = tpl.grip && tpl.grip.views ? Object.values(tpl.grip.views).map((x) => x && x.snap).filter(Boolean) : [];
    const pics = views.length ? views : (tpl.poster ? [tpl.poster] : []);
    stage = pics.length ? h('div', { class: 'jr-snaps' }, pics.map((src) => h('img', { src, alt: entry.name }))) : h('div', { class: 'note-box' }, '這個示範沒有影片。');
  }
  show(
    head(tpl.name, null, back),
    chipsFor(tpl),
    h('div', { style: { marginTop: '14px' } }, stage),
    speedCtl,
    h('div', { class: 'note-box' }, '先用慢速看清楚每個階段的動作，再對著鏡子或請同學幫忙看，反覆練習同一個動作。'),
    h('div', { class: 'btn-row one' }, btn('練習完，寫練習日誌', () => { draft.template = tpl.name; setTab('log'); logForm(); }, '', 'pen')),
  );
  // show() 會先執行上一個畫面的清理，所以釋放影片網址要在 show() 之後登記
  if (url) onLeave(() => URL.revokeObjectURL(url));
  // 記下學生點開哪一支示範影片（寫日誌時自動帶入，並計算點開次數）
  lsSet('views', [...lsGet('views', []).slice(-300), { id: entry.id, name: tpl.name, at: Date.now() }]);
  lsSet('lastDemo', tpl.name);
}

// ───────── 寫日誌 ─────────
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const draft = { date: '', template: '', minutes: '', reps: '', note: '', photo: null, thumb: '' };
const NONE = '__none__';
const NO_VIDEO = '（這次沒有看示範影片）';

// 照片只存在這台手機：縮小成長邊 1600 像素的 JPEG 以節省空間，另做一張小縮圖給清單用
async function loadImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* 改用 <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
function drawTo(img, max) {
  const w = img.width || img.naturalWidth, hgt = img.height || img.naturalHeight;
  const s = Math.min(1, max / Math.max(w, hgt));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(hgt * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}
async function compressPhoto(file) {
  const img = await loadImage(file);
  const big = drawTo(img, 1600);
  const blob = await new Promise((res) => big.toBlob(res, 'image/jpeg', 0.82));
  const thumb = drawTo(img, 320).toDataURL('image/jpeg', 0.7);
  if (img.close) img.close();
  if (!blob) throw new Error('照片轉換失敗');
  return { blob, thumb };
}

async function logForm() {
  setTab('log');
  const names = (await demoList().catch(() => [])).map((t) => t.name);
  if (location.hash.slice(1) !== 'log') return;
  if (!draft.date) draft.date = todayStr();
  const minDay = (() => { const d = new Date(); d.setDate(d.getDate() - 30); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const date = h('input', { type: 'date', value: draft.date, max: todayStr(), min: minDay });
  // 預設帶入最近在「示範影片」點開的那一支
  if (!draft.template) { const last = lsGet('lastDemo'); if (last && names.includes(last)) draft.template = last; }
  const sel = h('select', {},
    h('option', { value: '' }, '請選擇這次看的示範影片'),
    names.map((n) => h('option', { value: n }, n)),
    h('option', { value: NONE }, NO_VIDEO));
  sel.value = draft.template === NONE ? NONE : (draft.template && names.includes(draft.template) ? draft.template : '');
  sel.addEventListener('change', () => save());
  const minutes = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: 300, step: 1, value: draft.minutes, placeholder: '例：30' });
  const reps = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: 5000, step: 1, value: draft.reps, placeholder: '例：100' });
  const note = h('textarea', { rows: 3, maxlength: 500, placeholder: '例：在宿舍前空地練習，後半段比較能做到轉體。' });
  note.value = draft.note;
  const save = () => {
    draft.date = date.value; draft.minutes = minutes.value; draft.reps = reps.value; draft.note = note.value;
    draft.template = sel.value;
  };
  [date, minutes, reps, note].forEach((el) => el.addEventListener('input', save));

  // 照片
  const preview = h('div', { class: 'jr-photo' });
  const renderPhoto = () => {
    preview.replaceChildren(draft.thumb
      ? h('div', { class: 'jr-photo-has' }, h('img', { src: draft.thumb, alt: '練習照片' }), btn('移除', () => { draft.photo = null; draft.thumb = ''; renderPhoto(); }, 'quiet small'))
      : h('div', { class: 'jr-photo-empty' }, '還沒有照片'));
  };
  renderPhoto();
  const takePhoto = (capture) => {
    const input = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    if (capture) input.setAttribute('capture', 'environment');
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      preview.replaceChildren(h('p', { class: 'progress-text' }, '處理照片中…'));
      try { const r = await compressPhoto(f); draft.photo = r.blob; draft.thumb = r.thumb; }
      catch (e) { console.error(e); toast('這張照片無法讀取，請換一張或改用拍照'); }
      renderPhoto();
    });
    document.body.append(input);
    input.click();
  };
  const msg = h('div', { role: 'status' });
  const warn = (t) => { msg.replaceChildren(h('div', { class: 'note-box warn' }, t)); msg.scrollIntoView({ block: 'center', behavior: 'smooth' }); };

  const submit = async () => {
    save();
    const tplName = sel.value === NONE ? NO_VIDEO : sel.value;
    const m = Number(minutes.value), r = Number(reps.value);
    if (!date.value) return warn('請選擇練習日期。');
    if (date.value > todayStr()) return warn('練習日期不能是未來的日期。');
    if (!tplName) return warn('請選擇這次看的示範影片。');
    if (!Number.isFinite(m) || m < 1 || m > 300) return warn('練習時間請填 1～300 分鐘。');
    if (!Number.isInteger(r) || r < 1 || r > 5000) return warn('揮拍次數請填 1～5000 的整數。');
    // 從上一筆日誌到現在，這支影片在 App 裡被點開幾次
    const prevAt = (await DB.all('entries').catch(() => [])).reduce((t, e) => Math.max(t, Date.parse(e.at) || 0), 0);
    const opens = sel.value === NONE ? 0 : lsGet('views', []).filter((v) => v.name === tplName && v.at > prevAt).length;
    const entry = {
      id: DB.uid(), at: new Date().toISOString(), date: date.value, template: tplName, opens,
      minutes: Math.round(m), reps: r, note: note.value.trim(), photo: draft.photo, thumb: draft.thumb,
      app: APP_VERSION, synced: false,
    };
    try { await DB.put('entries', entry); }
    catch (e) { console.error(e); return warn('這台裝置無法儲存日誌（可能是無痕模式或空間不足）。'); }
    Object.assign(draft, { date: '', template: '', minutes: '', reps: '', note: '', photo: null, thumb: '' });
    doneScreen(entry);
  };

  show(
    head('寫練習日誌', '每次自主練習完記一筆。練習時間和揮拍次數必填；照片可以加在自己的日誌裡，不會上傳。'),
    accountBanner(),
    field('練習日期', date),
    field('觀看的示範影片', sel, '已自動帶入你最近在「示範影片」點開的影片；這次看的是別支，請改選。'),
    h('div', { class: 'jr-two' },
      field('練習時間（分鐘）', minutes, '大約就好'),
      field('揮拍次數', reps, '這個動作大約揮了幾下')),
    groupField('練習照片（選填，只存在你的手機）', h('div', {},
      preview,
      h('div', { class: 'section-actions', style: { margin: '10px 0 0' } },
        btn('拍照', () => takePhoto(true), 'secondary', 'camera'),
        btn('從相簿選擇', () => takePhoto(false), 'secondary', 'image')),
      h('p', { class: 'field-hint jr-private' }, '照片只會存在這支手機的練習日誌裡，不會上傳給老師或任何人。送給老師的只有日期、動作、時間、次數、說明，以及「有沒有附照片」。'))),
    field('練習說明（選填）', note, '在哪裡練、和誰練、哪裡進步了或還不順。'),
    msg,
    h('div', { class: 'btn-row one' }, btn('送出日誌', submit)),
  );
}

async function doneScreen(entry) {
  const status = h('div', { role: 'status' }, h('p', { class: 'progress-text' }, '上傳中…'));
  show(
    head('已記錄', `${entry.date}・${entry.template}`),
    h('section', { class: 'jr-done' + (entry.thumb ? '' : ' no-photo') },
      entry.thumb ? h('img', { src: entry.thumb, alt: '練習照片' }) : null,
      h('div', {}, h('div', { class: 'jr-big' }, h('b', {}, entry.minutes), ' 分鐘'), h('div', { class: 'jr-big' }, h('b', {}, entry.reps), ' 下'))),
    status,
    h('div', { class: 'btn-row' }, btn('再寫一筆', () => logForm()), btn('看練習紀錄', () => { location.hash = 'history'; }, 'secondary')),
  );
  await syncPending();
  if (!status.isConnected) return;
  const e = await DB.get('entries', entry.id).catch(() => null);
  if (e && e.synced) status.replaceChildren(h('div', { class: 'note-box' }, entry.thumb ? '已送給老師。照片留在你的手機，沒有上傳。' : '已送給老師。'));
  else if (!TR.enabled()) status.replaceChildren(h('div', { class: 'note-box warn' }, '老師還沒完成後台設定，日誌先存在這台裝置。'));
  else if (!TR.account()) status.replaceChildren(h('div', { class: 'note-box warn' }, h('p', { style: { margin: '0 0 10px' } }, '日誌已存在這台裝置。綁定學校帳號後，會自動送給老師。'), btn('綁定學校帳號', () => accountScreen({}), 'secondary')));
  else status.replaceChildren(h('div', { class: 'note-box warn' }, lastSyncError ? `${TR.errorText(lastSyncError)} 日誌已存在這台裝置，連上網路後會自動補送。` : '日誌已存在這台裝置，連上網路後會自動補送給老師。'));
}

// ───────── 上傳 ─────────
let syncing = null;
let lastSyncError = null;
function syncPending() {
  if (syncing) return syncing;
  syncing = (async () => {
    const a = TR.account();
    if (!a || !TR.enabled() || !navigator.onLine) return 0;
    const list = (await DB.all('entries').catch(() => [])).filter((e) => !e.synced).sort((x, y) => x.at.localeCompare(y.at));
    let n = 0;
    lastSyncError = null;
    for (const e of list) {
      try {
        const r = await TR.request({
          action: 'journal', deviceKey: a.deviceKey, profile: TR.profile(),
          // 照片不上傳，只告訴老師這筆有沒有附照片
          entry: { id: e.id, at: e.at, date: e.date, template: e.template, opens: e.opens || 0, minutes: e.minutes, reps: e.reps, note: e.note, app: e.app, hasPhoto: !!e.photo },
        });
        if (!r.accepted || !r.accepted.includes(e.id)) throw Object.assign(new Error('not accepted'), { code: 'http' });
        await DB.put('entries', { ...e, synced: true, syncedAt: Date.now() });
        n++;
      } catch (err) {
        console.warn('日誌上傳失敗', err);
        lastSyncError = err;
        if (err.code === 'bad-key') await TR.unlink();
        break;
      }
    }
    return n;
  })().finally(() => { syncing = null; });
  syncing.then((n) => { if (n && location.hash.slice(1) === 'history' && !document.querySelector('.jr-detail')) historyHome(); });
  return syncing;
}

// ───────── 練習紀錄 ─────────
function accountBanner() {
  if (!TR.enabled() || TR.account()) return null;
  return h('div', { class: 'note-box warn', style: { marginBottom: '14px' } },
    h('p', { style: { margin: '0 0 10px' } }, '還沒綁定學校 Google 帳號，老師看不到你的練習日誌。'),
    btn('綁定學校帳號', () => accountScreen({}), 'secondary'));
}

async function journalTotals() {
  const list = await DB.all('entries').catch(() => []);
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
  const wk = `${weekAgo.getFullYear()}-${String(weekAgo.getMonth() + 1).padStart(2, '0')}-${String(weekAgo.getDate()).padStart(2, '0')}`;
  const sum = (arr) => ({ n: arr.length, min: arr.reduce((t, e) => t + (e.minutes || 0), 0), reps: arr.reduce((t, e) => t + (e.reps || 0), 0) });
  const all = sum(list), week = sum(list.filter((e) => e.date >= wk));
  const pending = list.filter((e) => !e.synced).length;
  const a = TR.account();
  return h('section', { class: 'trk-totals jr-totals' },
    h('div', { class: 'jr-kpis' },
      h('div', {}, h('span', { class: 'trk-k' }, '近 7 天'), h('b', {}, week.n), ' 筆', h('div', { class: 'detail' }, `${week.min} 分鐘・${week.reps} 下`)),
      h('div', {}, h('span', { class: 'trk-k' }, '累計'), h('b', {}, all.n), ' 筆', h('div', { class: 'detail' }, `${all.min} 分鐘・${all.reps} 下`))),
    h('p', { class: 'field-hint' }, a
      ? (pending ? `已綁定 ${a.email}。還有 ${pending} 筆日誌等網路連線後送給老師。` : `已綁定 ${a.email}。日誌都已送給老師。`)
      : (TR.enabled() ? '還沒綁定學校帳號，日誌會先存在這台裝置，綁定後自動補送給老師。' : '日誌存在這台裝置上。')),
    a && pending ? btn('立即上傳', async () => { toast('上傳中…'); const n = await syncPending(); toast(n ? `已上傳 ${n} 筆` : TR.errorText(lastSyncError || {})); historyHome(); }, 'secondary small') : null,
    a ? null : (TR.enabled() ? btn('綁定學校帳號', () => accountScreen({}), 'secondary small') : null));
}

async function historyHome() {
  setTab('history');
  const list = (await DB.all('entries').catch(() => [])).sort((x, y) => (y.date + y.at).localeCompare(x.date + x.at));
  const totals = await journalTotals();
  if (location.hash.slice(1) !== 'history') return;
  const fmtDay = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${m}/${dd}（${'日一二三四五六'[new Date(y, m - 1, dd).getDay()]}）`; };
  show(
    head('練習紀錄', '你送出的練習日誌。'),
    totals,
    list.length ? h('div', { class: 'jr-list' }, list.map((e) => h('button', { class: 'jr-row', type: 'button', onclick: () => entryDetail(e) },
      e.thumb ? h('img', { class: 'tpl-thumb', src: e.thumb, alt: '' }) : h('div', { class: 'tpl-thumb' }),
      h('div', {},
        h('div', { class: 'tpl-name' }, e.template),
        h('div', { class: 'history-meta' }, `${fmtDay(e.date)}・${e.minutes} 分鐘・${e.reps} 下`),
        h('span', { class: 'chip ' + (e.synced ? 'pub' : 'unpub') }, e.synced ? '已送給老師' : '等待上傳')),
      h('span', { class: 'tpl-go', html: ICON.go }))))
      : emptyState('還沒有練習日誌', '看完示範、練習之後，到「寫日誌」記下這次的練習。', ['寫練習日誌', () => { location.hash = 'log'; }]),
  );
}

async function entryDetail(e) {
  const back = () => historyHome();
  let url = null;
  if (e.photo) url = URL.createObjectURL(e.photo);
  show(
    head(e.template, `${e.date}・${e.synced ? '已送給老師' : '等待上傳'}`, back),
    h('div', { class: 'jr-detail' },
      url || e.thumb ? [h('img', { class: 'jr-detail-photo', src: url || e.thumb, alt: '練習照片' }), h('p', { class: 'field-hint jr-private' }, '這張照片只存在這支手機，沒有上傳。')] : null,
      h('div', { class: 'jr-kpis', style: { marginTop: '14px' } },
        h('div', {}, h('span', { class: 'trk-k' }, '練習時間'), h('b', {}, e.minutes), ' 分鐘'),
        h('div', {}, h('span', { class: 'trk-k' }, '揮拍次數'), h('b', {}, e.reps), ' 下')),
      h('p', { class: 'field-hint' }, e.template === NO_VIDEO ? '這次沒有看示範影片。' : `觀看的示範影片：${e.template}${e.opens ? `（在 App 裡點開 ${e.opens} 次）` : ''}`),
      e.note ? h('div', { class: 'note-box' }, e.note) : null),
    e.synced ? h('p', { class: 'field-hint', style: { marginTop: '16px' } }, '已送出的日誌無法修改。填錯的話，請告訴老師。')
      : h('div', { class: 'section-actions', style: { marginTop: '18px' } },
        TR.account() ? btn('立即上傳', async () => { await syncPending(); historyHome(); }, 'secondary') : null,
        btn('刪除這筆', async () => {
          if (!confirm('這筆日誌還沒送給老師，刪除後無法復原。要刪除嗎？')) return;
          await DB.del('entries', e.id); toast('已刪除'); historyHome();
        }, 'danger')),
  );
  if (url) onLeave(() => URL.revokeObjectURL(url));
}

// ───────── 學校帳號（和「我的羽球教練」相同的綁定方式） ─────────
// 複製文字；瀏覽器不允許時，跳出可長按選取的對話框
async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); return; } catch { /* 改用下面的方式 */ }
  const ta = h('textarea', { readonly: true, rows: 3, style: { width: '100%', fontSize: '14px', padding: '8px', border: '2px solid #CBD4D0', borderRadius: '4px' } }, text);
  const dlg = h('dialog', { class: 'sheet' }, h('div', { class: 'sheet-body' },
    h('div', { class: 'sheet-head' }, h('h2', {}, '複製網址'), btn('關閉', () => dlg.close(), 'quiet')),
    h('p', { class: 'field-hint' }, '這個瀏覽器不能自動複製，請長按下面的網址，選「全選」後「複製」。'), ta));
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal(); ta.focus(); ta.select();
}

// 綁定表單送出後，背景完成綁定時呼叫
let pairErrorBox = null;
// 切回 App 的方法：依手機與開啟方式給不同說明
function returnHint() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (ios && standalone) return '看到「已送出」後，從螢幕最下方往上滑一點停住（有 Home 鍵的 iPhone 按兩下 Home 鍵），點選「練習日誌」回到這裡。';
  if (ios) return '看到「已送出」後，關閉表單分頁，或點 Safari 下方的「分頁」按鈕切回這個分頁。';
  if (android && standalone) return '看到「已送出」後，按手機的「最近使用的應用程式」鍵（或從螢幕底部往上滑停住），點選「練習日誌」回到這裡。';
  if (android) return '看到「已送出」後，按瀏覽器右上角的分頁數字，切回這個分頁。';
  return '看到「已送出」後，關閉表單分頁，回到這個分頁。';
}
const CHECK_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22" fill="currentColor"/><path d="M14 24.5l7 7 13-14" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// 綁定成功：顯示明顯的完成畫面，讓剛切回來的學生知道已經好了
function linkedScreen() {
  const a = TR.account();
  if (!a) return accountScreen({});
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  const tst = $('#toast'); if (tst) tst.classList.remove('show');
  if (navigator.vibrate) { try { navigator.vibrate(80); } catch { /* 不支援 */ } }
  show(
    h('section', { class: 'trk-linked' },
      h('div', { class: 'trk-check', html: CHECK_SVG }),
      h('h1', {}, '綁定完成'),
      h('b', {}, a.name), h('div', { class: 'trk-linked-mail' }, a.email),
      h('p', { class: 'lede' }, '之後每次送出的練習日誌都會自動交給老師。這支手機之後不用再綁定。')),
    h('div', { class: 'btn-row one' }, btn('開始寫日誌', () => { location.hash = 'log'; route(); })),
    h('div', { class: 'section-actions', style: { justifyContent: 'center', marginTop: '10px' } }, btn('確認班級與學號', () => accountScreen({}), 'quiet')),
  );
}
function onPairLinked() {
  syncPending();
  linkedScreen();
}
function onPairError(e) {
  // 配對碼已失效，重新顯示綁定畫面（會產生新的配對碼），再顯示錯誤原因
  if (pairErrorBox && pairErrorBox.isConnected) { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); accountScreen({}); pairErrorBox.replaceChildren(h('div', { class: 'note-box warn' }, TR.errorText(e), ' 請按「開啟綁定表單」重新送出。')); }
  else toast(TR.errorText(e));
}

async function accountScreen({ first = false } = {}) {
  const back = () => { setTab('demos'); route(); };
  const a = TR.account();
  const prof = TR.profile();
  const cls = h('input', { type: 'text', value: prof.className, placeholder: '例：體育一甲', maxlength: 40, autocomplete: 'off' });
  const sid = h('input', { type: 'text', value: prof.studentId, placeholder: '例：1130123', maxlength: 40, inputmode: 'text', autocomplete: 'off' });
  const saveProf = () => { TR.setProfile({ className: cls.value, studentId: sid.value }); };
  cls.addEventListener('change', saveProf); sid.addEventListener('change', saveProf);
  const msg = h('div', { role: 'status' });
  const err = (e) => msg.replaceChildren(h('div', { class: 'note-box warn' }, TR.errorText(e)));
  const profileBox = [
    h('h2', {}, '班級與學號'),
    h('p', { class: 'field-hint' }, '方便老師對照名單。學號已依信箱自動填入時，請確認是否正確。'),
    field('班級', cls), field('學號', sid),
  ];
  const privacy = h('div', { class: 'note-box' },
    h('strong', {}, '老師會看到的資料'),
    h('p', { style: { margin: '6px 0 0' } }, '學校信箱、姓名、班級、學號，以及每筆練習日誌的日期、動作、練習時間、揮拍次數、說明和「有沒有附照片」。照片本身只存在你的手機，不會上傳。'));

  if (a) {
    const codeOut = h('div');
    show(
      head('我的帳號', null, back),
      h('section', { class: 'trk-account' },
        h('div', { class: 'trk-k' }, '已綁定的學校帳號'),
        h('b', {}, a.name), h('div', {}, a.email)),
      await journalTotals(),
      profileBox,
      h('div', { class: 'btn-row one' }, btn('儲存班級與學號', async () => {
        saveProf();
        try { await TR.syncProfile(); toast('已儲存，老師那邊也已更新'); } catch { toast('已儲存，連上網路後會自動送給老師'); }
      })),
      h('h2', {}, '在另一台裝置使用'),
      h('p', { class: 'field-hint' }, '在這裡產生綁定碼，到另一台裝置的「綁定學校帳號」頁輸入，10 分鐘內有效。'),
      btn('產生綁定碼', async () => {
        try { const r = await TR.issueCode(); codeOut.replaceChildren(h('p', { class: 'trk-code' }, r.code), h('p', { class: 'field-hint' }, '10 分鐘內有效，只能使用一次。')); }
        catch (e) { codeOut.replaceChildren(h('div', { class: 'note-box warn' }, TR.errorText(e))); }
      }, 'secondary'),
      codeOut,
      privacy,
      h('div', { class: 'section-actions', style: { marginTop: '18px' } }, btn('解除這台裝置的綁定', async () => {
        if (!confirm('解除後，這台裝置的日誌不會再送給老師，直到重新綁定。要解除嗎？')) return;
        await TR.unlink(); toast('已解除綁定'); accountScreen({});
      }, 'danger')),
    );
    return;
  }

  const gbtn = h('div', { class: 'trk-gbtn' }, h('p', { class: 'field-hint' }, '載入 Google 登入…'));
  const codeIn = h('input', { type: 'text', inputmode: 'numeric', maxlength: 6, placeholder: '6 位數字', autocomplete: 'one-time-code' });
  const done = () => {
    syncPending();
    linkedScreen();
  };
  const cfg = TR.config() || {};
  const bindHref = cfg.bindUrl ? cfg.bindUrl + (cfg.bindUrl.includes('?') ? '&' : '?') + 'action=bind' : '';
  // 綁定表單：後台有建立時優先使用（學生和老師的學校帳號屬於不同機構也能用）
  const formBox = h('div', {}, h('p', { class: 'field-hint' }, '正在確認綁定方式…'));
  const bindBox = h('div');
  const formStatus = h('div', { role: 'status' });
  show(
    head('綁定學校 Google 帳號', '證明一次你的學校帳號，老師就能收到你的練習日誌。', first ? null : back),
    privacy,
    formBox,
    bindBox,
    msg,
    first ? h('div', { class: 'section-actions', style: { marginTop: '22px' } }, btn('稍後再說', () => {
      toast('之後可以在「設定」綁定，日誌會先存在這台裝置'); route();
    }, 'quiet')) : null,
  );
  // 送出表單後回到 App：背景會自動詢問後台（TR.init 的 onLinked / onPairError）
  pairErrorBox = formStatus;
  const otherWays = (withForm) => [
    !withForm && bindHref ? [
      h('h2', {}, '第 1 步：取得綁定碼'),
      h('p', { class: 'field-hint' }, '按下面的按鈕會開啟學校帳號的綁定頁。請用學校的 Google 帳號登入，頁面會顯示 6 位數綁定碼。'),
      h('div', { class: 'section-actions', style: { margin: '0' } },
        h('a', { class: 'btn', href: bindHref, target: '_blank', rel: 'noopener' }, '開啟學校帳號綁定頁'),
        btn('複製綁定頁網址', () => copyText(bindHref, '已複製，請貼到無痕視窗的網址列'), 'secondary')),
      h('p', { class: 'field-hint' }, '瀏覽器同時登入多個 Google 帳號而打不開，或顯示的不是你的學校帳號時：按「複製綁定頁網址」，開一個無痕視窗（iPhone Safari 的「私密瀏覽」、Chrome 的「無痕分頁」），把網址貼上，只登入學校帳號。'),
      h('h2', {}, '第 2 步：輸入綁定碼'),
    ] : [
      withForm || cfg.clientId ? null : h('div', { class: 'note-box warn' }, '老師還沒有設定學生綁定頁，請先輸入老師或其他裝置給的綁定碼。'),
      h('h2', {}, withForm ? '在另一台裝置綁定過了？' : '輸入綁定碼'),
    ],
    h('p', { class: 'field-hint' }, !withForm && bindHref ? '回到這裡，輸入綁定頁上的 6 位數字。已經在其他裝置綁定過的話，也可以用那台裝置「我的帳號」產生的綁定碼。' : '已經在其他裝置綁定過：到那台裝置的「我的帳號」產生綁定碼，在這裡輸入。'),
    h('div', { class: 'trk-code-row' }, codeIn, btn('綁定', async () => {
      if (!/^\d{6}$/.test(codeIn.value.trim())) return toast('請輸入 6 位數的綁定碼');
      try { await TR.redeemCode(codeIn.value.trim()); done(); } catch (e) { err(e); }
    }, 'secondary')),
    cfg.clientId ? [
      h('h2', {}, withForm || bindHref ? '或用 Google 帳號登入' : '用 Google 帳號登入'),
      h('p', { class: 'field-hint' }, '請選擇學校的帳號，其他 Google 帳號無法綁定。iPhone 主畫面上的 App 按登入沒有反應時，請改用綁定碼。'),
      gbtn,
    ] : null,
  ];
  TR.formInfo().then(async (formUrl) => {
    if (!formBox.isConnected) return;
    if (!formUrl) { formBox.replaceChildren(); bindBox.replaceChildren(...otherWays(false).flat(2).filter(Boolean)); if (cfg.clientId) mountGsi(); return; }
    let href;
    try { href = await TR.startFormPairing(); } catch (e) { formBox.replaceChildren(); bindBox.replaceChildren(...otherWays(false).flat(2).filter(Boolean)); if (cfg.clientId) mountGsi(); return; }
    const open = h('a', { class: 'btn', href, target: '_blank', rel: 'noopener' }, '開啟綁定表單');
    open.addEventListener('click', () => {
      TR.markFormOpened();
      formStatus.replaceChildren(h('p', { class: 'field-hint trk-wait' }, '等待表單送出… 送出後切回這個 App，會自動完成綁定。'));
    });
    formBox.replaceChildren(
      h('h2', {}, '用學校帳號送出綁定表單'),
      h('ol', { class: 'trk-steps' },
        h('li', {}, '按「開啟綁定表單」。'),
        h('li', {}, '確認表單上方顯示的是你的學校帳號（＠' + ((cfg.domain || '').split(',')[0].trim() || '學校網域') + '），不是的話按「切換帳號」。'),
        h('li', {}, '「配對碼」通常已經自動填好；如果是空白，請按下面的「複製配對碼」，回到表單長按貼上（或照著輸入）。'),
        h('li', {}, '按「提交」。'),
        h('li', { class: 'trk-return' }, h('b', {}, '回到這個 App：'), returnHint(), '幾秒內就會出現「綁定完成」。')),
      h('div', { class: 'trk-pair' },
        h('div', {}, h('span', { class: 'trk-k' }, '你的配對碼'), h('b', { class: 'trk-pair-code' }, TR.pairCode())),
        btn('複製配對碼', () => { TR.markFormOpened(); copyText(TR.pairCode(), '已複製配對碼，回到表單貼上'); }, 'secondary small')),
      h('div', { class: 'section-actions', style: { margin: '0' } },
        open,
        btn('我已送出', async () => {
          TR.markFormOpened();
          try { if (await TR.checkFormPairing()) { onPairLinked(); return; } toast('還沒收到表單，請確認已按「提交」，幾秒後再試'); }
          catch (e) { formStatus.replaceChildren(h('div', { class: 'note-box warn' }, TR.errorText(e))); }
        }, 'secondary'),
        btn('複製表單網址', () => { TR.markFormOpened(); copyText(href, '已複製，請貼到瀏覽器的網址列'); }, 'quiet')),
      formStatus,
      h('p', { class: 'field-hint' }, '表單打不開或要求登入的不是學校帳號：按「複製表單網址」，貼到無痕視窗（iPhone Safari 的「私密瀏覽」），只登入學校帳號送出，再回到這個 App 按「我已送出」。'));
    if (TR.pairPending()) formStatus.replaceChildren(h('p', { class: 'field-hint trk-wait' }, '等待表單送出… 送出後回到這個畫面，會自動完成綁定。'));
    bindBox.replaceChildren(...otherWays(true).flat(2).filter(Boolean));
    if (cfg.clientId) mountGsi();
    TR.checkPairNow();
  });
  const mountGsi = () => TR.renderSignIn(gbtn, { onDone: done, onError: (e) => { if (e.code === 'not-configured' || e.code === 'network') gbtn.replaceChildren(h('p', { class: 'field-hint' }, e.code === 'network' ? '無法載入 Google 登入，請確認網路連線。' : TR.errorText(e))); else err(e); } });
}


// ───────── 設定 ─────────
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });
function openSettings() {
  const dlg = h('dialog', { class: 'sheet' });
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.append(h('div', { class: 'sheet-body' },
    h('div', { class: 'sheet-head' }, h('h2', {}, '設定'), btn('完成', close, 'quiet')),
    groupField('學校帳號', h('div', {},
      h('p', { style: { margin: '0 0 8px' } }, TR.account() ? `已綁定 ${TR.account().email}。` : (TR.enabled() ? '還沒綁定。' : '老師還沒完成後台設定。')),
      TR.enabled() ? h('div', { class: 'section-actions', style: { margin: 0 } }, btn(TR.account() ? '我的帳號' : '綁定學校 Google 帳號', () => { close(); accountScreen({}); }, 'secondary')) : null)),
    installEvent ? h('div', { class: 'btn-row one' }, btn('安裝到這台裝置', async () => { installEvent.prompt(); await installEvent.userChoice; installEvent = null; close(); })) : null,
    h('p', { class: 'field-hint' }, `目前版本：${APP_VERSION}`),
    h('div', { class: 'note-box' }, '練習照片只存在這台裝置，不會上傳給老師或任何人；換手機或清除資料後照片會不見，想保留請自己另存到相簿。日誌的文字內容（日期、動作、時間、次數、說明）在綁定學校帳號後送給老師。'),
    h('div', { class: 'section-actions', style: { marginTop: '16px' } }, btn('清除這台裝置的資料', async () => {
      const pending = (await DB.all('entries').catch(() => [])).filter((e) => !e.synced).length;
      if (!confirm(pending ? `還有 ${pending} 筆日誌沒送給老師，清除後會遺失，照片也會一起刪除。確定要清除嗎？` : '要清除這台裝置的日誌、照片和示範暫存嗎？照片只存在這台裝置，清除後無法復原；已送給老師的日誌文字不受影響。')) return;
      await DB.clear('templates'); await DB.clear('entries'); lsSet('index', null); close(); route();
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
// 練習日誌不用自動計時（練習時間由學生自己填寫）
TR.init({ ns: NS, appVersion: APP_VERSION, studentCheck: () => false, onLinked: onPairLinked, onPairError });
window.addEventListener('online', () => syncPending());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncPending(); });
TR.loadConfig().then(() => syncPending());
// 開了綁定表單後 App 被重新開啟：直接回到綁定畫面等候
if (lsGet('started') && !TR.account() && TR.pairPending()) accountScreen({}); else route();
