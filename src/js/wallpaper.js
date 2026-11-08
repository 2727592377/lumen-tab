// wallpaper.js —— 壁纸：纯色 / 渐变 / 本地图片 / 必应每日 / 定时轮换（A1 A2 A3 A4 A7 A8）

import { state, setWall, save, emit } from './store.js';
import { shrinkImage, toast, sleep, clamp } from './util.js';
import { t } from './i18n.js';

const LAYER = () => document.getElementById('bg-layer');
const SCRIM = () => document.getElementById('bg-scrim');

let rotateTimer = null;

/** 把当前壁纸配置渲染到背景层 */
export function applyWallpaper() {
  const layer = LAYER();
  const scrim = SCRIM();
  if (!layer) return;
  const w = state.wall;
  const light = document.documentElement.dataset.theme === 'light';
  const g1 = light ? (w.g1Light || '#e9eef7') : (w.g1 || '#1b2b4b');
  const g2 = light ? (w.g2Light || '#f8fafc') : (w.g2 || '#0a0d12');

  layer.style.backgroundImage = 'none';
  layer.style.backgroundColor = light ? '#eef1f6' : 'transparent';
  layer.style.filter = '';
  layer.style.transform = '';

  if (w.blur) {
    layer.style.filter = `blur(${w.blur}px) saturate(1.05)`;
    layer.style.transform = 'scale(1.04)';   // 模糊后边缘露白，放大一点盖住
  }

  if (w.type === 'solid') {
    layer.style.backgroundColor = w.solid || (light ? '#eef1f6' : '#0b0f14');
  } else if (w.type === 'gradient') {
    layer.style.backgroundImage = `linear-gradient(${w.angle || 145}deg, ${g1}, ${g2})`;
  } else if (w.type === 'image' || w.type === 'bing') {
    const url = currentImageUrl();
    if (url) {
      layer.style.backgroundImage = `url("${url}")`;
      layer.style.backgroundSize = w.fit === 'contain' ? 'contain' : 'cover';
      layer.style.backgroundPosition = 'center';
      layer.style.backgroundRepeat = 'no-repeat';
    } else if (w.type === 'bing') {
      layer.style.backgroundImage = `linear-gradient(${w.angle || 145}deg, ${g1}, ${g2})`;
      ensureBing().catch(() => {});
    }
  }

  if (scrim) {
    scrim.style.background = light
      ? `rgba(255,255,255,${clamp(w.dimLight ?? 0.35, 0, 0.9)})`
      : `rgba(0,0,0,${clamp(w.dim ?? 0.18, 0, 0.85)})`;
  }
}

function currentImageUrl() {
  const w = state.wall;
  if (w.type === 'image') {
    const list = w.images || [];
    if (!list.length) return '';
    const i = ((w.imgIndex || 0) % list.length + list.length) % list.length;
    return list[i];
  }
  if (w.type === 'bing') return w.bingCache?.url || '';
  return '';
}

/** 必应每日图（A4）：官方接口，无需 key */
export async function ensureBing() {
  const today = new Date().toISOString().slice(0, 10);
  const w = state.wall;
  if (w.bingCache?.date === today && w.bingCache?.url) return w.bingCache.url;
  try {
    const r = await fetch('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN', { cache: 'no-store' });
    const j = await r.json();
    const img = j?.images?.[0];
    if (!img) throw new Error('no image');
    const base = img.urlbase?.startsWith('http') ? img.urlbase : `https://www.bing.com${img.urlbase}`;
    const url = `${base}_UHD.jpg`;
    setWall({ bingCache: { date: today, url, copyright: img.copyright || '' } }, { silent: true });
    save('wall');
    if (state.wall.type === 'bing') applyWallpaper();
    return url;
  } catch (e) {
    console.warn('bing failed', e);
    return '';
  }
}

/** 切换壁纸类型（设置面板调用） */
export function setWallType(type) {
  setWall({ type });
  if (type === 'bing') ensureBing().catch(() => {});
  applyWallpaper();
  emit('wall:changed');
}

