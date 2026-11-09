'use strict';
/*
 * JustMusic v3 — Apple Music 风格改版（浅色、左侧栏、红色点缀）。
 * 搜索 / 播放逻辑与 v2 完全一致，只改了界面，另加每源状态显示
 * （搜索后每源一行 ✓ 有结果 / ✗ 暂无结果，数据来自 Promise.allSettled，不发新请求）。
 * JustMusic v2 — 纯静态多源听歌页，无构建、无后端、无 lx 运行时。
 * 音源逻辑改编自 Mac-XK/KMusic 仓库根目录的「非常刀.js」v5
 * （lx-music 格式脚本，原脚本用 globalThis.lx.request()；
 * 这里全部改写为浏览器原生 fetch()），并参考了「溯音音源」v1
 * 的酷我 / 咪咕搜索式取链。
 *
 * v2 聚合搜索（2026-11-09 14:57–14:58 实测结论）：
 * 星海统一接口 music-api.gdstudio.xyz 当时搜“春庭雪”时
 * netease / kuwo 都是 HTTP 503，tencent 先报
 * {"detail":"Value of `source` is not supported."}，刷新后也变 503。
 * 所以星海只是“有就用、没有就回退”的补充，不能当唯一主搜索。
 * 主线是各源自己的搜索：网易云 CHKSZ、酷我 / 咪咕 oiapi 循环
 * （每页 1 首，v2 扩到 10 页）、汽水不变；QQ 再加一路
 * oiapi QQ 搜索。星海 types=search 成功就合并去重，失败就忽略。
 *
 * v3 搜索改动（2026-11-09 15:15–15:16 实测搜“春庭雪”）：
 * QQ 主路改走 QQ 官方 client_search_cp（先 fetch、失败走 JSONP），
 * oiapi QQ 返回 code -403“该Api暂时无法访问，可能在维护中”，只留作回退；
 * 酷我主路改走酷我官方 search.kuwo.cn/r.s，一次返回 10 首（先 fetch、失败走 JSONP），
 * oiapi 循环只留作回退；汽水接口本身是通的，加一次重试；
 * 网易云：星海 VIP 返回 {"detail":"Invalid request."}，CHKSZ 仍超时、
 * 星海普通版 503——目前没有能用的公开搜索接口，CHKSZ / 星海只作回退尝试，
 * 最稳的办法是用户自己部署 NeteaseCloudMusicApi 后在设置里填地址。
 *
 * 注意：本站不嵌入任何 API Key。QQ 取链首选星海
 * types=url&source=tencent（恢复后可用），失败就明确报错，
 * 不用溯音 / 非常刀里那个需要 Key 的 QQ 接口。
 */

// ---------- 可配置的 API 地址（设置面板可改，存 localStorage） ----------
const DEFAULT_BASES = {
  // CHKSZ：网易云搜索 / 直链（2026-11-09 仍连接超时，仅作回退）
  chksz: 'https://api.chksz.top/api',
  // 星海：聚合搜索 / 全平台直链 / 歌词。问号后的固定参数是接口要求的一部分，不可省略。
  // 实测不稳定（503 / tencent 不被支持），只作补充源。
  xinghai: 'https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=forest&need_sec_link=1&sec_link_scene=im&theme=light',
  // 溯音 oiapi：网易 Music_163、酷我 Kuwo、QQ 搜索
  oiapi: 'https://oiapi.net/api',
  // 咪咕：搜索 / 直链（溯音咪咕同款接口）
  migu: 'https://api.xcvts.cn/api/music/migu',
};
const SETTINGS_KEY = 'justmusic-api-bases';

function loadBases() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...DEFAULT_BASES, ...saved };
  } catch (_) {
    return { ...DEFAULT_BASES };
  }
}
let bases = loadBases();

// 汽水搜索 / H5 与长青 / 念心模板地址写在下方常量中，改代码即可换地址。
const QISHUI_SEARCH_API = 'https://api-vehicle.volcengine.com/v2/search/type';
const QISHUI_H5_API = 'https://api.qishui.com/luna/h5/track';

// ---------- 音源定义 ----------
// 展示顺序：QQ、网易云、酷我、咪咕、汽水
const SOURCES = [
  { key: 'tx', name: 'QQ音乐', badge: 'QQ', xinghai: 'tencent' },
  { key: 'wy', name: '网易云', badge: '网易云', xinghai: 'netease' },
  { key: 'kw', name: '酷我', badge: '酷我', xinghai: 'kuwo' },
  { key: 'mg', name: '咪咕', badge: '咪咕', xinghai: 'migu' },
  { key: 'qs', name: '汽水', badge: '汽水', xinghai: null },
];
const SOURCE_NAME = { tx: 'QQ音乐', wy: '网易云', kw: '酷我', mg: '咪咕', qs: '汽水' };
const SOURCE_BADGE = { tx: 'QQ', wy: '网易云', kw: '酷我', mg: '咪咕', qs: '汽水' };
const PER_SOURCE_LIMIT = 10;

// ---------- 音质映射（与非常刀 v5 一致） ----------
const CHKSZ_LEVEL = { '128k': 'standard', '320k': 'exhigh', flac: 'lossless', flac24bit: 'jymaster' };
const CHKSZ_FALLBACK = {
  jymaster: ['jymaster', 'lossless', 'exhigh', 'standard'],
  lossless: ['lossless', 'exhigh', 'standard'],
  exhigh: ['exhigh', 'standard'],
  standard: ['standard'],
};
const XINGHAI_BR = { '128k': '128', '192k': '192', '320k': '320', flac: '740', flac24bit: '999' };
const XINGHAI_SRC = { wy: 'netease', tx: 'tencent', kw: 'kuwo', mg: 'migu' };
const SUYIN_KW_BR = { flac: 1, '320k': 5, '128k': 7 };

// 长青 / 念心模板（只保留 wy / kw / mg；QQ 不用模板、不嵌 Key）
const CHANGQING = {
  wy: 'http://175.27.166.236/wy/wy.php?type=mp3&id={id}&level={level}',
  kw: 'https://musicapi.haitangw.net/music/kw.php?type=mp3&id={id}&level={level}',
  mg: 'https://music.haitangw.cc/musicapi/mg.php?type=mp3&id={id}&level={level}',
};
const NIANXIN = {
  wy: 'http://music.nxinxz.com/wy.php?id={id}&level={level}&type=mp3',
  kw: 'http://music.nxinxz.com/kw.php?id={id}&level={level}&type=mp3',
  mg: 'http://music.nxinxz.com/mg.php?id={id}&level={level}&type=mp3',
};

