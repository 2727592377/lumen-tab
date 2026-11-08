// main.js —— 启动与接线

import { boot, state, on, save, emit, flush, isExtension, addSite, addWidget } from './store.js';
import { $, $$, el, toast, downloadFile, debounce } from './util.js';
import { t, setLang, applyI18n, getLang } from './i18n.js';
import { applyWallpaper, startRotation, nextImage } from './wallpaper.js';
import { initSearch, applySearchStyle, hideSuggest, renderEngineChip } from './search.js';
import { renderSites, renderFreeSites, applyGridStyle, openSiteEditor, openFolder, tidyFree } from './grid.js';
import { renderWidgets, placeWidgetsColumn, packWidgetsColumn, WIDGETS } from './widgets.js';
import { openSettings, applyTheme } from './settings.js';
import { openMenu, openDialog, promptDialog } from './ui.js';
import { makeBackup } from './store.js';

async function main() {
  setLang(localStorage.getItem('lumen.lang') || 'zh');

  await boot(() => {});
  if (state.cfg.locale && state.cfg.locale !== getLang()) {
    // 配置里的语言优先于上次手动切换
    setLang(state.cfg.locale);
  }
  applyI18n(document);
  paintLocaleBtn();
  applyTheme();
  applyWallpaper();
  startRotation();
  applyGridStyle();

  initSearch({
    form: $('#search-form'),
    input: $('#q'),
    suggest: $('#suggest'),
    chip: $('#engine-chip'),
    favicon: $('#engine-favicon'),
    name: $('#engine-name'),
  });
  applySearchStyle();

  const free = state.cfg.layout.mode === 'free';
  const canvasEl = $('#canvas');
  if (canvasEl) canvasEl.hidden = !free;
  document.body.classList.toggle('free-mode', free);
  renderSites();
  if (free) {
    if (!state.cfg.layout.freeInit) {
      state.cfg.layout.freeInit = true;
      save('cfg');
      placeWidgetsColumn({ force: true });
    }
    renderWidgets();
    renderFreeSites();
  } else {
    renderWidgets();
  }

  wireTopbar();
  wireKeyboard();
  wireEvents();
  wireMessages();

  // 媒体查询变化时跟着切主题（F1「跟随系统」）
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());

  // 首次安装：告诉她迁移了多少个站点
  if (!localStorage.getItem('lumen.welcomed') && state.sites.length) {
    localStorage.setItem('lumen.welcomed', '1');
    setTimeout(() => {
      toast(t('welcome.seeded', { n: state.sites.length }));
    }, 800);
  }

  document.body.classList.add('ready');
  $('#loading')?.classList.add('done');
  requestAnimationFrame(fitCanvas);

  // 深链接：newtab.html?panel=settings&tab=appearance / ?panel=add
  // 调试开关：?theme=light|dark / ?layout=free|grid / ?lang=en
  const qs = new URLSearchParams(location.search);
  const qTheme = qs.get('theme');
  const qLayout = qs.get('layout');
  if (qTheme === 'light' || qTheme === 'dark') { state.cfg.theme = qTheme; applyTheme(); }
  if (qLayout === 'free' || qLayout === 'grid') setLayoutMode(qLayout, { silent: true });
  if (qs.get('lang')) { setLang(qs.get('lang')); refreshLang(); }

  // 调试：?w=trends,speedtest 直接往桌面加组件（截图验收用）
  const qWidgets = qs.get('w');
  if (qWidgets) {
    const have = new Set(state.cfg.widgets.map((x) => x.type));
    for (const type of qWidgets.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (WIDGETS[type] && !have.has(type)) addWidget(type);
    }
    renderWidgets();
  }

  // 调试：?feed=<url> 给订阅组件塞一个源（截图验收用）
  const qFeed = qs.get('feed');
  if (qFeed) {
    const fw = state.cfg.widgets.find((x) => x.type === 'feed');
    if (fw) {
      fw.cfg = fw.cfg || {};
      fw.cfg.feeds = [{ url: new URL(qFeed, location.href).href, title: '样例源' }];
      save('cfg');
      renderWidgets();
    }
  }

  const panel = qs.get('panel');
  if (panel === 'settings') openSettings(qs.get('tab') || undefined);
  else if (panel === 'add') openSiteEditor(null);
}

