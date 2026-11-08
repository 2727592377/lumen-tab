// widgets.js —— 组件注册表：时钟 / 世界时钟 / 热榜 / 待办 / 便签 / 网速 / 翻译 / AI / 电影日历
// 每个组件 = { name, icon, defaultSize, render(body, w, ctx) }，数据一律存在 w.cfg 里。

import { state, addWidget, updateWidget, updateWidgetCfg, removeWidget, save, emit } from './store.js';
import { $, $$, el, uid, debounce, pad, esc, fetchWithTimeout, getJSON, clamp, toast } from './util.js';
import { openMenu, promptDialog, openDialog } from './ui.js';
import { translate } from './search.js';
import { t } from './i18n.js';

/* ── 时钟 ───────────────────────────────────────────── */
const CLOCK_STYLES = ['sans', 'serif', 'mono', 'thin', 'wide', 'italic', 'round', 'condensed'];

function clockRenderer(body, w) {
  const cfg = w.cfg || {};
  const wrap = el('div', { class: `clock-card clock-${cfg.style || 'sans'}` }, [
    el('div', { class: 'clock-time' }, [
      el('span', { class: 'hm' }),
      el('span', { class: 'sec' }),
    ]),
    el('div', { class: 'clock-date' }),
  ]);
  body.append(wrap);
  const tick = () => {
    const now = new Date();
    const hh = pad(cfg.h24 === false ? ((now.getHours() + 11) % 12) + 1 : now.getHours());
    wrap.querySelector('.hm').textContent = `${hh}:${pad(now.getMinutes())}`;
    wrap.querySelector('.sec').textContent = cfg.seconds ? pad(now.getSeconds()) : '';
    wrap.querySelector('.clock-date').textContent = formatDate(now, cfg);
  };
  tick();
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}

function formatDate(d, cfg = {}) {
  const loc = state.cfg.locale === 'en' ? 'en-US' : 'zh-CN';
  const weekday = d.toLocaleDateString(loc, { weekday: 'long' });
  const md = d.toLocaleDateString(loc, { month: 'long', day: 'numeric' });
  return cfg.dateFormat === 'full' ? `${d.getFullYear()}年${md} ${weekday}` : `${md} ${weekday}`;
}

/* ── 世界时钟 ───────────────────────────────────────── */
const DEFAULT_ZONES = [
  { city: '北京', tz: 'Asia/Shanghai' },
  { city: '东京', tz: 'Asia/Tokyo' },
  { city: '伦敦', tz: 'Europe/London' },
  { city: '纽约', tz: 'America/New_York' },
];

function worldClockRenderer(body, w) {
  const cfg = w.cfg || {};
  const zones = cfg.zones || DEFAULT_ZONES;
  const wrap = el('div', { class: 'wc' });
  body.append(wrap);
  const tick = () => {
    wrap.innerHTML = '';
    for (const z of zones) {
      let time = '--:--';
      try {
        time = new Intl.DateTimeFormat(state.cfg.locale === 'en' ? 'en-GB' : 'zh-CN', {
          timeZone: z.tz, hour: '2-digit', minute: '2-digit', hour12: false,
        }).format(new Date());
      } catch { /* 非法时区忽略 */ }
      wrap.append(el('div', { class: 'wc-row' }, [
        el('span', { class: 'wc-city', text: z.city }),
        el('span', { class: 'wc-time', text: time }),
      ]));
    }
  };
  tick();
  const id = setInterval(tick, 10_000);
  return () => clearInterval(id);
}

