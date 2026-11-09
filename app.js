'use strict';
/*
* JustMusic — 纯静态多源听歌页，无构建、无后端、无 lx 运行时。
* 音源逻辑改编自 Mac-XK/KMusic 仓库根目录的「非常刀.js」v5
* （lx-music 格式脚本，原脚本用 globalThis.lx.request()；
* 这里全部改写为浏览器原生 fetch()）。
*
* 注意：QQ 音乐在原脚本里需要一个 API Key 才能取链，
* 本站不嵌入任何 Key，因此完全省略 QQ 取链，不提供 QQ 音源。
*/

// ---------- 可配置的 API 地址（设置面板可改，存 localStorage） ----------
const DEFAULT_BASES = {
// CHKSZ：网易云搜索 / 直链
chksz: 'https://api.chksz.top/api',
// 星海：全平台直链。注意问号后的固定参数是接口要求的一部分，不可省略。
xinghai: 'https://music-api.gdstudio.xyz/api.php?use_xbridge3=true&loader_name=forest&need_sec_link=1&sec_link_scene=im&theme=light',
// 溯音 oiapi：网易 Music_163、酷我 Kuwo
oiapi: 'https://oiapi.net/api',
// 咪咕：搜索 / 直链（溯音咪咕同款接口）
migu: 'https://api.xcvts.cn/api/music/migu',
};
const SETTINGS_KEY = 'justmusic-api-bases';

function loadBases() {
try {
const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
return {...DEFAULT_BASES,...saved};
} catch (_) {
return {...DEFAULT_BASES};
}
}
let bases = loadBases();

// 汽水搜索 / H5 与长青 / 念心模板地址写在下方常量中，改代码即可换地址。
const QISHUI_SEARCH_API = 'https://api-vehicle.volcengine.com/v2/search/type';
const QISHUI_H5_API = 'https://api.qishui.com/luna/h5/track';

// ---------- 音质映射（与非常刀 v5 一致） ----------
const CHKSZ_LEVEL = { '128k': 'standard', '320k': 'exhigh', flac: 'lossless', flac24bit: 'jymaster'};
const CHKSZ_FALLBACK = {
jymaster: ['jymaster', 'lossless', 'exhigh', 'standard'],
lossless: ['lossless', 'exhigh', 'standard'],
exhigh: ['exhigh', 'standard'],
standard: ['standard'],
};
const XINGHAI_BR = { '128k': '128', '192k': '192', '320k': '320', flac: '740', flac24bit: '999'};
const XINGHAI_SRC = { wy: 'netease', kw: 'kuwo', mg: 'migu'};
const SUYIN_KW_BR = { flac: 1, '320k': 5, '128k': 7};

// 长青 / 念心模板（只保留本站用到的 wy / kw / mg；原脚本的 tx / kg 已随 QQ 一并省略）
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
if (Date.now() - c.ts > CACHE_TTL) { urlCache.delete(key); return null;}
return c.val;
}
function cacheSet(key, val) {
if (urlCache.size >= CACHE_MAX) urlCache.delete(urlCache.keys().next().value);
urlCache.set(key, { val, ts: Date.now()});
}

// ---------- 通用工具 ----------
function formatDuration(ms) {
const sec = typeof ms === 'number'? Math.floor(ms > 1000? ms / 1000: ms): 0;
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
return m? m[0]: null;
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
if (info.singer) kws.push({ kw: info.name + ' ' + info.singer, strict: true});
if (info.albumName) kws.push({ kw: info.name + ' ' + info.albumName, strict: true});
kws.push({ kw: info.name, strict: false});
return kws;
}
function checkSongMatch(apiName, apiArtist, musicInfo) {
const a = cleanText(apiName), b = cleanText(musicInfo.name || '');
if (!a ||!b || (!a.includes(b) &&!b.includes(a))) return false;
const singer = cleanText(musicInfo.singer || '');
if (singer) {
const c = cleanText(apiArtist || '');
if (c &&!c.includes(singer) &&!singer.includes(c)) return false;
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
headers: { Accept: 'application/json'},
signal: ctrl.signal,
});
const text = await resp.text();
if (!resp.ok) throw new Error('HTTP ' + resp.status);
if (!text) throw new Error('空响应');
try { return JSON.parse(text);} catch (_) { return text;}
} catch (err) {
if (err && err.name === 'AbortError') throw new Error('请求超时');
throw err;
} finally {
clearTimeout(timer);
}
}

