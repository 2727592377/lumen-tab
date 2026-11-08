// settings.js —— 设置面板：外观 / 搜索 / 桌面 / 壁纸 / 组件 / 数据 / 同步 / 关于

import { state, save, emit, BUILTIN_ENGINES, setWall, snapshot, applySnapshot, clearAll, makeBackup, getBackups, restoreBackup, clearBackups, webdavTest, webdavUpload, webdavDownload, firefoxSyncPush, firefoxSyncPull, importBookmarks, importItab, exportText, importSnapshotText, isExtension } from './store.js';
import { $, el, esc, toast, downloadFile, readFileAsText, clamp, uid } from './util.js';
import { applyWallpaper, addLocalImages, removeLocalImage, ensureBing, setWallType, paletteFromWallpaper } from './wallpaper.js';
import { applySearchStyle, renderEngineChip, setEngine } from './search.js';
import { applyGridStyle, renderSites } from './grid.js';
import { renderWidgets, WIDGETS } from './widgets.js';
import { openDialog, confirmDialog, promptDialog, showHost, hideHost } from './ui.js';
import { t, setLang, applyI18n } from './i18n.js';

const FONTS = [
  ['system', '系统默认'],
  ['serif', '宋体 / Serif'],
  ['sans', '黑体 / Sans'],
  ['mono', '等宽 / Mono'],
  ['rounded', '圆体 / Rounded'],
];

/* ── 通用控件 ───────────────────────────────────────── */
function field(label, node, hint) {
  return el('div', { class: 'field' }, [
    el('label', { text: label }),
    node,
    hint ? el('p', { class: 'hint', text: hint }) : null,
  ]);
}

function row(label, node) {
  return el('div', { class: 'setting-row' }, [
    el('span', { class: 'setting-label', text: label }),
    node,
  ]);
}

