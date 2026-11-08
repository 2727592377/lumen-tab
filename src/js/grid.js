// grid.js —— 图标网格：拖拽、文件夹、分组、右键菜单、增删改（C1–C14）

import {
  state, save, emit, sitesOf, folderSites, groupsFlat,
  addSite, updateSite, removeSite, addFolder, removeFolder,
  addGroup, renameGroup, removeGroup, setActiveGroup, hostGuess,
} from './store.js';
import { $, el, uid, clamp, esc, normalizeUrl, shrinkImage, toast, colorFromString } from './util.js';
import { makeIcon, letterOf, letterColor } from './favicon.js';
import { openMenu, openDialog, confirmDialog, promptDialog } from './ui.js';
import { t } from './i18n.js';

let dragId = null;
let dropTarget = null;
let openFolderId = null;

/* ── 尺寸与布局变量（C13 / C14 / E1） ───────────────── */
export function applyGridStyle() {
  const L = state.cfg.layout;
  const root = document.documentElement;
  root.style.setProperty('--icon-size', `${L.iconSize}px`);
  root.style.setProperty('--gap-x', `${L.gapX}px`);
  root.style.setProperty('--gap-y', `${L.gapY}px`);
  root.style.setProperty('--label-lines', String(L.labelLines || 1));
  root.style.setProperty('--max-width', `${L.maxWidth || 1120}px`);
  root.style.setProperty('--icon-radius', `${L.iconRadius ?? 18}px`);
  root.style.setProperty('--rail-width', `${L.railWidth || 340}px`);

  const grid = $('#grid');
  if (grid) {
    grid.style.gridTemplateColumns = L.cols > 0
      ? `repeat(${L.cols}, minmax(0, 1fr))`
      : `repeat(auto-fill, minmax(${Math.round(L.iconSize * 1.28)}px, 1fr))`;
    grid.style.justifyItems = L.align === 'left' ? 'start' : L.align === 'right' ? 'end' : 'center';
  }
}

/* ── 主渲染 ─────────────────────────────────────────── */
export function renderSites() {
  applyGridStyle();
  const grid = $('#grid');
  if (!grid) return;
  grid.innerHTML = '';

  const list = sitesOf();
  const folders = state.folders.filter((f) => {
    const g = state.cfg.activeGroup;
    return !g || g === 'all' || f.group === g || f.group === 'all';
  });

  for (const f of folders) grid.append(folderTile(f));
  for (const s of list) grid.append(siteTile(s));

  const add = el('button', { class: 'site add-tile', type: 'button', title: t('site.add') }, [
    el('span', { class: 'site-icon add-icon', text: '+' }),
    el('span', { class: 'site-name', text: t('site.add') }),
  ]);
  add.addEventListener('click', () => openSiteEditor(null));
  grid.append(add);

  renderGroupsBar();
}

function siteTile(site) {
  const L = state.cfg.layout;
  const a = el('a', {
    class: 'site',
    href: site.url,
    'data-id': site.id,
    draggable: 'true',
    title: site.name,
  }, [
    makeIcon(site, { size: L.iconSize, radius: L.iconRadius }),
    el('span', { class: 'site-name', text: site.name }),
  ]);

  a.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey || e.button === 1) return;   // 交给浏览器开新标签
    e.preventDefault();
    openUrl(site.url, e.shiftKey);
  });
  a.addEventListener('auxclick', (e) => {
    if (e.button === 1) { e.preventDefault(); openUrl(site.url, true); }
  });
  a.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    siteMenu(e, site);
  });
  a.addEventListener('dragstart', (e) => {
    dragId = site.id;
    a.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', site.id);
  });
  a.addEventListener('dragend', () => {
    dragId = null;
    a.classList.remove('dragging');
    clearDropMark();
  });
  a.addEventListener('dragover', (e) => {
    if (!dragId || dragId === site.id) return;
    e.preventDefault();
    clearDropMark();
    dropTarget = site.id;
    a.classList.add('drop-before');
  });
  a.addEventListener('drop', (e) => {
    e.preventDefault();
    reorderTo(dragId, site.id);
    clearDropMark();
  });
  return a;
}

