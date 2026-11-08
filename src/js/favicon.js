// favicon.js —— 网站图标解析与降级（C3 / C4 / C5 / C6）
//
// 关键在于「诚实」：几乎所有图标服务对不认识的域名都会返回一张占位图，
// <img> 拿它当成功加载（错误事件根本不会触发），结果就是一排灰色圆球。
// 所以这里不靠 <img> 的 onerror，而是用 fetch 亲自取一遍：
//   · 状态码不是 2xx          → 这个源没有图标
//   · 返回的不是 image/*      → 这个源在拿 HTML 骗人
//   · 体积小于 200 字节       → 基本是占位图 / 空白图
// 只有通过的 URL 才交给 <img> 去显示；全都不通过就落到文字图标。

import { hostOf, colorFromString, el, safeColor } from './util.js';
import { state } from './store.js';

const CACHE_KEY = 'lumen.iconCache';
const TTL_OK = 7 * 24 * 3600 * 1000;
const TTL_NONE = 24 * 3600 * 1000;
const MIN_BYTES = 200;

/**
 * 站点图标的四种来源（写在 site.icon 里）：
 *   {kind:'favicon'}            在线抓取
 *   {kind:'url', value:'...'}   自定义图片地址（图标库 / iTab 导入）
 *   {kind:'data', value:'...'}  用户上传（C5，dataURL）
 *   {kind:'letter', value:'', color:'#..'}  文字图标（C6）
 */
export function faviconCandidates(site, size = 128) {
  const icon = site.icon || {};
  if (icon.kind === 'data' && icon.value) return [icon.value];
  if (icon.kind === 'url' && icon.value) return [icon.value];
  const host = hostOf(site.url);
  if (!host) return [];
  const provider = state.cfg.iconProvider || 'auto';
  const ddg = `https://icons.duckduckgo.com/ip3/${host}.ico`;
  const g = `https://www.google.com/s2/favicons?domain=${host}&sz=${size >= 64 ? 128 : 64}`;
  const direct = `https://${host}/favicon.ico`;
  if (icon.kind === 'favicon' && icon.value) return [icon.value];
  if (provider === 'google') return [g, ddg, direct];
  if (provider === 'duckduckgo') return [ddg, direct];
  if (provider === 'direct') return [direct];
  // auto：DuckDuckGo 命中率最高，其次站点自己的 /favicon.ico；Google 放最后不用
  return [ddg, direct];
}

/* ── 缓存 ───────────────────────────────────────────── */

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// 图标判定逻辑一改（比如发现 DDG 会对 404 返回占位图），
// 旧版本缓存里的错误结论就得作废——升这个号即可整体清空。
const CACHE_VER = '2';

function ensureCacheVersion() {
  try {
    const key = CACHE_KEY + '.v';
    if (localStorage.getItem(key) !== CACHE_VER) {
      localStorage.removeItem(CACHE_KEY);
      localStorage.setItem(key, CACHE_VER);
      return true;
    }
  } catch { /* 隐私模式不让写就算了 */ }
  return false;
}

let cache = ensureCacheVersion() ? {} : readCache();
let cacheDirty = false;

function cacheGet(key) {
  const hit = cache[key];
  if (!hit) return undefined;
  const ttl = hit.url ? TTL_OK : TTL_NONE;
  if (Date.now() - hit.t > ttl) {
    delete cache[key];
    cacheDirty = true;
    return undefined;
  }
  return hit.url || '';
}

function cacheSet(key, url) {
  cache[key] = { url: url || '', t: Date.now() };
  cacheDirty = true;
}

export function flushIconCache() {
  if (!cacheDirty) return;
  cacheDirty = false;
  try {
    // 只留最近 400 条，免得 localStorage 无限膨胀
    const entries = Object.entries(cache).sort((a, b) => b[1].t - a[1].t).slice(0, 400);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* 满了就算了，下次再写 */ }
}

export function clearIconCache() {
  cache = {};
  cacheDirty = true;
  flushIconCache();
}

/* ── 探测 ───────────────────────────────────────────── */

// 同时在跑的探测最多 4 个：浏览器对单个域名只有 6 条连接，
// 67 个站点一起轰 icons.duckduckgo.com 会把排队时间拖成超时。
const MAX_PROBES = 4;
let probing = 0;
const probeQueue = [];

function limited(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      probing += 1;
      fn().then(resolve, reject).finally(() => {
        probing -= 1;
        const next = probeQueue.shift();
        if (next) next();
      });
    };
    if (probing < MAX_PROBES) run();
    else probeQueue.push(run);
  });
}