/** 本地图片：加进来之前先压到 2560px / JPEG 0.82，免得 storage 爆炸（A3） */
export async function addLocalImages(files, { max = 2560, quality = 0.82 } = {}) {
  const imgs = [...files].filter((f) => /^image\//.test(f.type));
  if (!imgs.length) return 0;
  const out = [];
  for (const f of imgs) {
    try {
      const data = await shrinkImage(f, max, quality);
      if (data) out.push(data);
    } catch (e) {
      console.warn('shrink failed', f.name, e);
    }
  }
  if (!out.length) return 0;
  const images = [...(state.wall.images || []), ...out];
  setWall({ type: 'image', images, imgIndex: 0 });
  applyWallpaper();
  toast(t('wall.added', { n: out.length }));
  return out.length;
}

export function removeLocalImage(index) {
  const images = [...(state.wall.images || [])];
  images.splice(index, 1);
  setWall({ images, imgIndex: 0 });
  applyWallpaper();
}

export function nextImage(step = 1) {
  const list = state.wall.images || [];
  if (!list.length) return;
  const i = (((state.wall.imgIndex || 0) + step) % list.length + list.length) % list.length;
  setWall({ imgIndex: i });
  applyWallpaper();
}

/**
 * 定时轮换（A7）：every = 'hour' | 'day' | 'startup' | 'none'
 * 用 setInterval 每分钟探一次，而不是长 setTimeout，避免系统休眠把定时器冻住。
 */
export function startRotation() {
  clearInterval(rotateTimer);
  const rot = state.wall.rotate || {};
  if (!rot.on || rot.every === 'none') return;

  const last = Number(rot.lastTs || 0);
  const now = Date.now();
  const due = rot.every === 'hour' ? 3600e3 : rot.every === 'day' ? 86400e3 : 0;
  if (rot.every === 'startup' && now - last > 60e3) tickRotation(true);
  else if (due && now - last >= due) tickRotation(true);

  rotateTimer = setInterval(() => {
    const r = state.wall.rotate || {};
    if (!r.on) return;
    const gap = r.every === 'hour' ? 3600e3 : r.every === 'day' ? 86400e3 : Infinity;
    if (Date.now() - Number(r.lastTs || 0) >= gap) tickRotation(false);
  }, 60_000);
}

async function tickRotation(initial) {
  const rot = state.wall.rotate || {};
  if (rot.source === 'bing') {
    await ensureBing();
    await sleep(120);
    if (state.wall.type === 'bing') applyWallpaper();
  } else if (rot.source === 'local') {
    if ((state.wall.images || []).length > 1) nextImage(1);
  } else if (rot.source === 'gradient') {
    // 随机渐变：色相在暗色区抖动
    const h = Math.floor(Math.random() * 360);
    const g1 = hslToHex(h, 42, 22);
    const g2 = hslToHex((h + 40) % 360, 38, 8);
    setWall({ type: 'gradient', g1, g2, angle: 120 + Math.floor(Math.random() * 90) });
    applyWallpaper();
  }
  setWall({ rotate: { ...(state.wall.rotate || {}), lastTs: Date.now() } }, { silent: true });
  save('wall');
  emit('wall:changed');
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

/** 从一张图片里取一组配色，做「按壁纸取主题色」（F2 的可选联动） */
export async function paletteFromWallpaper(url) {
  if (!url) return null;
  try {
    const img = await loadImage(url);
    const c = document.createElement('canvas');
    const n = 32;
    c.width = n; c.height = n;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, n, n);
    const { data } = ctx.getImageData(0, 0, n, n);
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const pr = data[i], pg = data[i + 1], pb = data[i + 2];
      const lum = (0.2126 * pr + 0.7152 * pg + 0.0722 * pb) / 255;
      if (lum < 0.1 || lum > 0.92) continue;
      r += pr; g += pg; b += pb; count++;
    }
    if (!count) return null;
    return rgbToHex(r / count, g / count, b / count);
  } catch {
    return null;
  }
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

function rgbToHex(r, g, b) {
  const to = (x) => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