/* ── 热榜（D10）─────────────────────────────────────── */
// 每个榜单给一串候选地址，按顺序试，谁先返回数据用谁。
// 百度 / B 站有官方公开接口（已验证）；微博、知乎、抖音没有免 key 的官方接口，
// 只能用公开镜像，镜像挂了就明确提示，并且支持用户自己贴一个源。
const HOT_SOURCES = {
  baidu: {
    label: '百度',
    urls: [
      'https://top.baidu.com/api/board?platform=wise&tab=realtime',
      'https://v2.xxapi.cn/api/baiduhot',
    ],
    parse: (j) => {
      const arr = j?.data?.cards?.[0]?.content?.[0]?.content || j?.data || [];
      return arr.map((x) => ({ title: x.word || x.title || x.query, url: x.url || '', hot: x.hotScore || x.hot || '' }));
    },
  },
  bilibili: {
    label: 'B站',
    urls: [
      'https://api.bilibili.com/x/web-interface/popular?ps=20',
      'https://api-hot.imsyy.top/bilibili',
    ],
    parse: (j) => {
      const arr = j?.data?.list || j?.data || [];
      return arr.map((x) => ({
        title: x.title,
        url: x.short_link_v2 || (x.bvid ? `https://www.bilibili.com/video/${x.bvid}` : x.url || ''),
        hot: x?.stat?.view || x.hot || '',
      }));
    },
  },
  weibo: {
    label: '微博',
    // xxapi 是实测可用的免 key 镜像（带 CORS 头）；后面的都是备胎
    urls: [
      'https://v2.xxapi.cn/api/weibohot',
      'https://api.vvhan.com/api/hotlist/wbHot',
      'https://api-hot.imsyy.top/weibo',
    ],
    parse: genericParse,
  },
  zhihu: {
    label: '知乎',
    // 知乎热榜没有公开免 key 接口，只挂镜像；挂了就显示「没拿到数据」
    urls: ['https://api.vvhan.com/api/hotlist/zhihuHot', 'https://api-hot.imsyy.top/zhihu'],
    parse: genericParse,
  },
  douyin: {
    label: '抖音',
    urls: [
      'https://v2.xxapi.cn/api/douyinhot',
      'https://api.vvhan.com/api/hotlist/douyinHot',
      'https://api-hot.imsyy.top/douyin',
    ],
    parse: genericParse,
  },
};

function genericParse(j) {
  const arr = j?.data || j?.list || [];
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => ({
    title: x.title || x.name || x.word || x.query,
    url: x.url || x.mobileUrl || x.link || '',
    hot: x.hot || x.hotValue || x.hotScore || '',
  }));
}

async function fetchHot(type) {
  const src = HOT_SOURCES[type];
  if (!src) return [];
  for (const url of src.urls) {
    try {
      const j = await getJSON(url, 7000);
      const rows = src.parse(j).filter((r) => r.title);
      if (rows.length) return rows;
    } catch { /* 试下一个地址 */ }
  }
  return [];
}

function trendsRenderer(body, w) {
  const cfg = w.cfg || {};
  const type = cfg.source || 'baidu';
  const head = el('div', { class: 'trend-tabs' });
  const list = el('div', { class: 'trend-list trend-scroll' });

  const paint = () => {
    head.innerHTML = '';
    for (const [key, src] of Object.entries(HOT_SOURCES)) {
      const b = el('button', { class: `mini-chip${key === type ? ' active' : ''}`, type: 'button', text: src.label });
      b.addEventListener('click', () => {
        updateWidgetCfg(w.id, { source: key });
        paintList(key);
      });
      head.append(b);
    }
  };

  const paintList = async (which) => {
    list.innerHTML = '';
    list.append(el('div', { class: 'loading-line', text: t('common.loading') }));
    try {
      const rows = await fetchHot(which);
      list.innerHTML = '';
      if (!rows.length) { list.append(el('p', { class: 'hint', text: t('w.trendsEmpty') })); return; }
      rows.slice(0, 20).forEach((r, i) => {
        const a = el('a', { class: 'trend-item', href: r.url || '#', target: '_blank', rel: 'noopener' }, [
          el('span', { class: `idx${i < 3 ? ' top' : ''}`, text: String(i + 1) }),
          el('span', { class: 'txt', text: r.title, title: r.title }),
          r.hot ? el('span', { class: 'heat', text: fmtHot(r.hot) }) : null,
        ]);
        a.addEventListener('click', (e) => {
          if (!r.url) { e.preventDefault(); window.location.href = `https://www.baidu.com/s?wd=${encodeURIComponent(r.title)}`; }
        });
        list.append(a);
      });
    } catch (e) {
      list.innerHTML = '';
      list.append(el('p', { class: 'hint', text: t('w.trendsFail') }),
        el('button', { class: 'btn small', type: 'button', text: t('common.retry'), onclick: () => paintList(which) }));
    }
  };

  paint();
  body.append(head, list);
  paintList(type);
  return () => {};
}

function fmtHot(v) {
  const n = Number(String(v).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || !n) return String(v || '');
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return String(n);
}