/** 这个 URL 真的是个图标吗？ */
async function verify(url) {
  try {
    const ctl = new AbortController();
    // 67 个图标同时探测会挤爆每域名 6 条连接的上限，超时就全废了。4 秒足够。
    const timer = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(url, {
      referrerPolicy: 'no-referrer',
      cache: 'force-cache',
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const type = res.headers.get('content-type') || '';
    if (!/^image\//i.test(type)) return false;
    const buf = await res.arrayBuffer();
    return buf.byteLength >= MIN_BYTES;
  } catch {
    return false;
  }
}

/**
 * 找出第一个「真」图标地址。
 * fetch 被拦（比如在 http:// 预览里没有 host 权限）时整条链都验不过，
 * 这时退回「直接交给 <img> 试」的老办法，预览里也能看到图。
 */
async function resolveIcon(site, size) {
  const host = hostOf(site.url);
  if (!host) return '';
  const key = `${host}|${state.cfg.iconProvider || 'auto'}`;

  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const cands = faviconCandidates(site, size);
  if (!cands.length) {
    cacheSet(key, '');
    return '';
  }

  return limited(async () => {
    let verified = false;
    for (const url of cands) {
      if (await verify(url)) {
        cacheSet(key, url);
        return url;
      }
      verified = true;
    }

    // fetch 一个都没过：可能是权限问题，改用 <img> 兜底（不写缓存）。
    // 但只在 http/file 预览里兜底 —— 扩展里 DDG 的 404 响应体本身就是一张
    // 灰色占位图，<img> 会把它当成功，等于把「没有图标」画成「有图标」。
    const preview = !/^(moz|chrome)-extension:$/.test(location.protocol);
    if (verified && preview) {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      const ok = await new Promise((res) => {
        img.onload = () => res(img.naturalWidth > 0);
        img.onerror = () => res(false);
        img.src = cands[0];
      });
      if (ok) return cands[0];
    }

    cacheSet(key, '');
    return '';
  });
}

/* ── 文字图标 ───────────────────────────────────────── */

/** 文字图标的字：中文取第一个汉字，英文取首字母（最多两个字符） */
export function letterOf(site) {
  const n = String(site.name || '').trim();
  if (site.icon && site.icon.kind === 'letter' && site.icon.value) return site.icon.value.slice(0, 2);
  if (!n) return '?';
  const cjk = n.match(/[\u3400-\u9fff]/);
  if (cjk) return cjk[0];
  const word = n.replace(/[^\p{L}\p{N}]/gu, ' ').trim();
  const first = word.split(/\s+/)[0] || n;
  return first.slice(0, 2).toUpperCase();
}

export function letterColor(site) {
  return safeColor(site.icon?.color) || colorFromString(hostOf(site.url) || site.name || 'lumen');
}

/** 把一个图标盒子画成文字图标（CSS 里叫 .letter） */
function paintLetter(box, site, size) {
  box.classList.add('letter');
  box.classList.remove('has-img');
  box.style.background = letterColor(site);
  box.textContent = letterOf(site);
  box.style.fontSize = `${Math.round(size * 0.42)}px`;
  return box;
}

/* ── 对外 ───────────────────────────────────────────── */

/**
 * 生成图标元素：先立刻画出文字图标（不闪烁、不占位空白），
 * 探测到真图标后再淡入换上。
 */
export function makeIcon(site, { size = 44, radius = 14 } = {}) {
  const box = el('span', {
    class: 'site-icon',
    style: { width: `${size}px`, height: `${size}px`, borderRadius: `${radius}px` },
  });
  paintLetter(box, site, size);

  // 固定了图标（上传 / 自定义 / 指定 favicon）的，直接显示，不用探测
  const icon = site.icon || {};
  if (icon.kind === 'data' && icon.value) return paintImage(box, site, icon.value, size);
  if (icon.kind === 'url' && icon.value) return paintImage(box, site, icon.value, size);

  resolveIcon(site, size).then((url) => {
    if (!url || !box.isConnected) return;
    paintImage(box, site, url, size);
  });

  return box;
}

function paintImage(box, site, url, size) {
  // 别用 loading="lazy"：首屏之外的图标永远不会进入视口，
  // img 不加载 → 永远只有文字图标（这是「一屏图标全是字」的真凶）。
  const img = el('img', {
    alt: '',
    loading: 'eager',
    decoding: 'async',
    referrerpolicy: 'no-referrer',
    src: url,
  });
  img.addEventListener('load', () => {
    if (img.naturalWidth === 0) return;
    box.classList.add('has-img');
    box.classList.remove('letter');
    box.textContent = '';
    box.append(img);
    box.style.background = 'transparent';
  }, { once: true });
  img.addEventListener('error', () => {
    // 指定了地址却打不开 → 显示文字图标
    paintLetter(box, site, size);
  }, { once: true });
  return box;
}

/** 预热：把当前桌面上的图标提前探一遍 */
/** 调试用：看探测队列有没有堵住 */
export function iconProbeStats() {
  return { probing, queued: probeQueue.length, cached: Object.keys(cache).length };
}

export { resolveIcon };

export function prefetchIcons(sites) {
  (sites || []).slice(0, 120).forEach((s, i) => {
    setTimeout(() => resolveIcon(s, 64), i * 60);
  });
  setTimeout(flushIconCache, 1200);
}
