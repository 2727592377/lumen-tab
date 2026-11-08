// ui.js —— 通用浮层：右键菜单、模态对话框、确认框

import { $, el, esc } from './util.js';
import { t } from './i18n.js';

let openMenus = [];

/**
 * 显示 / 收起承载浮层的 <dialog id="dialog">
 * 原生 <dialog> 必须走 showModal()，加 class 是不会让它出现的。
 */
export function showHost(host) {
  if (!host) return;
  if (!host._lumenBound) {
    // Esc 关闭原生 <dialog> 时同步摘掉 open 类，让确认框/输入框的观察器能收到
    host.addEventListener('close', () => {
      host.classList.remove('open');
      host.innerHTML = '';
    });
    host._lumenBound = true;
  }
  host.className = 'dialog';
  if (typeof host.showModal === 'function') {
    if (!host.open) {
      host.classList.add('open');
      host.showModal();
    }
  } else {
    host.classList.add('open');
  }
}

export function hideHost(host) {
  if (!host) return;
  host.classList.remove('open');
  host.innerHTML = '';
  if (typeof host.close === 'function' && host.open) host.close();
}

export function closeMenus() {
  for (const m of openMenus) m.remove();
  openMenus = [];
}

/** @param {{label:string, action?:Function, danger?:boolean, checked?:boolean, divider?:boolean, disabled?:boolean}[]} list */
export function openMenu(x, y, list, { align = 'left' } = {}) {
  closeMenus();
  const menu = el('div', { class: 'menu' });
  for (const item of list) {
    if (item.divider) { menu.append(el('div', { class: 'menu-divider' })); continue; }
    const mi = el('button', {
      class: `mi${item.danger ? ' danger' : ''}${item.checked ? ' checked' : ''}`,
      type: 'button',
      disabled: item.disabled || undefined,
    }, [
      el('span', { class: 'mi-ico', text: item.icon || (item.checked ? '✓' : '') }),
      el('span', { class: 'mi-label', text: item.label }),
      item.hint ? el('span', { class: 'mi-hint', text: item.hint }) : null,
    ]);
    mi.addEventListener('click', () => {
      closeMenus();
      item.action?.();
    });
    menu.append(mi);
  }
  document.body.append(menu);
  openMenus.push(menu);

  // 定位：贴边翻转
  const r = menu.getBoundingClientRect();
  let left = x, top = y;
  if (left + r.width > innerWidth - 8) left = x - r.width;
  if (top + r.height > innerHeight - 8) top = y - r.height;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.classList.add('in');
  return menu;
}

document.addEventListener('pointerdown', (e) => {
  if (!openMenus.some((m) => m.contains(e.target))) closeMenus();
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
window.addEventListener('blur', closeMenus);

/**
 * 模态框
 * @param {{title:string, body:HTMLElement|string, okText?:string, cancelText?:string, onOk?:Function, wide?:boolean}} opt
 */
export function openDialog(opt) {
  const host = $('#dialog');
  if (!host) return;
  host.innerHTML = '';
  const body = typeof opt.body === 'string'
    ? el('div', { text: opt.body })
    : opt.body;
  const foot = el('div', { class: 'dlg-foot' });
  const dlg = el('div', { class: `dlg${opt.wide ? ' wide' : ''}` }, [
    el('div', { class: 'dlg-head' }, [
      el('h3', { text: opt.title || '' }),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'close', onclick: close }, ['✕']),
    ]),
    el('div', { class: 'dlg-body' }, [body]),
    foot,
  ]);
  if (opt.okText !== null) {
    foot.append(el('button', {
      class: 'btn primary', type: 'button', text: opt.okText || t('common.ok'),
      onclick: async () => {
        const keep = opt.onOk ? await opt.onOk() : false;
        if (keep !== false) close();
      },
    }));
  }
  foot.append(el('button', {
    class: 'btn', type: 'button', text: opt.cancelText || t('common.cancel'),
    onclick: close,
  }));

  host.append(dlg);
  showHost(host);
  const first = dlg.querySelector('input, textarea, select');
  setTimeout(() => first?.focus(), 30);

  function close() {
    hideHost(host);
    host.innerHTML = '';
  }
  return { close, dlg, body };
}

export function confirmDialog(text, { okText, danger = true } = {}) {
  return new Promise((res) => {
    let done = false;
    const body = el('p', { class: 'confirm-text', text });
    const ref = openDialog({
      title: t('dialog.confirm'),
      body,
      okText: okText || t('common.ok'),
      onOk: () => { done = true; res(true); return true; },
    });
    // 取消 / 点空白 也返回 false
    const host = $('#dialog');
    const obs = new MutationObserver(() => {
      if (!host.classList.contains('open') && !done) { done = true; obs.disconnect(); res(false); }
    });
    obs.observe(host, { attributes: true, attributeFilter: ['class'] });
    return ref;
  });
}

export function promptDialog({ title, label = '', value = '', placeholder = '', okText } = {}) {
  return new Promise((res) => {
    let val = value;
    const input = el('input', { class: 'input', type: 'text', value, placeholder });
    input.addEventListener('input', () => { val = input.value; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('#dialog .btn.primary')?.click(); }
    });
    const body = el('div', { class: 'field' }, [label ? el('label', { text: label }) : null, input]);
    let ok = false;
    openDialog({
      title,
      body,
      okText: okText || t('common.ok'),
      onOk: () => { ok = true; res(val.trim()); return true; },
    });
    const host = $('#dialog');
    const obs = new MutationObserver(() => {
      if (!host.classList.contains('open') && !ok) { obs.disconnect(); res(null); }
    });
    obs.observe(host, { attributes: true, attributeFilter: ['class'] });
  });
}

export function toastEl(msg) {
  const host = $('#toast');
  if (!host) return;
  host.textContent = msg;
  host.classList.add('show');
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => host.classList.remove('show'), 2200);
}
