# JustMusic — 在线听歌（v2）

一个纯静态的多源在线听歌页面：输入歌名或歌手，一次搜索同时查
QQ / 网易云 / 酷我 / 咪咕 / 汽水，点某一首就用它自己的音源解析播放，
歌词显示在“正在播放”卡片里。
没有后端、没有构建步骤，只有 `index.html` + `app.js` + `style.css`，
可以直接部署到 GitHub Pages。

## 为什么 v1 只显示 3 首

v1 的搜索是单源切换：一次只查一个音源，而且酷我 / 咪咕走的
oiapi 接口每页只返回 1 首歌，v1 只循环了 3 页，所以一次最多 3 条。
另外 QQ 在溯音 / 非常刀的脚本里只有取链（而且需要 Key）、没有搜索，
所以 v1 干脆省略了 QQ。

## v2 改了什么

- **聚合搜索**：一个搜索框同时查 5 个源（`Promise.allSettled`，
  某个源挂了不影响其他源），每源默认最多 10 首，按“歌名 + 歌手”去重后合并。
- **分组展示 + 源标签**：结果按 QQ / 网易云 / 酷我 / 咪咕 / 汽水
  分组，每组有标题和数量，每首歌都有源标签（QQ / 网易云 / 酷我 / 咪咕 / 汽水）。
  上方的筛选（全部 / QQ / 网易云 / 酷我 / 咪咕 / 汽水）只过滤已搜到的结果，
  不会重新搜索。
- **QQ 加回来了**：搜索走 oiapi `QQ_Music?keyword=`（不嵌 Key），
  取链首选星海 `types=url&source=tencent`。
- **点歌用对应音源解析**：点哪首，就用那首自己的源去拿播放链接，
  每个源有自己的回退链（`Promise.any` 竞速，各 8 秒超时，5 分钟缓存）。
- **歌词搬进“正在播放”卡片**：删掉了原来右侧独立的歌词栏。
  现在页面是单列：搜索卡片 → 结果列表（全宽）→ 正在播放卡片
  （封面、歌名、歌手、源标签、音质 + 歌词面板，歌词可滚动、当前行高亮自动滚动）
  → 底部固定播放器。没在播时显示“搜一首歌，点它开始播放，歌词会在这里显示”。

## 音源逻辑来源