function folderTile(folder) {
  const L = state.cfg.layout;
  const kids = folderSites(folder.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const preview = el('span', {
    class: 'site-icon folder-icon',
    style: { width: `${L.iconSize}px`, height: `${L.iconSize}px`, borderRadius: `${L.iconRadius}px` },
  });
  const mini = el('span', { class: 'folder-mini' });
  kids.slice(0, 4).forEach((s) => {
    mini.append(makeIcon(s, { size: Math.round(L.iconSize * 0.4), radius: Math.round(L.iconRadius * 0.5) }));
  });
  for (let i = kids.length; i < 4; i++) mini.append(el('span', { class: 'mini-empty' }));
  preview.append(mini);
  if (kids.length > 4) preview.append(el('span', { class: 'folder-count', text: String(kids.length) }));

  const tile = el('div', { class: 'site folder-tile', 'data-folder': folder.id, title: folder.name }, [
    preview,
    el('span', { class: 'site-name', text: folder.name }),
  ]);
  tile.addEventListener('click', () => openFolder(folder.id));
  tile.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    tile.classList.add('drop-into');
  });
  tile.addEventListener('dragleave', () => tile.classList.remove('drop-into'));
  tile.addEventListener('drop', (e) => {
    e.preventDefault();
    tile.classList.remove('drop-into');
    if (!dragId) return;
    updateSite(dragId, { folder: folder.id });
    dragId = null;
    renderSites();
  });
  tile.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      { label: t('folder.rename'), icon: '✎', action: async () => {
        const name = await promptDialog({ title: t('folder.rename'), value: folder.name });
        if (name) { folder.name = name; save('folders'); renderSites(); }
      } },
      { label: t('folder.dissolve'), icon: '⤴', action: () => {
        kids.forEach((s) => updateSite(s.id, { folder: null }));
        removeFolder(folder.id);
        renderSites();
      } },
      { label: t('common.delete'), icon: '🗑', danger: true, action: async () => {
        if (await confirmDialog(t('folder.deleteConfirm', { name: folder.name }))) {
          removeFolder(folder.id);
          renderSites();
        }
      } },
    ]);
  });
  return tile;
}

function openUrl(url, newTab) {
  if (newTab) window.open(url, '_blank', 'noopener');
  else window.location.href = url;
}

/* ── 文件夹展开 ─────────────────────────────────────── */
export function openFolder(id) {
  openFolderId = id;
  const folder = state.folders.find((f) => f.id === id);
  if (!folder) return;
  const body = el('div', { class: 'folder-grid' });
  const kids = folderSites(id);
  for (const s of kids) {
    const tile = siteTile(s);
    tile.classList.add('in-folder');
    // 文件夹内右键多一个「移出」
    tile.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      siteMenu(e, s, { inFolder: true });
    });
    body.append(tile);
  }
  if (!kids.length) body.append(el('p', { class: 'empty-hint', text: t('folder.empty') }));
  const editor = openDialog({
    title: folder.name,
    body,
    wide: true,
    okText: null,
    cancelText: t('common.close'),
  });
  openFolderId = null;
  return editor;
}

/* ── 分组栏（C8） ───────────────────────────────────── */
function renderGroupsBar() {
  const bar = $('#groups-bar');
  if (!bar) return;
  bar.innerHTML = '';
  for (const g of groupsFlat()) {
    const active = (state.cfg.activeGroup || 'all') === g.id;
    const chip = el('button', {
      class: `group-chip${active ? ' active' : ''}`,
      type: 'button',
      'data-group': g.id,
      text: g.name,
    });
    chip.addEventListener('click', () => { setActiveGroup(g.id); renderSites(); });
    chip.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (g.id === 'all') {
        openMenu(e.clientX, e.clientY, [{ label: t('group.add'), icon: '+', action: addGroupFlow }]);
        return;
      }
      openMenu(e.clientX, e.clientY, [
        { label: t('group.rename'), icon: '✎', action: async () => {
          const name = await promptDialog({ title: t('group.rename'), value: g.name });
          if (name) { renameGroup(g.id, name); renderSites(); }
        } },
        { label: t('group.delete'), icon: '🗑', danger: true, action: async () => {
          if (await confirmDialog(t('group.deleteConfirm', { name: g.name }))) { removeGroup(g.id); renderSites(); }
        } },
      ]);
    });
    bar.append(chip);
  }
  const addBtn = el('button', { class: 'group-chip add-group', type: 'button', text: '+', title: t('group.add') });
  addBtn.addEventListener('click', addGroupFlow);
  bar.append(addBtn);
}

