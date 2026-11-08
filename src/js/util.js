// util.js —— 小工具，没有依赖。

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const uid = (p = 'i') =>
  p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const debounce = (fn, ms = 200) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

export const throttle = (fn, ms = 80) => {
  let last = 0, timer = null;
  return (...a) => {
    const now = Date.now();
    const rest = ms - (now - last);
    if (rest <= 0) { last = now; fn(...a); }
    else if (!timer) {
      timer = setTimeout(() => { timer = null; last = Date.now(); fn(...a); }, rest);
    }
  };
};

export function toast(msg, ms = 1900) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => (t.hidden = true), 250);
  }, ms);
}

/** 把用户输入/pasted 的地址补全成合法 URL */
export function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (/^(https?|ftp|moz-extension|file|about|chrome|view-source):/i.test(s)) return s;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(s)) return 'https://' + s;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(s)) return 'http://' + s;
  return 'https://' + s;
}

export function hostOf(url) {
  try { return new URL(normalizeUrl(url)).host; } catch { return ''; }
}

export function originOf(url) {
  try { return new URL(normalizeUrl(url)).origin; } catch { return ''; }
}

/** yyyy-mm-dd / hh:mm:ss 之类的格式化 */
export const pad = (n, w = 2) => String(n).padStart(w, '0');

export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtBytes(n) {
  if (!n && n !== 0) return '–';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return v.toFixed(i ? 1 : 0) + ' ' + u[i];
}

/** 稳健的 fetch + 超时 */
export async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal, credentials: 'omit' });
  } finally {
    clearTimeout(timer);
  }
}

export async function getJSON(url, ms = 8000) {
  const r = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, ms);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

export async function getText(url, ms = 8000) {
  const r = await fetchWithTimeout(url, {}, ms);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

/** JSON 里按 "a.b.0.c" 取值 */
export function pick(obj, path) {
  if (!path) return obj;
  return String(path).split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

/** 极简模板：{{q}} */
export function applyTemplate(tpl, vars) {
  return String(tpl).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => encodeURIComponent(vars[k] ?? ''));
}

export function downloadFile(name, text, type = 'application/json') {
  const blob = new Blob([text], { type: type + ';charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function readFileAsText(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(fr.error);
    fr.readAsText(file, 'utf-8');
  });
}

export function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(file);
  });
}

/** 图片压缩成 dataURL，避免把 5MB 原图塞进 storage */
export function shrinkImage(file, maxSide = 2560, quality = 0.86) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      res(cv.toDataURL('image/webp', quality));
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
    img.src = url;
  });
}

/** iTab / Nebula 里常见的颜色写法统一 */
export function safeColor(c, fallback = '') {
  if (!c) return fallback;
  const s = String(c).trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s;
  if (/^rgba?\([\d\s.,%]+\)$/i.test(s)) return s;
  return fallback;
}

export function colorFromString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return hslToHex(h, 46, 32);
}

/** hsl → #rrggbb（统一输出十六进制，避免 style.background 解析差异） */
export function hslToHex(h, s, l) {
  const S = s / 100, L = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