// ---------- 搜索 ----------
// 网易云：GET {chksz}/163_search?keyword=<enc>&limit=20
async function searchWy(keyword, limit) {
const body = await httpGet(
bases.chksz + '/163_search?keyword=' + encodeURIComponent(keyword) + '&limit=' + limit, 10000
);
if (body && body.code!== 200) throw new Error('搜索失败');
const items = Array.isArray(body && body.data)? body.data: [];
if (!items.length) throw new Error('未找到相关歌曲');
return items.slice(0, limit).map(function (s) {
return {
name: s.name || '',
singer: s.artists || '',
albumName: typeof s.album === 'string'? s.album: ((s.album && s.album.name) || ''),
id: String(s.id),
source: 'wy',
duration: s.duration,
durationText: formatDuration(s.duration),
pic: s.picUrl || '',
};
});
}

// 酷我：每页只返回一首，循环 1..3 页收集
// GET {oiapi}/Kuwo?msg=<enc>&n=<page> -> {data:{song,singer,album,rid,duration}}
async function searchKw(keyword, limit) {
const results = [];
for (let page = 1; results.length < limit && page <= 3; page++) {
try {
const body = await httpGet(bases.oiapi + '/Kuwo?msg=' + encodeURIComponent(keyword) + '&n=' + page, 10000);
const d = body && body.data;
if (!d ||!d.song) break;
results.push({
name: d.song || '', singer: d.singer || '', albumName: d.album || '',
id: String(d.rid || ''),
source: 'kw',
duration: d.duration,
durationText: formatDuration(d.duration),
pic: '',
});
} catch (_) { break;}
}
if (!results.length) throw new Error('未找到相关歌曲');
return results;
}

// 咪咕：每页只返回一首，循环 1..3 页收集
// GET {migu}?gm=<enc>&n=<page>&num=1&type=json -> code==200 且有 title
async function searchMg(keyword, limit) {
const results = [];
for (let page = 1; results.length < limit && page <= 3; page++) {
try {
const body = await httpGet(
bases.migu + '?gm=' + encodeURIComponent(keyword) + '&n=' + page + '&num=1&type=json', 10000
);
if (!body || body.code!== 200 ||!body.title) break;
// 原脚本的咪咕搜索没有返回稳定的数字 id，这里用 body.id（若有），否则用合成 id；
// 取链主要靠“溯音咪咕”搜索式回退（按歌名+歌手再查一次），见 suyinMgGetUrl。
// 搜索时已返回的 music_url 会存为 directUrl，作为取链的最后一道回退。
results.push({
name: body.title || '', singer: body.artist || '', albumName: body.album || '',
id: body.id? String(body.id): ('mg_' + Date.now() + '_' + page),
source: 'mg',
duration: body.duration,
durationText: typeof body.duration === 'string'? body.duration: formatDuration(body.duration),
pic: '',
directUrl: body.music_url || '',
});
} catch (_) { break;}
}
if (!results.length) throw new Error('未找到相关歌曲');
return results;
}

// 汽水：GET {QISHUI_SEARCH_API}?keyword=<enc>&search_type=music&limit=20&real_offset=0&search_source=qishui
async function searchQs(keyword, limit) {
const body = await httpGet(
QISHUI_SEARCH_API + '?keyword=' + encodeURIComponent(keyword) +
'&search_type=music&limit=' + limit + '&real_offset=0&search_source=qishui', 10000
);
const items = body && body.data && body.data.list;
if (!Array.isArray(items) ||!items.length) throw new Error('未找到相关歌曲');
return items.slice(0, limit).map(function (s) {
return {
name: s.title || '',
singer: (s.author_info && s.author_info.name) || '',
albumName: '',
id: String(s.item_id),
source: 'qs',
duration: s.duration,
durationText: formatDuration(s.duration),
pic: s.cover_url || '',
};
});
}

