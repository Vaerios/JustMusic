# JustMusic — 在线听歌

一个纯静态的多源在线听歌页面：输入歌名或歌手，搜歌、点歌、听歌、看歌词。
没有后端、没有构建步骤，只有 `index.html` + `app.js` + `style.css`，
可以直接部署到 GitHub Pages。

## 音源逻辑来源

改编自 [Mac-XK/KMusic](https://github.com/Mac-XK/KMusic) 仓库根目录的
**非常刀.js v5**（lx-music 格式脚本）。

原脚本跑在 lx-music 的 `globalThis.lx.request()` 环境里；
本站把它的请求全部改写为浏览器原生 `fetch()`（`AbortController` 超时），
不依赖任何 lx 运行时。

按原脚本实现的音源（搜索 + 取链）：

| 音源 | 搜索 | 取播放链接（竞速 / 回退） |
| --- | --- | --- |
| 网易云 `wy` | `api.chksz.top/api/163_search` | CHKSZ → 星海 → 溯音163 → 长青 → 念心（`Promise.any` 竞速，各 8 秒超时，5 分钟缓存） |
| 酷我 `kw` | `oiapi.net/api/Kuwo`（每页 1 首，循环 1–3 页） | 星海 → 溯音酷我（搜索式）→ 长青 → 念心 |
| 咪咕 `mg` | `api.xcvts.cn/api/music/migu`（每页 1 首，循环 1–3 页） | 星海 → 溯音咪咕（搜索式）→ 长青 → 念心 → 搜索时已返回的 `music_url` |
| 汽水 `qs` | `api-vehicle.volcengine.com/v2/search/type` | 汽水 H5（`api.qishui.com/luna/h5/track`） |

歌词：**只有汽水保证提供歌词**（KRC 转 LRC，滚动高亮）。
其他音源没有可用的歌词接口，本站不编造歌词接口，统一显示“暂无歌词”。

没有 QQ 音乐：原脚本的 QQ 取链需要一个 API Key，
本站不嵌入任何 Key，因此完全省略 QQ 取链。

## 部署到 GitHub Pages（Vaerios/JustMusic）

仓库是空的，把这 5 个文件传到 `main` 分支根目录即可：

- `index.html`
- `app.js`
- `style.css`
- `README.md`
- `.nojekyll`（空文件，防止 GitHub Pages 按 Jekyll 处理）

步骤：

1. 在 GitHub 上打开 `Vaerios/JustMusic`，点 `Add file` → `Upload files`，
   把上面 5 个文件拖进去，提交到 `main` 分支。
   （也可以用 `git clone` 后复制文件再 `push`。）
2. 打开仓库 `Settings` → `Pages`，`Build and deployment` 的 `Source` 选
   `Deploy from a branch`，`Branch` 选 `main`、`/ (root)`，点 `Save`。
3. 等一两分钟，打开 `https://vaerios.github.io/JustMusic/` 即可使用。

## 换 API 地址

页面底部有“接口设置”，可改 4 个 API 地址，保存在本机浏览器
（`localStorage`，键名 `justmusic-api-bases`），点“恢复默认”可还原：

- CHKSZ（网易云搜索 / 直链）
- 星海（全平台直链）
- 溯音 oiapi（网易 / 酷我）
- 咪咕（搜索 / 直链）

汽水搜索 / H5 与长青 / 念心模板地址写在 `app.js` 顶部的常量中，
改代码即可换地址。

## 已知限制

- 2026-11-09 13:11（Asia/Shanghai）实测：酷我搜索可用（搜“春庭雪”返回邓寓君原唱，320k 直链），汽水搜索可用（返回 5 条，多为翻唱/DJ 版）；网易云搜索 `api.chksz.top` 连接超时不可达，咪咕搜索返回 502“接口均不可用”。因此默认音源已改为酷我，网易云仍可手动切换，等 `api.chksz.top` 恢复后再用。
- 依赖第三方公开接口：如果某个接口挂了、被封或不允许浏览器跨域（CORS），
  对应音源会搜索失败或解析失败，页面会明确提示，换个音源试试。
  自己部署一份后端接口是最稳的办法，但 GitHub Pages 本身跑不了后端。
- 酷我 / 咪咕搜索每页只返回 1 首歌，所以一次搜索最多 3 条结果，这是接口本身的限制。
- 咪咕搜索不返回稳定的数字歌曲 id，取链主要靠“溯音咪咕”搜索式回退
  （按歌名 + 歌手再查一次），以及搜索时已返回的 `music_url`。
- 音质档位只有 128k / 320k / FLAC；部分歌曲没有高音质直链时会自动回退到低音质。
- 仅供个人学习使用，音乐版权归原作者所有，请勿商用。

## 文件清单

| 文件 | 说明 |
| --- | --- |
| `index.html` | 页面结构：搜索框、音源切换、音质、热门搜索、结果列表、歌词面板、底部播放器、接口设置 |
| `app.js` | 全部逻辑：搜索、取链竞速、缓存、歌词、播放控制、设置 |
| `style.css` | 深色毛玻璃样式，移动端适配 |
| `README.md` | 本文件 |
| `.nojekyll` | 空文件，告诉 GitHub Pages 不要用 Jekyll 处理 |