async function addGroupFlow() {
  const name = await promptDialog({ title: t('group.add'), placeholder: t('group.namePlaceholder') });
  if (!name) return;
  addGroup(name);
  renderSites();
}

/* ── 拖拽排序（C9） ─────────────────────────────────── */
function clearDropMark() {
  document.querySelectorAll('.site.drop-before, .site.drop-into').forEach((n) => {
    n.classList.remove('drop-before', 'drop-into');
  });
  dropTarget = null;
}

function reorderTo(fromId, toId) {
  const visible = sitesOf();
  const ids = visible.map((s) => s.id);
  const fi = ids.indexOf(fromId);
  const ti = ids.indexOf(toId);
  if (fi < 0 || ti < 0) return;
  ids.splice(ti, 0, ids.splice(fi, 1)[0]);
  ids.forEach((id, i) => {
    const s = state.sites.find((x) => x.id === id);
    if (s) s.order = i;
  });
  save('sites');
  renderSites();
}

/* ── 右键菜单（C12） ───────────────────────────────── */
function siteMenu(e, site, { inFolder = false } = {}) {
  const groups = state.cfg.groups;
  const menu = [
    { label: t('site.open'), icon: '↗', action: () => openUrl(site.url, false) },
    { label: t('site.openNew'), icon: '⧉', action: () => openUrl(site.url, true) },
    { divider: true },
    { label: t('site.edit'), icon: '✎', action: () => openSiteEditor(site) },
    { label: t('site.icon'), icon: '🖼', action: () => openIconPicker(site) },
    { label: t('site.copyUrl'), icon: '⧉', action: () => navigator.clipboard?.writeText(site.url).then(() => toast(t('common.copied'))) },
    { divider: true },
    {
      label: t('site.moveGroup'), icon: '🗂',
      hint: groups.length ? '' : t('group.none'),
      action: groups.length ? () => groupPicker(e, site) : null,
      disabled: !groups.length,
    },
    { label: t('site.moveFolder'), icon: '📁', action: () => folderPicker(e, site) },
    ...(inFolder || site.folder ? [{ label: t('folder.removeFrom'), icon: '⤴', action: () => { updateSite(site.id, { folder: null }); renderSites(); } }] : []),
    { divider: true },
    { label: t('common.delete'), icon: '🗑', danger: true, action: async () => {
      if (await confirmDialog(t('site.deleteConfirm', { name: site.name }))) { removeSite(site.id); renderSites(); }
    } },
  ];
  openMenu(e.clientX, e.clientY, menu);
}

function groupPicker(e, site) {
  const items = [{ label: t('group.all'), checked: site.group === 'all', action: () => { updateSite(site.id, { group: 'all' }); renderSites(); } }]
    .concat(state.cfg.groups.map((g) => ({
      label: g.name,
      checked: site.group === g.id,
      action: () => { updateSite(site.id, { group: g.id }); renderSites(); },
    })));
  openMenu(e.clientX + 160, e.clientY, items);
}

function folderPicker(e, site) {
  const items = [{ label: t('folder.none'), checked: !site.folder, action: () => { updateSite(site.id, { folder: null }); renderSites(); } }]
    .concat(state.folders.map((f) => ({
      label: f.name,
      checked: site.folder === f.id,
      action: () => { updateSite(site.id, { folder: f.id }); renderSites(); },
    })))
    .concat([{ divider: true }, { label: t('folder.new'), icon: '+', action: async () => {
      const name = await promptDialog({ title: t('folder.new'), placeholder: t('folder.namePlaceholder') });
      if (!name) return;
      const f = addFolder(name);
      updateSite(site.id, { folder: f.id });
      renderSites();
    } }]);
  openMenu(e.clientX + 160, e.clientY, items);
}