const SEARCH_ERROR = {
wy: '网易云搜索失败，换个源试试',
kw: '酷我搜索失败，换个源试试',
mg: '咪咕搜索失败，换个源试试',
qs: '汽水搜索失败，换个源试试',
};

async function searchBySource(source, keyword) {
const limit = 20;
if (source === 'wy') return searchWy(keyword, limit);
if (source === 'kw') return searchKw(keyword, limit);
if (source === 'mg') return searchMg(keyword, limit);
if (source === 'qs') return searchQs(keyword, limit);
throw new Error('不支持的音源');
}

// ---------- 取播放链接 ----------
// CHKSZ：GET {chksz}/163_music?id=<id>&level=<level>，按音质回退链逐级尝试
async function chkszGetUrl(song, quality) {
const level = CHKSZ_LEVEL[quality] || 'standard';
const levels = CHKSZ_FALLBACK[level] || ['standard'];
for (const lv of levels) {
try {
const body = await httpGet(bases.chksz + '/163_music?id=' + encodeURIComponent(song.id) + '&level=' + lv, 8000);
if (body && body.code === 200 && body.data && body.data.url) return body.data.url;
} catch (_) { continue;}
}
throw new Error('CHKSZ失败');
}

// 星海：GET {xinghai}&types=url&source=<source>&id=<id>&br=<br>
async function xinghaiGetUrl(platform, song, quality) {
const source = XINGHAI_SRC[platform];
const br = XINGHAI_BR[quality] || '320';
if (!source ||!song.id) throw new Error('参数缺失');
const body = await httpGet(
bases.xinghai + '&types=url&source=' + source + '&id=' + encodeURIComponent(song.id) + '&br=' + br, 8000
);
return validateUrl(body && body.url);
}

// 溯音163：GET {oiapi}/Music_163?id=<id>，data 可能是数组或对象，取第一个.url
async function suyin163GetUrl(song) {
const body = await httpGet(bases.oiapi + '/Music_163?id=' + encodeURIComponent(song.id), 8000);
const data = Array.isArray(body && body.data)? body.data[0]: (body && body.data);
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
} catch (_) { continue;}
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
} catch (_) { continue;}
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
return validateUrl((body && body.url) || (body && body.data && body.data.url) || extractUrlFromMsg(typeof body === 'string'? body: JSON.stringify(body)));
}

// 汽水 H5：GET {QISHUI_H5_API}?track_id=<id>，解析 track_player.video_model JSON
async function qishuiH5GetUrl(song) {
const body = await httpGet(QISHUI_H5_API + '?track_id=' + encodeURIComponent(song.id), 8000);
const songStr = body && body.track_player && body.track_player.video_model;
if (!songStr) throw new Error('汽水H5无数据');
const parsed = JSON.parse(songStr);
const first = parsed && parsed.video_list && parsed.video_list[0];
if (!first ||!first.main_url) throw new Error('汽水H5无链接');
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
function () { return chkszGetUrl(song, quality);},
function () { return xinghaiGetUrl('wy', song, quality);},
function () { return suyin163GetUrl(song);},
function () { return templateGetUrl('wy', song, quality, CHANGQING);},
function () { return templateGetUrl('wy', song, quality, NIANXIN);},
];
} else if (platform === 'kw') {
chain = [
function () { return xinghaiGetUrl('kw', song, quality);},
function () { return suyinKwGetUrl(song, quality);},
function () { return templateGetUrl('kw', song, quality, CHANGQING);},
function () { return templateGetUrl('kw', song, quality, NIANXIN);},
];
} else if (platform === 'mg') {
chain = [
function () { return xinghaiGetUrl('mg', song, quality);},
function () { return suyinMgGetUrl(song);},
function () { return templateGetUrl('mg', song, quality, CHANGQING);},
function () { return templateGetUrl('mg', song, quality, NIANXIN);},
// 搜索时已返回 music_url：不发新请求，直接复用
function () { return song.directUrl? validateUrl(song.directUrl): Promise.reject(new Error('无直链'));},
];
} else if (platform === 'qs') {
chain = [function () { return qishuiH5GetUrl(song);}];
} else {
return Promise.reject(new Error('不支持的平台'));
}

