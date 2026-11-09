/* ============================================================
   JustMusic — lx-music custom source host
   Loads KMusic / lx-music compatible .js source scripts and
   lets them search & resolve stream URLs in the browser.
   ============================================================ */
(function () {
  const JM = (window.JM = window.JM || {});

  const BUNDLED = [
    {
      id: "feichangdao",
      name: "非常刀",
      file: "sources/feichangdao.js",
      desc: "聚合音源 · 网易 / QQ / 酷我 / 咪咕 / 汽水",
      author: "群主要进去",
      defaultOn: true,
    },
    {
      id: "suyin",
      name: "溯音音源",
      file: "sources/suyin.js",
      desc: "QQ / 网易 / 酷我 / 咪咕",
      author: "竹佀",
      defaultOn: false,
    },
    {
      id: "luoxue",
      name: "落雪音源",
      file: "sources/luoxue.js",
      desc: "QQ / 网易 · 支持歌词与封面",
      author: "高音质",
      defaultOn: false,
    },
    {
      id: "xinlan",
      name: "新澜音源",
      file: "sources/xinlan.js",
      desc: "全平台 320k（需要服务端授权）",
      author: "时迁酱",
      defaultOn: false,
    },
    {
      id: "ikun",
      name: "ikun 音源",
      file: "sources/ikun.js",
      desc: "酷我 / 网易 / QQ",
      author: "ikunshare",
      defaultOn: false,
    },
  ];

  const EVENT_NAMES = {
    request: "request",
    inited: "inited",
    updateAlert: "updateAlert",
    showConfigView: "showConfigView",
    downloadPic: "downloadPic",
  };

  const scripts = BUNDLED.map((s) => ({
    ...s,
    status: "idle",
    error: "",
    sources: {},
    handlers: {},
    code: "",
  }));

  const listeners = new Set();
  let loading = false;
  let loadedOnce = false;

  function emit() {
    listeners.forEach((fn) => {
      try { fn(); } catch (err) { /* ignore */ }
    });
  }

  function find(id) {
    return scripts.find((s) => s.id === id) || null;
  }

  /* ---------------- sandbox ---------------- */
  function makeSandbox(def) {
    const handlers = {};
    let inited = false;

    const lxRequest = (url, options, callback) => {
      const opts = options || {};
      const cb = typeof callback === "function" ? callback : () => {};
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeout || 12000);
      const init = {
        method: opts.method || "GET",
        headers: opts.headers || {},
        signal: ctrl.signal,
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      };
      fetch(url, init)
        .then(async (res) => {
          const text = await res.text();
          let body = text;
          try { body = JSON.parse(text); } catch (err) { /* keep text */ }
          clearTimeout(timer);
          const headers = {};
          res.headers.forEach((v, k) => { headers[k] = v; });
          cb(null, { statusCode: res.status, status: res.status, headers, body });
        })
        .catch((err) => {
          clearTimeout(timer);
          cb(err);
        });
    };

    const lx = {
      EVENT_NAMES,
      env: "desktop",
      version: "2.0.0",
      utils: {},
      request: lxRequest,
      on(event, handler) {
        handlers[event] = handler;
      },
      send(event, payload) {
        if (event === EVENT_NAMES.inited) {
          inited = true;
          def.sources = (payload && payload.sources) || {};
          def.status = "ready";
          def.error = "";
        }
        if (event === EVENT_NAMES.updateAlert && payload && payload.log) {
          console.info(`[${def.name}] ${payload.log}`);
        }
      },
    };

    def.handlers = handlers;
    return { lx, isInited: () => inited };
  }

  async function fetchScriptCode(def) {
    if (!def.custom) {
      const map = window.__JM_LX_SOURCES__;
      if (map && typeof map[def.id] === "string" && map[def.id].length > 40) {
        return map[def.id];
      }
    }
    try {
      const res = await fetch(def.file, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const code = await res.text();
      if (!code || code.length < 40) throw new Error("内容为空");
      return code;
    } catch (err) {
      const detail = (err && err.message) || String(err);
      if (location.protocol === "file:") {
        throw new Error("本地文件访问受限，请用本地静态服务器打开（" + detail + "）");
      }
      throw new Error("无法读取脚本文件，请确认 sources/ 目录已上传（" + detail + "）");
    }
  }

  async function loadScript(def) {
    def.status = "loading";
    def.error = "";
    emit();
    try {
      const code = await fetchScriptCode(def);

      // lx-music scripts read globalThis.lx at evaluation time.
      const sandbox = makeSandbox(def);
      window.lx = sandbox.lx;
      globalThis.lx = sandbox.lx;

      try {
        new Function(code)();
      } catch (err) {
        throw new Error("脚本执行出错：" + (err && err.message ? err.message : err));
      }

      if (!sandbox.isInited()) {
        await new Promise((r) => setTimeout(r, 400));
      }
      if (!sandbox.isInited()) throw new Error("脚本未返回音源信息");

      const count = Object.keys(def.sources).length;
      if (!count) throw new Error("脚本没有声明任何音源");
      def.code = code;
      def.status = "ready";
    } catch (err) {
      def.status = "error";
      def.error = (err && err.message) || String(err);
      def.handlers = {};
      def.sources = {};
    }
    emit();
  }

  /* ---------------- url helpers ---------------- */
  function normalizeScriptUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    const gh = raw.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
    if (gh) return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}/${gh[4]}`;
    const gist = raw.match(/^https?:\/\/gist\.github\.com\/([^/]+)\/([^/]+)$/);
    if (gist) return "";
    return raw;
  }

  function addCustomScript(url, name) {
    const clean = normalizeScriptUrl(url);
    if (!clean) return null;
    const id = "custom_" + Math.random().toString(36).slice(2, 9);
    const def = {
      id,
      name: name || "自定义音源",
      file: clean,
      desc: "从链接加载",
      author: "自定义",
      custom: true,
      status: "idle",
      error: "",
      sources: {},
      handlers: {},
      code: "",
    };
    scripts.push(def);
    return def;
  }

  /* ---------------- loading ---------------- */
  async function init(force) {
    if (loading) return;
    if (loadedOnce && !force) return;
    loading = true;
    const settings = JM.store ? JM.store.data.settings : { scripts: {} };

    for (const def of scripts) {
      if (def.custom) continue;
      const enabled = def.defaultOn
        ? settings.scripts[def.id] !== false
        : settings.scripts[def.id] === true;
      if (!enabled) {
        def.status = "idle";
        continue;
      }
      await loadScript(def);
    }

    // custom scripts from settings
    const custom = (settings.customScripts || []).filter((s) => s.enabled && s.url);
    for (const item of custom) {
      if (scripts.some((s) => s.custom && s.file === normalizeScriptUrl(item.url))) continue;
      const def = addCustomScript(item.url, item.name);
      if (def) await loadScript(def);
    }

    loadedOnce = true;
    loading = false;
    emit();
  }

  async function toggle(def) {
    if (!def) return;
    if (def.status === "ready" || def.status === "loading") {
      def.status = "idle";
      def.handlers = {};
      def.sources = {};
      emit();
      return;
    }
    await loadScript(def);
  }

  async function reloadAll() {
    for (const def of scripts) {
      if (def.status === "ready" || def.status === "error") {
        def.status = "idle";
        def.handlers = {};
        def.sources = {};
      }
    }
    loadedOnce = false;
    await init(true);
  }

  /* ---------------- track normalization ---------------- */
  function normalizeItem(item, def, source) {
    if (!item) return null;
    const id = item.id || item.songmid || item.hash || item.songId ||
      (item.meta && item.meta[source] && (item.meta[source].id || item.meta[source].mid)) || "";
    const cover = item.img || item.picture || (item.meta && item.meta.picture) || "";
    const duration = JM.api ? JM.api.parseDuration(item.interval || item.duration || 0) : 0;
    const key = `lx:${def.id}:${source}:${id || (item.name + "|" + (item.singer || ""))}`;
    return {
      key,
      id: String(id || ""),
      engineId: String(id || ""),
      source: "lx",
      engineSource: source,
      scriptId: def.id,
      scriptName: def.name,
      sourceName: `${def.name} · ${(def.sources[source] && def.sources[source].name) || source}`,
      name: item.name || item.song || "未知歌曲",
      singer: item.singer || item.artist || "未知歌手",
      album: item.albumName || item.album || "",
      duration,
      cover: JM.api ? JM.api.upgrade(cover) : cover,
      quality: "320k",
      lxMeta: item.meta || {},
      extra: item,
    };
  }

  /* ---------------- actions ---------------- */
  async function search(scriptId, source, keyword, count) {
    const def = find(scriptId);
    if (!def) throw new Error("音源脚本不存在");
    if (def.status !== "ready") throw new Error("音源脚本未就绪");
    const handler = def.handlers[EVENT_NAMES.request];
    if (typeof handler !== "function") throw new Error("脚本没有注册请求处理器");
    if (!def.sources[source] || !(def.sources[source].actions || []).includes("search")) {
      throw new Error("该音源不支持搜索");
    }
    let result;
    try {
      result = await handler({
        action: "search",
        source,
        info: { keyword, page: 1, limit: count || 20 },
      });
    } catch (err) {
      throw new Error((err && err.message) || "脚本搜索失败");
    }
    const list = Array.isArray(result) ? result : [];
    if (!list.length) throw new Error("没有找到相关歌曲");
    return list.map((item) => normalizeItem(item, def, source)).filter(Boolean);
  }

  async function musicUrl(track, quality) {
    const def = find(track.scriptId);
    if (!def || def.status !== "ready") throw new Error("音源脚本未就绪");
    const handler = def.handlers[EVENT_NAMES.request];
    if (typeof handler !== "function") throw new Error("脚本没有注册请求处理器");

    const meta = track.lxMeta || {};
    const musicInfo = Object.assign(
      {
        id: track.engineId,
        songmid: track.engineId,
        hash: track.engineId,
        rid: track.engineId,
        name: track.name,
        singer: track.singer,
        albumName: track.album,
        source: track.engineSource,
        meta,
      },
      meta
    );

    let url;
    try {
      url = await handler({
        action: "musicUrl",
        source: track.engineSource,
        info: { type: quality || "320k", musicInfo },
      });
    } catch (err) {
      throw new Error((err && err.message) || "脚本解析播放地址失败");
    }
    if (url && typeof url === "object") url = url.url;
    if (!url || typeof url !== "string") throw new Error("脚本没有返回播放地址");
    return JM.api.upgrade(url);
  }

  function searchableSources() {
    const out = [];
    scripts.forEach((def) => {
      if (def.status !== "ready") return;
      Object.keys(def.sources || {}).forEach((key) => {
        const src = def.sources[key];
        const actions = (src && src.actions) || [];
        if (actions.includes("search")) {
          out.push({
            value: `lx:${def.id}:${key}`,
            scriptId: def.id,
            source: key,
            label: `${def.name} · ${src.name || key}`,
            scriptName: def.name,
            sourceName: src.name || key,
          });
        }
      });
    });
    return out;
  }

  // One search across every ready script. Individual scripts are unreliable
  // (dead upstreams, CORS, rate limits), so failures are skipped rather than
  // surfaced as a wall of errors.
  async function searchAll(keyword, count) {
    const sources = searchableSources();
    if (!sources.length) throw new Error("没有可用的脚本音源");
    const groups = await Promise.all(
      sources.map(async (entry) => {
        let timer;
        try {
          const rows = await Promise.race([
            search(entry.scriptId, entry.source, keyword, count || 20),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error("搜索超时")), 13000);
            }),
          ]);
          return rows;
        } catch (err) {
          return [];
        } finally {
          clearTimeout(timer);
        }
      })
    );
    const seen = new Set();
    const out = [];
    groups.flat().forEach((track) => {
      if (!track) return;
      const key = `${track.name}|${track.singer}`.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(track);
    });
    if (!out.length) throw new Error("扩展音源暂时没有结果，可以试试内置音源");
    return out;
  }

  function readyCount() {
    return scripts.filter((s) => s.status === "ready").length;
  }

  JM.lx = {
    EVENT_NAMES,
    scripts,
    init,
    reloadAll,
    toggle,
    loadScript,
    addCustomScript,
    search,
    searchAll,
    musicUrl,
    searchableSources,
    readyCount,
    normalizeScriptUrl,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    off(fn) { listeners.delete(fn); },
  };
})();