/* ── 新增 / 编辑网站（C2） ──────────────────────────── */
export function openSiteEditor(site = null) {
  const isNew = !site;
  const draft = site
    ? { ...site, icon: { ...(site.icon || { kind: 'favicon' }) } }
    : { id: null, name: '', url: '', group: state.cfg.activeGroup === 'all' ? 'all' : state.cfg.activeGroup, folder: null, icon: { kind: 'favicon', value: '' } };

  const nameInput = el('input', { class: 'input', type: 'text', value: draft.name, placeholder: t('site.nameExample') });
  const urlInput = el('input', { class: 'input', type: 'text', value: draft.url, placeholder: 'https://…' });
  const preview = el('div', { class: 'icon-preview' });

  const groupSel = el('select', { class: 'input' },
    [{ id: 'all', name: t('group.all') }, ...state.cfg.groups].map((g) =>
      el('option', { value: g.id, text: g.name, selected: g.id === draft.group ? '' : null })));
  const folderSel = el('select', { class: 'input' },
    [{ id: '', name: t('folder.none') }, ...state.folders].map((f) =>
      el('option', { value: f.id, text: f.name, selected: f.id === (draft.folder || '') ? '' : null })));

  const repaint = () => {
    preview.innerHTML = '';
    const probe = { ...draft, name: nameInput.value || 'A', url: urlInput.value || 'https://example.com', icon: draft.icon };
    preview.append(makeIcon(probe, { size: 64, radius: 18 }));
  };
  nameInput.addEventListener('input', repaint);
  urlInput.addEventListener('input', () => {
    if (!isNew && draft.icon.kind !== 'favicon') return;
    repaint();
  });

  const pickIconBtn = el('button', {
    class: 'btn', type: 'button', text: t('site.chooseIcon'),
    onclick: () => {
      openIconPicker({ ...draft, url: urlInput.value || draft.url, name: nameInput.value || draft.name }, (icon) => {
        draft.icon = icon;
        repaint();
      }, { draftOnly: true });
    },
  });

  const body = el('div', { class: 'site-editor' }, [
    el('div', { class: 'editor-top' }, [preview, el('div', { class: 'editor-fields' }, [
      el('div', { class: 'field' }, [el('label', { text: t('site.name') }), nameInput]),
      el('div', { class: 'field' }, [el('label', { text: t('site.url') }), urlInput]),
    ])]),
    el('div', { class: 'field-row' }, [
      el('div', { class: 'field' }, [el('label', { text: t('site.group') }), groupSel]),
      el('div', { class: 'field' }, [el('label', { text: t('site.folder') }), folderSel, el('button', {
        class: 'btn-mini', type: 'button', text: '+ ' + t('folder.new'),
        onclick: async () => {
          const nm = await promptDialog({ title: t('folder.new'), placeholder: t('folder.namePlaceholder') });
          if (!nm) return;
          const f = addFolder(nm);
          const opt = el('option', { value: f.id, text: f.name, selected: '' });
          folderSel.append(opt);
          folderSel.value = f.id;
        },
      })]),
    ]),
    el('div', { class: 'field' }, [el('label', { text: t('site.icon') }), pickIconBtn]),
  ]);
  repaint();

  openDialog({
    title: isNew ? t('site.add') : t('site.edit'),
    body,
    okText: t('common.save'),
    onOk: () => {
      const name = nameInput.value.trim();
      const raw = urlInput.value.trim();
      if (!raw) { toast(t('err.needUrl')); return false; }
      const url = normalizeUrl(raw);
      const payload = {
        name: name || hostGuess(url),
        url,
        group: groupSel.value,
        folder: folderSel.value || null,
        icon: draft.icon,
      };
      if (isNew) addSite(payload);
      else updateSite(site.id, payload);
      renderSites();
      return true;
    },
  });
}

/* ── 图标选择器（C4 C5 C6） ─────────────────────────── */
const ICON_LIB = [
  ['GitHub', 'github.com'], ['Google', 'google.com'], ['YouTube', 'youtube.com'], ['Bilibili', 'bilibili.com'],
  ['微博', 'weibo.com'], ['知乎', 'zhihu.com'], ['豆瓣', 'douban.com'], ['小红书', 'xiaohongshu.com'],
  ['X', 'x.com'], ['Reddit', 'reddit.com'], ['Pixiv', 'pixiv.net'], ['Bing', 'bing.com'],
  ['Notion', 'notion.so'], ['Figma', 'figma.com'], ['Spotify', 'spotify.com'], ['Gmail', 'mail.google.com'],
  ['Telegram', 'telegram.org'], ['Discord', 'discord.com'], ['Wikipedia', 'wikipedia.org'], ['Archive', 'archive.org'],
  ['AO3', 'archiveofourown.org'], ['晋江', 'jjwxc.net'], ['少数派', 'sspai.com'], ['DeepSeek', 'deepseek.com'],
];