/* ── 待办（D4）──────────────────────────────────────── */
function todoRenderer(body, w) {
  const cfg = w.cfg || {};
  const items = cfg.items || [];
  const listEl = el('div', { class: 'todo-list' });
  const input = el('input', { type: 'text', placeholder: t('w.todoAdd') });

  const commit = (next) => updateWidgetCfg(w.id, { items: next });

  const paint = () => {
    listEl.innerHTML = '';
    if (!items.length) listEl.append(el('p', { class: 'hint', text: t('w.todoEmpty') }));
    items.forEach((it, i) => {
      const row = el('div', { class: `todo-item${it.done ? ' done' : ''}` }, [
        el('input', {
          type: 'checkbox', checked: it.done ? '' : null,
          onchange: (e) => {
            items[i].done = e.target.checked;
            commit([...items]);
            paint();
          },
        }),
        el('span', { class: 'txt', text: it.text, title: it.text }),
        it.pri ? el('span', { class: `tag p${it.pri}`, text: it.pri === 2 ? '!!' : '!' }) : null,
        el('button', { class: 'del', type: 'button', text: '✕', onclick: () => {
          items.splice(i, 1);
          commit([...items]);
          paint();
        } }),
      ]);
      listEl.append(row);
    });
  };

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const v = input.value.trim();
    if (!v) return;
    items.push({ id: uid('t'), text: v, done: false, pri: 0, ts: Date.now() });
    input.value = '';
    commit([...items]);
    paint();
  });

  body.append(el('div', { class: 'todo-input' }, [input]), listEl);
  paint();
  return () => {};
}

/* ── 便签（D5）──────────────────────────────────────── */
function noteRenderer(body, w) {
  const area = el('textarea', { class: 'note-area', placeholder: t('w.notePlaceholder'), spellcheck: 'false' });
  area.value = w.cfg?.text || '';
  const saveDebounced = debounce(() => updateWidgetCfg(w.id, { text: area.value }), 400);
  area.addEventListener('input', saveDebounced);
  body.append(area);
  return () => {};
}

/* ── 网速测试（D13）─────────────────────────────────── */
function speedRenderer(body, w) {
  const out = el('div', { class: 'speed' }, [el('div', { class: 'speed-val', text: '—' }), el('div', { class: 'speed-unit', text: 'Mbps' })]);
  const pingLine = el('div', { class: 'hint', text: '' });
  const btn = el('button', { class: 'btn primary small', type: 'button', text: t('w.speedStart') });

  const run = async () => {
    btn.disabled = true;
    out.querySelector('.speed-val').textContent = '…';
    pingLine.textContent = t('w.speedTesting');
    try {
      const t0 = performance.now();
      await fetchWithTimeout('https://speed.cloudflare.com/__down?bytes=0', { cache: 'no-store' }, 5000);
      const ping = Math.round(performance.now() - t0);
      const bytes = 8_000_000;
      const t1 = performance.now();
      const res = await fetchWithTimeout(`https://speed.cloudflare.com/__down?bytes=${bytes}`, { cache: 'no-store' }, 20_000);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = await res.arrayBuffer();
      const sec = (performance.now() - t1) / 1000;
      const mbps = (buf.byteLength * 8) / sec / 1e6;
      out.querySelector('.speed-val').textContent = mbps.toFixed(1);
      pingLine.textContent = `${t('w.speedPing')} ${ping} ms`;
    } catch (e) {
      out.querySelector('.speed-val').textContent = '×';
      pingLine.textContent = t('w.speedFail');
    } finally {
      btn.disabled = false;
    }
  };
  btn.addEventListener('click', run);
  body.append(out, pingLine, btn);
  return () => {};
}

/* ── 翻译（D14）─────────────────────────────────────── */
function translateRenderer(body, w) {
  const src = el('textarea', { class: 'note-area small', placeholder: t('w.translatePlaceholder') });
  const out = el('div', { class: 'trans-out' });
  const btn = el('button', { class: 'btn primary small', type: 'button', text: t('w.translateGo') });
  btn.addEventListener('click', async () => {
    const q = src.value.trim();
    if (!q) return;
    out.textContent = t('common.loading');
    const r = await translate(q);
    out.textContent = r || t('w.translateFail');
  });
  body.append(src, btn, out);
  return () => {};
}

