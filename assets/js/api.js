/* ============================================================
   JustMusic — audio sources
   Public endpoints + lx-music style script bridge.
   Everything runs in the browser; no build step, no server.
   ============================================================ */
(function () {
  const JM = (window.JM = window.JM || {});

  const OIAPI = "https://oiapi.net/api";
  const VKEYS = "https://api.vkeys.cn/v2/music";
  const VKEYS_PATH = { wy: "netease", tx: "tencent" };
  const METING = "https://api.qijieya.cn/meting/";
  const KUWO_LRC = "https://m.kuwo.cn/newh5/singles/songinfoandlrc";

  const BR = { "128k": 7, "320k": 5, "flac": 1 };
  const QUALITY_LABEL = { "128k": "标准", "320k": "高品质", flac: "无损" };

  /* ---------------- small utilities ---------------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function upgrade(url) {
    if (typeof url !== "string") return "";
    return url.startsWith("http://") ? "https://" + url.slice(7) : url;
  }

  // Meting is a thin redirect layer in front of the official CDNs. Its
  // netease stream endpoint answers over https and allows cross-origin
  // playback, so the browser can hand the URL straight to <audio>.
  function meting(server, type, id) {
    return `${METING}?server=${server}&type=${type}&id=${encodeURIComponent(id)}`;
  }

  // Netease serves the original multi-megabyte artwork by default. Asking
  // for a 300px rendition keeps search lists fast.
  function coverUrl(url, source) {
    const u = upgrade(url);
    if (!u) return "";
    if (source === "wy" && /music\.126\.net/.test(u) && !/[?&]param=/.test(u)) {
      return u + (u.includes("?") ? "&" : "?") + "param=300y300";
    }
    return u;
  }

  function createLimiter(max) {
    let active = 0;
    const queue = [];
    const run = (task) =>
      new Promise((resolve, reject) => {
        const start = () => {
          active++;
          task()
            .then(resolve, reject)
            .finally(() => {
              active--;
              const next = queue.shift();
              if (next) next();
            });
        };
        if (active < max) start();
        else queue.push(start);
      });
    return run;
  }

  const limit = createLimiter(6);

  async function getJSON(url, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 13000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        method: opts.method || "GET",
        headers: Object.assign({ Accept: "application/json" }, opts.headers || {}),
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!res.ok) throw new Error("网络请求失败 (" + res.status + ")");
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function getText(url, timeout = 13000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!res.ok) throw new Error("网络请求失败 (" + res.status + ")");
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  function parseDuration(value) {    if (typeof value === "number" && isFinite(value)) return Math.round(value);
    if (!value) return 0;
    const str = String(value).trim();
    if (/^\d+$/.test(str)) return parseInt(str, 10);
    const cn = str.match(/(?:(\d+)\s*分)?\s*(\d+)\s*秒/);
    if (cn) return (parseInt(cn[1] || 0, 10) * 60) + parseInt(cn[2] || 0, 10);
    const mmss = str.match(/^(\d+):(\d{1,2})$/);
    if (mmss) return parseInt(mmss[1], 10) * 60 + parseInt(mmss[2], 10);
    return 0;
  }

  function normalize(text) {
    return String(text || "")
      .replace(/（[^）]*）|\([^)]*\)|\[[^\]]*\]/g, "")
      .replace(/[\s·,，。!！?？:：;；/\\|\-—–_'’"“”《》【】]/g, "")
      .toLowerCase();
  }

  function artistMatch(a, b) {
    const x = normalize(a);
    const y = normalize(b);
    if (!x || !y) return true;
    const parts = x.split(/[&/、]/).filter(Boolean);
    return x.includes(y) || y.includes(x) || parts.some((p) => y.includes(p) || p.includes(y));
  }

  function songMatch(a, b) {
    const x = normalize(a);
    const y = normalize(b);
    if (!x || !y) return false;
    return x === y || x.includes(y) || y.includes(x);
  }

  /* ---------------- response cache ---------------- */
  const memo = new Map();
  function cached(key, ttl, fn) {
    const hit = memo.get(key);
    if (hit && Date.now() - hit.ts < ttl) return hit.value;
    const value = fn().catch((err) => {
      memo.delete(key);
      throw err;
    });
    memo.set(key, { ts: Date.now(), value });
    return value;
  }

  /* ---------------- 酷我 (oiapi) ---------------- */
  function normalizeKuwo(raw, fallbackName) {
    if (!raw || !raw.song) return null;
    const id = raw.id != null ? String(raw.id) : "";
    return {
      key: "kw:" + (id || normalize(raw.song) + normalize(raw.singer)),
      id,
      source: "kw",
      sourceName: "酷我音乐",
      name: raw.song,
      singer: raw.singer || "未知歌手",
      album: raw.album || "",
      duration: parseDuration(raw.time),
      cover: upgrade(raw.picture),
      quality: "320k",
      extra: { rid: raw.rid, types: raw.types || [], bitrate: raw.bitrate },
      meta: { kw: { id, rid: raw.rid } },
      _fallbackName: fallbackName,
    };
  }

  async function kuwoOne(keyword, index, quality) {
    const br = BR[quality] || 5;
    const url = `${OIAPI}/Kuwo?msg=${encodeURIComponent(keyword)}&n=${index}&br=${br}`;
    const body = await limit(() => getJSON(url));
    if (!body || !body.data) {
      const msg = (body && body.message) || "没有找到结果";
      throw new Error(msg);
    }
    return normalizeKuwo(body.data);
  }

  async function kuwoSearch(keyword, count = 12, offset = 0) {
    const q = String(keyword || "").trim();
    if (!q) return [];
    return cached("kw-search:" + q + ":" + count + ":" + offset, 5 * 60 * 1000, async () => {
      const jobs = [];
      for (let i = offset + 1; i <= offset + count; i++) {
        jobs.push(
          kuwoOne(q, i, "320k").catch(() => null)
        );
      }
      const rows = await Promise.all(jobs);
      const seen = new Set();
      const out = [];
      rows.forEach((t) => {
        if (!t || seen.has(t.key)) return;
        seen.add(t.key);
        out.push(t);
      });
      if (!out.length && offset > 0) return [];
      if (!out.length) throw new Error("没有找到相关歌曲，换个关键词试试");
      return out;
    });
  }

  async function resolveKuwo(track, quality) {
    const q = String(track.name || "").trim();
    if (!q) throw new Error("缺少歌曲名");
    const wantFlac = quality === "flac";
    const attempts = [
      `${q} ${track.singer || ""}`.trim(),
      q,
    ];
    // Artist names are formatted differently across services
    // ("冯沁苑(买辣椒也用券)" vs "买辣椒也用券"), so a name match that
    // also agrees on the artist wins, but a loose name match is kept as
    // a fallback instead of failing outright.
    let loose = null;
    for (const keyword of attempts) {
      for (let n = 1; n <= 2; n++) {
        try {
          const data = await limit(() => getJSON(
            `${OIAPI}/Kuwo?msg=${encodeURIComponent(keyword)}&n=${n}&br=${BR[quality] || 5}`
          ));
          const raw = data && data.data;
          if (!raw || !raw.url) continue;
          if (!songMatch(raw.song, track.name)) continue;
          if (wantFlac && String(raw.format || "").toLowerCase() !== "flac") continue;
          const hit = {
            url: upgrade(raw.url),
            bitrate: raw.bitrate,
            format: raw.format,
            matched: raw.song,
          };
          if (!track.singer || artistMatch(raw.singer, track.singer)) return hit;
          if (!loose) loose = hit;
        } catch (err) {
          /* try the next candidate */
        }
      }
    }
    if (loose) return loose;
    throw new Error("酷我音源没有找到可播放的版本");
  }

  async function kuwoStream(track, q) {
    try {
      return (await resolveKuwo(track, q)).url;
    } catch (err) {
      // A song without a lossless version should still play in 320k
      // instead of being skipped.
      if (q === "flac") return (await resolveKuwo(track, "320k")).url;
      throw err;
    }
  }

  async function kuwoLyric(trackOrId) {
    let id = typeof trackOrId === "object" ? trackOrId.id : trackOrId;
    if (!id && typeof trackOrId === "object") {
      const hit = await kuwoSearch(`${trackOrId.name} ${trackOrId.singer || ""}`.trim(), 3).catch(() => []);
      if (hit[0]) id = hit[0].id;
    }
    if (!id) return [];
    return cached("kw-lrc:" + id, 30 * 60 * 1000, async () => {
      const body = await limit(() => getJSON(`${KUWO_LRC}?musicId=${encodeURIComponent(id)}`));
      const list = body && body.data && body.data.lrclist;
      if (!Array.isArray(list)) return [];
      return list
        .map((line) => ({
          t: parseFloat(line.time) || 0,
          text: String(line.lineLyric || "").trim(),
        }))
        .filter((line) => line.text);
    });
  }

  /* ---------------- 网易云 / QQ (vkeys) ---------------- */
  function normalizeVkeys(raw, source) {
    if (!raw || !(raw.song || raw.name)) return null;
    const id = raw.id != null ? String(raw.id) : raw.mid;
    return {
      key: source + ":" + id,
      id,
      source,
      sourceName: source === "wy" ? "网易云音乐" : "QQ音乐",
      name: raw.song || raw.name,
      singer: raw.singer || "未知歌手",
      album: raw.album || "",
      duration: parseDuration(raw.interval),
      cover: coverUrl(raw.cover || "", source),
      quality: source === "wy" ? "320k" : "128k",
      meta: source === "tx" ? { qq: { id, mid: raw.mid } } : { wy: { id } },
      _raw: raw,
    };
  }

  async function vkeysSearch(source, keyword, count = 20, page = 1) {
    const q = String(keyword || "").trim();
    if (!q) return [];
    const key = `vk:${source}:${q}:${count}:${page}`;
    return cached(key, 5 * 60 * 1000, async () => {
      const path = VKEYS_PATH[source] || source;
      const quality = source === "wy" ? "&quality=2" : "";
      // Netease's "page" is really an offset (page 2 overlaps page 1 by 19
      // items), so walk it by whole pages. Tencent uses a real page number.
      const apiPage = source === "wy" ? (page - 1) * count + 1 : page;
      const url = `${VKEYS}/${path}?word=${encodeURIComponent(q)}&num=${count}&page=${apiPage}${quality}`;
      let body;
      try {
        body = await limit(() => getJSON(url));
      } catch (err) {
        // The upstream occasionally drops a request; one retry is enough.
        await sleep(400);
        body = await limit(() => getJSON(url));
      }
      const list = body && Array.isArray(body.data) ? body.data : [];
      if (!list.length) {
        // Page 2+ returning nothing just means the result set ended.
        if (page > 1) return [];
        throw new Error((body && body.message) || "没有找到相关歌曲，换个关键词试试");
      }
      return list.map((item) => normalizeVkeys(item, source)).filter(Boolean);
    });
  }

  async function vkeysDetail(source, id, mid, quality) {
    const kq = source === "tx" ? String(quality || 8) : "";
    // QQ hands out short-lived signed URLs; don't reuse one for long.
    const ttl = source === "tx" ? 4 * 60 * 1000 : 15 * 60 * 1000;
    return cached(`vk-detail:${source}:${id}:${mid || ""}:${kq}`, ttl, async () => {
      const path = VKEYS_PATH[source] || source;
      let url = `${VKEYS}/${path}?id=${encodeURIComponent(id)}`;
      if (mid) url += `&mid=${encodeURIComponent(mid)}`;
      if (source === "tx") url += `&quality=${kq}`;
      const body = await limit(() => getJSON(url));
      return (body && body.data) || null;
    });
  }

  /* ---------------- direct 网易云 / QQ streams ----------------
     The vkeys search endpoints give us real Netease / QQ catalogue
     entries, so playback should use those services' own audio rather
     than silently matching a Kuwo copy. Free tracks resolve directly;
     VIP / paid tracks fail and the player falls back to Kuwo. */

  function neteaseDirect(track) {
    if (!track || !track.id) throw new Error("缺少网易云歌曲 ID");
    return meting("netease", "url", track.id);
  }

  async function tencentDirect(track, quality) {
    if (!track || !track.id) throw new Error("缺少 QQ 音乐歌曲 ID");
    const mid = (track.meta && track.meta.qq && track.meta.qq.mid) || track.mid || "";
    // vkeys tiers: 6 = 128kbps mp3, 8 = 320kbps mp3. Higher values fall
    // back to the same 320k file for songs without a lossless master.
    const kq = quality === "128k" ? 6 : 8;
    const detail = await vkeysDetail("tx", track.id, mid, kq).catch(() => null);
    if (!detail || !detail.url) throw new Error("QQ 音乐没有返回播放地址");
    const kbps = parseInt(detail.kbps, 10) || 0;
    // Paid / VIP tracks only yield a short 28k preview; a full Kuwo match
    // is a better experience, so treat the preview as a miss.
    if (detail.quality === "音乐试听" || kbps < 64) {
      throw new Error("QQ 音乐只提供试听片段");
    }
    return upgrade(detail.url);
  }

  async function vkeysLyric(source, id) {
    const path = VKEYS_PATH[source] || source;
    return cached(`vk-lrc:${source}:${id}`, 30 * 60 * 1000, async () => {
      try {
        const body = await limit(() => getJSON(`${VKEYS}/${path}/lyric?id=${encodeURIComponent(id)}`));
        const lrc = body && body.data && body.data.lrc;
        return lrc ? parseLRC(lrc) : [];
      } catch (err) {
        return [];
      }
    });
  }

  // Meting's lyric endpoint returns the raw LRC text from the service that
  // owns the song, which covers far more tracks than the vkeys lyric route.
  async function metingLyric(server, id) {
    if (!id) return [];
    return cached(`meting-lrc:${server}:${id}`, 30 * 60 * 1000, async () => {
      try {
        const text = await limit(() => getText(meting(server, "lrc", id)));
        return parseLRC(text);
      } catch (err) {
        return [];
      }
    });
  }

  // Backup search when the vkeys route is unavailable. Meting returns one
  // entry per song with name / artist / cover / id, but no duration.
  async function metingSearch(source, keyword, count) {
    const q = String(keyword || "").trim();
    if (!q) return [];
    return cached(`meting-search:${source}:${q}`, 5 * 60 * 1000, async () => {
      const server = source === "tx" ? "tencent" : "netease";
      const body = await limit(() => getJSON(meting(server, "search", q)));
      const rows = Array.isArray(body) ? body : [];
      const out = rows.slice(0, count || 20).map((item) => {
        const m = String(item.url || "").match(/[?&]id=([^&]+)/);
        const id = m ? decodeURIComponent(m[1]) : "";
        if (!id) return null;
        const isTx = source === "tx";
        return {
          key: `${source}:${id}`,
          id,
          source,
          sourceName: source === "wy" ? "网易云音乐" : "QQ音乐",
          name: item.name || "未知歌曲",
          singer: item.artist || "未知歌手",
          album: "",
          duration: 0,
          cover: coverUrl(item.pic || "", source),
          quality: source === "wy" ? "320k" : "128k",
          meta: isTx ? { qq: { id, mid: id } } : { wy: { id } },
        };
      }).filter(Boolean);
      if (!out.length) throw new Error("没有找到相关歌曲，换个关键词试试");
      return out;
    });
  }

  /* ---------------- LRC parsing ---------------- */
  function parseLRC(lrc) {
    const rows = [];
    String(lrc || "")
      .split(/\r?\n/)
      .forEach((line) => {
        const stamps = line.match(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g);
        if (!stamps) return;
        const text = line.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, "").trim();
        if (!text) return;
        stamps.forEach((stamp) => {
          const m = stamp.match(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/);
          if (!m) return;
          const ms = m[3] ? parseInt(m[3].padEnd(3, "0").slice(0, 3), 10) : 0;
          rows.push({
            t: parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + ms / 1000,
            text,
          });
        });
      });
    rows.sort((a, b) => a.t - b.t);
    return rows;
  }

  /* ---------------- stream resolution ---------------- */
  const streamCache = new Map();
  // Tracks whose official stream was rejected by the browser. Skip the
  // direct URL on later plays instead of failing again.
  const directBlocked = new Set();

  async function getStream(track, quality) {
    if (!track) throw new Error("没有歌曲");
    const q = QUALITY_LABEL[quality] ? quality : "320k";
    const cacheKey = `${track.key}:${q}`;
    const hit = streamCache.get(cacheKey);
    if (hit && Date.now() - hit.ts < hit.ttl) return hit.url;

    let url = "";

    if (track.source === "lx") {
      // Script sources sometimes return a URL that is reachable by the
      // script's server but not by the browser. Prefer the native Kuwo
      // match when the song exists there, and keep the script as fallback
      // for exclusive tracks.
      let native = null;
      try {
        native = await resolveKuwo(track, q);
      } catch (err) {
        if (q === "flac") {
          native = await resolveKuwo(track, "320k").catch(() => null);
        }
      }
      url = native ? native.url : await JM.lx.musicUrl(track, q);
    } else if (track.source === "wy" || track.source === "tx") {
      // Use the service's own audio first, then fall back to Kuwo when the
      // track is VIP-only or the upstream refuses to hand out a URL.
      if (!directBlocked.has(track.key)) {
        try {
          url = track.source === "wy"
            ? neteaseDirect(track)
            : await tencentDirect(track, q);
        } catch (err) {
          url = "";
        }
      }
      if (!url) url = await kuwoStream(track, q);
    } else {
      url = await kuwoStream(track, q);
    }

    if (!url) throw new Error("没有解析到播放地址");
    const ttl = track.source === "tx" ? 4 * 60 * 1000 : 10 * 60 * 1000;
    streamCache.set(cacheKey, { ts: Date.now(), url, ttl });
    return url;
  }

  // Used when the browser rejects the primary URL (expired token, VIP-only
  // CDN, offline host). Kuwo is matched by name + artist, so it can rescue
  // a Netease / QQ track that resolved to nothing playable.
  async function getBackupStream(track) {
    if (!track) throw new Error("没有歌曲");
    if (track.source === "wy" || track.source === "tx") {
      directBlocked.add(track.key);
    }
    if (track.source === "lx") {
      try {
        return await JM.lx.musicUrl(track, "320k");
      } catch (err) { /* fall through to Kuwo */ }
    }
    for (const q of ["320k", "128k"]) {
      try {
        const hit = await resolveKuwo(track, q);
        if (hit && hit.url) return hit.url;
      } catch (err) { /* try the lower bitrate */ }
    }
    throw new Error("没有可用的备用音源");
  }

  async function getLyrics(track) {
    if (!track) return [];
    try {
      if (track.source === "kw") return await kuwoLyric(track.id);
      if (track.source === "wy") {
        const metingLrc = await metingLyric("netease", track.id);
        if (metingLrc.length) return metingLrc;
        const own = await vkeysLyric("wy", track.id);
        if (own.length) return own;
      }
      if (track.source === "tx") {
        const mid = (track.meta && track.meta.qq && track.meta.qq.mid) || "";
        const metingLrc = await metingLyric("tencent", mid || track.id);
        if (metingLrc.length) return metingLrc;
        const own = await vkeysLyric("tx", track.id);
        if (own.length) return own;
      }
    } catch (err) {
      /* fall through to Kuwo lookup */
    }
    return kuwoLyric(track).catch(() => []);
  }

  /* ---------------- search entry ---------------- */
  async function search(source, keyword, page) {
    const pg = Math.max(1, parseInt(page, 10) || 1);
    if (source === "kw") return kuwoSearch(keyword, 12, (pg - 1) * 12);
    if (source === "wy" || source === "tx") {
      try {
        return await vkeysSearch(source, keyword, 20, pg);
      } catch (err) {
        if (pg > 1) throw err;
        try {
          return await metingSearch(source, keyword, 20);
        } catch (fallbackErr) {
          throw err;
        }
      }
    }
    if (source === "lx:all") return JM.lx.searchAll(keyword, 20);
    if (source.startsWith("lx:")) {
      const [, scriptId, engineSource] = source.split(":");
      return JM.lx.search(scriptId, engineSource, keyword, 20);
    }
    throw new Error("未知音源");
  }

  JM.api = {
    search,
    getStream,
    getBackupStream,
    getLyrics,
    kuwoSearch,
    kuwoLyric,
    vkeysSearch,
    vkeysDetail,
    vkeysLyric,
    metingSearch,
    neteaseDirect,
    tencentDirect,
    parseLRC,
    parseDuration,
    upgrade,
    normalize,
    QUALITY_LABEL,
  };
})();
