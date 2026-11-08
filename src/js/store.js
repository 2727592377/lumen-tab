// store.js —— 数据层：本地存储、同步、备份、导入导出。
// 所有状态集中在这里，界面只读 state、调用 mutation 方法。

import { uid, normalizeUrl, toast } from './util.js';
import { t } from './i18n.js';

const api = globalThis.browser ?? globalThis.chrome;
const HAS_EXT = !!(api && api.storage && api.storage.local);

/* ── 本地存储：有扩展 API 用扩展，没有就退化成 localStorage（方便离线预览） ── */
const KV = HAS_EXT
  ? {
      async get(key, fallback) {
        const o = await api.storage.local.get(key);
        return o[key] === undefined ? fallback : o[key];
      },
      async set(key, val) { await api.storage.local.set({ [key]: val }); },
      async remove(key) { await api.storage.local.remove(key); },
      async all() { return api.storage.local.get(null); },
    }
  : {
      async get(key, fallback) {
        const raw = localStorage.getItem('lumen.' + key);
        return raw == null ? fallback : JSON.parse(raw);
      },
      async set(key, val) { localStorage.setItem('lumen.' + key, JSON.stringify(val)); },
      async remove(key) { localStorage.removeItem('lumen.' + key); },
      async all() {
        const out = {};
        for (const k of Object.keys(localStorage)) if (k.startsWith('lumen.')) out[k.slice(6)] = JSON.parse(localStorage.getItem(k));
        return out;
      },
    };

export const isExtension = HAS_EXT;

/* ── 默认状态 ─────────────────────────────────────────── */
export const BUILTIN_ENGINES = [
  { id: 'bing', name: 'Bing', url: 'https://cn.bing.com/search?q={{q}}', suggest: 'https://api.bing.com/osjson.aspx?query={{q}}&language=zh-CN', suggestType: 'osjson' },
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q={{q}}', suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&q={{q}}&hl=zh-CN', suggestType: 'osjson' },
  { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd={{q}}', suggest: 'https://suggestion.baidu.com/su?wd={{q}}&cb=cb', suggestType: 'baidu' },
  { id: 'ddg', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={{q}}', suggest: '', suggestType: '' },
  { id: 'yandex', name: 'Yandex', url: 'https://yandex.com/search/?text={{q}}', suggest: '', suggestType: '' },
  { id: 'github', name: 'GitHub', url: 'https://github.com/search?q={{q}}', suggest: '', suggestType: '' },
  { id: 'bilibili', name: '哔哩哔哩', url: 'https://search.bilibili.com/all?keyword={{q}}', suggest: 'https://s.search.bilibili.com/main/suggest?term={{q}}', suggestType: 'bili' },
  { id: 'zhihu', name: '知乎', url: 'https://www.zhihu.com/search?q={{q}}', suggest: 'https://www.zhihu.com/api/v4/search/suggest?q={{q}}', suggestType: 'zhihu' },
];

export const DEFAULT_CFG = {
  v: 1,
  locale: 'zh',
  theme: 'auto',
  accent: '#6aa8ff',
  accent2: '#a17bff',
  iconProvider: 'auto',     // auto | google | duckduckgo | direct
  iconDirect: false,
  font: 'system',
  uiScale: 1,
  anim: true,
  radius: 18,
  customCSS: '',
  layout: {
    mode: 'grid',
    cols: 0,             // 0 = 自动
    iconSize: 62,
    gapX: 22,
    gapY: 26,
    labelLines: 1,
    align: 'center',
    iconRadius: 18,
    maxWidth: 1120,
    railWidth: 340,
  },
  search: {
    on: true,
    engine: 'bing',
    width: 600,
    radius: 999,
    suggest: true,
    history: true,
    math: true,
    fade: true,
  },
  engines: BUILTIN_ENGINES,
  widgetOrder: [],
  widgets: [],
  groups: [],
  activeGroup: 'all',
  sync: {
    firefox: false,
    webdav: { on: false, url: '', user: '', pass: '', path: 'lumen-backup.json' },
  },
  ai: { endpoint: '', key: '', model: '' },
  known: { tips: {} },
};

export const DEFAULT_WALL = {
  // 默认用必应每日一图（iTab 就是这个默认）；取不到时 wallpaper.js 会退回渐变
  type: 'bing',
  solid: '#0b0f14',
  g1: '#1b2b4b',
  g2: '#0a0d12',
  angle: 145,
  images: [],          // dataURL[]
  imgIndex: 0,
  fit: 'cover',
  blur: 0,
  dim: 0.30,
  rotate: { on: true, source: 'bing', every: 'day' },
  bingCache: { date: '', url: '' },
};

/* ── 事件总线 ─────────────────────────────────────────── */
const bus = new EventTarget();
export function on(evt, fn) { bus.addEventListener(evt, fn); return () => bus.removeEventListener(evt, fn); }
export function emit(evt, detail) { bus.dispatchEvent(new CustomEvent(evt, { detail })); }

/* ── 状态 ─────────────────────────────────────────────── */
export const state = {
  cfg: structuredClone(DEFAULT_CFG),
  sites: [],
  folders: [],
  wall: structuredClone(DEFAULT_WALL),
  hist: [],
};

let _dirty = {};
let saveTimer = null;

function sameStore(sites) {
  // 迁移前的数据里常见嵌套分组；这里统一扁平化
  return sites;
}

export async function load() {
  const [cfg, sites, folders, wall, hist] = await Promise.all([
    KV.get('cfg', null),
    KV.get('sites', null),
    KV.get('folders', null),
    KV.get('wall', null),
    KV.get('hist', []),
  ]);
  state.cfg = deepMerge(structuredClone(DEFAULT_CFG), cfg || {});
  // 引擎表必须补齐内置的（升级时新加的引擎要出现）
  state.cfg.engines = mergeEngines(state.cfg.engines);
  state.sites = sameStore(Array.isArray(sites) ? sites : []);
  state.folders = Array.isArray(folders) ? folders : [];
  state.wall = deepMerge(structuredClone(DEFAULT_WALL), wall || {});
  state.hist = Array.isArray(hist) ? hist : [];
  return state;
}

function mergeEngines(list) {
  const byId = new Map((list || []).map((e) => [e.id, e]));
  for (const b of BUILTIN_ENGINES) if (!byId.has(b.id)) byId.set(b.id, b);
  return [...byId.values()];
}

function deepMerge(base, extra) {
  if (Array.isArray(base)) return Array.isArray(extra) ? extra : base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    for (const [k, v] of Object.entries(extra || {})) {
      out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? deepMerge(base[k] && typeof base[k] === 'object' ? base[k] : {}, v) : v;
    }
    return out;
  }
  return extra === undefined ? base : extra;
}