export function openIconPicker(site, onPick = null, { draftOnly = false } = {}) {
  const apply = (icon) => {
    if (onPick) onPick(icon);
    else { updateSite(site.id, { icon }); renderSites(); }
  };

  const tabs = el('div', { class: 'tabs' });
  const pane = el('div', { class: 'icon-pane' });

  const tabDefs = [
    ['favicon', t('icon.favicon')],
    ['library', t('icon.library')],
    ['letter', t('icon.letter')],
    ['upload', t('icon.upload')],
    ['url', t('icon.url')],
  ];
  let cur = 'favicon';

  const render = () => {
    tabs.innerHTML = '';
    for (const [id, label] of tabDefs) {
      const b = el('button', { class: `tab${id === cur ? ' active' : ''}`, type: 'button', text: label });
      b.addEventListener('click', () => { cur = id; render(); });
      tabs.append(b);
    }
    pane.innerHTML = '';
    if (cur === 'favicon') {
      pane.append(el('p', { class: 'hint', text: t('icon.faviconHint') }));
      const row = el('div', { class: 'icon-row' }, [makeIcon(site, { size: 64, radius: 16 })]);
      const use = el('button', { class: 'btn primary', type: 'button', text: t('icon.use'),
        onclick: () => { apply({ kind: 'favicon', value: '' }); } });
      pane.append(row, use);
    } else if (cur === 'library') {
      const grid = el('div', { class: 'icon-grid-pick' });
      for (const [name, domain] of ICON_LIB) {
        const b = el('button', { class: 'icon-cell', type: 'button', title: name, onclick: () => {
          apply({ kind: 'url', value: `https://www.google.com/s2/favicons?domain=${domain}&sz=128` });
        } }, [el('img', { src: `https://www.google.com/s2/favicons?domain=${domain}&sz=64`, alt: name, loading: 'lazy' })]);
        grid.append(b);
      }
      pane.append(grid);
    } else if (cur === 'letter') {
      const text = el('input', { class: 'input small', type: 'text', maxlength: '2', value: letterOf(site), placeholder: 'A' });
      const color = el('input', { class: 'input color', type: 'color', value: letterColor(site) });
      const demo = el('div', { class: 'icon-row' });
      const repaint = () => {
        demo.innerHTML = '';
        demo.append(makeIcon({ ...site, icon: { kind: 'letter', value: text.value, color: color.value } }, { size: 64, radius: 16 }));
      };
      text.addEventListener('input', repaint);
      color.addEventListener('input', repaint);
      repaint();
      pane.append(el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [el('label', { text: t('icon.letterText') }), text]),
        el('div', { class: 'field' }, [el('label', { text: t('icon.color') }), color]),
      ]), demo, el('button', { class: 'btn primary', type: 'button', text: t('icon.use'), onclick: () => {
        apply({ kind: 'letter', value: text.value.slice(0, 2), color: color.value });
      } }));
    } else if (cur === 'upload') {
      const file = el('input', { class: 'input', type: 'file', accept: 'image/*' });
      const prev = el('div', { class: 'icon-row' });
      file.addEventListener('change', async () => {
        const f = file.files?.[0];
        if (!f) return;
        const data = await shrinkImage(f, 160, 0.9);
        prev.innerHTML = '';
        prev.append(el('img', { src: data, alt: '', class: 'icon-big' }));
        apply({ kind: 'data', value: data });
      });
      pane.append(el('p', { class: 'hint', text: t('icon.uploadHint') }), file, prev);
    } else if (cur === 'url') {
      const input = el('input', { class: 'input', type: 'text', placeholder: 'https://…/icon.png' });
      pane.append(el('p', { class: 'hint', text: t('icon.urlHint') }), input,
        el('button', { class: 'btn primary', type: 'button', text: t('icon.use'), onclick: () => {
          const v = input.value.trim();
          if (v) apply({ kind: 'url', value: v });
        } }));
    }
  };
  render();

  openDialog({
    title: t('icon.pick'),
    body: el('div', {}, [tabs, pane]),
    okText: null,
    cancelText: t('common.close'),
  });
}

/* ── 自由布局：图标也上画布（E2 / E3 / E5） ────────────── */

const FREE = { padX: 56, padY: 28, cols: 0, gapX: 18, gapY: 22, snap: 8 };

