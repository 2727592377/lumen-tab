// search.js —— 搜索框：多引擎 / 联想 / 历史 / 算式 / 翻译（B1 B3 B4 B5 B6 B7 B8）

import { state, save, pushHistory } from './store.js';
import { $, el, debounce, esc, pick, getJSON, getText, clamp } from './util.js';
import { t } from './i18n.js';

let ctx = null;         // {form, input, suggest, chip, favicon, name, go}
let items = [];         // 当前候选
let active = -1;
let seq = 0;            // 请求序号，防竞态

export function initSearch(refs) {
  ctx = refs;
  const { form, input, suggest, chip } = ctx;

  applySearchStyle();
  renderEngineChip();

  input.addEventListener('input', onInput);
  input.addEventListener('focus', onFocus);
  input.addEventListener('blur', () => setTimeout(() => hideSuggest(), 120));
  input.addEventListener('keydown', onKeydown);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(input.value, { newTab: e.ctrlKey || e.metaKey });
  });
  chip?.addEventListener('click', (e) => { e.preventDefault(); cycleEngine(1); });
  chip?.addEventListener('contextmenu', (e) => { e.preventDefault(); cycleEngine(-1); });

  // Ctrl+K / 焦点快捷键由 background 派发
  document.addEventListener('lumen:focus-search', () => input.focus());
}

export function applySearchStyle() {
  const s = state.cfg.search;
  const hero = $('#hero');
  if (hero) {
    hero.style.setProperty('--search-width', `${s.width}px`);
    hero.style.setProperty('--search-radius', `${s.radius}px`);
    hero.classList.toggle('hidden-search', !s.on);
  }
  const form = ctx?.form;
  if (form) form.style.borderRadius = `${s.radius}px`;
}

export function renderEngineChip() {
  const s = state.cfg.search;
  const eng = state.cfg.engines.find((e) => e.id === s.engine) || state.cfg.engines[0];
  if (!ctx) return;
  if (ctx.name) ctx.name.textContent = eng.name;
  if (ctx.favicon) {
    ctx.favicon.src = `https://www.google.com/s2/favicons?domain=${hostOfEng(eng)}&sz=64`;
    ctx.favicon.onerror = () => { ctx.favicon.style.visibility = 'hidden'; };
  }
  if (ctx.input) ctx.input.placeholder = t('search.placeholder', { engine: eng.name });
}

function hostOfEng(eng) {
  try { return new URL(eng.url.replace('{{q}}', 'x')).host; } catch { return 'bing.com'; }
}

export function setEngine(id) {
  state.cfg.search.engine = id;
  save('cfg');
  renderEngineChip();
}

export function cycleEngine(dir = 1) {
  const list = state.cfg.engines;
  const i = list.findIndex((e) => e.id === state.cfg.search.engine);
  const next = ((i < 0 ? 0 : i) + dir + list.length) % list.length;
  setEngine(list[next].id);
}

function currentEngine() {
  const s = state.cfg.search;
  return state.cfg.engines.find((e) => e.id === s.engine) || state.cfg.engines[0];
}

/* ── 候选列表 ─────────────────────────────────────── */
const onInput = debounce(async () => {
  const q = ctx.input.value.trim();
  if (!q) { showHistory(); return; }
  const list = [];

  // 算式（B5）
  const math = evaluateMath(q);
  if (math !== null) list.push({ kind: 'math', text: q, sub: `= ${math}`, value: String(math) });

  // 翻译（B6）：输入「翻 xxx」或「tr xxx」
  const tm = q.match(/^(?:翻|翻译|tr|translate)[\s:：]+(.+)$/i);
  if (tm) {
    const res = await translate(tm[1]);
    if (res) list.push({ kind: 'trans', text: res, sub: t('search.translateSub'), value: res });
  }

  // 联想（B3）
  const suggests = await fetchSuggest(q);
  for (const s of suggests) list.push({ kind: 'suggest', text: s, value: s });

  // 历史补充（B4）
  const hist = state.hist.filter((h) => h !== q && h.includes(q)).slice(0, 3);
  for (const h of hist) list.push({ kind: 'hist', text: h, value: h });

  items = list.slice(0, 10);
  active = -1;
  renderSuggest();
}, 160);

function onFocus() {
  if (!ctx.input.value.trim()) showHistory();
}

function showHistory() {
  if (!state.cfg.search.history) return hideSuggest();
  items = state.hist.slice(0, 8).map((h) => ({ kind: 'hist', text: h, value: h }));
  active = -1;
  renderSuggest();
}

export function hideSuggest() {
  const box = ctx?.suggest;
  if (!box) return;
  box.classList.remove('open');
  box.innerHTML = '';
  items = [];
  active = -1;
}

function renderSuggest() {
  const box = ctx.suggest;
  if (!box) return;
  if (!items.length) return hideSuggest();
  box.innerHTML = '';
  items.forEach((it, i) => {
    const row = el('div', {
      class: `sg-item${i === active ? ' active' : ''}`,
      'data-i': i,
    }, [
      el('span', { class: 'sg-kind', text: kindGlyph(it.kind) }),
      el('span', { class: 'sg-text', text: it.text }),
      it.sub ? el('span', { class: 'sg-sub', text: it.sub }) : null,
    ]);
    row.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
    box.append(row);
  });
  box.classList.add('open');
}

function kindGlyph(kind) {
  return { math: '=', trans: '译', hist: '⏱', suggest: '🔍' }[kind] || '🔍';
}