/* ── AI 小组件（D17）────────────────────────────────── */
function aiRenderer(body, w) {
  const cfg = w.cfg || {};
  const msgs = cfg.msgs || [];
  const log = el('div', { class: 'ai-log' });
  const input = el('textarea', { class: 'note-area small', placeholder: t('w.aiPlaceholder'), rows: '2' });
  const btn = el('button', { class: 'btn primary small', type: 'button', text: t('w.aiSend') });

  const paint = () => {
    log.innerHTML = '';
    for (const m of msgs.slice(-8)) {
      log.append(el('div', { class: `ai-msg ${m.role}`, text: m.content }));
    }
    log.scrollTop = log.scrollHeight;
  };

  const send = async () => {
    const q = input.value.trim();
    if (!q) return;
    const ai = state.cfg.ai || {};
    input.value = '';
    msgs.push({ role: 'user', content: q });
    paint();
    const pending = el('div', { class: 'ai-msg assistant', text: t('common.loading') });
    log.append(pending);
    try {
      // 留空就用内置的免 key 服务（Pollinations，OpenAI 兼容）；填了就走自己的
      const base = (ai.endpoint || '').replace(/\/$/, '');
      const url = base
        ? (base.endsWith('/chat/completions') ? base : base + '/chat/completions')
        : 'https://text.pollinations.ai/openai';
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(ai.key ? { Authorization: `Bearer ${ai.key}` } : {}),
        },
        body: JSON.stringify({
          model: ai.model || (base ? 'gpt-4o-mini' : 'openai'),
          messages: msgs.slice(-10).map((m) => ({ role: m.role, content: m.content })),
          stream: false,
        }),
      }, 45_000);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const answer = j?.choices?.[0]?.message?.content || j?.error?.message || t('w.aiFail');
      msgs.push({ role: 'assistant', content: answer });
      updateWidgetCfg(w.id, { msgs: msgs.slice(-20) });
    } catch (e) {
      msgs.push({ role: 'assistant', content: t('w.aiFail') });
    }
    paint();
  };
  btn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  });

  body.append(el('div', { class: 'ai-head' }, [
    el('span', { class: 'hint', text: (state.cfg.ai?.model || t('w.aiNoModel')) }),
    el('button', { class: 'icon-btn tiny', type: 'button', text: '⌫', title: t('w.aiClear'), onclick: () => {
      updateWidgetCfg(w.id, { msgs: [] });
      msgs.length = 0;
      paint();
    } }),
  ]), log, input, btn);
  paint();
  return () => {};
}

/* ── 电影日历（D18）────────────────────────────────── */
// 豆瓣「热门电影」公开接口，免 key（实测 200）。它不发 CORS 头，
// 所以只在扩展里能用（host_permissions 放行），http 预览里会失败——属预期。
async function fetchMovies() {
  const j = await getJSON(
    'https://movie.douban.com/j/search_subjects?type=movie&tag=%E7%83%AD%E9%97%A8&page_limit=20&page_start=0',
    8000,
  );
  const arr = j?.subjects || [];
  return arr.map((x) => ({
    title: x.title,
    desc: `★ ${x.rate || '-'}`,
    cover: x.cover || '',
    url: x.url || '',
    hot: x.rate || '',
  }));
}

function movieRenderer(body, w) {
  const wrap = el('div', { class: 'movie-list' });
  const load = async () => {
    wrap.innerHTML = '';
    wrap.append(el('div', { class: 'loading-line', text: t('common.loading') }));
    try {
      const rows = await fetchMovies();
      wrap.innerHTML = '';
      if (!rows.length) { wrap.append(el('p', { class: 'hint', text: t('w.movieEmpty') })); return; }
      for (const m of rows.slice(0, 8)) {
        const item = el('a', { class: 'movie-item', href: m.url || '#', target: '_blank', rel: 'noopener' }, [
          m.cover ? el('img', { class: 'movie-cover', src: m.cover, alt: '', loading: 'lazy' }) : el('span', { class: 'movie-cover ph' }),
          el('span', { class: 'movie-meta' }, [
            el('span', { class: 'movie-title', text: m.title }),
            el('span', { class: 'movie-sub', text: m.desc }),
          ]),
        ]);
        wrap.append(item);
      }
    } catch {
      wrap.innerHTML = '';
      wrap.append(el('p', { class: 'hint', text: t('w.movieFail') }),
        el('button', { class: 'btn small', type: 'button', text: t('common.retry'), onclick: load }));
    }
  };
  body.append(wrap);
  load();
  return () => {};
}

/* ── 订阅（圈层热点：源你自己填）──────────────────── */
// 为什么是 RSS：圈层站基本没有「热榜」页，但有 RSS/Atom。
// 这个组件只做三件事——抓、解析、按时间排；源挂了自己会显示哪条挂了，不白屏。

function absUrl(u, base) {
  try { return new URL(u, base || location.href).href; } catch { return u || ''; }
}