/* ── 自由布局画布高度：跟着最靠下的那个元素长 ───────── */
export function fitCanvas() {
  const canvas = $('#canvas');
  if (!canvas || state.cfg.layout.mode !== 'free') return;
  let bottom = 0;
  for (const n of canvas.children) {
    const top = parseFloat(n.style.top) || n.offsetTop || 0;
    bottom = Math.max(bottom, top + (n.offsetHeight || 0));
  }
  canvas.style.minHeight = `${Math.max(560, Math.round(bottom + 90))}px`;
}

/* ── 语言切换后把整页重刷一遍（组件和图标是 JS 画的，不会自动跟着换） ── */
function paintLocaleBtn() {
  const b = $('#btn-locale');
  if (b) b.textContent = getLang() === 'zh' ? 'EN' : '中';
}

export function refreshLang() {
  applyI18n(document);
  paintLocaleBtn();
  applySearchStyle();
  renderEngineChip();
  if (state.cfg.layout.mode === 'free') {
    renderWidgets();
    renderFreeSites();
  } else {
    renderWidgets();
    renderSites();
  }
  requestAnimationFrame(fitCanvas);
}

/* ── 布局切换（E1 网格 / E2 自由 / E3 一键整理） ─────── */
export function setLayoutMode(mode, { silent = false } = {}) {
  const free = mode === 'free';
  state.cfg.layout.mode = mode;
  save('cfg');
  document.body.classList.toggle('free-mode', free);
  const canvas = $('#canvas');
  if (canvas) canvas.hidden = !free;
  if (free) {
    // 第一次进自由布局：组件排右侧、图标铺左侧，之后各归各位
    if (!state.cfg.layout.freeInit) {
      state.cfg.layout.freeInit = true;
      save('cfg');
      placeWidgetsColumn({ force: true });
      renderWidgets();
      packWidgetsColumn();
      tidyFree({ silent: true });
    } else {
      renderWidgets();
      renderFreeSites();
    }
  } else {
    renderWidgets();
    renderSites();
  }
  requestAnimationFrame(fitCanvas);
  if (!silent) toast(free ? t('layout.toFree') : t('layout.toGrid'));
}

/* ── 顶部按钮 ─────────────────────────────────────── */
function wireTopbar() {
  $('#btn-settings')?.addEventListener('click', () => openSettings('appearance'));

  $('#btn-layout')?.addEventListener('click', () => {
    setLayoutMode(state.cfg.layout.mode === 'grid' ? 'free' : 'grid');
  });

  $('#btn-locale')?.addEventListener('click', () => {
    setLang(getLang() === 'zh' ? 'en' : 'zh');
    state.cfg.locale = getLang();
    save('cfg');
    localStorage.setItem('lumen.lang', getLang());
    refreshLang();
  });

  $('#btn-import-export')?.addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openMenu(r.left - 120, r.bottom + 8, [
      { label: t('set.exportJson'), icon: '⬇', action: async () => {
        const { exportText } = await import('./store.js');
        const text = await exportText();
        downloadFile(`lumen-backup-${new Date().toISOString().slice(0, 10)}.json`, text);
      } },
      { label: t('set.importJson'), icon: '⬆', action: () => {
        const inp = el('input', { type: 'file', accept: '.json,application/json' });
        inp.addEventListener('change', async () => {
          const f = inp.files?.[0];
          if (!f) return;
          const { importSnapshotText } = await import('./store.js');
          const { readFileAsText } = await import('./util.js');
          try {
            importSnapshotText(await readFileAsText(f));
            location.reload();
          } catch { toast(t('err.import')); }
        });
        inp.click();
      } },
      { divider: true },
      { label: t('set.importBookmarks'), icon: '🔖', action: async () => {
        const { importBookmarks } = await import('./store.js');
        try {
          const n = await importBookmarks();
          toast(t('set.imported', { n }));
          renderSites();
        } catch { toast(t('err.bookmarks')); }
      } },
      { label: t('set.makeBackup'), icon: '🗄', action: async () => { await makeBackup('manual'); toast(t('set.backupDone')); } },
      { divider: true },
      { label: t('set.title'), icon: '⚙', action: () => openSettings('appearance') },
    ]);
  });

  // 自由布局空白处右键 → 新建 / 整理
  $('#canvas')?.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.free-item')) return;
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      { label: t('site.add'), icon: '+', action: () => openSiteEditor(null) },
      { label: t('layout.tidy'), icon: '🧹', action: () => tidyFree() },
      { label: t('w.add'), icon: '▦', action: () => openSettings('widgets') },
      { divider: true },
      { label: t('layout.toGrid'), icon: '▤', action: () => setLayoutMode('grid') },
      { label: t('set.title'), icon: '⚙', action: () => openSettings('layout') },
    ]);
  });

  // 空白处右键 → 新建
  $('#grid')?.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.site')) return;
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      { label: t('site.add'), icon: '+', action: () => openSiteEditor(null) },
      { label: t('folder.new'), icon: '📁', action: async () => {
        const name = await promptDialog({ title: t('folder.new'), placeholder: t('folder.namePlaceholder') });
        if (!name) return;
        const { addFolder } = await import('./store.js');
        addFolder(name);
        renderSites();
      } },
      { label: t('group.add'), icon: '🗂', action: async () => {
        const name = await promptDialog({ title: t('group.add'), placeholder: t('group.namePlaceholder') });
        if (!name) return;
        const { addGroup } = await import('./store.js');
        addGroup(name);
        renderSites();
      } },
      { divider: true },
      { label: t('wall.next'), icon: '🖼', action: () => nextImage(1) },
      { label: t('set.title'), icon: '⚙', action: () => openSettings('appearance') },
    ]);
  });
}