return Promise.any(chain.map(function (fn) {
return Promise.resolve().then(fn).then(validateUrl);
})).then(function (url) {
cacheSet(key, url);
return url;
}).catch(function () {
throw new Error('所有音源均解析失败');
});
}

// ---------- 歌词：只有汽水保证提供 ----------
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
const m = line.match(/^\[(\d+):(\d+)\.(\d+)\](.*)$/);
if (!m) continue;
out.push({ time: parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + parseInt(m[3], 10) / 100, text: m[4].trim()});
}
return out.sort(function (a, b) { return a.time - b.time;});
}
async function loadLyrics(song) {
if (song.source!== 'qs') return [];
const body = await httpGet(QISHUI_H5_API + '?track_id=' + encodeURIComponent(song.id), 8000);
const raw = body && body.lyric && body.lyric.content;
if (!raw) throw new Error('无歌词');
return parseLrc(krcToLrc(raw));
}

// ---------- 界面 ----------
const $ = function (id) { return document.getElementById(id);};
const searchInput = $('searchInput');
const searchBtn = $('searchBtn');
const statusEl = $('status');
const resultsList = $('resultsList');
const emptyHint = $('emptyHint');
const lyricsPanel = $('lyricsPanel');
const audio = $('audio');

let currentSource = 'kw'; // 2026-11-09：网易云搜索 api.chksz.top 不可达，默认改用已实测可用的酷我；网易云仍可手动切换
let results = [];
let currentIndex = -1;
let currentLyrics = [];

function setStatus(text, kind) {
statusEl.textContent = text;
statusEl.className = 'status' + (kind? ' ' + kind: '');
}
function esc(s) {
return String(s == null? '': s).replace(/[&<>"']/g, function (c) {
return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
});
}

function renderResults() {
resultsList.innerHTML = '';
emptyHint.style.display = results.length? 'none': '';
results.forEach(function (song, i) {
const li = document.createElement('li');
const btn = document.createElement('button');
btn.type = 'button';
btn.className = 'result-item' + (i === currentIndex? ' playing': '');
const cover = song.pic
? '<img class="result-cover" src="' + esc(song.pic) + '" alt="" loading="lazy">'
: '<span class="result-cover-placeholder" aria-hidden="true">♪</span>';
btn.innerHTML = cover +
'<span class="result-info"><span class="result-name">' + esc(song.name) + '</span>' +
'<span class="result-sub">' + esc(song.singer || '未知歌手') + (song.albumName? ' · ' + esc(song.albumName): '') + '</span></span>' +
'<span class="result-duration">' + esc(song.durationText || '') + '</span>';
btn.addEventListener('click', function () { playSong(i);});
li.appendChild(btn);
resultsList.appendChild(li);
});
}

function renderLyrics() {
lyricsPanel.innerHTML = '';
if (!currentLyrics.length) {
const p = document.createElement('p');
p.className = 'lyrics-empty';
p.textContent = '暂无歌词';
lyricsPanel.appendChild(p);
return;
}
currentLyrics.forEach(function (line) {
const p = document.createElement('p');
p.textContent = line.text;
p.dataset.time = String(line.time);
lyricsPanel.appendChild(p);
});
}

function updateLyricHighlight() {
if (!currentLyrics.length ||!audio.duration) return;
const t = audio.currentTime;
let active = -1;
for (let i = 0; i < currentLyrics.length; i++) {
if (currentLyrics[i].time <= t) active = i; else break;
}
const ps = lyricsPanel.querySelectorAll('p');
ps.forEach(function (p, i) { p.classList.toggle('active', i === active);});
if (active >= 0 && ps[active]) ps[active].scrollIntoView({ block: 'center', behavior: 'smooth'});
}

function updateNowPlaying(song) {
$('songName').textContent = song? song.name: '未在播放';
$('songSinger').textContent = song? (song.singer || '未知歌手'): '搜一首歌，点它开始播放';
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
}