改编自 [Mac-XK/KMusic](https://github.com/Mac-XK/KMusic) 仓库根目录的
**非常刀.js v5**（lx-music 格式脚本），并参考了**溯音音源** v1
的酷我 / 咪咕搜索式取链。

原脚本跑在 lx-music 的 `globalThis.lx.request()` 环境里；
本站把它的请求全部改写为浏览器原生 `fetch()`（`AbortController` 超时），
不依赖任何 lx 运行时。本站不嵌入任何 API Key。

### 搜索（每源最多 10 首）

| 音源 | 主线搜索 | 星海补充搜索 |
| --- | --- | --- |
| QQ音乐 `tx` | `oiapi.net/api/QQ_Music?keyword=&limit=10` | 星海 `types=search&source=tencent`（实测不稳定，见下） |
| 网易云 `wy` | `api.chksz.top/api/163_search?keyword=&limit=10`（仍超时，仅作回退） | 星海 `types=search&source=netease` |
| 酷我 `kw` | `oiapi.net/api/Kuwo?msg=&n=<页>`，循环 1–10 页（每页 1 首） | 星海 `types=search&source=kuwo` |
| 咪咕 `mg` | `api.xcvts.cn/api/music/migu?gm=&n=<页>`，循环 1–10 页（每页 1 首） | 星海 `types=search&source=migu` |
| 汽水 `qs` | `api-vehicle.volcengine.com/v2/search/type?keyword=&search_type=music&limit=10` | 无星海源 |

星海搜索地址：`https://music-api.gdstudio.xyz/api.php?…&types=search&source=<源>&name=<关键词>&count=10&pages=1`，
返回数组（含 `id`、`name`、`artist`、`album`、`pic_id`、`url_id`、`lyric_id`、`source`）。
封面只用接口实际返回的 `pic` / `picUrl` / `cover_url` / `cover` / `image` 字段，
不拿 `pic_id` 拼地址。

### 取播放链接（点哪首，用哪源）

| 音源 | 回退链（`Promise.any` 竞速） |
| --- | --- |
| 网易云 `wy` | 星海（netease）→ CHKSZ `163_music` → 溯音163 → 长青 → 念心 |
| QQ音乐 `tx` | 星海（tencent，320k 失败再试 128k）；失败就明确报错，不用 Key |
| 酷我 `kw` | 星海（kuwo）→ 溯音酷我（搜索式）→ 长青 → 念心 |
| 咪咕 `mg` | 星海（migu）→ 溯音咪咕（搜索式）→ 长青 → 念心 → 搜索时已返回的 `music_url` |
| 汽水 `qs` | 汽水 H5（`api.qishui.com/luna/h5/track`） |

### 歌词

先试星海 `types=lyric&id=<lyric_id 或 id>&source=<源>`（兼容 JSON
`{lyric}` / `{lrc}` / `{data}` 和纯 LRC 文本）；汽水再试 H5 的
`lyric.content`（KRC 转 LRC）。都拿不到就显示“暂无歌词”。
没有为其他音源编造歌词接口。

## 部署到 GitHub Pages（Vaerios/JustMusic）

把这 5 个文件传到 `main` 分支根目录即可：

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
- 星海（聚合搜索 / 全平台直链 / 歌词）——现在是补充源，不是主源
- 溯音 oiapi（网易 / 酷我 / QQ 搜索）
- 咪咕（搜索 / 直链）

汽水搜索 / H5 与长青 / 念心模板地址写在 `app.js` 顶部的常量中，
改代码即可换地址。

## 已知限制（实测）

- **星海不稳定**：2026-11-09 14:57–14:58 实测搜“春庭雪”，
  星海 netease 和 kuwo 都是 HTTP 503，tencent 先返回
  “`source` is not supported”，刷新后也变 503，0 首。
  所以 v2 里星海只是补充源，主线是各源自己的搜索；它恢复后会自动参与合并。
- **网易云 CHKSZ 仍超时**：2026-11-09 全天多次实测 `api.chksz.top`
  连接超时，无 HTTP 状态。网易云搜索目前主要靠星海（它也不稳），
  恢复前网易云分组可能暂无结果，那是接口问题不是网站问题。
- 依赖第三方公开接口：如果某个接口挂了、被封或不允许浏览器跨域（CORS），
  对应音源会搜索失败或解析失败，页面会明确提示，换个音源试试。
  自己部署一份后端接口是最稳的办法，但 GitHub Pages 本身跑不了后端。
- 酷我 / 咪咕的 oiapi 搜索每页只返回 1 首歌，v2 循环 10 页，
  所以每源最多 10 条；如果接口提前返回空，后面的页就不再试。
- 咪咕搜索不返回稳定的数字歌曲 id，取链主要靠“溯音咪咕”搜索式回退
  （按歌名 + 歌手再查一次），以及搜索时已返回的 `music_url`。
- 音质档位只有 128k / 320k / FLAC；部分歌曲没有高音质直链时会自动回退到低音质。
- 仅供个人学习使用，音乐版权归原作者所有，请勿商用。

## 文件清单

| 文件 | 说明 |
| --- | --- |
| `index.html` | 页面结构：搜索框、音质、热门搜索、筛选、分组结果列表、正在播放卡片（内含歌词）、底部播放器、接口设置 |
| `app.js` | 全部逻辑：聚合搜索、去重、取链竞速、缓存、歌词、播放控制、设置 |
| `style.css` | 深色毛玻璃样式，单列布局，移动端适配 |
| `README.md` | 本文件 |
| `.nojekyll` | 空文件，告诉 GitHub Pages 不要用 Jekyll 处理 |
