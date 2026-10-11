// 練習紀錄：把學生的比對次數與練習時間送到老師的 Google 試算表
//  - 身分：學生用學校 Google 帳號登入一次，後台驗證後發給這台裝置一把金鑰
//  - 練習時間：只在練習相關畫面、App 在前景、而且 2 分鐘內有操作時才累計
//  - 離線：紀錄先存在裝置上，連上網路後自動補送
import * as CFG from './config.js'; // 舊版 config.js 沒有 TRACKING 也能正常運作
import * as L from './library.js';

let NS = 'swing-coach';
let APP = '';
const K = (k) => `${NS}-trk-${k}`;
const get = (k, d = null) => { try { const v = localStorage.getItem(K(k)); return v == null ? d : JSON.parse(v); } catch { return d; } };
const set = (k, v) => { try { if (v == null) localStorage.removeItem(K(k)); else localStorage.setItem(K(k), JSON.stringify(v)); } catch { /* 無痕模式 */ } };
const listeners = new Set();
const emit = () => listeners.forEach((f) => { try { f(); } catch (e) { console.warn(e); } });
export const onChange = (f) => { listeners.add(f); return () => listeners.delete(f); };

// ───────── 設定 ─────────
let cfg = null;
function fromConfigJs() {
  const t = CFG.TRACKING || {};
  return t.endpoint ? { endpoint: t.endpoint, bindUrl: t.bindUrl || '', clientId: t.clientId || '', domain: t.domain || '' } : null;
}
export function config() { return cfg || get('config') || fromConfigJs(); }
export function enabled() { const c = config(); return !!(c && c.endpoint); }
export async function loadConfig() {
  try {
    const s = await L.fetchSettings();
    const t = s && s.tracking && s.tracking.endpoint ? s.tracking : fromConfigJs();
    cfg = t; set('config', t); emit();
  } catch (e) {
    console.warn('讀取練習紀錄設定失敗，使用上次的設定', e);
  }
  return config();
}

// ───────── 帳號 ─────────
export const account = () => get('account');
export function profile() { return get('profile', { className: '', studentId: '' }); }
export function setProfile(p) {
  set('profile', { className: String(p.className || '').trim(), studentId: String(p.studentId || '').trim() });
  set('profileDirty', true);
  emit();
}
// 把班級學號送給老師（還沒練習的學生也會出現在老師的名單中）
export async function syncProfile() {
  const a = account();
  if (!a || !get('profileDirty')) return;
  await post({ action: 'profile', deviceKey: a.deviceKey, profile: profile() });
  set('profileDirty', null);
}
function setAccount(a, prof) {
  set('account', a ? { email: a.email, name: a.name, deviceKey: a.deviceKey, linkedAt: Date.now() } : null);
  if (prof && (prof.className || prof.studentId)) {
    const cur = profile();
    set('profile', { className: cur.className || prof.className || '', studentId: cur.studentId || prof.studentId || '' });
  }
  if (a && !profile().studentId) {
    const local = a.email.split('@')[0];
    if (/\d/.test(local)) set('profile', { ...profile(), studentId: local });
  }
  if (a) set('profileDirty', true);
  emit();
}
const device = () => (navigator.userAgent.match(/iPhone|iPad|Android|Windows|Macintosh|Linux/) || ['其他'])[0];

async function post(body) {
  const c = config();
  if (!c || !c.endpoint) throw Object.assign(new Error('尚未設定練習紀錄後台'), { code: 'not-configured' });
  const res = await fetch(c.endpoint, {
    method: 'POST', body: JSON.stringify(body), redirect: 'follow', keepalive: body.action === 'record' && JSON.stringify(body).length < 60000,
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 簡單請求，避免跨網域預檢
  });
  if (!res.ok) throw Object.assign(new Error('後台回應 ' + res.status), { code: 'http' });
  const json = await res.json();
  if (!json.ok) throw Object.assign(new Error(json.message || json.error), { code: json.error, email: json.email });
  return json;
}

export function errorText(e) {
  const c = e && e.code;
  if (c === 'wrong-domain') return `「${e.email || '這個帳號'}」不是學校的帳號，請改用學校的 Google 帳號登入。`;
  if (c === 'bad-token') return 'Google 登入驗證失敗，請再試一次。';
  if (c === 'bad-code') return '綁定碼不正確或已過期（10 分鐘內有效），請重新產生。';
  if (c === 'too-many') return '嘗試次數太多，請等 1 分鐘再試。';
  if (c === 'not-configured') return '老師還沒完成練習紀錄後台的設定。';
  if (c === 'bad-key') return '這台裝置的綁定已失效，請重新登入。';
  if (c === 'form-not-verified') return '綁定表單沒有收集「經過驗證」的信箱，請老師檢查表單設定。';
  return '連不上練習紀錄後台，請確認網路後再試。';
}