function textOf(node, sel) {
  try {
    const n = node.querySelector(sel);
    return n ? (n.textContent || '').trim() : '';
  } catch { return ''; }
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 解 RSS 2.0 / Atom，坏文档返回 { error: true } */
function parseFeedXml(xmlText, baseUrl) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) return { error: true, title: '', items: [] };

  const channel = doc.querySelector('channel');
  if (channel) {
    const title = textOf(channel, 'title');
    const items = [...channel.querySelectorAll('item')].map((it) => ({
      title: stripTags(textOf(it, 'title')),
      link: absUrl(textOf(it, 'link') || textOf(it, 'guid'), baseUrl),
      date: textOf(it, 'pubDate') || textOf(it, 'date'),
      desc: stripTags(textOf(it, 'description')).slice(0, 140),
    }));
    return { title, items };
  }

  const feed = doc.querySelector('feed');
  if (feed) {
    const title = textOf(feed, 'title');
    const items = [...feed.querySelectorAll('entry')].map((it) => {
      const linkEl = it.querySelector('link[rel="alternate"]') || it.querySelector('link');
      return {
        title: stripTags(textOf(it, 'title')),
        link: absUrl(linkEl?.getAttribute('href') || '', baseUrl),
        date: textOf(it, 'updated') || textOf(it, 'published'),
        desc: stripTags(textOf(it, 'summary') || textOf(it, 'content')).slice(0, 140),
      };
    });
    return { title, items };
  }
  return { error: true, title: '', items: [] };
}

function timeAgo(s) {
  const ts = Date.parse(s);
  if (!Number.isFinite(ts)) return '';
  const d = Date.now() - ts;
  if (d < 0) return '';
  const m = Math.floor(d / 60000);
  if (m < 1) return t('w.feed.justNow');
  if (m < 60) return t('w.feed.minutes', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('w.feed.hours', { n: h });
  return t('w.feed.days', { n: Math.floor(h / 24) });
}

async function fetchFeed(url) {
  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } }, 9000);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const raw = await res.text();
  const parsed = parseFeedXml(raw, url);
  if (parsed.error) throw new Error('bad feed');
  return parsed;
}

function feedRenderer(body, w) {
  const cfg = w.cfg || {};
  const feeds = Array.isArray(cfg.feeds) ? cfg.feeds : [];
  const list = el('div', { class: 'feed-list trend-scroll' });
  const head = el('div', { class: 'feed-head' }, [
    el('span', { class: 'feed-count', text: '' }),
    el('button', {
      class: 'icon-btn tiny', type: 'button', text: '↻', title: t('w.feed.refresh'),
      onclick: () => { delete w.cfg._cache; load(); },
    }),
    el('button', {
      class: 'icon-btn tiny', type: 'button', text: '＋', title: t('w.feed.add'),
      onclick: () => addFeed(w, load),
    }),
    el('button', {
      class: 'icon-btn tiny', type: 'button', text: '⚙', title: t('w.feed.manage'),
      onclick: () => manageFeeds(w, load),
    }),
  ]);

  const load = async () => {
    list.innerHTML = '';
    if (!feeds.length) {
      list.append(
        el('p', { class: 'hint', text: t('w.feed.empty') }),
        el('p', { class: 'hint dim', text: t('w.feed.hint') }),
        el('button', { class: 'btn small', type: 'button', text: t('w.feed.add'), onclick: () => addFeed(w, load) }),
      );
      head.querySelector('.feed-count').textContent = '';
      return;
    }
    list.append(el('div', { class: 'loading-line', text: t('common.loading') }));
    const results = await Promise.all(feeds.map(async (f) => {
      try {
        const r = await fetchFeed(f.url);
        return { feed: f, ...r, ok: true };
      } catch {
        return { feed: f, ok: false, items: [] };
      }
    }));

    list.innerHTML = '';
    const all = [];
    let failed = 0;
    for (const r of results) {
      if (!r.ok) { failed++; continue; }
      for (const it of r.items) all.push({ ...it, src: r.feed.title || r.title || new URL(feedUrlSafe(r.feed.url)).host });
    }
    all.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
    head.querySelector('.feed-count').textContent = all.length
      ? `${all.length}${failed ? ' · ' + t('w.feed.someFailed', { n: failed }) : ''}`
      : (failed ? t('w.feed.allFailed') : '');
    if (!all.length) {
      list.append(el('p', { class: 'hint', text: t('w.feed.allFailed') }),
        el('button', { class: 'btn small', type: 'button', text: t('common.retry'), onclick: load }));
      return;
    }
    for (const it of all.slice(0, 30)) {
      list.append(el('a', { class: 'feed-item', href: it.link || '#', target: '_blank', rel: 'noopener', title: it.desc || it.title }, [
        el('span', { class: 'feed-title', text: it.title }),
        el('span', { class: 'feed-meta' }, [
          el('span', { class: 'feed-src', text: it.src || '' }),
          it.date ? el('span', { class: 'feed-time', text: timeAgo(it.date) }) : null,
        ]),
      ]));
    }
  };

  body.append(head, list);
  load();
  const timer = setInterval(load, 20 * 60 * 1000);
  return () => clearInterval(timer);
}