/* ── 键位 ─────────────────────────────────────────── */
function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    const inField = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    if (e.key === '/' && !inField) {
      e.preventDefault();
      $('#q')?.focus();
    }
    if (e.key === 'Escape') {
      hideSuggest();
      $('#q')?.blur();
    }
    // Ctrl+Shift+E 导出快照，Ctrl+Shift+B 备份
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      makeBackup('manual').then(() => toast(t('set.backupDone')));
    }
  });
}

/* ── 订阅数据变更 ─────────────────────────────────── */
function wireEvents() {
  on('sites', () => {});
  on('cfg:changed', ({ detail } = {}) => {
    if (!detail) return;
    if (detail.path?.startsWith('layout')) applyGridStyle();
    if (detail.path?.startsWith('search')) applySearchStyle();
  });
  window.addEventListener('beforeunload', () => { flush(); });
  // 拖完组件 / 图标后画布重新量一次高度
  $('#canvas')?.addEventListener('pointerup', () => setTimeout(fitCanvas, 40));
  window.addEventListener('resize', debounce(fitCanvas, 150));
}

/* ── 来自 background 的消息（快捷键 / 右键菜单） ── */
function wireMessages() {
  if (!isExtension) return;
  const api = globalThis.browser ?? globalThis.chrome;

  api.runtime?.onMessage?.addListener((msg) => {
    if (msg?.type === 'focus-search') {
      window.focus();
      $('#q')?.focus();
    } else if (msg?.type === 'open-settings') {
      openSettings('appearance');
    } else if (msg?.type === 'add-site') {
      if (msg.site?.url) {
        addSite({ name: msg.site.name, url: msg.site.url });
        renderSites();
        toast(t('site.added', { name: msg.site.name }));
      } else {
        openSiteEditor(null);
      }
    }
  });

  // 右键菜单在「没有打开新标签页」时会把待加站点写进 storage，这里消费掉
  if (api.storage?.local) {
    api.storage.local.get('pendingSite').then((o) => {
      const s = o?.pendingSite;
      if (!s?.url) return;
      addSite({ name: s.name, url: s.url });
      renderSites();
      api.storage.local.remove('pendingSite');
      toast(t('site.added', { name: s.name }));
    }).catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  document.body.classList.add('ready');
  const host = $('#loading');
  if (host) host.textContent = '加载失败：' + e.message;
});