let gsiPromise = null;
function loadGsi() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
  if (!gsiPromise) {
    gsiPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gsiPromise = null; reject(new Error('gsi')); };
      document.head.append(s);
    });
  }
  return gsiPromise;
}

// 在 container 裡放「使用 Google 帳號登入」按鈕
export async function renderSignIn(container, { onDone, onError } = {}) {
  const c = config();
  if (!c || !c.clientId) { onError && onError(Object.assign(new Error(), { code: 'not-configured' })); return; }
  try { await loadGsi(); } catch { onError && onError(Object.assign(new Error(), { code: 'network' })); return; }
  const hd = (c.domain || '').split(',')[0].trim();
  window.google.accounts.id.initialize({
    client_id: c.clientId,
    hd: hd || undefined,
    ux_mode: 'popup',
    auto_select: false,
    callback: async (resp) => {
      try {
        const r = await post({ action: 'link', idToken: resp.credential, device: device() });
        setAccount(r, r.profile);
        flush();
        onDone && onDone(account());
      } catch (e) { onError && onError(e); }
    },
  });
  container.replaceChildren();
  window.google.accounts.id.renderButton(container, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', locale: 'zh-TW', width: Math.min(320, container.clientWidth || 300) });
}

// ───────── 綁定表單（學生用學校帳號送出 Google 表單） ─────────
let pairInfo = null;
export async function formInfo() {
  const c = config();
  if (!c || !c.endpoint) return null;
  if (pairInfo && pairInfo.endpoint === c.endpoint) return pairInfo.url;
  try {
    const res = await fetch(`${c.endpoint}?action=pairinfo&t=${Date.now()}`, { redirect: 'follow' });
    const j = await res.json();
    pairInfo = { endpoint: c.endpoint, url: (j && j.ok && j.formUrl) || null };
  } catch { return null; }
  return pairInfo.url;
}
const PAIR_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newPairCode() {
  const a = new Uint8Array(8); // 8 碼：表單沒自動帶入時，學生也能手動貼上或輸入
  crypto.getRandomValues(a);
  return Array.from(a, (x) => PAIR_CHARS[x % PAIR_CHARS.length]).join('');
}
// 產生（或沿用 30 分鐘內的）配對碼，回傳已填好配對碼的表單網址
export async function startFormPairing() {
  const url = await formInfo();
  if (!url) throw Object.assign(new Error(), { code: 'not-configured' });
  let p = get('pair');
  if (!p || Date.now() - p.at > 25 * 60 * 1000) { p = { code: newPairCode(), at: Date.now() }; set('pair', p); }
  return url.replace('PAIRCODE', p.code);
}
export const pairCode = () => { const p = get('pair'); return p ? p.code : ''; };
export const pairPending = () => { const p = get('pair'); return !!(p && p.opened && Date.now() - p.at < 30 * 60 * 1000); };
export function markFormOpened() { const p = get('pair'); if (p) set('pair', { ...p, opened: true }); }
// 詢問後台：表單送出了嗎？送出了就完成綁定，回傳帳號；還沒就回傳 null
export async function checkFormPairing() {
  const p = get('pair');
  if (!p) return null;
  let r;
  try { r = await post({ action: 'pairCheck', code: p.code, device: device() }); }
  catch (e) { if (e.code && e.code !== 'http' && e.code !== 'network') set('pair', null); throw e; }
  if (r.status !== 'linked') return null;
  set('pair', null);
  setAccount(r, r.profile);
  flush();
  return account();
}
export function cancelFormPairing() { set('pair', null); }
// 背景詢問：學生送出表單後回到 App（即使 App 被重新開啟）也能自動完成綁定
let pairHooks = {}, pairBusy = false;
async function pairTick() {
  if (pairBusy || account() || !pairPending() || document.visibilityState !== 'visible' || !navigator.onLine) return;
  pairBusy = true;
  try { const a = await checkFormPairing(); if (a && pairHooks.onLinked) pairHooks.onLinked(a); }
  catch (e) { if (pairHooks.onError) pairHooks.onError(e); }
  finally { pairBusy = false; }
}
export const checkPairNow = pairTick;

export async function redeemCode(code) {
  const r = await post({ action: 'redeem', code, device: device() });
  setAccount(r, r.profile);
  flush();
  return account();
}
export async function issueCode() {
  const a = account();
  if (!a) throw Object.assign(new Error(), { code: 'bad-key' });
  try { return await post({ action: 'code', deviceKey: a.deviceKey }); }
  catch (e) { if (e.code === 'bad-key') setAccount(null); throw e; }
}
export async function unlink() {
  const a = account();
  if (a) { try { await post({ action: 'unlink', deviceKey: a.deviceKey }); } catch (e) { console.warn(e); } }
  setAccount(null);
}

// ───────── 紀錄佇列 ─────────
const MAX_QUEUE = 500;
export const queue = () => get('queue', []);
const uid = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
function enqueue(rec) {
  const q = queue();
  q.push({ id: uid(), at: new Date().toISOString(), app: APP, ...rec });
  while (q.length > MAX_QUEUE) q.shift();
  set('queue', q);
  emit();
}
let flushing = null;
export function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    const a = account();
    if (!a || !enabled() || !navigator.onLine) return;
    try { await syncProfile(); } catch (e) { if (e.code === 'bad-key') { setAccount(null); return; } }
    while (true) {
      const q = queue();
      if (!q.length) break;
      const batch = q.slice(0, 50);
      let r;
      try { r = await post({ action: 'record', deviceKey: a.deviceKey, profile: profile(), records: batch }); set('profileDirty', null); }
      catch (e) {
        if (e.code === 'bad-key') setAccount(null);
        break;
      }
      const ok = new Set(r.accepted || []);
      set('queue', queue().filter((x) => !ok.has(x.id)));
      set('lastSync', Date.now());
      emit();
      if (!ok.size) break;
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

// ───────── 練習時間 ─────────
const TICK = 5, IDLE = 120;
let practicing = false, lastActive = Date.now(), timer = null, isStudent = () => true;
export function ping() { lastActive = Date.now(); }
export function setPracticing(on) { practicing = !!on; if (on) ping(); }
export const pendingSeconds = () => get('pendingSec', 0);
export function totalSeconds() { return get('totalSec', 0); }
function addSeconds(s) { set('pendingSec', pendingSeconds() + s); set('totalSec', totalSeconds() + s); }
function takeSeconds() { const s = pendingSeconds(); set('pendingSec', 0); return s; }
function flushTime(min = 60) {
  if (pendingSeconds() >= min) { enqueue({ kind: 'time', practiceSec: takeSeconds() }); flush(); }
}

// 完成一次比對時呼叫
export function logAnalysis({ type, template, score, shots, videoSec, topIssue }) {
  if (!isStudent()) return;
  enqueue({ kind: 'analysis', type, template, score: Math.round(score), shots, videoSec: Math.round((videoSec || 0) * 10) / 10, topIssue: topIssue || '', practiceSec: takeSeconds() });
  flush();
}

export function init({ ns, appVersion, studentCheck, onLinked, onPairError }) {
  NS = ns; APP = appVersion; if (studentCheck) isStudent = studentCheck;
  pairHooks = { onLinked, onError: onPairError };
  setInterval(pairTick, 3000);
  document.addEventListener('visibilitychange', pairTick);
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((ev) => window.addEventListener(ev, ping, { passive: true, capture: true }));
  clearInterval(timer);
  timer = setInterval(() => {
    if (!practicing || !isStudent() || document.visibilityState !== 'visible') return;
    if (Date.now() - lastActive > IDLE * 1000) return;
    addSeconds(TICK);
    if (pendingSeconds() >= 600) flushTime(600); // 練習很久沒有比對時，每 10 分鐘送一次
  }, TICK * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushTime(60); else flush(); });
  window.addEventListener('pagehide', () => flushTime(60));
  window.addEventListener('online', () => flush());
  loadConfig().then(() => flush());
}

export const fmtMinutes = (sec) => {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} 分鐘` : `${Math.floor(m / 60)} 小時 ${m % 60} 分鐘`;
};

// ───────── 老師：讀取全班統計 ─────────
export function teacherKey() { return get('teacherKey', ''); }
export function setTeacherKey(k) { set('teacherKey', k || null); }
export async function teacherSummary({ from = '', to = '' } = {}) {
  const c = config();
  if (!c || !c.endpoint) throw Object.assign(new Error(), { code: 'not-configured' });
  const range = `${from ? '&from=' + from : ''}${to ? '&to=' + to : ''}`;
  const res = await fetch(`${c.endpoint}?action=summary&key=${encodeURIComponent(teacherKey())}${range}&t=${Date.now()}`, { redirect: 'follow' });
  const json = await res.json();
  if (!json.ok) throw Object.assign(new Error(json.error), { code: json.error });
  return json;
}
export async function importRoster(rows) {
  return post({ action: 'roster', key: teacherKey(), rows });
}
export async function pingEndpoint(endpoint) {
  const res = await fetch(`${endpoint}?action=ping&t=${Date.now()}`, { redirect: 'follow' });
  return res.json();
}
