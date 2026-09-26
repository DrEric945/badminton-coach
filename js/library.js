// 共享示範影片庫
// 示範資料放在 GitHub 專案的 library/ 資料夾，和網頁一起由 GitHub Pages 提供。
//  - 學生：直接讀取網站上的 library/index.json，不需要任何帳號。
//  - 老師：用 GitHub 權杖（token）透過 GitHub API 把新示範寫入專案，GitHub Pages 約 1 分鐘內更新。
import { LIBRARY } from './config.js';

const API = 'https://api.github.com';
const DIR = 'library';

export function repoInfo() {
  if (LIBRARY && LIBRARY.owner && LIBRARY.repo) return { owner: LIBRARY.owner, repo: LIBRARY.repo, branch: LIBRARY.branch || 'main' };
  const host = location.hostname;
  if (host.endsWith('.github.io')) {
    const owner = host.slice(0, -'.github.io'.length);
    const seg = location.pathname.split('/').filter(Boolean)[0];
    const repo = seg && !seg.includes('.') ? seg : `${owner}.github.io`;
    return { owner, repo, branch: (LIBRARY && LIBRARY.branch) || 'main' };
  }
  return null;
}

export function getToken() { try { return localStorage.getItem('swing-coach-gh-token') || ''; } catch { return ''; } }
export function setToken(t) { try { if (t) localStorage.setItem('swing-coach-gh-token', t.trim()); else localStorage.removeItem('swing-coach-gh-token'); } catch { /* 無痕模式 */ } }

function apiHeaders(token, raw = false) {
  return {
    Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function api(path, { token, method = 'GET', body, raw = false } = {}) {
  const res = await fetch(API + path, {
    method, cache: 'no-store',
    headers: { ...apiHeaders(token, raw), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = new Error(`GitHub API ${res.status}`);
    err.status = res.status;
    try { err.detail = (await res.json()).message; } catch { /* 沒有內容 */ }
    throw err;
  }
  return raw ? res : res.json();
}

const emptyIndex = () => ({ version: 1, updatedAt: 0, templates: [] });

// 讀取示範清單。有老師權杖時走 GitHub API（立即是最新）；學生讀網站上的檔案（部署後約 1 分鐘更新）。
export async function fetchIndex() {
  const token = getToken(), r = repoInfo();
  if (token && r) {
    try {
      const res = await api(`/repos/${r.owner}/${r.repo}/contents/${DIR}/index.json?ref=${r.branch}`, { token, raw: true });
      return await res.json();
    } catch (e) {
      if (e.status === 404) return emptyIndex();
      console.warn('用 API 讀取示範清單失敗，改讀網站檔案', e);
    }
  }
  const res = await fetch(`${DIR}/index.json?t=${Date.now()}`, { cache: 'no-store' });
  if (res.status === 404) return emptyIndex();
  if (!res.ok) throw new Error('index ' + res.status);
  return res.json();
}

// 下載單一示範的完整資料與影片
export async function fetchTemplate(entry, onProgress) {
  const token = getToken(), r = repoInfo();
  const getFile = async (path) => {
    if (token && r) {
      try { return await api(`/repos/${r.owner}/${r.repo}/contents/${path}?ref=${r.branch}`, { token, raw: true }); }
      catch (e) { console.warn('API 下載失敗，改讀網站檔案', e); }
    }
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`下載 ${path} 失敗（${res.status}）`);
    return res;
  };
  if (onProgress) onProgress('下載示範資料…');
  const tpl = await (await getFile(entry.data)).json();
  if (entry.video) { if (onProgress) onProgress('下載示範影片…'); tpl.video = await (await getFile(entry.video)).blob(); }
  if (entry.demoVideo) { if (onProgress) onProgress('下載示範影片…'); tpl.demoVideo = await (await getFile(entry.demoVideo)).blob(); }
  tpl.remote = true;
  tpl.rev = entry.rev || tpl.createdAt;
  return tpl;
}

const blobToBase64 = (b) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).split(',')[1] || '');
  fr.onerror = rej;
  fr.readAsDataURL(b);
});
const textToBase64 = (s) => blobToBase64(new Blob([s], { type: 'application/json' }));
const extOf = (blob) => {
  const t = (blob && blob.type) || '';
  if (t.includes('mp4')) return 'mp4';
  if (t.includes('webm')) return 'webm';
  if (t.includes('quicktime')) return 'mov';
  return 'mp4';
};