function toggle(checked, onChange) {
  const input = el('input', { type: 'checkbox', class: 'switch', checked: checked ? '' : null });
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

function range(value, min, max, step, onChange, fmt = null) {
  const input = el('input', { type: 'range', class: 'range', min, max, step, value });
  const out = el('span', { class: 'range-val', text: fmt ? fmt(value) : String(value) });
  input.addEventListener('input', () => {
    out.textContent = fmt ? fmt(input.value) : input.value;
    onChange(Number(input.value));
  });
  return el('div', { class: 'range-wrap' }, [input, out]);
}

function select(options, value, onChange) {
  const s = el('select', { class: 'input' }, options.map(([v, label]) =>
    el('option', { value: v, text: label, selected: String(v) === String(value) ? '' : null })));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function color(value, onChange) {
  const i = el('input', { type: 'color', class: 'input color', value });
  i.addEventListener('input', () => onChange(i.value));
  return i;
}

/** 修改配置 + 立即持久化 + 通知界面刷新 */
function set(path, value) {
  const keys = path.split('.');
  let node = state.cfg;
  for (let i = 0; i < keys.length - 1; i++) {
    node[keys[i]] = node[keys[i]] || {};
    node = node[keys[i]];
  }
  node[keys.at(-1)] = value;
  save('cfg');
  emit('cfg:changed', { path, value });
}

/* ── 面板 ───────────────────────────────────────────── */
const TABS = [
  ['appearance', 'set.appearance'],
  ['search', 'set.search'],
  ['desktop', 'set.desktop'],
  ['wallpaper', 'set.wallpaper'],
  ['widgets', 'set.widgets'],
  ['data', 'set.data'],
  ['sync', 'set.sync'],
  ['about', 'set.about'],
];

export function openSettings(tab = 'appearance') {
  const host = $('#dialog');
  if (!host) return;
  host.innerHTML = '';
  const nav = el('div', { class: 'set-nav' });
  const pane = el('div', { class: 'set-pane' });
  let cur = tab;

  const dlg = el('div', { class: 'dlg settings-dlg' }, [
    el('div', { class: 'dlg-head' }, [
      el('h3', { text: t('set.title') }),
      el('button', { class: 'icon-btn', type: 'button', text: '✕', onclick: close }),
    ]),
    el('div', { class: 'set-body' }, [nav, pane]),
  ]);
  host.append(dlg);
  showHost(host);

  const paint = () => {
    nav.innerHTML = '';
    for (const [id, key] of TABS) {
      const b = el('button', { class: `set-tab${id === cur ? ' active' : ''}`, type: 'button', text: t(key) });
      b.addEventListener('click', () => { cur = id; paint(); });
      nav.append(b);
    }
    pane.innerHTML = '';
    pane.append(PANES[cur]?.() || el('p', { text: '—' }));
  };
  paint();

  function close() {
    hideHost(host);
  }
  return { close };
}

const PANES = {
  /* ── 外观（F1–F6） ─────────────────────────────── */
  appearance() {
    const c = state.cfg;
    return el('div', {}, [
      field(t('set.theme'), select([['auto', t('set.themeAuto')], ['dark', t('set.themeDark')], ['light', t('set.themeLight')]], c.theme, (v) => {
        set('theme', v);
        applyTheme();
      })),
      field(t('set.accent'), el('div', { class: 'color-row' }, [
        color(c.accent, (v) => { set('accent', v); applyTheme(); }),
        color(c.accent2, (v) => { set('accent2', v); applyTheme(); }),
        el('button', { class: 'btn small', type: 'button', text: t('set.pickFromWall'), onclick: async () => {
          const url = state.wall.type === 'bing' ? state.wall.bingCache?.url : (state.wall.images || [])[state.wall.imgIndex || 0];
          const hex = await paletteFromWallpaper(url);
          if (!hex) { toast(t('err.palette')); return; }
          set('accent', hex);
          applyTheme();
          openSettings('appearance');
        } }),
      ])),
      field(t('set.font'), select(FONTS, c.font, (v) => { set('font', v); applyTheme(); })),
      field(t('set.uiScale'), range(c.uiScale, 0.85, 1.25, 0.05, (v) => { set('uiScale', v); applyTheme(); }, (v) => `${Math.round(v * 100)}%`)),
      field(t('set.radius'), range(c.radius, 0, 32, 2, (v) => { set('radius', v); applyTheme(); }, (v) => `${v}px`)),
      row(t('set.anim'), toggle(c.anim, (v) => { set('anim', v); applyTheme(); })),
      field(t('set.customCSS'), (() => {
        const ta = el('textarea', { class: 'code-area', rows: '8', spellcheck: 'false', placeholder: '/* body { ... } */' });
        ta.value = c.customCSS || '';
        let timer = null;
        ta.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(() => { set('customCSS', ta.value); applyTheme(); }, 400);
        });
        return ta;
      })(), t('set.customCSSHint')),
    ]);
  },

  /* ── 搜索（B1–B8） ─────────────────────────────── */
  search() {
    const c = state.cfg;
    const engineList = el('div', { class: 'engine-list' });
    const paintEngines = () => {
      engineList.innerHTML = '';
      state.cfg.engines.forEach((eng, i) => {
        const isOn = eng.id === state.cfg.search.engine;
        const rowEl = el('div', { class: `engine-row${isOn ? ' active' : ''}` }, [
          el('img', { class: 'engine-ico', src: `https://www.google.com/s2/favicons?domain=${safeHost(eng.url)}&sz=32`, alt: '' }),
          el('span', { class: 'engine-name', text: eng.name }),
          el('button', { class: 'btn tiny', type: 'button', text: t('set.useEngine'), onclick: () => { setEngine(eng.id); paintEngines(); applySearchStyle(); } }),
          el('button', { class: 'icon-btn tiny', type: 'button', text: '✎', onclick: async () => {
            const name = await promptDialog({ title: t('set.engineEdit'), label: t('site.name'), value: eng.name });
            if (!name) return;
            const url = await promptDialog({ title: t('set.engineEdit'), label: t('set.engineUrl'), value: eng.url });
            if (!url) return;
            eng.name = name;
            eng.url = url.includes('{{q}}') ? url : url + '{{q}}';
            save('cfg');
            paintEngines();
            renderEngineChip();
          } }),
          el('button', { class: 'icon-btn tiny', type: 'button', text: '🗑', onclick: () => {
            state.cfg.engines = state.cfg.engines.filter((x) => x.id !== eng.id);
            if (!state.cfg.engines.length) state.cfg.engines = structuredClone(BUILTIN_ENGINES);
            if (!state.cfg.engines.find((x) => x.id === state.cfg.search.engine)) state.cfg.search.engine = state.cfg.engines[0].id;
            save('cfg');
            paintEngines();
            renderEngineChip();
          } }),
        ]);
        engineList.append(rowEl);
      });
    };
    paintEngines();

    return el('div', {}, [
      row(t('set.searchShow'), toggle(c.search.on, (v) => { set('search.on', v); applySearchStyle(); })),
      field(t('set.searchWidth'), range(c.search.width, 420, 900, 10, (v) => { set('search.width', v); applySearchStyle(); }, (v) => `${v}px`)),
      field(t('set.searchRadius'), range(c.search.radius, 0, 999, 1, (v) => { set('search.radius', v); applySearchStyle(); }, (v) => (v >= 999 ? t('set.pill') : `${v}px`))),
      row(t('set.suggest'), toggle(c.search.suggest, (v) => set('search.suggest', v))),
      row(t('set.historyOn'), toggle(c.search.history, (v) => set('search.history', v))),
      field(t('set.engines'), el('div', {}, [engineList,
        el('button', { class: 'btn small', type: 'button', text: t('set.engineAdd'), onclick: async () => {
          const name = await promptDialog({ title: t('set.engineAdd'), label: t('site.name'), placeholder: 'Kagi' });
          if (!name) return;
          const url = await promptDialog({ title: t('set.engineAdd'), label: t('set.engineUrl'), placeholder: 'https://kagi.com/search?q={{q}}' });
          if (!url) return;
          state.cfg.engines.push({ id: uid('e'), name, url: url.includes('{{q}}') ? url : url + '{{q}}', suggest: '', suggestType: '' });
          save('cfg');
          paintEngines();
          renderEngineChip();
        } })]), t('set.engineHint')),
    ]);
  },

  /* ── 桌面（C13 C14 E1–E5） ─────────────────────── */
  desktop() {
    const c = state.cfg;
    const L = c.layout;
    return el('div', {}, [
      field(t('set.layoutMode'), select([['grid', t('set.layoutGrid')], ['free', t('set.layoutFree')]], L.mode, (v) => {
        set('layout.mode', v);
        document.body.classList.toggle('free-mode', v === 'free');
        renderSites(); renderWidgets();
      }), t('set.layoutHint')),
      field(t('set.iconSize'), range(L.iconSize, 36, 120, 2, (v) => { set('layout.iconSize', v); applyGridStyle(); renderSites(); }, (v) => `${v}px`)),
      field(t('set.iconRadius'), range(L.iconRadius, 0, 40, 2, (v) => { set('layout.iconRadius', v); applyGridStyle(); renderSites(); }, (v) => `${v}px`)),
      field(t('set.cols'), range(L.cols, 0, 12, 1, (v) => { set('layout.cols', v); applyGridStyle(); }, (v) => (Number(v) === 0 ? t('set.auto') : String(v)))),
      field(t('set.gapX'), range(L.gapX, 0, 80, 2, (v) => { set('layout.gapX', v); applyGridStyle(); }, (v) => `${v}px`)),
      field(t('set.gapY'), range(L.gapY, 0, 80, 2, (v) => { set('layout.gapY', v); applyGridStyle(); }, (v) => `${v}px`)),
      field(t('set.labelLines'), range(L.labelLines, 1, 3, 1, (v) => { set('layout.labelLines', v); applyGridStyle(); renderSites(); })),
      field(t('set.align'), select([['center', t('set.alignCenter')], ['left', t('set.alignLeft')], ['right', t('set.alignRight')]], L.align, (v) => { set('layout.align', v); applyGridStyle(); renderSites(); })),
      field(t('set.maxWidth'), range(L.maxWidth, 720, 1600, 20, (v) => { set('layout.maxWidth', v); applyGridStyle(); }, (v) => `${v}px`)),
      field(t('set.railWidth'), range(L.railWidth, 260, 460, 10, (v) => { set('layout.railWidth', v); applyGridStyle(); }, (v) => `${v}px`)),
      field(t('set.iconProvider'), select([['auto', t('set.providerAuto')], ['duckduckgo', 'DuckDuckGo'], ['google', 'Google S2'], ['direct', t('set.direct')]], c.iconProvider || 'auto', (v) => {
        set('iconProvider', v);
        renderSites();
      })),
      row(t('set.cleanLayout'), el('button', { class: 'btn small', type: 'button', text: t('set.organize'), onclick: () => {
        // 一键整理（E3）：把顺序压实、把自由布局的组件排成两列
        state.sites.forEach((s, i) => { s.order = i; });
        save('sites');
        const ws = [...state.cfg.widgets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        ws.forEach((w, i) => {
          w.x = 40 + (i % 2) * 360;
          w.y = 120 + Math.floor(i / 2) * 260;
          w.w = w.w || 330;
        });
        save('cfg');
        renderSites(); renderWidgets();
        toast(t('set.organized'));
      } })),
    ]);
  },

  /* ── 壁纸（A1–A8） ─────────────────────────────── */
  wallpaper() {
    const w = state.wall;
    const rerender = () => { applyWallpaper(); openSettings('wallpaper'); };

    const typeSel = select([
      ['solid', t('wall.solid')], ['gradient', t('wall.gradient')], ['image', t('wall.local')], ['bing', t('wall.bing')],
    ], w.type, (v) => { setWallType(v); rerender(); });

    const localBox = el('div', { class: 'wall-thumbs' });
    (w.images || []).forEach((src, i) => {
      localBox.append(el('div', { class: 'wall-thumb', style: { backgroundImage: `url("${src}")` } }, [
        el('button', { class: 'icon-btn tiny', type: 'button', text: '✕', onclick: () => { removeLocalImage(i); rerender(); } }),
      ]));
    });

    const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: '', class: 'input' });
    fileInput.addEventListener('change', async () => {
      await addLocalImages(fileInput.files);
      rerender();
    });

    const rot = w.rotate || {};
    return el('div', {}, [
      field(t('wall.type'), typeSel),
      w.type === 'solid' ? field(t('wall.color'), color(w.solid, (v) => { setWall({ solid: v, type: 'solid' }); applyWallpaper(); })) : null,
      w.type === 'gradient' ? el('div', {}, [
        field(t('wall.from'), color(w.g1, (v) => { setWall({ g1: v }); applyWallpaper(); })),
        field(t('wall.to'), color(w.g2, (v) => { setWall({ g2: v }); applyWallpaper(); })),
        field(t('set.angle'), range(w.angle, 0, 360, 5, (v) => { setWall({ angle: v }); applyWallpaper(); }, (v) => `${v}°`)),
      ]) : null,
      w.type === 'image' ? el('div', {}, [
        el('p', { class: 'hint', text: t('wall.localHint') }),
        localBox,
        el('button', { class: 'btn small', type: 'button', text: t('wall.add'), onclick: () => fileInput.click() }),
        fileInput,
      ]) : null,
      w.type === 'bing' ? el('div', {}, [
        el('p', { class: 'hint', text: w.bingCache?.copyright || t('wall.bingHint') }),
        el('button', { class: 'btn small', type: 'button', text: t('wall.refreshBing'), onclick: async () => {
          setWall({ bingCache: { date: '', url: '' } }, { silent: true });
          await ensureBing();
          applyWallpaper();
          rerender();
        } }),
      ]) : null,
      field(t('wall.fit'), select([['cover', t('wall.cover')], ['contain', t('wall.contain')]], w.fit, (v) => { setWall({ fit: v }); applyWallpaper(); })),
      field(t('wall.blur'), range(w.blur, 0, 24, 1, (v) => { setWall({ blur: v }); applyWallpaper(); }, (v) => `${v}px`)),
      field(t('wall.dim'), range(w.dim, 0, 0.8, 0.02, (v) => { setWall({ dim: v }); applyWallpaper(); }, (v) => `${Math.round(v * 100)}%`)),
      row(t('wall.rotateOn'), toggle(!!rot.on, (v) => { setWall({ rotate: { ...(state.wall.rotate || {}), on: v } }); })),
      field(t('wall.rotateEvery'), select([['startup', t('wall.startup')], ['hour', t('wall.hour')], ['day', t('wall.day')], ['none', t('wall.never')]], rot.every || 'day', (v) => {
        setWall({ rotate: { ...(state.wall.rotate || {}), every: v } });
      })),
      field(t('wall.rotateFrom'), select([['bing', t('wall.bing')], ['local', t('wall.local')], ['gradient', t('wall.gradient')]], rot.source || 'bing', (v) => {
        setWall({ rotate: { ...(state.wall.rotate || {}), source: v } });
      })),
    ]);
  },

  /* ── 组件（E4） ────────────────────────────────── */
  widgets() {
    const list = el('div', { class: 'widget-pick' });
    for (const [type, def] of Object.entries(WIDGETS)) {
      list.append(el('button', { class: 'widget-cell', type: 'button', onclick: () => {
        const mod = state.cfg.widgets.filter((w) => w.type === type).length;
        state.cfg.widgets.push({
          id: uid('w'), type, size: def.sizes.includes('small') ? 'small' : 'medium',
          order: state.cfg.widgets.length + mod, x: 60, y: 160, w: 330, h: 0, cfg: {},
        });
        save('cfg');
        renderWidgets();
        renderWidgets();
        toast(t('w.added'));
      } }, [el('span', { class: 'widget-ico', text: def.icon }), el('span', { text: def.label() })]));
    }

    const ai = state.cfg.ai || {};
    return el('div', {}, [
      el('p', { class: 'hint', text: t('set.widgetsHint') }),
      list,
      el('hr', { class: 'sep' }),
      el('h4', { text: t('w.ai') }),
      el('p', { class: 'hint', text: t('set.aiHint') }),
      field('Endpoint', (() => {
        const i = el('input', { class: 'input', type: 'text', value: ai.endpoint || '', placeholder: 'https://api.openai.com/v1' });
        i.addEventListener('change', () => set('ai.endpoint', i.value.trim()));
        return i;
      })()),
      field('Model', (() => {
        const i = el('input', { class: 'input', type: 'text', value: ai.model || '', placeholder: 'gpt-4o-mini' });
        i.addEventListener('change', () => set('ai.model', i.value.trim()));
        return i;
      })()),
      field('API Key', (() => {
        const i = el('input', { class: 'input', type: 'password', value: ai.key || '', placeholder: 'sk-…' });
        i.addEventListener('change', () => set('ai.key', i.value.trim()));
        return i;
      })(), t('set.aiKeyHint')),
    ]);
  },

  /* ── 数据（G1–G3） ─────────────────────────────── */
  data() {
    const backupBox = el('div', { class: 'backup-list' });
    const paintBackups = async () => {
      const list = await getBackups();
      backupBox.innerHTML = '';
      if (!list.length) { backupBox.append(el('p', { class: 'hint', text: t('set.noBackup') })); return; }
      for (const b of list) {
        backupBox.append(el('div', { class: 'backup-row' }, [
          el('span', { class: 'backup-time', text: new Date(b.ts).toLocaleString() }),
          el('span', { class: 'hint', text: `${(b.size / 1024).toFixed(1)} KB · ${b.data.sites?.length || 0} ${t('common.sites')}` }),
          el('button', { class: 'btn tiny', type: 'button', text: t('set.restore'), onclick: async () => {
            if (!await confirmDialog(t('set.restoreConfirm'))) return;
            await restoreBackup(b.ts);
            location.reload();
          } }),
        ]));
      }
    };
    paintBackups();

    const fileIn = el('input', { type: 'file', accept: 'application/json,.json', class: 'input' });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files?.[0];
      if (!f) return;
      try {
        const text = await readFileAsText(f);
        const n = importSnapshotText(text);
        toast(t('set.imported', { n }));
        setTimeout(() => location.reload(), 600);
      } catch (e) {
        toast(t('err.import'));
      }
    });

    return el('div', {}, [
      el('h4', { text: t('set.exportTitle') }),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn', type: 'button', text: t('set.exportJson'), onclick: async () => {
          const text = await exportText();
          downloadFile(`lumen-backup-${new Date().toISOString().slice(0, 10)}.json`, text);
        } }),
        el('button', { class: 'btn', type: 'button', text: t('set.importJson'), onclick: () => fileIn.click() }),
        fileIn,
      ]),
      el('hr', { class: 'sep' }),
      el('h4', { text: t('set.backups') }),
      el('p', { class: 'hint', text: t('set.backupHint') }),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn', type: 'button', text: t('set.makeBackup'), onclick: async () => { await makeBackup('manual'); paintBackups(); toast(t('set.backupDone')); } }),
        el('button', { class: 'btn danger', type: 'button', text: t('set.clearBackups'), onclick: async () => { await clearBackups(); paintBackups(); } }),
      ]),
      backupBox,
      el('hr', { class: 'sep' }),
      el('h4', { text: t('set.importTitle') }),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn', type: 'button', text: t('set.importBookmarks'), disabled: isExtension ? null : '', onclick: async () => {
          try {
            const n = await importBookmarks();
            toast(t('set.imported', { n }));
            renderSites();
          } catch (e) { toast(t('err.bookmarks')); }
        } }),
        el('button', { class: 'btn', type: 'button', text: t('set.importItab'), onclick: () => {
          const inp = el('input', { type: 'file', accept: '.json,application/json' });
          inp.addEventListener('change', async () => {
            const f = inp.files?.[0];
            if (!f) return;
            try {
              const n = importItab(await readFileAsText(f));
              toast(t('set.imported', { n }));
              renderSites();
            } catch { toast(t('err.import')); }
          });
          inp.click();
        } }),
      ]),
      el('hr', { class: 'sep' }),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn danger', type: 'button', text: t('set.resetAll'), onclick: async () => {
          if (!await confirmDialog(t('set.resetConfirm'))) return;
          await makeBackup('before-reset');
          await clearAll();
          location.reload();
        } }),
      ]),
    ]);
  },

  /* ── 同步（G4 G6） ─────────────────────────────── */
  sync() {
    const s = state.cfg.sync || {};
    const dav = s.webdav || {};
    const davFields = (key, label, type = 'text', ph = '') => {
      const i = el('input', { class: 'input', type, placeholder: ph });
      i.value = dav[key] || '';
      i.addEventListener('change', () => set(`sync.webdav.${key}`, i.value.trim()));
      return field(label, i);
    };
    return el('div', {}, [
      el('h4', { text: t('set.syncFirefox') }),
      el('p', { class: 'hint', text: t('set.syncFirefoxHint') }),
      row(t('set.syncEnable'), toggle(!!s.firefox, (v) => set('sync.firefox', v))),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn primary', type: 'button', text: t('set.syncPush'), onclick: async () => {
          try {
            const r = await firefoxSyncPush();
            toast(t('set.syncPushed', { n: r.chunks }));
          } catch (e) { toast(t('err.sync')); }
        } }),
        el('button', { class: 'btn', type: 'button', text: t('set.syncPull'), onclick: async () => {
          try {
            const r = await firefoxSyncPull();
            toast(t('set.syncPulled', { n: r.sites }));
            setTimeout(() => location.reload(), 700);
          } catch (e) { toast(t('err.sync')); }
        } }),
      ]),
      el('hr', { class: 'sep' }),
      el('h4', { text: t('set.webdav') }),
      el('p', { class: 'hint', text: t('set.webdavHint') }),
      davFields('url', t('set.davUrl'), 'text', 'https://dav.jianguoyun.com/dav/lumen/'),
      davFields('user', t('set.davUser')),
      davFields('pass', t('set.davPass'), 'password'),
      davFields('path', t('set.davPath'), 'text', 'lumen-backup.json'),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn', type: 'button', text: t('set.davTest'), onclick: async () => {
          try { await webdavTest(state.cfg.sync.webdav); toast(t('set.davOk')); } catch (e) { toast(t('set.davFail', { msg: e.message })); }
        } }),
        el('button', { class: 'btn primary', type: 'button', text: t('set.davUpload'), onclick: async () => {
          try { const n = await webdavUpload(state.cfg.sync.webdav); toast(t('set.davUploaded', { kb: (n / 1024).toFixed(1) })); } catch (e) { toast(t('set.davFail', { msg: e.message })); }
        } }),
        el('button', { class: 'btn', type: 'button', text: t('set.davDownload'), onclick: async () => {
          try { await webdavDownload(state.cfg.sync.webdav); toast(t('set.davPulled')); setTimeout(() => location.reload(), 700); } catch (e) { toast(t('set.davFail', { msg: e.message })); }
        } }),
      ]),
    ]);
  },

  /* ── 关于 ──────────────────────────────────────── */
  about() {
    return el('div', {}, [
      el('h4', { text: t('about.name') }),
      el('p', { class: 'hint', text: t('about.desc') }),
      el('div', { class: 'kv' }, [
        [t('about.version'), '1.0.0'],
        [t('about.engine'), navigator.userAgent.includes('Firefox') ? 'Firefox' : navigator.userAgent.slice(0, 40)],
        [t('about.sites'), String(state.sites.length)],
        [t('about.widgets'), String(state.cfg.widgets.length)],
      ].map(([k, v]) => el('div', { class: 'kv-row' }, [el('span', { text: k }), el('b', { text: v })]))),
      field(t('set.language'), select([['zh', '简体中文'], ['en', 'English']], state.cfg.locale || 'zh', (v) => {
        set('locale', v);
        setLang(v);
        applyI18n(document);
        location.reload();
      })),
      el('p', { class: 'hint mono', text: t('about.migrated', { n: state.sites.length }) }),
    ]);
  },
};