function feedUrlSafe(u) {
  try { return new URL(u).href; } catch { return 'https://example.com'; }
}

async function addFeed(w, done) {
  const url = await promptDialog({
    title: t('w.feed.add'),
    label: t('w.feed.url'),
    placeholder: 'https://example.com/feed.xml',
  });
  if (!url) return;
  const clean = absUrl(url.trim());
  w.cfg = w.cfg || {};
  w.cfg.feeds = Array.isArray(w.cfg.feeds) ? w.cfg.feeds : [];
  if (w.cfg.feeds.some((f) => f.url === clean)) { toast(t('w.feed.dup')); return; }
  try {
    const r = await fetchFeed(clean);
    w.cfg.feeds.push({ url: clean, title: r.title || new URL(feedUrlSafe(clean)).host });
    updateWidgetCfg(w.id, { feeds: w.cfg.feeds });
    toast(t('w.feed.added', { n: r.items.length }));
  } catch {
    toast(t('w.feed.fail'));
    return;
  }
  done?.();
}

async function manageFeeds(w, done) {
  const feeds = (w.cfg && w.cfg.feeds) || [];
  const box = el('div', { class: 'feed-manage' });
  if (!feeds.length) box.append(el('p', { class: 'hint', text: t('w.feed.empty') }));
  feeds.forEach((f) => {
    const row = el('div', { class: 'feed-row' }, [
      el('div', { class: 'feed-row-main' }, [
        el('div', { class: 'feed-row-title', text: f.title || f.url }),
        el('div', { class: 'feed-row-url', text: f.url }),
      ]),
      el('button', {
        class: 'btn danger tiny', type: 'button', text: t('common.delete'),
        onclick: () => {
          w.cfg.feeds = feeds.filter((x) => x.url !== f.url);
          updateWidgetCfg(w.id, { feeds: w.cfg.feeds });
          row.remove();
        },
      }),
    ]);
    box.append(row);
  });
  box.append(el('button', {
    class: 'btn small', type: 'button', text: t('w.feed.add'),
    onclick: async () => {
      const url = await promptDialog({ title: t('w.feed.add'), label: t('w.feed.url'), placeholder: 'https://…' });
      if (!url) return;
      try {
        const clean = absUrl(url.trim());
        const r = await fetchFeed(clean);
        w.cfg.feeds = [...((w.cfg && w.cfg.feeds) || []), { url: clean, title: r.title || feedUrlSafe(clean) }];
        updateWidgetCfg(w.id, { feeds: w.cfg.feeds });
        toast(t('w.feed.added', { n: r.items.length }));
      } catch { toast(t('w.feed.fail')); }
    },
  }));
  openDialog({ title: t('w.feed.manage'), body: box, okText: t('common.done'), onOk: () => { done?.(); return true; } });
}

/* ── 注册表（E4 五种尺寸）──────────────────────────── */
/* ── 组件尺寸（E4）：五档，网格里改最小高度，自由布局里改默认宽度 ── */
export const SIZE_KEYS = ['xs', 'small', 'medium', 'large', 'xl'];
const SIZE_WIDTH = { xs: 240, small: 280, medium: 320, large: 420, xl: 520 };

