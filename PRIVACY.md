# 流明 Lumen 隐私政策 / Privacy Policy

最后更新 Last updated：2026-11-08

---

## 中文

流明不收集、不上传、不分享任何个人数据。没有账号，没有服务器，没有埋点。

### 保存了什么

所有设置、图标、壁纸、待办、便签、订阅源，都保存在你自己浏览器的 `storage.local`
（以及 localStorage 的图标缓存）里。卸载扩展时这些数据一并删除。我们没有服务器，
也没有任何接收数据的端点。

### 什么情况下会向外发请求

只有这几种，全部由你的操作触发：

1. **搜索**：你在搜索框提交的关键词，会发给当前选中的搜索引擎（默认 Bing，可在设置里改）。
2. **图标**：站点图标的获取由 DuckDuckGo 的图标服务或站点自身提供，请求里只包含域名。
3. **壁纸**：必应每日一图接口，请求里只有日期和语言。
4. **组件**：热度榜（百度 / B站 / 微博 / 抖音的公开接口）、影视日历（豆瓣公开接口）、
   翻译（MyMemory 公开接口）、网速测试（Cloudflare 测速端点）—— 仅在你启用对应组件时请求。
5. **订阅**：你在「订阅」组件里自己填的 RSS / Atom 源地址。
6. **AI 组件**：只请求你自己填写的接口地址，密钥存在本地，不经过我们。

这些第三方服务各自的隐私政策适用于它们收到的数据。

### 我们不做的事

- 不收集浏览历史，不读取你访问过的页面内容（扩展只在你打开新标签页或侧边栏时运行）。
- 不上传书签（书签 API 只用于「一键导入到图标桌面」，且只读）。
- 没有账号系统，没有埋点，没有远程配置。
- 不向第三方出售或转让任何数据。

### 联系

通过 AMO 页面的「支持站点」或 GitHub issue 反馈。

---

## English

Lumen does not collect, upload or share any personal data. There is no account, no server
and no analytics.

### What is stored

All settings, icons, wallpapers, to-dos, notes and feeds are stored in your own browser's
`storage.local` (plus an icon cache in localStorage). Uninstalling the add-on deletes them.
We run no server and have no endpoint that receives data.

### When the add-on talks to the network

Only these, all triggered by your own actions:

1. **Search** — the keywords you submit are sent to the search engine currently selected
   (Bing by default, configurable in settings).
2. **Icons** — site icons are fetched from DuckDuckGo's icon service or from the site itself;
   the request contains only the domain name.
3. **Wallpaper** — Bing's daily image endpoint; the request carries only date and language.
4. **Widgets** — trending lists (public endpoints of Baidu / Bilibili / Weibo / Douyin),
   movie calendar (public Douban endpoint), translation (public MyMemory endpoint),
   speed test (Cloudflare endpoint) — only while the corresponding widget is enabled.
5. **Feeds** — the RSS / Atom URLs you add to the Feeds widget yourself.
6. **AI widget** — only the endpoint you configure yourself; the key stays local and never
   passes through us.

The privacy policies of those third parties apply to the data they receive.

### What we do not do

- We do not collect browsing history or read the pages you visit (the add-on only runs on
  the new tab page and the sidebar you open).
- We do not upload bookmarks (the bookmarks API is used read-only, for one-click import
  onto the icon grid).
- No accounts, no analytics, no remote configuration.
- We never sell or transfer any data.

### Contact

Use the "Support site" link on the AMO page, or open a GitHub issue.