async function playSong(index) {
if (index < 0 || index >= results.length) return;
currentIndex = index;
const song = results[index];
const quality = $('qualitySelect').value;
renderResults();
updateNowPlaying(song);
setStatus('正在解析播放链接…（' + song.name + '）');
$('playBtn').textContent = '⏸';
try {
const url = await getUrlWithFallback(song.source, song, quality);
audio.src = url;
await audio.play();
setStatus('正在播放：' + song.name + ' — ' + (song.singer || '未知歌手'), 'ok');
$('playBtn').textContent = '⏸';
} catch (err) {
setStatus('播放链接解析失败，换首歌或换个音质试试（' + (err && err.message? err.message: '未知错误') + '）', 'error');
$('playBtn').textContent = '▶';
return;
}
// 歌词：只有汽水保证提供，其他音源失败时显示“暂无歌词”，不报错打断播放
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
setStatus('正在搜索…');
try {
results = await searchBySource(currentSource, keyword);
currentIndex = -1;
renderResults();
setStatus('找到 ' + results.length + ' 首（' + (currentSource === 'wy'? '网易云': currentSource === 'kw'? '酷我': currentSource === 'mg'? '咪咕': '汽水') + '），点一首开始播放。', 'ok');
} catch (err) {
results = [];
renderResults();
setStatus((SEARCH_ERROR[currentSource] || '搜索失败，换个源试试') + '（' + (err && err.message? err.message: '未知错误') + '）', 'error');
} finally {
searchBtn.disabled = false;
}
}

// ---------- 事件绑定 ----------
searchBtn.addEventListener('click', doSearch);
searchInput.addEventListener('keydown', function (e) {
if (e.key === 'Enter') doSearch();
});

document.querySelectorAll('.tab').forEach(function (tab) {
tab.addEventListener('click', function () {
document.querySelectorAll('.tab').forEach(function (t) {
t.classList.remove('active');
t.setAttribute('aria-selected', 'false');
});
tab.classList.add('active');
tab.setAttribute('aria-selected', 'true');
currentSource = tab.dataset.source;
if (searchInput.value.trim()) doSearch();
else setStatus('已切换到' + tab.textContent + '，输入歌名后搜索。');
});
});

document.querySelectorAll('.chip').forEach(function (chip) {
chip.addEventListener('click', function () {
searchInput.value = chip.dataset.keyword;
doSearch();
});
});

$('qualitySelect').addEventListener('change', function () {
if (currentIndex >= 0) playSong(currentIndex);
});

$('playBtn').addEventListener('click', function () {
if (!audio.src) {
if (results.length) playSong(0);
else setStatus('请先搜索并选择一首歌。', 'error');
return;
}
if (audio.paused) { audio.play(); $('playBtn').textContent = '⏸';}
else { audio.pause(); $('playBtn').textContent = '▶';}
});
$('prevBtn').addEventListener('click', function () {
if (results.length) playSong((currentIndex - 1 + results.length) % results.length);
});
$('nextBtn').addEventListener('click', function () {
if (results.length) playSong((currentIndex + 1) % results.length);
});

audio.addEventListener('play', function () { $('playBtn').textContent = '⏸';});
audio.addEventListener('pause', function () { $('playBtn').textContent = '▶';});
audio.addEventListener('ended', function () {
if (results.length) playSong((currentIndex + 1) % results.length);
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
if (!next.chksz ||!next.xinghai ||!next.oiapi ||!next.migu) {
$('settingsStatus').textContent = '地址不能为空，请检查后再保存。';
return;
}
bases = next;
try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));} catch (_) {}
$('settingsStatus').textContent = '已保存，下次搜索生效。';
});
$('resetSettingsBtn').addEventListener('click', function () {
try { localStorage.removeItem(SETTINGS_KEY);} catch (_) {}
bases = {...DEFAULT_BASES};
fillSettings();
$('settingsStatus').textContent = '已恢复默认地址。';
});

// ---------- 初始化 ----------
audio.volume = 0.8;
fillSettings();
renderLyrics();