export const WIDGETS = {
  clock: { name: 'w.clock', icon: '🕒', sizes: SIZE_KEYS, render: clockRenderer, label: () => t('w.clock') },
  worldclock: { name: 'w.worldclock', icon: '🌍', sizes: SIZE_KEYS, render: worldClockRenderer, label: () => t('w.worldclock') },
  trends: { name: 'w.trends', icon: '🔥', sizes: SIZE_KEYS, render: trendsRenderer, label: () => t('w.trends') },
  todo: { name: 'w.todo', icon: '✅', sizes: SIZE_KEYS, render: todoRenderer, label: () => t('w.todo') },
  note: { name: 'w.note', icon: '📝', sizes: SIZE_KEYS, render: noteRenderer, label: () => t('w.note') },
  speedtest: { name: 'w.speedtest', icon: '📶', sizes: SIZE_KEYS, render: speedRenderer, label: () => t('w.speedtest') },
  translate: { name: 'w.translate', icon: '🌐', sizes: SIZE_KEYS, render: translateRenderer, label: () => t('w.translate') },
  ai: { name: 'w.ai', icon: '✨', sizes: SIZE_KEYS, render: aiRenderer, label: () => t('w.ai') },
  movie: { name: 'w.movie', icon: '🎬', sizes: SIZE_KEYS, render: movieRenderer, label: () => t('w.movie') },
  feed: { name: 'w.feed', icon: '📡', sizes: SIZE_KEYS, render: feedRenderer, label: () => t('w.feed') },
};

/* ── 渲染 ───────────────────────────────────────────── */
let cleanups = [];

/** 自由布局：把组件沿右侧一列排好（首次进入 / 点「整理」时用） */
export function placeWidgetsColumn({ force = false } = {}) {
  const vw = Math.max(900, window.innerWidth || 1440);
  const colX = Math.max(600, vw - 392);
  let cursorY = 108;
  let changed = false;
  const widgets = [...state.cfg.widgets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const w of widgets) {
    if (force || typeof w.x !== 'number' || typeof w.y !== 'number') {
      w.x = colX;
      w.y = cursorY;
      changed = true;
    }
    cursorY = Math.max(cursorY, w.y) + (w.h || 300) + 16;
  }
  if (changed) save('cfg');
  return changed;
}

/** 自由布局：按真实渲染高度把组件列紧凑排一遍（首次进入后调用一次） */
export function packWidgetsColumn() {
  const canvas = $('#canvas');
  if (!canvas) return;
  const vw = Math.max(900, window.innerWidth || 1440);
  const colX = Math.max(600, vw - 392);
  const widgets = [...state.cfg.widgets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  let y = 108;
  let changed = false;
  for (const w of widgets) {
    const card = canvas.querySelector(`[data-wid="${w.id}"]`);
    if (!card) continue;
    const h = card.offsetHeight || w.h || 300;
    if (w.x !== colX) { w.x = colX; changed = true; }
    if (Math.abs((w.y ?? 0) - y) > 1) { w.y = y; changed = true; }
    card.style.left = `${colX}px`;
    card.style.top = `${y}px`;
    y += h + 16;
  }
  if (changed) save('cfg');
}

export function renderWidgets() {
  cleanups.forEach((fn) => { try { fn(); } catch {} });
  cleanups = [];

  const rail = $('#rail');
  const canvas = $('#canvas');
  const free = state.cfg.layout.mode === 'free';
  if (rail) rail.innerHTML = '';
  if (canvas) canvas.innerHTML = '';

  const widgets = [...state.cfg.widgets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  // 自由布局里，没摆过位置的组件沿右侧一列往下排，不然会全叠在同一个点上
  if (free) {
    const vw = Math.max(900, window.innerWidth || 1440);
    const colX = Math.max(600, vw - 392);
    let cursorY = 108;
    let assigned = false;
    for (const w of widgets) {
      if (typeof w.x !== 'number' || typeof w.y !== 'number') {
        w.x = colX;
        w.y = cursorY;
        assigned = true;
      }
      cursorY = Math.max(cursorY, w.y) + (w.h || 300) + 16;
    }
    if (assigned) save('cfg');
  }

  // 网格模式下有组件时，内容区切成「图标 + 右侧栏」两列
  const content = $('#content');
  if (content) content.classList.toggle('has-rail', !free && widgets.length > 0);

  for (const w of widgets) {
    const def = WIDGETS[w.type];
    if (!def) continue;
    const card = buildCard(w, def, free);
    if (free) canvas?.append(card);
    else rail?.append(card);
  }

  if (rail && !widgets.length) {
    rail.append(el('div', { class: 'rail-empty' }, [
      el('p', { text: t('w.empty') }),
      el('button', { class: 'btn primary small', type: 'button', text: t('w.add'), onclick: (e) => widgetMenu(e) }),
    ]));
  }
  if (canvas && free) {
    const hint = el('button', { class: 'canvas-add', type: 'button', text: '+ ' + t('w.add'), onclick: (e) => widgetMenu(e) });
    canvas.append(hint);
  }
}

function buildCard(w, def, free) {
  const card = el('div', {
    class: `card card-${w.size || 'medium'} w-${w.type}${free ? ' free-item' : ''}`,
    'data-wid': w.id,
    style: free ? {
      left: `${w.x ?? 80}px`, top: `${w.y ?? 160}px`,
      width: `${w.w || SIZE_WIDTH[w.size] || 320}px`, ...(w.h ? { height: `${w.h}px` } : {}),
    } : {},
  });
  const head = el('div', { class: 'card-head' }, [
    el('span', { class: 'card-title', text: `${def.icon} ${def.label ? def.label() : ''}` }),
    el('span', { class: 'card-actions' }, [
      el('button', { class: 'icon-btn tiny', type: 'button', text: '⋮', title: t('w.menu'), onclick: (e) => {
        e.stopPropagation();
        widgetMenu(e, w);
      } }),
    ]),
  ]);
  const body = el('div', { class: 'card-body' });
  card.append(head, body);

  try {
    const cleanup = def.render(body, w, { free });
    if (typeof cleanup === 'function') cleanups.push(cleanup);
  } catch (e) {
    console.error('widget render failed', w.type, e);
    body.append(el('p', { class: 'hint', text: t('w.renderFail') }));
  }

  if (free) {
    enableDrag(card, w);
    const handle = el('span', { class: 'resize-handle', title: t('w.resize') });
    card.append(handle);
    enableResize(card, handle, w);
  }
  return card;
}

/* 自由布局拖动（E2/E5，8px 吸附） */
function enableDrag(card, w) {
  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.resize-handle, input, textarea, button, a')) return;
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const ox = w.x ?? 80;
    const oy = w.y ?? 160;
    card.setPointerCapture(e.pointerId);
    card.classList.add('dragging');
    const move = (ev) => {
      const snap = (v) => Math.round(v / 8) * 8;
      const nx = snap(clamp(ox + ev.clientX - startX, 0, innerWidth - 120));
      const ny = snap(clamp(oy + ev.clientY - startY, 0, innerHeight - 80));
      card.style.left = `${nx}px`;
      card.style.top = `${ny}px`;
      w.x = nx; w.y = ny;
    };
    const up = () => {
      card.classList.remove('dragging');
      card.removeEventListener('pointermove', move);
      card.removeEventListener('pointerup', up);
      save('cfg');
    };
    card.addEventListener('pointermove', move);
    card.addEventListener('pointerup', up);
  });
}

