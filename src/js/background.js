// background.js —— 后台：快捷键、右键菜单、每日壁纸预热、首次安装

const api = globalThis.browser ?? globalThis.chrome;
const NEWTAB = 'newtab.html';

api.runtime.onInstalled.addListener(async (details) => {
  try {
    api.contextMenus.removeAll(() => {
      api.contextMenus.create({
        id: 'lumen-add-link',
        title: api.i18n.getMessage('menuAddLink') || '添加到 Lumen',
        contexts: ['link', 'page'],
      });
      api.contextMenus.create({
        id: 'lumen-open-settings',
        title: api.i18n.getMessage('menuSettings') || 'Lumen 设置',
        contexts: ['action'],
      });
    });
  } catch (e) {
    console.warn('contextMenus failed', e);
  }

  if (details.reason === 'install') {
    // 让新标签页预热一次必应图片缓存
    try {
      await fetch('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN', { cache: 'no-store' });
    } catch { /* 离线就算了 */ }
  }
});

/* 右键菜单：把链接 / 当前页 加进 Lumen */
api.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'lumen-open-settings') {
    const [t0] = await api.tabs.query({ url: api.runtime.getURL('*') });
    if (t0) {
      await api.tabs.update(t0.id, { active: true });
      api.tabs.sendMessage(t0.id, { type: 'open-settings' }).catch(() => {});
    } else {
      await api.tabs.create({ url: api.runtime.getURL(NEWTAB) });
    }
    return;
  }
  if (info.menuItemId !== 'lumen-add-link') return;
  const url = info.linkUrl || info.pageUrl;
  if (!url) return;
  const name = info.linkText || tab?.title || url;
  const site = { name: String(name).slice(0, 40).trim(), url };

  const tabs = await api.tabs.query({ url: api.runtime.getURL('*') });
  const target = tabs.find((t) => t.url.includes('newtab.html')) || tabs[0];
  if (target) {
    await api.tabs.sendMessage(target.id, { type: 'add-site', site }).catch(() => {});
    await api.tabs.update(target.id, { active: true });
  } else {
    await api.storage.local.set({ pendingSite: site });
    await api.tabs.create({ url: api.runtime.getURL(NEWTAB) });
  }
});

/* 工具栏按钮：点一下打开新标签页 */
api.action?.onClicked.addListener(async (tab) => {
  const tabs = await api.tabs.query({ url: api.runtime.getURL('*') });
  const target = tabs.find((t) => t.url.includes('newtab.html'));
  if (target) {
    await api.tabs.update(target.id, { active: true });
    api.tabs.sendMessage(target.id, { type: 'focus-search' }).catch(() => {});
  } else {
    await api.tabs.create({ url: api.runtime.getURL(NEWTAB) });
  }
});

/* 快捷键（H5） */
api.commands?.onCommand.addListener(async (command) => {
  if (command === 'focus-search') {
    const tabs = await api.tabs.query({ url: api.runtime.getURL('*') });
    const target = tabs.find((t) => t.url.includes('newtab.html'));
    if (target) {
      await api.tabs.update(target.id, { active: true });
      api.tabs.sendMessage(target.id, { type: 'focus-search' }).catch(() => {});
    } else {
      await api.tabs.create({ url: api.runtime.getURL(NEWTAB) });
    }
  } else if (command === 'open-settings') {
    const tabs = await api.tabs.query({ url: api.runtime.getURL('*') });
    const target = tabs.find((t) => t.url.includes('newtab.html'));
    if (target) {
      await api.tabs.update(target.id, { active: true });
      api.tabs.sendMessage(target.id, { type: 'open-settings' }).catch(() => {});
    } else {
      await api.tabs.create({ url: api.runtime.getURL(NEWTAB) });
    }
  }
});

/* 每天预热一次必应壁纸，顺便清掉过期缓存（低占用 H6：一天一次） */
api.alarms?.create('lumen-bing', { periodInMinutes: 60 * 12 });
api.alarms?.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'lumen-bing') return;
  try {
    const { wall } = await api.storage.local.get('wall');
    const today = new Date().toISOString().slice(0, 10);
    if (wall?.bingCache?.date === today) return;
    const r = await fetch('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN', { cache: 'no-store' });
    const j = await r.json();
    const img = j?.images?.[0];
    if (!img) return;
    const base = img.urlbase?.startsWith('http') ? img.urlbase : `https://www.bing.com${img.urlbase}`;
    await api.storage.local.set({
      wall: { ...(wall || {}), bingCache: { date: today, url: `${base}_UHD.jpg`, copyright: img.copyright || '' } },
    });
  } catch { /* 忽略 */ }
});