function snapTo(v, step = FREE.snap) {
  return Math.round(v / step) * step;
}

/** 把没有坐标的图标按行铺开（首次进自由布局 / 一键整理都用它） */
export function tidyFree({ silent = false } = {}) {
  const L = state.cfg.layout;
  const vw = Math.max(720, window.innerWidth || 1440);
  const cell = L.iconSize + 46;
  // 右侧留出组件栏的宽度，图标不要铺到组件底下去
  const reserve = state.cfg.widgets?.length ? 430 : 0;
  const usable = Math.max(cell * 3, vw - FREE.padX * 2 - reserve);
  const perRow = Math.max(3, Math.floor(usable / cell));
  const list = sitesOf();
  list.forEach((s, i) => {
    s.free = {
      x: FREE.padX + (i % perRow) * cell,
      y: FREE.padY + Math.floor(i / perRow) * (L.iconSize + 54),
    };
  });
  save('sites');
  renderFreeSites();
  if (!silent) toast(t('layout.tidyDone'));
}

/** 自由布局下把图标画到 #canvas 上 */
export function renderFreeSites() {
  const canvas = $('#canvas');
  if (!canvas) return;
  canvas.querySelectorAll('a.site.free-item').forEach((n) => n.remove());
  if (state.cfg.layout.mode !== 'free') return;

  const list = sitesOf();
  const L = state.cfg.layout;
  let missing = false;
  for (const s of list) {
    if (!s.free || typeof s.free.x !== 'number' || typeof s.free.y !== 'number') missing = true;
  }
  if (missing) {
    // 有站点还没坐标：先算布局（不 toast），保证一进自由布局就看到东西
    const vw = Math.max(720, window.innerWidth || 1440);
    const cell = L.iconSize + 46;
    const reserve = state.cfg.widgets?.length ? 430 : 0;
    const usable = Math.max(cell * 3, vw - FREE.padX * 2 - reserve);
    const perRow = Math.max(3, Math.floor(usable / cell));
    list.forEach((s, i) => {
      if (s.free && typeof s.free.x === 'number') return;
      s.free = {
        x: FREE.padX + (i % perRow) * cell,
        y: FREE.padY + Math.floor(i / perRow) * (L.iconSize + 54),
      };
    });
    save('sites');
  }

  for (const s of list) canvas.append(freeSite(s, L));
}

function freeSite(site, L) {
  const a = el('a', {
    class: 'site free-item',
    href: site.url,
    'data-id': site.id,
    title: site.name,
    style: {
      left: `${site.free.x}px`,
      top: `${site.free.y}px`,
      width: `${Math.max(72, Math.round(L.iconSize * 1.5))}px`,
    },
  }, [
    makeIcon(site, { size: L.iconSize, radius: L.iconRadius }),
    el('span', { class: 'site-name', text: site.name }),
  ]);

  let moved = false;

  a.addEventListener('click', (e) => {
    if (moved) { e.preventDefault(); moved = false; return; }
    if (e.ctrlKey || e.metaKey || e.button === 1) return;
    e.preventDefault();
    openUrl(site.url, e.shiftKey);
  });
  a.addEventListener('auxclick', (e) => {
    if (e.button === 1) { e.preventDefault(); openUrl(site.url, true); }
  });
  a.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    siteMenu(e, site);
  });

  // 拖拽（8px 吸附，E5）
  a.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const x0 = site.free.x;
    const y0 = site.free.y;
    moved = false;
    a.setPointerCapture(e.pointerId);
    a.classList.add('dragging');

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      const x = Math.max(0, snapTo(x0 + dx));
      const y = Math.max(0, snapTo(y0 + dy));
      a.style.left = `${x}px`;
      a.style.top = `${y}px`;
      site.free.x = x;
      site.free.y = y;
    };
    const onUp = () => {
      a.releasePointerCapture?.(e.pointerId);
      a.classList.remove('dragging');
      a.removeEventListener('pointermove', onMove);
      a.removeEventListener('pointerup', onUp);
      a.removeEventListener('pointercancel', onUp);
      if (moved) save('sites');
    };
    a.addEventListener('pointermove', onMove);
    a.addEventListener('pointerup', onUp);
    a.addEventListener('pointercancel', onUp);
  });

  return a;
}

/* ── 书签导入入口（C10） ────────────────────────────── */
export { groupsFlat };