// 用 Git Data API 一次提交多個檔案（新增與刪除），影片最大 100 MB
async function commitFiles({ put = [], del = [], message, token, mutateIndex, onProgress }) {
  const r = repoInfo();
  if (!r) throw Object.assign(new Error('找不到 GitHub 專案資訊'), { code: 'no-repo' });
  const base = `/repos/${r.owner}/${r.repo}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ref = await api(`${base}/git/ref/heads/${r.branch}`, { token });
    const headSha = ref.object.sha;
    const commit = await api(`${base}/git/commits/${headSha}`, { token });
    let index;
    try { index = await (await api(`${base}/contents/${DIR}/index.json?ref=${headSha}`, { token, raw: true })).json(); }
    catch (e) { if (e.status === 404) index = emptyIndex(); else throw e; }
    const nextIndex = mutateIndex(index) || index;
    nextIndex.updatedAt = Date.now();
    const tree = [];
    let n = 0;
    for (const f of put) {
      n++;
      if (onProgress) onProgress(`上傳檔案 ${n}/${put.length + 1}…`);
      const content = f.blob ? await blobToBase64(f.blob) : await textToBase64(f.text);
      const blob = await api(`${base}/git/blobs`, { token, method: 'POST', body: { content, encoding: 'base64' } });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    if (onProgress) onProgress('更新示範清單…');
    const idxBlob = await api(`${base}/git/blobs`, { token, method: 'POST', body: { content: await textToBase64(JSON.stringify(nextIndex)), encoding: 'base64' } });
    tree.push({ path: `${DIR}/index.json`, mode: '100644', type: 'blob', sha: idxBlob.sha });
    for (const p of del) tree.push({ path: p, mode: '100644', type: 'blob', sha: null });
    const newTree = await api(`${base}/git/trees`, { token, method: 'POST', body: { base_tree: commit.tree.sha, tree } });
    const newCommit = await api(`${base}/git/commits`, { token, method: 'POST', body: { message, tree: newTree.sha, parents: [headSha] } });
    try {
      await api(`${base}/git/refs/heads/${r.branch}`, { token, method: 'PATCH', body: { sha: newCommit.sha } });
      return nextIndex;
    } catch (e) {
      if (attempt === 0 && (e.status === 422 || e.status === 409)) continue; // 同時有其他更新，重試一次
      throw e;
    }
  }
}

function entryOf(t, files) {
  return {
    id: t.id, type: t.type, name: t.name, sport: t.sport, hand: t.hand, view: t.view || null,
    poster: t.poster || null, createdAt: t.createdAt, rev: Date.now(), ...files,
  };
}

export async function publishTemplate(t, onProgress) {
  const token = getToken();
  if (!token) throw Object.assign(new Error('尚未設定 GitHub 權杖'), { code: 'no-token' });
  const { video, demoVideo, remote, rev, ...rest } = t;
  void remote; void rev;
  const files = { data: `${DIR}/${t.id}.json` };
  const put = [{ path: files.data, text: JSON.stringify(rest) }];
  if (video) { files.video = `${DIR}/${t.id}.${extOf(video)}`; put.push({ path: files.video, blob: video }); }
  if (demoVideo) { files.demoVideo = `${DIR}/${t.id}-demo.${extOf(demoVideo)}`; put.push({ path: files.demoVideo, blob: demoVideo }); }
  const entry = entryOf(t, files);
  const del = [];
  const index = await commitFiles({
    put, del, token, onProgress, message: `新增示範：${t.name}`,
    mutateIndex: (idx) => {
      const old = idx.templates.find((x) => x.id === t.id);
      del.length = 0;
      if (old) [old.data, old.video, old.demoVideo].forEach((p) => { if (p && !put.some((f) => f.path === p)) del.push(p); });
      idx.templates = [entry, ...idx.templates.filter((x) => x.id !== t.id)];
      return idx;
    },
  });
  return { entry, index };
}

export async function unpublishTemplate(id, onProgress) {
  const token = getToken();
  if (!token) throw Object.assign(new Error('尚未設定 GitHub 權杖'), { code: 'no-token' });
  let del = [];
  const r = repoInfo();
  // 先讀清單找出要刪的檔案
  const idx = await (await api(`/repos/${r.owner}/${r.repo}/contents/${DIR}/index.json?ref=${r.branch}`, { token, raw: true })).json();
  const old = idx.templates.find((x) => x.id === id);
  if (old) del = [old.data, old.video, old.demoVideo].filter(Boolean);
  return commitFiles({
    del, token, onProgress, message: '刪除示範',
    mutateIndex: (i) => { i.templates = i.templates.filter((x) => x.id !== id); return i; },
  });
}

// 檢查權杖是否能寫入這個專案
export async function testToken(token) {
  const r = repoInfo();
  if (!r) return { ok: false, msg: '目前的網址不是 GitHub Pages，無法判斷專案。請在 js/config.js 設定 LIBRARY。' };
  try {
    const repo = await api(`/repos/${r.owner}/${r.repo}`, { token });
    if (repo.permissions && repo.permissions.push === false) return { ok: false, msg: '這個權杖沒有寫入權限。請確認 Contents 權限設為 Read and write。' };
    return { ok: true, msg: `可以寫入 ${r.owner}/${r.repo}` };
  } catch (e) {
    if (e.status === 401) return { ok: false, msg: '權杖無效或已過期，請重新產生。' };
    if (e.status === 404) return { ok: false, msg: `找不到專案 ${r.owner}/${r.repo}，或權杖沒有被授權存取這個專案。` };
    return { ok: false, msg: '連線失敗：' + (e.detail || e.message) };
  }
}