function choose(i) {
  const it = items[i];
  if (!it) return;
  if (it.kind === 'math') {
    ctx.input.value = '';
    hideSuggest();
    navigator.clipboard?.writeText(it.value).catch(() => {});
    return;
  }
  if (it.kind === 'trans') {
    ctx.input.value = it.value;
    hideSuggest();
    return;
  }
  submit(it.value, {});
}

export function submit(q, { newTab = false } = {}) {
  q = String(q || '').trim();
  if (!q) return;
  hideSuggest();
  pushHistory(q);
  const eng = currentEngine();
  const url = eng.url.replace('{{q}}', encodeURIComponent(q));
  if (newTab) window.open(url, '_blank');
  else window.location.href = url;
  ctx.input.value = '';
}

/* ── 联想接口 ─────────────────────────────────────── */
async function fetchSuggest(q) {
  const eng = currentEngine();
  if (!state.cfg.search.suggest || !eng.suggest) return [];
  const url = eng.suggest.replace('{{q}}', encodeURIComponent(q));
  const my = ++seq;
  try {
    const text = await getText(url, 1500);
    if (my !== seq) return [];
    return parseSuggest(text, eng.suggestType || 'osjson');
  } catch {
    return [];
  }
}

function parseSuggest(text, type) {
  try {
    if (type === 'osjson') {
      const j = JSON.parse(text);
      const arr = Array.isArray(j) ? j[1] : [];
      return (arr || []).slice(0, 8).map(String);
    }
    if (type === 'baidu') {
      const m = text.match(/\[([\s\S]*?)\]/);
      if (!m) return [];
      return JSON.parse(m[0]).slice(0, 8).map(String);
    }
    if (type === 'bili') {
      const j = JSON.parse(text);
      const arr = j?.result?.tag || [];
      return arr.slice(0, 8).map((x) => String(x.name || x.value || x)).filter(Boolean);
    }
    if (type === 'zhihu') {
      const j = JSON.parse(text);
      return (j || []).slice(0, 8).map((x) => x[0] || x.query || '').filter(Boolean);
    }
  } catch {
    return [];
  }
  return [];
}

/* ── 算式求值（B5）── 不用 eval，手写一个四则/幂/百分号解析器 ── */
export function evaluateMath(input) {
  const src = String(input).trim()
    .replace(/[，,]/g, '')
    .replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
    .replace(/\s+/g, '');
  if (!/^[-+*/^%().\d]+$/.test(src)) return null;
  if (!/[-+*/^%]/.test(src)) return null;       // 纯数字不算算式
  if (!/\d/.test(src)) return null;
  try {
    const v = new Parser(src).parse();
    if (!Number.isFinite(v)) return null;
    return fmtNum(v);
  } catch {
    return null;
  }
}

function fmtNum(v) {
  if (Number.isInteger(v)) return String(v);
  const r = Math.round(v * 1e10) / 1e10;
  return String(r);
}

class Parser {
  constructor(src) { this.s = src; this.i = 0; }
  parse() {
    const v = this.expr();
    if (this.i < this.s.length) throw new Error('trailing');
    return v;
  }
  peek() { return this.s[this.i]; }
  expr() {
    let v = this.term();
    while (['+', '-'].includes(this.peek())) {
      const op = this.s[this.i++];
      const r = this.term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  term() {
    let v = this.power();
    while (['*', '/', '%'].includes(this.peek())) {
      const op = this.s[this.i++];
      const r = this.power();
      if (op === '*') v *= r;
      else if (op === '/') v /= r;
      else v %= r;
    }
    return v;
  }
  power() {
    const base = this.unary();
    if (this.peek() === '^') { this.i++; return Math.pow(base, this.power()); }
    return base;
  }
  unary() {
    if (this.peek() === '-') { this.i++; return -this.unary(); }
    if (this.peek() === '+') { this.i++; return this.unary(); }
    return this.atom();
  }
  atom() {
    if (this.peek() === '(') {
      this.i++;
      const v = this.expr();
      if (this.peek() !== ')') throw new Error('paren');
      this.i++;
      return v;
    }
    const m = /^\d+(\.\d+)?/.exec(this.s.slice(this.i));
    if (!m) throw new Error('num');
    this.i += m[0].length;
    return parseFloat(m[0]);
  }
}

/* ── 翻译（B6）：MyMemory 免费接口，无需 key ── */
export async function translate(text) {
  const q = String(text || '').trim();
  if (!q) return '';
  const zh = /[\u4e00-\u9fff]/.test(q);
  const pair = zh ? 'zh-CN|en' : 'en|zh-CN';
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${pair}`;
    const j = await getJSON(url, 4000);
    const out = j?.responseData?.translatedText || '';
    return out && out.toLowerCase() !== q.toLowerCase() ? out : '';
  } catch {
    return '';
  }
}

/* ── 键盘 ─────────────────────────────────────────── */
function onKeydown(e) {
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    cycleEngine(e.shiftKey ? -1 : 1);
    return;
  }
  if (e.key === 'ArrowDown' && items.length) {
    e.preventDefault();
    active = (active + 1) % items.length;
    renderSuggest();
    return;
  }
  if (e.key === 'ArrowUp' && items.length) {
    e.preventDefault();
    active = (active - 1 + items.length) % items.length;
    renderSuggest();
    return;
  }
  if (e.key === 'Escape') { hideSuggest(); return; }
  if (e.key === 'Enter' && active >= 0 && items[active]) {
    e.preventDefault();
    choose(active);
  }
}