// ---------- 5 分钟缓存（与非常刀 v5 一致：300000ms，上限 200 条） ----------
const urlCache = new Map();
const CACHE_TTL = 300000;
const CACHE_MAX = 200;
function cacheGet(key) {
  const c = urlCache.get(key);
  if (!c) return null;
  if (Date.now() - c.ts > CACHE_TTL) { urlCache.delete(key); return null; }
  return c.val;
}
function cacheSet(key, val) {
  if (urlCache.size >= CACHE_MAX) urlCache.delete(urlCache.keys().next().value);
  urlCache.set(key, { val, ts: Date.now() });
}

// ---------- 通用工具 ----------
function formatDuration(d) {
  if (typeof d === 'string') {
    if (d.indexOf(':') !== -1) return d;
    const n = Number(d);
    if (!isFinite(n) || n <= 0) return '00:00';
    d = n;
  }
  const sec = typeof d === 'number' ? Math.floor(d > 1000 ? d / 1000 : d) : 0;
  if (sec <= 0) return '00:00';
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
}
function formatTime(sec) {
  if (!isFinite(sec) || sec <= 0) return '00:00';
  sec = Math.floor(sec);
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
}
function validateUrl(url) {
  if (typeof url === 'string' && /^https?:\/\//.test(url.trim())) return url.trim();
  throw new Error('无效URL');
}
function extractUrlFromMsg(msg) {
  if (!msg) return null;
  const m = String(msg).match(/https?:\/\/[^\s"'<>]+/);
  return m ? m[0] : null;
}
function qualityToLevel(q) {
  if (['flac', 'flac24bit', '24bit', 'hires', 'master'].includes(q)) return 'lossless';
  if (['320k', '192k'].includes(q)) return 'exhigh';
  return 'standard';
}
function cleanText(text) {
  if (!text) return '';
  return String(text).replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, '').replace(/[《》"""'''·,，。!！?？:：;；/\\|\-]/g, '').trim().toLowerCase();
}
function buildSearchKeywords(info) {
  const kws = [];
  if (info.singer) kws.push({ kw: info.name + ' ' + info.singer, strict: true });
  if (info.albumName) kws.push({ kw: info.name + ' ' + info.albumName, strict: true });
  kws.push({ kw: info.name, strict: false });
  return kws;
}
function checkSongMatch(apiName, apiArtist, musicInfo) {
  const a = cleanText(apiName), b = cleanText(musicInfo.name || '');
  if (!a || !b || (!a.includes(b) && !b.includes(a))) return false;
  const singer = cleanText(musicInfo.singer || '');
  if (singer) {
    const c = cleanText(apiArtist || '');
    if (c && !c.includes(singer) && !singer.includes(c)) return false;
  }
  return true;
}

// fetch + AbortController 超时；返回解析后的 JSON，解析失败则返回原文本。
async function httpGet(url, timeoutMs) {
  const timeout = timeoutMs || 8000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    if (!text) throw new Error('空响应');
    try { return JSON.parse(text); } catch (_) { return text; }
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('请求超时');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- JSONP：官方接口常拦浏览器 fetch（CORS），先 fetch、失败再走 JSONP ----------
// 动态创建 script 标签，URL 追加 &callback=<唯一回调名>，10 秒超时后清理 script 和全局回调。
function jsonp(url, timeoutMs, callbackParam) {
  const timeout = timeoutMs || 10000;
  return new Promise(function (resolve, reject) {
    const cbName = 'justmusic_jsonp_' + Date.now() + '_' + Math.floor(Math.random() * 1000000);
    const script = document.createElement('script');
    let done = false;
    function cleanup() {
      try { delete window[cbName]; } catch (_) { window[cbName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }
    const timer = setTimeout(function () {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error('JSONP 超时'));
    }, timeout);
    window[cbName] = function (data) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      resolve(data);
    };
    script.onerror = function () {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error('JSONP 加载失败'));
    };
    const sep = url.indexOf('?') === -1 ? '?' : '&';
    script.src = url + sep + (callbackParam || 'callback') + '=' + cbName;
    document.head.appendChild(script);
  });
}
// 先 fetch，失败（跨域 / 超时 / 非 200）再走 JSONP；两路都失败才抛错。
async function fetchThenJsonp(url, timeoutMs, callbackParam) {
  try {
    return await httpGet(url, timeoutMs);
  } catch (e) {
    return await jsonp(url, timeoutMs, callbackParam);
  }
}

// 按“歌名 + 歌手”去重（同一源内星海结果和兜底结果可能重合），保留先出现的。
function dedupeSongs(list) {
  const seen = new Set();
  const out = [];
  for (const s of list) {
    if (!s || !s.name || !s.id) continue;
    const key = cleanText(s.name) + '|' + cleanText(s.singer || '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// ---------- 聚合搜索 ----------
// 星海 types=search：GET {xinghai}&types=search&source=<xs>&name=<enc>&count=<n>&pages=1
// 返回数组 [{id, name, artist（数组或字符串）, album, pic_id, url_id, lyric_id, source}]，
// 也可能包在 {data:[...]} / {result:[...]} 里。
// 注意：星海返回的 pic_id 不直接拼封面地址，只用接口实际返回的
// pic / picUrl / cover_url / cover / image 字段，没有就显示占位符。
async function searchXinghai(sourceKey, keyword, limit) {
  const xs = XINGHAI_SRC[sourceKey];
  if (!xs) throw new Error('该源无星海搜索');
  const body = await httpGet(
    bases.xinghai + '&types=search&source=' + xs + '&name=' + encodeURIComponent(keyword) +
    '&count=' + limit + '&pages=1', 10000
  );
  const items = Array.isArray(body) ? body
    : (body && Array.isArray(body.data) ? body.data
    : (body && Array.isArray(body.result) ? body.result
    : (body && Array.isArray(body.songs) ? body.songs : [])));
  if (!items.length) throw new Error('无结果');
  return items.slice(0, limit).map(function (s) {
    const artist = s.artist !== undefined ? s.artist : (s.singer !== undefined ? s.singer : (s.author || ''));
    const singer = Array.isArray(artist)
      ? artist.map(function (a) { return typeof a === 'string' ? a : ((a && a.name) || ''); }).filter(Boolean).join(' / ')
      : String(artist || '');
    const album = s.album;
    return {
      name: s.name || s.title || '',
      singer: singer,
      albumName: typeof album === 'string' ? album : ((album && album.name) || ''),
      id: String(s.url_id !== undefined && s.url_id !== null ? s.url_id : s.id),
      lyric_id: String(s.lyric_id !== undefined && s.lyric_id !== null ? s.lyric_id : (s.url_id !== undefined && s.url_id !== null ? s.url_id : s.id)),
      source: sourceKey,
      duration: s.duration !== undefined ? s.duration : (s.interval !== undefined ? s.interval : (s.time || 0)),
      durationText: formatDuration(s.duration !== undefined ? s.duration : (s.interval !== undefined ? s.interval : (s.time || 0))),
      pic: s.pic || s.picUrl || s.cover_url || s.cover || s.image || '',
    };
  }).filter(function (s) { return s.name && s.id; });
}

// 网易云兜底：GET {chksz}/163_search?keyword=<enc>&limit=10
async function searchWyFallback(keyword, limit) {
  const body = await httpGet(
    bases.chksz + '/163_search?keyword=' + encodeURIComponent(keyword) + '&limit=' + limit, 10000
  );
  if (body && body.code !== 200) throw new Error('搜索失败');
  const items = Array.isArray(body && body.data) ? body.data : [];
  if (!items.length) throw new Error('未找到相关歌曲');
  return items.slice(0, limit).map(function (s) {
    return {
      name: s.name || '',
      singer: s.artists || '',
      albumName: typeof s.album === 'string' ? s.album : ((s.album && s.album.name) || ''),
      id: String(s.id),
      lyric_id: String(s.id),
      source: 'wy',
      duration: s.duration,
      durationText: formatDuration(s.duration),
      pic: s.picUrl || '',
    };
  });
}

// QQ 主路（v3，2026-11-09 15:15 实测可用）：QQ 官方搜索
// GET https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=<关键词>&p=1&n=10&format=json
// 返回 {code:0, data:{song:{list:[{name, singer:[{name}], album:{name}, songmid, songid, interval（秒）}], totalnum}}}
// 实测搜“春庭雪”：code 0，10 首，总共 600 首，首条就是春庭雪—邓寓君(等什么君)。
// 浏览器 fetch 很可能被 CORS 拦，所以先 fetch、失败走 JSONP。id 用 songmid（取链用）。
async function searchTxOfficial(keyword, limit) {
  const url = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=' + encodeURIComponent(keyword) +
    '&p=1&n=' + limit + '&format=json';
  const body = await fetchThenJsonp(url, 10000, 'callback');
  if (!body || typeof body !== 'object') throw new Error('搜索失败');
  if (body.code !== undefined && body.code !== 0) throw new Error('搜索失败');
  const items = body && body.data && body.data.song && body.data.song.list;
  if (!Array.isArray(items) || !items.length) throw new Error('未找到相关歌曲');
  return items.slice(0, limit).map(function (s) {
    const singer = Array.isArray(s.singer)
      ? s.singer.map(function (a) { return typeof a === 'string' ? a : ((a && a.name) || ''); }).filter(Boolean).join(' / ')
      : String(s.singer || '');
    return {
      name: s.name || '',
      singer: singer,
      albumName: (s.album && s.album.name) || '',
      id: String(s.songmid || s.songid || ''),
      numericId: String(s.songid || ''),
      lyric_id: String(s.songmid || s.songid || ''),
      source: 'tx',
      duration: s.interval,
      durationText: formatDuration(s.interval),
      pic: '',
    };
  }).filter(function (s) { return s.name && s.id; });
}

// QQ 回退（不嵌 Key）：GET {oiapi}/QQ_Music?keyword=<enc>&limit=10
// 2026-11-09 15:15 实测返回 code -403“该Api暂时无法访问，可能在维护中”，0 首——
// 这就是 v2 里 QQ 为 0 的原因。只留作回退，主路已改走 QQ 官方。
// 返回 {data:[{name, singer（数组）, album, mid, id, duration, image}]}
async function searchTxOiapi(keyword, limit) {
  const body = await httpGet(
    bases.oiapi + '/QQ_Music?keyword=' + encodeURIComponent(keyword) + '&limit=' + limit, 10000
  );
  const items = Array.isArray(body && body.data) ? body.data : [];
  if (!items.length) throw new Error('未找到相关歌曲');
  return items.slice(0, limit).map(function (s) {
    const singer = Array.isArray(s.singer) ? s.singer.join(' / ') : String(s.singer || '');
    // 星海 tencent 取链用的是 QQ 的 songmid，所以 id 优先用 mid；
    // 数字 id 另外保留在 numericId 里备用。
    const mid = s.mid ? String(s.mid) : '';
    return {
      name: s.name || '',
      singer: singer,
      albumName: typeof s.album === 'string' ? s.album : ((s.album && s.album.name) || ''),
      id: mid || String(s.id || ''),
      numericId: String(s.id || ''),
      lyric_id: mid || String(s.id || ''),
      source: 'tx',
      duration: s.duration,
      durationText: formatDuration(s.duration),
      pic: s.image || s.pic || s.picUrl || '',
    };
  }).filter(function (s) { return s.name && s.id; });
}

// 酷我主路（v3，2026-11-09 15:15 实测可用）：酷我官方搜索，一次返回 10 首
// GET https://search.kuwo.cn/r.s?all=<关键词>&ft=music&itemset=web_2013&client=kt&pn=0&rn=10&rformat=json&encoding=utf8
// 返回 {TOTAL, abslist:[{SONGNAME, ARTIST, ALBUM, MUSICRID, DURATION（秒）}]}
// 实测搜“春庭雪”：TOTAL 256，10 首，首条是春庭雪(DJ版)—DJ朱宸霄。
// 浏览器 fetch 可能被 CORS 拦，先 fetch、失败走 JSONP（加 callback 参数）。
// MUSICRID 形如 "MUSIC_123456"，取链用的 id 只留数字部分（与原来 oiapi 的 rid 一致）。
async function searchKwOfficial(keyword, limit) {
  const url = 'https://search.kuwo.cn/r.s?all=' + encodeURIComponent(keyword) +
    '&ft=music&itemset=web_2013&client=kt&pn=0&rn=' + limit + '&rformat=json&encoding=utf8';
  const body = await fetchThenJsonp(url, 10000, 'callback');
  const items = (body && body.abslist) || (body && body.data && body.data.abslist) || [];
  if (!Array.isArray(items) || !items.length) throw new Error('未找到相关歌曲');
  return items.slice(0, limit).map(function (s) {
    const rid = String(s.MUSICRID || s.rid || '').replace(/^MUSIC_/, '');
    return {
      name: s.SONGNAME || s.name || '',
      singer: s.ARTIST || s.singer || '',
      albumName: s.ALBUM || s.album || '',
      id: rid,
      lyric_id: rid,
      source: 'kw',
      duration: s.DURATION,
      durationText: formatDuration(s.DURATION),
      pic: s.PIC || s.pic || '',
    };
  }).filter(function (s) { return s.name && s.id; });
}

// 酷我回退：oiapi 每页只返回一首，循环 1..10 页收集（v1 只循环 3 页，所以最多 3 首）
// GET {oiapi}/Kuwo?msg=<enc>&n=<page> -> {data:{song,singer,album,rid,duration}}
async function searchKwOiapiLoop(keyword, limit) {
  const results = [];
  for (let page = 1; results.length < limit && page <= 10; page++) {
    try {
      const body = await httpGet(bases.oiapi + '/Kuwo?msg=' + encodeURIComponent(keyword) + '&n=' + page, 8000);
      const d = body && body.data;
      if (!d || !d.song) break;
      results.push({
        name: d.song || '', singer: d.singer || '', albumName: d.album || '',
        id: String(d.rid || ''),
        lyric_id: String(d.rid || ''),
        source: 'kw',
        duration: d.duration,
        durationText: formatDuration(d.duration),
        pic: d.picture || '',
      });
    } catch (_) { break; }
  }
  if (!results.length) throw new Error('未找到相关歌曲');
  return results;
}

// 酷我：官方主路先试，失败再走 oiapi 循环回退
async function searchKwFallback(keyword, limit) {
  try {
    return await searchKwOfficial(keyword, limit);
  } catch (_) {
    return await searchKwOiapiLoop(keyword, limit);
  }
}

// 咪咕兜底：每页只返回一首，循环 1..10 页收集
// GET {migu}?gm=<enc>&n=<page>&num=1&type=json -> code==200 且有 title
async function searchMgFallback(keyword, limit) {
  const results = [];
  for (let page = 1; results.length < limit && page <= 10; page++) {
    try {
      const body = await httpGet(
        bases.migu + '?gm=' + encodeURIComponent(keyword) + '&n=' + page + '&num=1&type=json', 8000
      );
      if (!body || body.code !== 200 || !body.title) break;
      // 原脚本的咪咕搜索没有返回稳定的数字 id，这里用 body.id（若有），否则用合成 id；
      // 取链主要靠“溯音咪咕”搜索式回退（按歌名+歌手再查一次），见 suyinMgGetUrl。
      // 搜索时已返回的 music_url 会存为 directUrl，作为取链的最后一道回退。
      results.push({
        name: body.title || '', singer: body.artist || '', albumName: body.album || '',
        id: body.id ? String(body.id) : ('mg_' + Date.now() + '_' + page),
        lyric_id: body.id ? String(body.id) : '',
        source: 'mg',
        duration: body.duration,
        durationText: typeof body.duration === 'string' ? body.duration : formatDuration(body.duration),
        pic: '',
        directUrl: body.music_url || '',
      });
    } catch (_) { break; }
  }
  if (!results.length) throw new Error('未找到相关歌曲');
  return results;
}

// 汽水：GET {QISHUI_SEARCH_API}?keyword=<enc>&search_type=music&limit=10&real_offset=0&search_source=qishui
// 2026-11-09 15:15 实测直接打开是通的（code 0，10 条，首条是 DJ 翻唱版），接口本身没挂；
// v2 线上 Failed to fetch 很可能是浏览器 fetch 被 CORS 拦或瞬时失败，所以保留这路并加一次重试。
async function searchQs(keyword, limit) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const body = await httpGet(
        QISHUI_SEARCH_API + '?keyword=' + encodeURIComponent(keyword) +
        '&search_type=music&limit=' + limit + '&real_offset=0&search_source=qishui', 10000
      );
      const items = body && body.data && body.data.list;
      if (!Array.isArray(items) || !items.length) throw new Error('未找到相关歌曲');
      return items.slice(0, limit).map(function (s) {
        return {
          name: s.title || '',
          singer: (s.author_info && s.author_info.name) || '',
          albumName: '',
          id: String(s.item_id),
          lyric_id: String(s.item_id),
          source: 'qs',
          duration: s.duration,
          durationText: formatDuration(s.duration),
          pic: s.cover_url || '',
        };
      });
    } catch (err) {
      lastErr = err;
      if (attempt === 0) await new Promise(function (r) { setTimeout(r, 500); });
    }
  }
  throw lastErr || new Error('未找到相关歌曲');
}

// 单源聚合：星海和本源搜索并行跑，成功就合并去重、截到 10 首；
// 某一路失败只忽略该路，不让整个源失败；两路都失败才算该源无结果。
async function searchOneSource(sourceKey, keyword) {
  const limit = PER_SOURCE_LIMIT;
  if (sourceKey === 'qs') {
    const r = await searchQs(keyword, limit);
    if (!r.length) throw new Error('未找到相关歌曲');
    return r;
  }
  const attempts = [];
  if (XINGHAI_SRC[sourceKey]) attempts.push(searchXinghai(sourceKey, keyword, limit));
  if (sourceKey === 'wy') attempts.push(searchWyFallback(keyword, limit));
  else if (sourceKey === 'tx') { attempts.unshift(searchTxOfficial(keyword, limit)); attempts.push(searchTxOiapi(keyword, limit)); }
  else if (sourceKey === 'kw') attempts.push(searchKwFallback(keyword, limit));
  else if (sourceKey === 'mg') attempts.push(searchMgFallback(keyword, limit));
  const settled = await Promise.allSettled(attempts);
  let merged = [];
  settled.forEach(function (r) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) merged = merged.concat(r.value);
  });
  merged = dedupeSongs(merged).slice(0, limit);
  if (!merged.length) throw new Error('未找到相关歌曲');
  return merged;
}

// ---------- 取播放链接（点哪首，就用那首自己的源去解析） ----------
// CHKSZ：GET {chksz}/163_music?id=<id>&level=<level>，按音质回退链逐级尝试
async function chkszGetUrl(song, quality) {
  const level = CHKSZ_LEVEL[quality] || 'standard';
  const levels = CHKSZ_FALLBACK[level] || ['standard'];
  for (const lv of levels) {
    try {
      const body = await httpGet(bases.chksz + '/163_music?id=' + encodeURIComponent(song.id) + '&level=' + lv, 8000);
      if (body && body.code === 200 && body.data && body.data.url) return body.data.url;
    } catch (_) { continue; }
  }
  throw new Error('CHKSZ失败');
}

// 星海：GET {xinghai}&types=url&source=<source>&id=<id>&br=<br>
async function xinghaiGetUrl(platform, song, quality) {
  const source = XINGHAI_SRC[platform];
  const br = XINGHAI_BR[quality] || '320';
  if (!source || !song.id) throw new Error('参数缺失');
  const body = await httpGet(
    bases.xinghai + '&types=url&source=' + source + '&id=' + encodeURIComponent(song.id) + '&br=' + br, 8000
  );
  return validateUrl(body && body.url);
}

// QQ 星海取链：只用星海，不嵌 Key；音质档位失败时 320k -> 128k 再试一次
async function xinghaiGetUrlTx(song, quality) {
  const brs = [];
  [XINGHAI_BR[quality] || '320', '128'].forEach(function (b) { if (brs.indexOf(b) === -1) brs.push(b); });
  for (const br of brs) {
    try {
      const body = await httpGet(
        bases.xinghai + '&types=url&source=tencent&id=' + encodeURIComponent(song.id) + '&br=' + br, 8000
      );
      return validateUrl(body && body.url);
    } catch (_) { continue; }
  }
  throw new Error('星海QQ解析失败');
}

// 溯音163：GET {oiapi}/Music_163?id=<id>，data 可能是数组或对象，取第一个.url
async function suyin163GetUrl(song) {
  const body = await httpGet(bases.oiapi + '/Music_163?id=' + encodeURIComponent(song.id), 8000);
  const data = Array.isArray(body && body.data) ? body.data[0] : (body && body.data);
  return validateUrl(data && data.url);
}

// 溯音酷我（搜索式）：GET {oiapi}/Kuwo?msg=<enc "歌名 歌手">&n=1&br=<br>，br: flac=1, 320k=5, 128k=7
async function suyinKwGetUrl(song, quality) {
  const br = SUYIN_KW_BR[quality] || 5;
  for (const item of buildSearchKeywords(song)) {
    try {
      const body = await httpGet(
        bases.oiapi + '/Kuwo?msg=' + encodeURIComponent(item.kw) + '&n=1&br=' + br, 8000
      );
      const url = (body && body.data && body.data.url) || extractUrlFromMsg((body && body.data && body.data.message) || (body && body.message));
      if (url && (!item.strict || checkSongMatch((body && body.data && body.data.song) || '', (body && body.data && body.data.singer) || '', song))) {
        return validateUrl(url);
      }
    } catch (_) { continue; }
  }
  throw new Error('溯音酷我失败');
}

// 溯音咪咕（搜索式）：GET {migu}?gm=<enc "歌名 歌手">&n=1&num=1&type=json，取 music_url
async function suyinMgGetUrl(song) {
  for (const item of buildSearchKeywords(song)) {
    try {
      const body = await httpGet(
        bases.migu + '?gm=' + encodeURIComponent(item.kw) + '&n=1&num=1&type=json', 8000
      );
      if (body && body.code === 200 && body.music_url) {
        if (!item.strict || checkSongMatch(body.title || '', body.artist || '', song)) {
          return validateUrl(body.music_url);
        }
      }
    } catch (_) { continue; }
  }
  throw new Error('溯音咪咕失败');
}

// 长青 / 念心模板：返回 {url} 或 {data:{url}}，也兼容纯文本链接
async function templateGetUrl(platform, song, quality, templates) {
  const tpl = templates[platform];
  if (!tpl) throw new Error('模板不支持该平台');
  if (!song.id) throw new Error('缺少ID');
  const level = qualityToLevel(quality);
  const url = tpl.replace('{id}', encodeURIComponent(song.id)).replace('{level}', level);
  const body = await httpGet(url, 8000);
  if (typeof body === 'string') return validateUrl(extractUrlFromMsg(body) || body);
  return validateUrl((body && body.url) || (body && body.data && body.data.url) || extractUrlFromMsg(typeof body === 'string' ? body : JSON.stringify(body)));
}

// 汽水 H5：GET {QISHUI_H5_API}?track_id=<id>，解析 track_player.video_model JSON
async function qishuiH5GetUrl(song) {
  const body = await httpGet(QISHUI_H5_API + '?track_id=' + encodeURIComponent(song.id), 8000);
  const songStr = body && body.track_player && body.track_player.video_model;
  if (!songStr) throw new Error('汽水H5无数据');
  const parsed = JSON.parse(songStr);
  const first = parsed && parsed.video_list && parsed.video_list[0];
  if (!first || !first.main_url) throw new Error('汽水H5无链接');
  return validateUrl(first.main_url);
}

// 回退链：Promise.any 竞速，每个提供方内部 8 秒超时，5 分钟缓存
function getUrlWithFallback(platform, song, quality) {
  const key = 'url_' + platform + '_' + song.id + '_' + quality;
  const cached = cacheGet(key);
  if (cached) return Promise.resolve(cached);

  let chain;
  if (platform === 'wy') {
    chain = [
      function () { return xinghaiGetUrl('wy', song, quality); },
      function () { return chkszGetUrl(song, quality); },
      function () { return suyin163GetUrl(song); },
      function () { return templateGetUrl('wy', song, quality, CHANGQING); },
      function () { return templateGetUrl('wy', song, quality, NIANXIN); },
    ];
  } else if (platform === 'tx') {
    // QQ 只有星海这一路，不嵌 Key；失败就明确报错。
    chain = [function () { return xinghaiGetUrlTx(song, quality); }];
  } else if (platform === 'kw') {
    chain = [
      function () { return xinghaiGetUrl('kw', song, quality); },
      function () { return suyinKwGetUrl(song, quality); },
      function () { return templateGetUrl('kw', song, quality, CHANGQING); },
      function () { return templateGetUrl('kw', song, quality, NIANXIN); },
    ];
  } else if (platform === 'mg') {
    chain = [
      function () { return xinghaiGetUrl('mg', song, quality); },
      function () { return suyinMgGetUrl(song); },
      function () { return templateGetUrl('mg', song, quality, CHANGQING); },
      function () { return templateGetUrl('mg', song, quality, NIANXIN); },
      // 搜索时已返回 music_url：不发新请求，直接复用
      function () { return song.directUrl ? validateUrl(song.directUrl) : Promise.reject(new Error('无直链')); },
    ];
  } else if (platform === 'qs') {
    chain = [function () { return qishuiH5GetUrl(song); }];
  } else {
    return Promise.reject(new Error('不支持的平台'));
  }

  return Promise.any(chain.map(function (fn) {
    return Promise.resolve().then(fn).then(validateUrl);
  })).then(function (url) {
    cacheSet(key, url);
    return url;
  }).catch(function () {
    if (platform === 'tx') throw new Error('QQ 播放链接解析失败：星海接口暂不可用，且本站不内置任何 Key');
    throw new Error('所有音源均解析失败');
  });
}

// ---------- 歌词：并入“正在播放”卡片 ----------
// KRC 行：[1234,567]文本<0,0,0> -> LRC 行：[mm:ss.xx]文本（去掉 <> 标记）
function krcToLrc(krc) {
  const lines = String(krc || '').split('\n');
  const result = [];
  for (const line of lines) {
    const m = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!m) continue;
    const startMs = parseInt(m[1], 10);
    const min = Math.floor(startMs / 60000);
    const sec = Math.floor((startMs % 60000) / 1000);
    const cs = Math.floor((startMs % 1000) / 10);
    const text = m[3].replace(/<\d+,\d+,\d+>/g, '').replace(/<[^>]*>/g, '');
    if (text.trim()) {
      result.push('[' + String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + String(cs).padStart(2, '0') + ']' + text);
    }
  }
  return result.join('\n');
}
function parseLrc(lrcText) {
  const out = [];
  for (const line of String(lrcText || '').split('\n')) {
    const m = line.match(/^\[(\d+):(\d+)(?:\.(\d+))?\](.*)$/);
    if (!m) continue;
    const frac = m[3] ? parseInt(m[3], 10) / Math.pow(10, m[3].length) : 0;
    const text = m[4].trim();
    if (text) out.push({ time: parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac, text: text });
  }
  return out.sort(function (a, b) { return a.time - b.time; });
}
function linesFromArray(arr) {
  const out = [];
  arr.forEach(function (item) {
    if (typeof item === 'string') {
      parseLrc(item).forEach(function (l) { out.push(l); });
      return;
    }
    if (item && typeof item === 'object') {
      const t = item.time !== undefined ? item.time : (item.t !== undefined ? item.t : (item.start !== undefined ? item.start : null));
      const txt = item.text !== undefined ? item.text : (item.txt !== undefined ? item.txt : (item.lyric || item.lrc || ''));
      if (t !== null && t !== undefined && txt) out.push({ time: Number(t), text: String(txt).trim() });
    }
  });
  return out.sort(function (a, b) { return a.time - b.time; });
}
function lyricLinesFromBody(body) {
  if (typeof body === 'string') return parseLrc(body);
  if (Array.isArray(body)) return linesFromArray(body);
  if (body && typeof body === 'object') {
    if (typeof body.lyric === 'string') return parseLrc(body.lyric);
    if (typeof body.lrc === 'string') return parseLrc(body.lrc);
    if (typeof body.data === 'string') return parseLrc(body.data);
    if (Array.isArray(body.data)) return linesFromArray(body.data);
    if (body.data && typeof body.data === 'object') {
      if (typeof body.data.lyric === 'string') return parseLrc(body.data.lyric);
      if (typeof body.data.lrc === 'string') return parseLrc(body.data.lrc);
    }
  }
  return [];
}
// 星海歌词：GET {xinghai}&types=lyric&id=<lyric_id||id>&source=<xs>
// 返回可能是 JSON {lyric}/{lrc}/{data}，也可能是纯 LRC 文本。
async function xinghaiLyric(song) {
  const xs = XINGHAI_SRC[song.source];
  if (!xs) throw new Error('该源无星海歌词');
  const id = song.lyric_id || song.id;
  if (!id) throw new Error('缺少ID');
  const body = await httpGet(
    bases.xinghai + '&types=lyric&id=' + encodeURIComponent(id) + '&source=' + xs, 8000
  );
  const lines = lyricLinesFromBody(body);
  if (!lines.length) throw new Error('无歌词');
  return lines;
}
// 汽水歌词：GET {QISHUI_H5_API}?track_id=<id>，取 lyric.content（KRC）转 LRC
async function qishuiLyric(song) {
  const body = await httpGet(QISHUI_H5_API + '?track_id=' + encodeURIComponent(song.id), 8000);
  const raw = body && body.lyric && body.lyric.content;
  if (!raw) throw new Error('无歌词');
  const lines = parseLrc(krcToLrc(raw));
  if (!lines.length) throw new Error('无歌词');
  return lines;
}
async function loadLyrics(song) {
  if (XINGHAI_SRC[song.source]) {
    try { return await xinghaiLyric(song); } catch (_) { /* 继续试汽水 */ }
  }
  if (song.source === 'qs') {
    try { return await qishuiLyric(song); } catch (_) { /* 无歌词 */ }
  }
  return [];
}

// ---------- 界面 ----------
const $ = function (id) { return document.getElementById(id); };
const searchInput = $('searchInput');
const searchBtn = $('searchBtn');
const statusEl = $('status');
const resultsContainer = $('resultsContainer');
const emptyHint = $('emptyHint');
const lyricsPanel = $('lyricsPanel');
const audio = $('audio');

let allResults = [];      // 本次聚合搜索的全部结果（按源分组顺序）
let visibleResults = [];  // 当前筛选后可见的结果（上一曲 / 下一曲按它走）
let currentFilter = 'all';
let currentSong = null;
let currentIndex = -1;
let currentLyrics = [];

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

// v3：每源状态行 + 侧栏圆点（数据来自 Promise.allSettled 的 counts，不发新请求）
function updateSourceStatus(counts) {
  const line = $('sourceStatus');
  if (line) {
    line.innerHTML = SOURCES.map(function (s) {
      const n = counts[s.key] || 0;
      return n > 0
        ? '<span class="src-ok">' + esc(SOURCE_NAME[s.key]) + ' ✓ 有结果（' + n + '首）</span>'
        : '<span class="src-bad">' + esc(SOURCE_NAME[s.key]) + ' ✗ 暂无结果（接口问题）</span>';
    }).join('<span class="src-sep"> · </span>');
  }
  SOURCES.forEach(function (s) {
    const cap = s.key[0].toUpperCase() + s.key.slice(1);
    const dot = $('dot' + cap);
    const cnt = $('count' + cap);
    const n = counts[s.key] || 0;
    if (dot) dot.className = 'src-dot' + (n > 0 ? ' ok' : ' bad');
    if (cnt) cnt.textContent = n > 0 ? n + '首' : '—';
  });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// 按当前筛选渲染分组结果；筛选只过滤已搜到的结果，不重新搜索。
function renderResults() {
  visibleResults = [];
  resultsContainer.innerHTML = '';
  let any = false;
  SOURCES.forEach(function (src) {
    if (currentFilter !== 'all' && currentFilter !== src.key) return;
    const list = allResults.filter(function (song) { return song.source === src.key; });
    if (!list.length) return;
    any = true;
    const section = document.createElement('section');
    section.className = 'result-group';
    const h = document.createElement('h3');
    h.innerHTML = esc(src.name) + ' <span class="group-count">' + list.length + ' 首</span>';
    section.appendChild(h);
    const ul = document.createElement('ul');
    ul.className = 'results';
    list.forEach(function (song) {
      const idx = visibleResults.length;
      visibleResults.push(song);
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'result-item' + (song === currentSong ? ' playing' : '');
      const cover = song.pic
        ? '<img class="result-cover" src="' + esc(song.pic) + '" alt="" loading="lazy">'
        : '<span class="result-cover-placeholder" aria-hidden="true">♪</span>';
      btn.innerHTML = cover +
        '<span class="result-info"><span class="result-name">' + esc(song.name) + '</span>' +
        '<span class="result-sub">' + esc(song.singer || '未知歌手') + (song.albumName ? ' · ' + esc(song.albumName) : '') + '</span></span>' +
        '<span class="badge">' + esc(SOURCE_BADGE[song.source] || '') + '</span>' +
        '<span class="result-duration">' + esc(song.durationText || '') + '</span>';
      btn.addEventListener('click', function () { playSong(idx); });
      li.appendChild(btn);
      ul.appendChild(li);
    });
    section.appendChild(ul);
    resultsContainer.appendChild(section);
  });
  emptyHint.style.display = any ? 'none' : '';
}

function renderLyrics() {
  lyricsPanel.innerHTML = '';
  const p = document.createElement('p');
  if (!currentSong) {
    p.className = 'lyrics-empty';
    p.textContent = '搜一首歌，点它开始播放，歌词会在这里显示';
    lyricsPanel.appendChild(p);
    return;
  }
  if (!currentLyrics.length) {
    p.className = 'lyrics-empty';
    p.textContent = '暂无歌词';
    lyricsPanel.appendChild(p);
    return;
  }
  currentLyrics.forEach(function (line) {
    const el = document.createElement('p');
    el.textContent = line.text;
    el.dataset.time = String(line.time);
    lyricsPanel.appendChild(el);
  });
}

function updateLyricHighlight() {
  if (!currentLyrics.length || !audio.duration) return;
  const t = audio.currentTime;
  let active = -1;
  for (let i = 0; i < currentLyrics.length; i++) {
    if (currentLyrics[i].time <= t) active = i; else break;
  }
  const ps = lyricsPanel.querySelectorAll('p');
  ps.forEach(function (p, i) { p.classList.toggle('active', i === active); });
  if (active >= 0 && ps[active]) ps[active].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function updateNowPlaying(song) {
  const quality = $('qualitySelect').value;
  // 底部迷你播放器
  $('songName').textContent = song ? song.name : '未在播放';
  $('songSinger').textContent = song ? (song.singer || '未知歌手') : '搜一首歌，点它开始播放';
  const coverImg = $('coverImg');
  const placeholder = $('coverPlaceholder');
  if (song && song.pic) {
    coverImg.src = song.pic;
    coverImg.hidden = false;
    placeholder.style.display = 'none';
  } else {
    coverImg.removeAttribute('src');
    coverImg.hidden = true;
    placeholder.style.display = '';
  }
  // 正在播放卡片（歌词在它里面）
  $('nowPlayingName').textContent = song ? song.name : '未在播放';
  $('nowPlayingSinger').textContent = song
    ? (song.singer || '未知歌手') + (song.albumName ? ' · ' + song.albumName : '')
    : '搜一首歌，点它开始播放，歌词会在这里显示';
  const badge = $('nowPlayingBadge');
  if (song) {
    badge.textContent = SOURCE_BADGE[song.source] || SOURCE_NAME[song.source] || '';
    badge.hidden = false;
    $('nowPlayingQuality').textContent = '音质 ' + quality;
  } else {
    badge.hidden = true;
    badge.textContent = '';
    $('nowPlayingQuality').textContent = '';
  }
  const npCover = $('nowPlayingCover');
  const npPlaceholder = $('nowPlayingCoverPlaceholder');
  if (song && song.pic) {
    npCover.src = song.pic;
    npCover.hidden = false;
    npPlaceholder.style.display = 'none';
  } else {
    npCover.removeAttribute('src');
    npCover.hidden = true;
    npPlaceholder.style.display = '';
  }
}

async function playSong(index) {
  if (index < 0 || index >= visibleResults.length) return;
  currentIndex = index;
  const song = visibleResults[index];
  currentSong = song;
  const quality = $('qualitySelect').value;
  renderResults();
  updateNowPlaying(song);
  currentLyrics = [];
  renderLyrics();
  setStatus('正在解析播放链接…（' + SOURCE_NAME[song.source] + ' · ' + song.name + '）');
  $('playBtn').textContent = '⏸';
  try {
    const url = await getUrlWithFallback(song.source, song, quality);
    audio.src = url;
    await audio.play();
    setStatus('正在播放：' + song.name + ' — ' + (song.singer || '未知歌手') + '（' + SOURCE_NAME[song.source] + '）', 'ok');
    $('playBtn').textContent = '⏸';
  } catch (err) {
    setStatus('播放链接解析失败，换首歌或换个音质试试（' + (err && err.message ? err.message : '未知错误') + '）', 'error');
    $('playBtn').textContent = '▶';
    return;
  }
  // 歌词：星海优先，汽水走 H5；拿不到就显示“暂无歌词”，不打断播放
  try {
    currentLyrics = await loadLyrics(song);
  } catch (_) {
    currentLyrics = [];
  }
  renderLyrics();
}

async function doSearch() {
  const keyword = searchInput.value.trim();
  if (!keyword) {
    setStatus('请先输入歌名或歌手。', 'error');
    searchInput.focus();
    return;
  }
  searchBtn.disabled = true;
  setStatus('正在聚合搜索 QQ / 网易云 / 酷我 / 咪咕 / 汽水…');
  const settled = await Promise.allSettled(SOURCES.map(function (s) { return searchOneSource(s.key, keyword); }));
  allResults = [];
  const counts = {};
  SOURCES.forEach(function (s, i) {
    const r = settled[i];
    counts[s.key] = (r.status === 'fulfilled' && Array.isArray(r.value)) ? r.value.length : 0;
    if (r.status === 'fulfilled' && Array.isArray(r.value)) allResults.push.apply(allResults, r.value);
  });
  updateSourceStatus(counts);
  currentSong = null;
  currentIndex = -1;
  currentLyrics = [];
  renderResults();
  updateNowPlaying(null);
  renderLyrics();
  const total = allResults.length;
  if (!total) {
    setStatus('都没搜到，换个关键词试试。', 'error');
  } else {
    const okParts = SOURCES.filter(function (s) { return counts[s.key] > 0; })
      .map(function (s) { return SOURCE_NAME[s.key] + ' ' + counts[s.key]; });
    const emptyParts = SOURCES.filter(function (s) { return counts[s.key] === 0; })
      .map(function (s) { return SOURCE_NAME[s.key]; });
    let text = '找到 ' + total + ' 首：' + okParts.join(' · ');
    if (emptyParts.length) text += '，' + emptyParts.join('、') + '暂无结果';
    text += '。点一首开始播放。';
    setStatus(text, 'ok');
  }
  searchBtn.disabled = false;
}

// ---------- 事件绑定 ----------
searchBtn.addEventListener('click', doSearch);
searchInput.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') doSearch();
});

document.querySelectorAll('.filter-chip').forEach(function (chip) {
  chip.addEventListener('click', function () {
    document.querySelectorAll('.filter-chip').forEach(function (c) { c.classList.remove('active'); });
    chip.classList.add('active');
    currentFilter = chip.dataset.filter;
    renderResults();
  });
});

// v3：侧栏导航（视觉导航，不新增功能；收藏暂未上线）
document.querySelectorAll('.nav-item').forEach(function (item) {
  item.addEventListener('click', function () {
    document.querySelectorAll('.nav-item').forEach(function (i) { i.classList.remove('active'); });
    item.classList.add('active');
  });
});
const navBrowse = $('navBrowse');
if (navBrowse) navBrowse.addEventListener('click', function () { document.querySelector('.results-wrap').scrollIntoView({ behavior: 'smooth' }); });
const navSearch = $('navSearch');
if (navSearch) navSearch.addEventListener('click', function () { searchInput.focus(); searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
const navFav = $('navFav');
if (navFav) navFav.addEventListener('click', function () { setStatus('我的收藏暂未上线，先搜歌听歌吧。'); });

document.querySelectorAll('.chip').forEach(function (chip) {
  chip.addEventListener('click', function () {
    searchInput.value = chip.dataset.keyword;
    doSearch();
  });
});

$('qualitySelect').addEventListener('change', function () {
  if (currentSong) {
    // 音质变了，按当前可见列表里的位置重播（visibleResults 不变，currentIndex 仍有效）
    playSong(currentIndex);
  }
  if (currentSong) updateNowPlaying(currentSong);
});

$('playBtn').addEventListener('click', function () {
  if (!audio.src) {
    if (visibleResults.length) playSong(0);
    else setStatus('请先搜索并选择一首歌。', 'error');
    return;
  }
  if (audio.paused) { audio.play(); $('playBtn').textContent = '⏸'; }
  else { audio.pause(); $('playBtn').textContent = '▶'; }
});
$('prevBtn').addEventListener('click', function () {
  if (visibleResults.length) playSong((currentIndex - 1 + visibleResults.length) % visibleResults.length);
});
$('nextBtn').addEventListener('click', function () {
  if (visibleResults.length) playSong((currentIndex + 1) % visibleResults.length);
});

audio.addEventListener('play', function () { $('playBtn').textContent = '⏸'; });
audio.addEventListener('pause', function () { $('playBtn').textContent = '▶'; });
audio.addEventListener('ended', function () {
  if (visibleResults.length) playSong((currentIndex + 1) % visibleResults.length);
});
audio.addEventListener('error', function () {
  setStatus('音频加载失败，可能是链接已过期，换首歌或换个音质试试。', 'error');
  $('playBtn').textContent = '▶';
});
audio.addEventListener('loadedmetadata', function () {
  $('totalTime').textContent = formatTime(audio.duration);
  $('progressBar').max = 100;
});
audio.addEventListener('timeupdate', function () {
  $('currentTime').textContent = formatTime(audio.currentTime);
  if (audio.duration) $('progressBar').value = String((audio.currentTime / audio.duration) * 100);
  updateLyricHighlight();
});
$('progressBar').addEventListener('input', function (e) {
  if (audio.duration) audio.currentTime = (parseFloat(e.target.value) / 100) * audio.duration;
});
$('volumeSlider').addEventListener('input', function (e) {
  audio.volume = parseFloat(e.target.value) / 100;
});

// ---------- 设置面板 ----------
function fillSettings() {
  $('cfgChksz').value = bases.chksz;
  $('cfgXinghai').value = bases.xinghai;
  $('cfgOiapi').value = bases.oiapi;
  $('cfgMigu').value = bases.migu;
}
$('saveSettingsBtn').addEventListener('click', function () {
  const next = {
    chksz: $('cfgChksz').value.trim(),
    xinghai: $('cfgXinghai').value.trim(),
    oiapi: $('cfgOiapi').value.trim(),
    migu: $('cfgMigu').value.trim(),
  };
  if (!next.chksz || !next.xinghai || !next.oiapi || !next.migu) {
    $('settingsStatus').textContent = '地址不能为空，请检查后再保存。';
    return;
  }
  bases = next;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (_) {}
  $('settingsStatus').textContent = '已保存，下次搜索生效。';
});
$('resetSettingsBtn').addEventListener('click', function () {
  try { localStorage.removeItem(SETTINGS_KEY); } catch (_) {}
  bases = { ...DEFAULT_BASES };
  fillSettings();
  $('settingsStatus').textContent = '已恢复默认地址。';
});

// ---------- 初始化 ----------
audio.volume = 0.8;
fillSettings();
renderLyrics();