/** 标记某个存储键需要写盘（合并同一帧内的多次修改） */
export function save(key = 'cfg') {
  _dirty[key] = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 220);
}

export async function flush() {
  const jobs = [];
  for (const k of Object.keys(_dirty)) {
    if (k === 'cfg') jobs.push(KV.set('cfg', state.cfg));
    else if (k === 'sites') jobs.push(KV.set('sites', state.sites));
    else if (k === 'folders') jobs.push(KV.set('folders', state.folders));
    else if (k === 'wall') jobs.push(KV.set('wall', state.wall));
    else if (k === 'hist') jobs.push(KV.set('hist', state.hist));
  }
  _dirty = {};
  try {
    await Promise.all(jobs);
  } catch (e) {
    console.error(e);
    toast(t('err.storage'));
  }
}

window.addEventListener('pagehide', () => { flush(); });

/* ── 网站 ─────────────────────────────────────────────── */
export function sitesOf(group = state.cfg.activeGroup) {
  let list = state.sites;
  if (group && group !== 'all') list = list.filter((s) => s.group === group);
  // 文件夹里的网站不直接显示在主网格
  return list.filter((s) => !s.folder).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function folderSites(folderId) {
  return state.sites.filter((s) => s.folder === folderId);
}

export function groupsFlat() {
  return [{ id: 'all', name: t('group.all') }, ...state.cfg.groups];
}

export function addSite({ name, url, group = 'all', icon = null }) {
  const s = {
    id: uid('s'),
    name: name || hostGuess(url),
    url: normalizeUrl(url),
    group: state.cfg.activeGroup === 'all' ? group : group,
    folder: null,
    order: state.sites.length,
    icon: icon || { kind: 'favicon', value: '' },
  };
  state.sites.push(s);
  save('sites');
  emit('sites');
  return s;
}

export function updateSite(id, patch) {
  const s = state.sites.find((x) => x.id === id);
  if (!s) return;
  Object.assign(s, patch);
  save('sites');
  emit('sites');
}

export function removeSite(id) {
  state.sites = state.sites.filter((s) => s.id !== id);
  save('sites');
  emit('sites');
}

export function reorderSites(ids) {
  ids.forEach((id, i) => {
    const s = state.sites.find((x) => x.id === id);
    if (s) { s.order = i; }
  });
  save('sites');
  emit('sites');
}

export function hostGuess(url) {
  try { return new URL(normalizeUrl(url)).host.replace(/^www\./, ''); } catch { return url; }
}

/* ── 文件夹 ───────────────────────────────────────────── */
export function addFolder(name, group = state.cfg.activeGroup) {
  const f = { id: uid('f'), name: name || t('folder.new'), group, order: state.folders.length };
  state.folders.push(f);
  save('folders');
  emit('sites');
  return f;
}

export function removeFolder(id) {
  state.sites.forEach((s) => { if (s.folder === id) s.folder = null; });
  state.folders = state.folders.filter((f) => f.id !== id);
  save('folders'); save('sites');
  emit('sites');
}

/* ── 分组 ─────────────────────────────────────────────── */
export function addGroup(name) {
  const g = { id: uid('g'), name: name || t('group.new'), order: state.cfg.groups.length };
  state.cfg.groups.push(g);
  save('cfg');
  emit('groups');
  return g;
}

export function renameGroup(id, name) {
  const g = state.cfg.groups.find((x) => x.id === id);
  if (g) { g.name = name; save('cfg'); emit('groups'); }
}

export function removeGroup(id) {
  state.cfg.groups = state.cfg.groups.filter((g) => g.id !== id);
  state.sites.forEach((s) => { if (s.group === id) s.group = 'all'; });
  if (state.cfg.activeGroup === id) state.cfg.activeGroup = 'all';
  save('cfg'); save('sites');
  emit('groups'); emit('sites');
}

export function setActiveGroup(id) {
  state.cfg.activeGroup = id;
  save('cfg');
  emit('group:changed');
}

/* ── 搜索历史 ─────────────────────────────────────────── */
export function pushHistory(q) {
  if (!state.cfg.search.history || !q) return;
  state.hist = [q, ...state.hist.filter((x) => x !== q)].slice(0, 60);
  save('hist');
}

/* ── 组件 ─────────────────────────────────────────────── */
export function addWidget(type, patch = {}) {
  const def = {
    id: uid('w'),
    type,
    size: 'medium',
    order: state.cfg.widgets.length,
    x: 60 + (state.cfg.widgets.length % 3) * 30,
    y: 160 + (state.cfg.widgets.length % 4) * 24,
    w: 320,
    h: 0,
    cfg: {},
  };
  const w = { ...def, ...patch };
  state.cfg.widgets.push(w);
  save('cfg');
  emit('widgets');
  return w;
}

export function updateWidget(id, patch) {
  const w = state.cfg.widgets.find((x) => x.id === id);
  if (!w) return;
  Object.assign(w, patch);
  save('cfg');
  emit('widgets:update');
}

export function updateWidgetCfg(id, cfgPatch) {
  const w = state.cfg.widgets.find((x) => x.id === id);
  if (!w) return;
  w.cfg = { ...(w.cfg || {}), ...cfgPatch };
  save('cfg');
  emit('widgets:update');
}

export function removeWidget(id) {
  state.cfg.widgets = state.cfg.widgets.filter((w) => w.id !== id);
  save('cfg');
  emit('widgets');
}

/* ── 备份（G3） ───────────────────────────────────────── */
const BACKUP_MAX = 10;

export async function makeBackup(label = 'auto') {
  const snap = snapshot();
  const list = await KV.get('backups', []);
  list.unshift({ ts: Date.now(), label, size: JSON.stringify(snap).length, data: snap });
  const trimmed = list.slice(0, BACKUP_MAX);
  await KV.set('backups', trimmed);
  emit('backups');
  return trimmed;
}

export async function getBackups() {
  return KV.get('backups', []);
}

export async function restoreBackup(ts) {
  const list = await KV.get('backups', []);
  const b = list.find((x) => x.ts === ts);
  if (!b) throw new Error('backup not found');
  applySnapshot(b.data);
}

export async function clearBackups() {
  await KV.remove('backups');
  emit('backups');
}

/* ── 快照 ─────────────────────────────────────────────── */
export function snapshot() {
  return {
    app: 'lumen',
    v: 1,
    ts: Date.now(),
    cfg: state.cfg,
    sites: state.sites,
    folders: state.folders,
    wall: { ...state.wall, bingCache: { date: '', url: '' } },
  };
}

export function applySnapshot(snap) {
  if (!snap || typeof snap !== 'object') throw new Error('bad snapshot');
  if (snap.cfg) state.cfg = deepMerge(structuredClone(DEFAULT_CFG), snap.cfg);
  if (Array.isArray(snap.sites)) state.sites = snap.sites;
  if (Array.isArray(snap.folders)) state.folders = snap.folders;
  if (snap.wall) state.wall = deepMerge(structuredClone(DEFAULT_WALL), snap.wall);
  save('cfg'); save('sites'); save('folders'); save('wall');
  flush();
  emit('loaded');
}

export async function clearAll() {
  await Promise.all(['cfg', 'sites', 'folders', 'wall', 'hist'].map((k) => KV.remove(k)));
  state.cfg = structuredClone(DEFAULT_CFG);
  state.sites = [];
  state.folders = [];
  state.wall = structuredClone(DEFAULT_WALL);
  state.hist = [];
  emit('loaded');
}

/* ── 壁纸存取（单独一个键，避免每次改设置都重写大图） ── */
export function setWall(patch, { silent = false } = {}) {
  Object.assign(state.wall, patch);
  save('wall');
  if (!silent) emit('wall');
}

/* ── Firefox 同步（G4）：分片塞进 storage.sync ───────── */
const SYNC_META = 'lumen.sync.meta';
const SYNC_CHUNK = 6000;   // 单个 item 上限 8KB，留余量

function syncApi() { return (api && api.storage && api.storage.sync) || null; }

export async function firefoxSyncPush() {
  const s = syncApi();
  if (!s) throw new Error('no storage.sync');
  const bundle = { cfg: state.cfg, sites: state.sites, folders: state.folders, ts: Date.now() };
  const json = JSON.stringify(bundle);
  const chunks = [];
  for (let i = 0; i < json.length; i += SYNC_CHUNK) chunks.push(json.slice(i, i + SYNC_CHUNK));
  const old = (await s.get(null)) || {};
  const data = {};
  chunks.forEach((c, i) => (data['lumen.sync.' + i] = c));
  data[SYNC_META] = { chunks: chunks.length, ts: bundle.ts, v: 1 };
  const toRemove = Object.keys(old).filter((k) => k.startsWith('lumen.sync.') && !(k in data));
  await s.set(data);
  if (toRemove.length) await s.remove(toRemove);
  return { chunks: chunks.length, bytes: json.length };
}

export async function firefoxSyncPull() {
  const s = syncApi();
  if (!s) throw new Error('no storage.sync');
  const all = (await s.get(null)) || {};
  const meta = all[SYNC_META];
  if (!meta) throw new Error('nothing synced yet');
  let json = '';
  for (let i = 0; i < meta.chunks; i++) json += all['lumen.sync.' + i] || '';
  const bundle = JSON.parse(json);
  applySnapshot({ ...bundle, wall: state.wall });
  return { ts: bundle.ts, sites: bundle.sites?.length || 0 };
}

/* ── WebDAV（G6） ───────────────────────────────────── */
function davUrl(cfg) {
  let u = String(cfg.url || '').trim();
  if (!u) throw new Error('empty url');
  if (!/\/$/.test(u)) u += '/';
  const p = String(cfg.path || 'lumen-backup.json').replace(/^\/+/, '');
  return u + encodeURI(p);
}

function davAuth(cfg) {
  if (!cfg.user) return {};
  return { Authorization: 'Basic ' + btoa(unescape(encodeURIComponent(`${cfg.user}:${cfg.pass || ''}`))) };
}

export async function webdavTest(cfg) {
  const r = await fetch(davUrl(cfg), { method: 'PROPFIND', headers: { ...davAuth(cfg), Depth: '0' } });
  if (!r.ok && r.status !== 207) throw new Error('HTTP ' + r.status);
  return true;
}

export async function webdavUpload(cfg) {
  const body = JSON.stringify(snapshot());
  const r = await fetch(davUrl(cfg), {
    method: 'PUT',
    headers: { ...davAuth(cfg), 'Content-Type': 'application/json' },
    body,
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return body.length;
}

export async function webdavDownload(cfg) {
  const r = await fetch(davUrl(cfg), { headers: { ...davAuth(cfg) } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const snap = JSON.parse(await r.text());
  applySnapshot(snap);
  return snap;
}

/* ── 导入 iTab 数据（C11） ─────────────────────────── */
export function importItab(json) {
  // iTab 导出结构并不完全公开，这里尽量宽松地兼容几种常见形态
  const root = typeof json === 'string' ? JSON.parse(json) : json;
  const buckets = [];
  const walk = (node, depth = 0) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
      if (node.some((x) => x && (x.url || x.link || x.href))) buckets.push(node);
      node.forEach((n) => walk(n, depth + 1));
      return;
    }
    if (typeof node === 'object') {
      if (Array.isArray(node.sites) || Array.isArray(node.icons) || Array.isArray(node.list)) {
        const arr = node.sites || node.icons || node.list;
        buckets.push(arr);
      }
      for (const v of Object.values(node)) walk(v, depth + 1);
    }
  };
  walk(root);
  let n = 0;
  const seen = new Set(state.sites.map((s) => normalizeUrl(s.url)));
  for (const arr of buckets) {
    for (const item of arr) {
      const url = normalizeUrl(item.url || item.link || item.href || item.src || '');
      if (!url || seen.has(url)) continue;
      seen.add(url);
      state.sites.push({
        id: uid('s'),
        name: item.name || item.title || item.text || hostGuess(url),
        url,
        group: 'all',
        folder: null,
        order: state.sites.length,
        icon: item.icon || item.logo || item.img
          ? { kind: 'url', value: String(item.icon || item.logo || item.img) }
          : { kind: 'favicon', value: '' },
      });
      n++;
    }
  }
  save('sites');
  emit('sites');
  return n;
}

/* ── 导入 Firefox 书签（C10 / H3） ────────────────── */
export async function importBookmarks() {
  if (!api?.bookmarks) throw new Error('no bookmarks API');
  const tree = await api.bookmarks.getTree();
  let n = 0;
  const seen = new Set(state.sites.map((s) => normalizeUrl(s.url)));

  const add = (url, title, group) => {
    const u = normalizeUrl(url);
    if (!/^https?:/i.test(u) || seen.has(u)) return;
    seen.add(u);
    state.sites.push({
      id: uid('s'), name: title || hostGuess(u), url: u, group, folder: null,
      order: state.sites.length, icon: { kind: 'favicon', value: '' },
    });
    n++;
  };

  const walk = (node, group) => {
    for (const child of node.children || []) {
      if (child.url) add(child.url, child.title, group);
      else if (child.children) {
        let g = group;
        if (child.title && !['menu________', 'toolbar_____', 'unfiled_____', 'mobile______'].includes(child.id)) {
          // 书签栏的一级文件夹 → 一个分组
          g = state.cfg.groups.find((x) => x.name === child.title)?.id
            || addGroup(child.title).id;
        }
        walk(child, g);
      }
    }
  };

  for (const root of tree) walk(root, 'all');
  save('sites'); save('cfg');
  emit('sites'); emit('groups');
  return n;
}

/* ── 导入 / 导出文件（G2） ─────────────────────────── */
export async function exportText() {
  return JSON.stringify(snapshot(), null, 2);
}

export function importSnapshotText(text) {
  const snap = JSON.parse(text);
  const before = state.sites.length;
  applySnapshot(snap);
  return state.sites.length;
}

/* ── 首次启动骨架 ─────────────────────────────────── */
export async function boot(firstRunCb) {
  const existed = await KV.get('cfg', null);
  await load();
  if (!existed) {
    // 全新安装：把内嵌的 Nebula 迁移数据铺上去
    try {
      const res = await fetch(new URL('../data/nebula-seed.json', import.meta.url));
      if (res.ok) {
        const seed = await res.json();
        if (seed?.sites?.length) {
          state.sites = seed.sites.map((s, i) => ({
            id: uid('s'),
            name: s.name,
            url: normalizeUrl(s.url),
            group: 'all',
            folder: null,
            order: i,
            icon: s.color ? { kind: 'letter', value: '', color: s.color } : { kind: 'favicon', value: '' },
          }));
          state.cfg.widgets = defaultWidgets();
          state.cfg.widgetOrder = state.cfg.widgets.map((w) => w.id);
          await flush();
          save('sites'); save('cfg');
          await flush();
          firstRunCb?.(state.sites.length);
        }
      }
    } catch (e) { console.warn('seed failed', e); }
  }
  if (!state.cfg.widgets.length && !existed) {
    state.cfg.widgets = defaultWidgets();
  }
  return state;
}

export function defaultWidgets() {
  const mk = (type, size, order) => ({
    id: uid('w'), type, size, order, x: 80, y: 180 + order * 40, w: 320, h: 0, cfg: {},
  });
  return [
    mk('clock', 'small', 0),
    mk('trends', 'medium', 1),
    mk('todo', 'medium', 2),
    mk('note', 'medium', 3),
  ];
}
