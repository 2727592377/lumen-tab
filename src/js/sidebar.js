// sidebar.js —— 侧边栏（H2）：紧凑图标列表 + 快速搜索

import { boot, state, sitesOf, groupsFlat, setActiveGroup, save, pushHistory } from './store.js';
import { $, el, normalizeUrl, debounce, hostOf } from './util.js';
import { makeIcon } from './favicon.js';
import { t, setLang, applyI18n } from './i18n.js';
import { evaluateMath } from './search.js';

const api = globalThis.browser ?? globalThis.chrome;

async function main() {
  setLang(localStorage.getItem('lumen.lang') || 'zh');
  await boot();
  applyI18n(document);
  document.body.classList.toggle('light', state.cfg.theme === 'light');
  document.documentElement.style.setProperty('--accent', state.cfg.accent || '#6aa8ff');

  renderGroups();
  renderList();
  wire();
}

function renderGroups() {
  const bar = $('#sb-groups');
  bar.innerHTML = '';
  for (const g of groupsFlat()) {
    const b = el('button', {
      class: `sb-chip${(state.cfg.activeGroup || 'all') === g.id ? ' active' : ''}`,
      type: 'button', text: g.name,
    });
    b.addEventListener('click', () => { setActiveGroup(g.id); renderGroups(); renderList(); });
    bar.append(b);
  }
}

function renderList(filter = '') {
  const host = $('#sb-list');
  host.innerHTML = '';
  let list = sitesOf();
  if (filter) {
    const q = filter.toLowerCase();
    list = list.filter((s) => s.name.toLowerCase().includes(q) || s.url.toLowerCase().includes(q));
  }
  if (!list.length) {
    host.append(el('p', { class: 'sb-empty', text: t('common.empty') }));
    return;
  }
  for (const s of list) {
    const a = el('a', { class: 'sb-item', href: s.url, title: s.name }, [
      makeIcon(s, { size: 26, radius: 8 }),
      el('span', { class: 'sb-name', text: s.name }),
    ]);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const cur = (globalThis.browser ?? globalThis.chrome);
      // 侧边栏里点开：优先新标签页，否则当前页就是侧边栏宿主
      window.open(s.url, '_blank', 'noopener');
    });
    host.append(a);
  }
}

function wire() {
  const q = $('#sb-q');
  q.addEventListener('input', debounce(() => renderList(q.value.trim()), 120));
  q.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const v = q.value.trim();
    if (!v) return;
    const math = evaluateMath(v);
    if (math !== null) {
      navigator.clipboard?.writeText(math);
      q.value = '';
      return;
    }
    const eng = state.cfg.engines.find((x) => x.id === state.cfg.search.engine) || state.cfg.engines[0];
    pushHistory(v);
    window.open(eng.url.replace('{{q}}', encodeURIComponent(v)), '_blank', 'noopener');
    q.value = '';
  });
  $('#sb-newtab')?.addEventListener('click', () => {
    api?.tabs?.create({ url: api.runtime.getURL('newtab.html') });
  });
  $('#sb-settings')?.addEventListener('click', () => {
    api?.tabs?.create({ url: api.runtime.getURL('newtab.html') + '#settings' });
  });
}

main().catch((e) => console.error(e));