function enableResize(card, handle, w) {
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const ow = w.w || 320;
    const oh = card.offsetHeight;
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const nw = clamp(ow + ev.clientX - startX, 220, 900);
      const nh = clamp(oh + ev.clientY - startY, 120, 900);
      card.style.width = `${nw}px`;
      card.style.height = `${nh}px`;
      w.w = Math.round(nw); w.h = Math.round(nh);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      save('cfg');
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

/* 组件菜单：换尺寸 / 移到另一布局 / 删除 */
export function widgetMenu(e, w = null) {
  const anchorX = e.clientX || (e.target.getBoundingClientRect().right - 8);
  const anchorY = e.clientY || (e.target.getBoundingClientRect().bottom + 6);
  if (!w) {
    openMenu(anchorX, anchorY, Object.entries(WIDGETS).map(([type, def]) => ({
      label: def.label(),
      icon: def.icon,
      action: () => {
        addWidget(type, { size: def.sizes.includes('small') ? 'small' : 'medium' });
        renderWidgets();
        emit('widgets:changed');
      },
    })));
    return;
  }
  const def = WIDGETS[w.type];
  const sizeItems = (def?.sizes || ['small', 'medium', 'large']).map((s) => ({
    label: t(`size.${s}`),
    checked: w.size === s,
    action: () => { updateWidget(w.id, { size: s }); renderWidgets(); },
  }));
  openMenu(anchorX, anchorY, [
    ...sizeItems,
    { divider: true },
    { label: t('w.up'), icon: '↑', action: () => moveOrder(w, -1) },
    { label: t('w.down'), icon: '↓', action: () => moveOrder(w, 1) },
    { divider: true },
    { label: t('common.delete'), icon: '🗑', danger: true, action: () => { removeWidget(w.id); renderWidgets(); } },
  ]);
}

function moveOrder(w, dir) {
  const list = [...state.cfg.widgets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const i = list.findIndex((x) => x.id === w.id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  const tmp = list[i].order ?? i;
  list[i].order = list[j].order ?? j;
  list[j].order = tmp;
  save('cfg');
  renderWidgets();
}