function safeHost(url) {
  try { return new URL(String(url).replace('{{q}}', 'x')).host; } catch { return 'bing.com'; }
}

/* ── 主题应用（F1–F6） ─────────────────────────────── */
export function applyTheme() {
  const c = state.cfg;
  const root = document.documentElement;
  const dark = c.theme === 'auto'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : c.theme === 'dark';
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.anim = c.anim ? 'on' : 'off';
  root.style.setProperty('--accent', c.accent);
  root.style.setProperty('--accent2', c.accent2 || c.accent);
  root.style.setProperty('--radius', `${c.radius}px`);
  root.style.setProperty('--radius-sm', `${Math.max(4, Math.round(c.radius * 0.55))}px`);
  root.style.setProperty('--ui', FONT_STACK[c.font] || FONT_STACK.system);
  root.style.fontSize = `${16 * (c.uiScale || 1)}px`;

  let style = document.getElementById('custom-css');
  if (!style) {
    style = document.createElement('style');
    style.id = 'custom-css';
    document.head.append(style);
  }
  style.textContent = c.customCSS || '';

  // 主题一变，背景的渐变/遮罩也要跟着换（深色渐变放在浅色主题里会很脏）
  applyWallpaper();
}

const FONT_STACK = {
  system: '"Segoe UI", system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
  serif: '"Songti SC", "SimSun", Georgia, "Times New Roman", serif',
  sans: '"Helvetica Neue", "PingFang SC", "Microsoft YaHei", Arial, sans-serif',
  mono: '"JetBrains Mono", "Cascadia Code", Consolas, "Sarasa Mono SC", monospace',
  rounded: '"Nunito", "Quicksand", "PingFang SC", "Microsoft YaHei", sans-serif',
};
