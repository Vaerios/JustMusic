/* ============================================================
   JustMusic — app shell, views & interactions
   ============================================================ */
(function () {
  const JM = window.JM;
  const store = JM.store;
  const player = JM.player;
  const U = JM.util;
  const esc = U.esc;
  const gradientFor = U.gradientFor;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const view = $("#view");
  const modalRoot = $("#modalRoot");
  const scrim = $("#scrim");
  const sidebar = $("#sidebar");

  const SHELVES = [
    { id: "mandarin", title: "华语流行", queries: ["华语热歌", "华语流行", "华语新歌"] },
    { id: "jay", title: "周杰伦 · 经典重温", queries: ["周杰伦", "周杰伦 经典", "Jay Chou"] },
    { id: "night", title: "深夜低语", queries: ["深夜情歌", "晚安", "深夜电台"] },
    { id: "western", title: "欧美精选", queries: ["Taylor Swift", "Ed Sheeran", "欧美流行"] },
    { id: "canto", title: "粤语金曲", queries: ["粤语经典", "陈奕迅", "张国荣"] },
    { id: "focus", title: "专注时刻", queries: ["轻音乐", "纯音乐", "钢琴曲"] },
  ];

  const HERO_COPY = [
    { h: "让今天，<br>有点好听", d: "从华语金曲到深夜低语，挑一首陪你过完这一天。" },
    { h: "把耳朵，<br>交给音乐", d: "认真挑过的旋律，适合此刻的你。" },
    { h: "今天，听点<br>不一样的", d: "跨过语言和年代，遇见一首刚好对的歌。" },
    { h: "好音乐，<br>不该被错过", d: "从经典到新声，JustMusic 替你挑好。" },
  ];

  const SUGGESTIONS = [
    { q: "晴天", label: "晴天", sub: "周杰伦" },
    { q: "夜曲", label: "夜曲", sub: "周杰伦" },
    { q: "富士山下", label: "富士山下", sub: "陈奕迅" },
    { q: "起风了", label: "起风了", sub: "买辣椒也用券" },
    { q: "Love Story", label: "Love Story", sub: "Taylor Swift" },
    { q: "漠河舞厅", label: "漠河舞厅", sub: "柳爽" },
    { q: "光年之外", label: "光年之外", sub: "邓紫棋" },
    { q: "稻香", label: "稻香", sub: "周杰伦" },
  ];

  const TITLES = {
    home: "现在就听",
    search: "搜索",
    favorites: "收藏",
    recent: "最近播放",
    playlist: "歌单",
    settings: "设置",
  };

  const NATIVE_SOURCES = [
    { value: "kw", label: "酷我音乐" },
    { value: "wy", label: "网易云" },
    { value: "tx", label: "QQ音乐" },
  ];

  const ENGINE_LABEL = {
    kw: "酷我音乐",
    wy: "网易云音乐",
    tx: "QQ音乐",
    kg: "酷狗音乐",
    mg: "咪咕音乐",
    qs: "汽水音乐",
    local: "本地",
    git: "GitHub",
  };

  function engineName(key, name) {
    if (!name || name === key) return ENGINE_LABEL[key] || key;
    return name;
  }

  const ui = {
    route: { name: "home", id: "", query: new URLSearchParams() },
    contexts: {},
    tracks: new Map(),
    shelves: {},
    shelfPromises: {},
    shelfVariant: {},
    heroTracks: [],
    heroCopy: U.dayOfYear() % HERO_COPY.length,
    search: { key: "", q: "", src: "kw", loading: false, results: [], error: "", token: 0, page: 1, loadingMore: false, exhausted: false, moreError: "" },
    lyricsIndex: -1,
    lastPbArt: "",
    lastNpArt: "",
    menuTrack: null,
    pendingTrack: null,
    confirmFn: null,
    sidebarOpen: false,
  };
  let routeEnterTimer = 0;

  /* ================= helpers ================= */
  function artHTML(track, extra) {
    const seed = track ? `${track.name || ""}${track.singer || ""}` : "justmusic";
    const g = gradientFor(seed);
    const cover = track && track.cover ? JM.api.upgrade(track.cover) : "";
    return `<span class="art ${extra || ""}" style="--g1:${g[0]};--g2:${g[1]}">` +
      `<span class="art-ph"><svg class="icon" aria-hidden="true"><use href="#i-note"/></svg></span>` +
      (cover
        ? `<img src="${esc(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onload="this.classList.add('loaded')" onerror="this.style.display='none'">`
        : "") +
      `</span>`;
  }

  function eqHTML() {
    return `<span class="eq" aria-hidden="true"><span></span><span></span><span></span><span></span></span>`;
  }

  function isCurrent(track) {
    return !!(player.current && track && player.current.key === track.key);
  }

  function remember(list) {
    (list || []).forEach((t) => { if (t && t.key) ui.tracks.set(t.key, t); });
  }

  function findTrack(key) {
    if (!key) return null;
    if (ui.tracks.has(key)) return ui.tracks.get(key);
    if (player.current && player.current.key === key) return player.current;
    const q = player.queue.find((t) => t.key === key);
    if (q) return q;
    return store.data.favorites.find((t) => t.key === key) ||
      store.data.recents.find((t) => t.key === key) || null;
  }

  function trackRowHTML(track, index, ctx) {
    const liked = store.isFavorite(track.key);
    const current = isCurrent(track);
    return `<div class="track${current ? " is-current" : ""}" data-key="${esc(track.key)}" data-ctx="${esc(ctx)}" data-index="${index}" data-action="rowPlay" role="button" tabindex="0">` +
      `<div class="track-index"><span>${index + 1}</span><svg class="icon"><use href="#i-play"/></svg></div>` +
      `<div class="track-cover">${artHTML(track)}</div>` +
      `<div class="track-main"><div class="track-name">${esc(track.name)}</div><div class="track-singer">${esc(track.singer)}</div></div>` +
      `<div class="track-album">${esc(track.album || "—")}</div>` +
      `<div class="track-time">${track.duration ? U.fmtTime(track.duration) : "--:--"}</div>` +
      `<div class="track-actions">` +
      `<button class="icon-btn${liked ? " liked" : ""}" data-action="like" data-like-key="${esc(track.key)}" aria-label="收藏"><svg class="icon"><use href="${liked ? "#i-heart-fill" : "#i-heart"}"/></svg></button>` +
      `<button class="icon-btn" data-action="more" data-key="${esc(track.key)}" aria-label="更多"><svg class="icon"><use href="#i-more"/></svg></button>` +
      `</div></div>`;
  }

  function tracklistHTML(tracks, ctx) {
    if (!tracks.length) return "";
    return `<div class="tracklist">` +
      `<div class="tracklist-head"><span>#</span><span></span><span>标题</span><span>专辑</span><span style="text-align:right">时长</span><span></span></div>` +
      tracks.map((t, i) => trackRowHTML(t, i, ctx)).join("") +
      `</div>`;
  }

  function cardHTML(track, ctx, index) {
    const current = isCurrent(track);
    return `<article class="card${current ? " is-playing" : ""}" data-key="${esc(track.key)}" data-ctx="${esc(ctx)}" data-index="${index}" data-action="playCard" role="button" tabindex="0">` +
      `<div class="card-art">${artHTML(track)}${eqHTML()}` +
      `<button class="card-play" data-action="playCard" data-ctx="${esc(ctx)}" data-index="${index}" aria-label="播放 ${esc(track.name)}"><svg class="icon"><use href="#i-play"/></svg></button>` +
      `</div>` +
      `<div class="card-title">${esc(track.name)}</div>` +
      `<div class="card-artist">${esc(track.singer)}</div>` +
      `</article>`;
  }

  function skeletonCards(n) {
    return Array.from({ length: n }).map(() => `<div class="skeleton-card"><div class="skeleton skeleton-art"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div></div>`).join("");
  }

  function skeletonRows(n) {
    return Array.from({ length: n }).map(() => `<div class="skeleton skeleton-row"></div>`).join("");
  }

  function emptyHTML(icon, title, desc, action, label) {
    return `<div class="empty"><div class="empty-icon"><svg class="icon"><use href="#${icon}"/></svg></div>` +
      `<h3>${esc(title)}</h3><p>${esc(desc)}</p>` +
      (action ? `<button class="btn btn-quiet" data-action="${action}">${esc(label)}</button>` : "") +
      `</div>`;
  }

  function toast(message, icon) {
    const host = $("#toasts");
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `<svg class="icon"><use href="#${icon || "i-check"}"/></svg><span>${esc(message)}</span>`;
    host.appendChild(el);
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 280);
    }, 2400);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制");
    } catch (err) {
      toast("复制失败，请手动选择");
    }
  }

  /* ================= theme ================= */
  function resolvedTheme() {
    const t = store.data.settings.theme || "dark";
    if (t === "system") {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    return t === "light" ? "light" : "dark";
  }

  function applyTheme() {
    const t = resolvedTheme();
    document.documentElement.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "dark" ? "#08080a" : "#f4f4f6");
    const icon = $("#themeIcon use");
    if (icon) icon.setAttribute("href", t === "dark" ? "#i-sun" : "#i-moon");
  }

  function cycleTheme() {
    const cur = store.data.settings.theme || "dark";
    const next = cur === "dark" ? "light" : cur === "light" ? "system" : "dark";
    store.setSetting("theme", next);
    applyTheme();
    toast(`外观：${next === "dark" ? "深色" : next === "light" ? "浅色" : "跟随系统"}`);
  }

  /* ================= routing ================= */
  function parseRoute() {
    const hash = location.hash.replace(/^#\/?/, "");
    const [pathPart, queryPart] = hash.split("?");
    const parts = pathPart.split("/").filter(Boolean);
    return {
      name: parts[0] || "home",
      id: parts[1] || "",
      query: new URLSearchParams(queryPart || ""),
    };
  }

  function navName(route) {
    if (route.name === "playlist") return "";
    return TITLES[route.name] ? route.name : "home";
  }

  function render() {
    const route = parseRoute();
    const changed = ui.route.key !== `${route.name}/${route.id}/${route.query.toString()}`;
    ui.route = route;
    ui.route.key = `${route.name}/${route.id}/${route.query.toString()}`;

    $$(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.nav === navName(route)));
    $("#topTitle").textContent = TITLES[route.name] || "JustMusic";
    syncSearchInput();

    ui.contexts = {};
    ui.tracks = new Map();
    ui.lyricsIndex = -1;

    renderView();

    if (changed) {
      view.scrollTop = 0;
      // Only a route change gets the staggered entrance. In-place updates
      // (search loading, like toggles, queue changes) should never replay it.
      view.classList.remove("route-enter");
      void view.offsetWidth;
      view.classList.add("route-enter");
      clearTimeout(routeEnterTimer);
      routeEnterTimer = setTimeout(() => view.classList.remove("route-enter"), 800);
    }
  }

  function renderView() {
    const route = ui.route;
    switch (route.name) {
      case "home": renderHome(); break;
      case "search": renderSearchPage(); break;
      case "favorites": renderFavorites(); break;
      case "recent": renderRecent(); break;
      case "playlist": renderPlaylist(route.id); break;
      case "settings": renderSettings(); break;
      default: renderHome();
    }
    renderSidebarPlaylists();
    refreshPlayingStates();
    refreshLikes();
  }

  function syncSearchInput() {
    const input = $("#searchInput");
    if (!input) return;
    if (document.activeElement === input) return;
    input.value = ui.route.name === "search" ? (ui.route.query.get("q") || "") : "";
  }

  /* ================= sidebar ================= */
  function renderSidebarPlaylists() {
    const host = $("#sidePlaylists");
    const list = store.data.playlists;
    if (!list.length) {
      host.innerHTML = `<p class="side-empty">还没有歌单。点上面的 + 建一张。</p>`;
      return;
    }
    host.innerHTML = list.map((p) => {
      const active = ui.route.name === "playlist" && ui.route.id === p.id;
      return `<a class="playlist-link${active ? " active" : ""}" href="#/playlist/${p.id}">` +
        `<svg class="icon"><use href="#i-note"/></svg><span>${esc(p.name)}</span></a>`;
    }).join("");
  }

  function renderSourceCard() {
    const scripts = JM.lx.scripts;
    const ready = scripts.filter((s) => s.status === "ready");
    const loading = scripts.some((s) => s.status === "loading");
    const dot = $("#sourceDot");
    const title = $("#sourceTitle");
    const desc = $("#sourceDesc");
    dot.classList.toggle("busy", loading);
    if (ready.length) {
      title.textContent = "音源已就绪";
      desc.textContent = `酷我 / 网易 / QQ · 脚本 ${ready.length} 个`;
    } else if (loading) {
      title.textContent = "正在加载音源";
      desc.textContent = "酷我 / 网易 / QQ · 脚本连接中";
    } else {
      title.textContent = "内置音源可用";
      desc.textContent = "酷我 / 网易 / QQ · 公开接口";
    }
  }

  /* ================= home ================= */
  function heroHTML() {
    const copy = HERO_COPY[ui.heroCopy % HERO_COPY.length];
    return `<section class="hero">` +
      `<div class="hero-copy">` +
      `<span class="hero-kicker"><svg class="icon"><use href="#i-sparkle"/></svg>每日精选</span>` +
      `<h1>${copy.h}</h1>` +
      `<p class="hero-desc">${esc(copy.d)}</p>` +
      `<div class="hero-actions">` +
      `<button class="btn btn-primary" data-action="playFeatured"><svg class="icon"><use href="#i-play"/></svg>播放精选</button>` +
      `<button class="btn btn-ghost" data-action="shuffleFeatured"><svg class="icon"><use href="#i-shuffle"/></svg>随机播放</button>` +
      `<button class="btn btn-ghost" data-action="heroShuffle"><svg class="icon"><use href="#i-refresh"/></svg>换一批</button>` +
      `</div></div>` +
      `<div class="hero-art" id="heroArt">${[0, 1, 2].map((i) => artHTML({ name: "justmusic" + i })).join("")}</div>` +
      `</section>`;
  }

  function shelfHTML(def) {
    return `<section class="shelf" data-shelf="${def.id}">` +
      `<div class="shelf-head"><h2>${esc(def.title)}</h2>` +
      `<button class="shelf-more" data-action="shelfMore" data-shelf="${def.id}">查看全部<svg class="icon"><use href="#i-chevron-right"/></svg></button></div>` +
      `<div class="shelf-row" id="shelf-${def.id}">${skeletonCards(8)}</div>` +
      `</section>`;
  }

  function renderHome() {
    ui.shelves = {};
    ui.shelfPromises = {};
    const recents = store.data.recents.slice(0, 10);
    const recentsHTML = recents.length
      ? `<section class="shelf" data-recents="1"><div class="shelf-head"><h2>继续聆听</h2>` +
        `<a class="shelf-more" href="#/recent">查看全部<svg class="icon"><use href="#i-chevron-right"/></svg></a></div>` +
        `<div class="shelf-row" id="recentShelf">${recents.map((t, i) => cardHTML(t, "recent-shelf", i)).join("")}</div></section>`
      : "";

    view.innerHTML = heroHTML() + recentsHTML + SHELVES.map(shelfHTML).join("");
    if (recents.length) {
      ui.contexts["recent-shelf"] = recents;
      remember(recents);
    }
    observeShelves();
    hydrateHeroFromCache();

    // First shelf drives the hero artwork.
    ensureShelf("mandarin").then((tracks) => {
      if (tracks && tracks.length) {
        ui.heroTracks = tracks.slice(0, 3);
        updateHeroArt();
      }
    }).catch(() => {});
  }

  function updateHeroArt() {
    const host = $("#heroArt");
    if (!host || !ui.heroTracks.length) return;
    host.innerHTML = ui.heroTracks.map((t) => artHTML(t)).join("");
  }

  function hydrateHeroFromCache() {
    const def = SHELVES[0];
    const q = def.queries[ui.shelfVariant[def.id] || 0];
    const cached = shelfCacheGet(q);
    if (cached && cached.length) {
      ui.heroTracks = cached.slice(0, 3);
      updateHeroArt();
    }
  }

  function observeShelves() {
    const sections = $$(".shelf[data-shelf]");
    if (!("IntersectionObserver" in window)) {
      sections.forEach((s) => ensureShelf(s.dataset.shelf));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = entry.target.dataset.shelf;
        io.unobserve(entry.target);
        ensureShelf(id);
      });
    }, { root: view, rootMargin: "500px 0px" });
    sections.forEach((s) => io.observe(s));
  }

  function shelfCacheGet(query) {
    try {
      const raw = localStorage.getItem("jm.shelf." + query);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && Date.now() - parsed.ts < 6 * 3600 * 1000 && Array.isArray(parsed.tracks)) return parsed.tracks;
    } catch (err) { /* ignore */ }
    return null;
  }

  function shelfCacheSet(query, tracks) {
    try {
      localStorage.setItem("jm.shelf." + query, JSON.stringify({ ts: Date.now(), tracks: tracks.slice(0, 10) }));
    } catch (err) { /* ignore */ }
  }

  function ensureShelf(id) {
    if (ui.shelfPromises[id]) return ui.shelfPromises[id];
    const def = SHELVES.find((s) => s.id === id);
    if (!def) return Promise.resolve([]);
    const variant = ui.shelfVariant[id] || 0;
    const q = def.queries[variant % def.queries.length];

    const cached = shelfCacheGet(q);
    if (cached && cached.length) {
      applyShelf(id, cached);
      ui.shelfPromises[id] = Promise.resolve(cached);
      return ui.shelfPromises[id];
    }

    const row = $("#shelf-" + id);
    if (row) row.innerHTML = skeletonCards(8);

    const promise = JM.api.kuwoSearch(q, 10)
      .then((tracks) => {
        shelfCacheSet(q, tracks);
        applyShelf(id, tracks);
        return tracks;
      })
      .catch((err) => {
        const rowEl = $("#shelf-" + id);
        if (rowEl) {
          rowEl.innerHTML = `<div class="shelf-error"><span>加载失败：${esc(err.message || "网络异常")}</span><button class="btn btn-quiet small" data-action="retryShelf" data-shelf="${id}">重试</button></div>`;
        }
        return [];
      })
      .finally(() => { delete ui.shelfPromises[id]; });

    ui.shelfPromises[id] = promise;
    return promise;
  }

  function applyShelf(id, tracks) {
    const row = $("#shelf-" + id);
    if (!row) return;
    row.innerHTML = tracks.map((t, i) => cardHTML(t, "shelf:" + id, i)).join("");
    ui.contexts["shelf:" + id] = tracks;
    remember(tracks);
    refreshPlayingStates();
    refreshLikes();
    if (id === "mandarin" && !ui.heroTracks.length) {
      ui.heroTracks = tracks.slice(0, 3);
      updateHeroArt();
    }
  }

  async function playShelf(id, shuffle) {
    const tracks = await ensureShelf(id).catch(() => []);
    if (!tracks.length) {
      toast("这个歌单暂时没有加载出来", "i-x");
      return;
    }
    const list = tracks.slice();
    if (shuffle) list.sort(() => Math.random() - 0.5);
    player.setQueue(list, 0, true);
  }

  /* ================= search ================= */
  function allSearchSources() {
    // Script engines are merged into one tab: their upstreams come and go,
    // and showing every engine separately turns the tab row into a list of
    // options that mostly fail.
    const extra = JM.lx.searchableSources().length
      ? [{ value: "lx:all", label: "扩展音源", lx: true }]
      : [];
    return NATIVE_SOURCES.concat(extra);
  }

  function sourceLabel(value) {
    const found = allSearchSources().find((s) => s.value === value);
    return found ? found.label : value;
  }

  function renderSearchPage() {
    const route = ui.route;
    const q = route.query.get("q") || "";
    let src = route.query.get("src") || "kw";
    const sources = allSearchSources();
    if (!sources.some((s) => s.value === src)) src = "kw";

    const tabs = sources.map((s) => `<button class="chip${s.value === src ? " active" : ""}" data-action="searchTab" data-src="${esc(s.value)}">${esc(s.label)}</button>`).join("");

    let body = "";
    if (!q) {
      const history = store.data.searchHistory;
      body = `<div class="search-suggests">` +
        (history.length
          ? `<div class="page-head-row"><h3>最近搜索</h3><button class="history-clear" data-action="clearSearch">清除</button></div>` +
            `<div class="history-row">${history.map((h) => `<button class="history-chip" data-action="useQuery" data-q="${esc(h)}"><svg class="icon"><use href="#i-clock"/></svg>${esc(h)}</button>`).join("")}</div>`
          : "") +
        `<div class="suggest-grid">${SUGGESTIONS.map((s, i) => {
          const g = gradientFor(s.q + i);
          return `<button class="suggest-tile" data-action="useQuery" data-q="${esc(s.q)}" style="--s1:${g[0]};--s2:${g[1]}">` +
            `<span class="suggest-label">${esc(s.label)}</span><span class="suggest-sub">${esc(s.sub)}</span>` +
            `<svg class="icon"><use href="#i-play"/></svg></button>`;
        }).join("")}</div>` +
        `</div>`;
    } else {
      const state = ui.search;
      const loading = state.loading && state.key === `${src}|${q}`;
      const items = state.key === `${src}|${q}` ? state.results : [];
      const error = state.key === `${src}|${q}` ? state.error : "";
      const note = src === "lx:all"
        ? "扩展音源会合并所有可用脚本的搜索结果；单个脚本失效时会被跳过。"
        : src === "kw"
          ? "酷我音源 · 播放地址自动匹配 320K / 无损；公开接口单次最多返回 10 首。"
          : src === "wy"
            ? "网易云原生音源 · 免费曲目直接播放，VIP 或失效时自动匹配酷我。"
            : "QQ 音乐原生音源 · 免费曲目优先 320K，VIP 或失效时自动匹配酷我。";

      const more = items.length && !loading && !error && src !== "lx:all" && src !== "kw" && !state.exhausted
        ? `<div class="search-more">` +
          (state.moreError ? `<span class="search-more-note">${esc(state.moreError)}</span>` : "") +
          `<button class="btn btn-quiet" data-action="loadMore"${state.loadingMore ? " disabled" : ""}>` +
          (state.loadingMore ? "正在加载…" : state.moreError ? "重试" : "加载更多") +
          `</button></div>`
        : "";

      body = `<div class="results-head"><h2>“${esc(q)}”</h2>` +
        (loading ? `<span class="meta">正在搜索…</span>` : `<span class="meta">${items.length} 首 · ${esc(sourceLabel(src))}</span>`) +
        `</div>` +
        `<div class="source-tabs">${tabs}</div>` +
        `<p class="tab-note">${esc(note)}</p>` +
        (loading
          ? `<div class="tracklist">${skeletonRows(8)}</div>`
          : error
            ? `<div class="empty"><div class="empty-icon"><svg class="icon"><use href="#i-search"/></svg></div><h3>没有搜到</h3><p>${esc(error)}</p><button class="btn btn-quiet" data-action="retrySearch">重试</button></div>`
            : items.length
              ? tracklistHTML(items, "search") + more
              : emptyHTML("i-search", "输入关键词开始搜索", "试试歌名、歌手，或者一句歌词。", "", ""));
    }

    view.innerHTML = `<div class="search-page">` +
      `<div class="page-head"><h1 class="page-title">搜索</h1></div>` +
      `<div class="search-big"><svg class="icon"><use href="#i-search"/></svg>` +
      `<input id="pageSearch" type="search" placeholder="搜索歌曲、歌手或专辑" value="${esc(q)}" autocomplete="off" spellcheck="false">` +
      `<kbd>Enter</kbd></div>` + body + `</div>`;

    if (itemsOfSearch(q, src).length) {
      ui.contexts["search"] = itemsOfSearch(q, src);
      remember(itemsOfSearch(q, src));
    }

    if (q && (ui.search.key !== `${src}|${q}` || (!ui.search.loading && !ui.search.results.length && !ui.search.error))) {
      runSearch(q, src);
    }
  }

  function itemsOfSearch(q, src) {
    return ui.search.key === `${src}|${q}` ? ui.search.results : [];
  }

  async function runSearch(q, src) {
    const key = `${src}|${q}`;
    if (ui.search.key === key && (ui.search.loading || ui.search.results.length || ui.search.error)) return;
    const token = ++ui.search.token;
    ui.search = { key, q, src, loading: true, results: [], error: "", token, page: 1, loadingMore: false, exhausted: false, moreError: "" };
    if (ui.route.name === "search") renderSearchPage();
    try {
      const results = await JM.api.search(src, q, 1);
      if (token !== ui.search.token) return;
      ui.search = { key, q, src, loading: false, results, error: "", token, page: 1, loadingMore: false, exhausted: false, moreError: "" };
    } catch (err) {
      if (token !== ui.search.token) return;
      ui.search = { key, q, src, loading: false, results: [], error: (err && err.message) || "搜索失败，请稍后再试", token, page: 1, loadingMore: false, exhausted: false, moreError: "" };
    }
    if (ui.route.name === "search" && ui.route.query.get("q") === q) renderSearchPage();
  }

  async function loadMoreSearch() {
    const s = ui.search;
    if (!s.results.length || s.loading || s.loadingMore || s.exhausted) return;
    if (s.src === "lx:all" || s.src === "kw") return;
    const token = s.token;
    s.loadingMore = true;
    s.moreError = "";
    const keepTop = view.scrollTop;
    renderSearchPage();
    view.scrollTop = keepTop;
    try {
      const next = await JM.api.search(s.src, s.q, s.page + 1);
      if (token !== ui.search.token) return;
      const state = ui.search;
      const seen = new Set(state.results.map((t) => t.key));
      const added = next.filter((t) => !seen.has(t.key));
      ui.search = {
        ...state,
        loadingMore: false,
        results: state.results.concat(added),
        page: state.page + 1,
        exhausted: next.length === 0,
      };
    } catch (err) {
      if (token !== ui.search.token) return;
      ui.search = { ...ui.search, loadingMore: false, moreError: (err && err.message) || "加载更多失败" };
    }
    const top = view.scrollTop;
    renderSearchPage();
    view.scrollTop = top;
  }

  function submitSearch(term) {
    const q = String(term || "").trim();
    if (!q) return;
    store.addSearchHistory(q);
    const src = (ui.route.name === "search" && ui.route.query.get("src")) || "kw";
    const hash = `#/search?q=${encodeURIComponent(q)}&src=${encodeURIComponent(src)}`;
    if (location.hash === hash) {
      ui.search.key = "";
      runSearch(q, src);
    } else {
      location.hash = hash;
    }
  }

  /* ================= favorites / recent / playlist ================= */
  function renderFavorites() {
    const list = store.data.favorites;
    remember(list);
    ui.contexts["favorites"] = list;
    view.innerHTML = `<div class="page-head"><div class="page-head-row"><div><h1 class="page-title">收藏</h1>` +
      `<p class="page-sub">${list.length ? `共 ${list.length} 首，都是你按过 ♡ 的歌。` : "你喜欢的歌，都会留在这里。"}</p></div>` +
      (list.length ? `<div class="list-actions"><button class="btn btn-primary" data-action="playAll" data-ctx="favorites"><svg class="icon"><use href="#i-play"/></svg>播放全部</button>` +
        `<button class="btn btn-quiet" data-action="shuffleList" data-ctx="favorites"><svg class="icon"><use href="#i-shuffle"/></svg>随机</button></div>` : "") +
      `</div></div>` +
      (list.length ? tracklistHTML(list, "favorites") : emptyHTML("i-heart", "还没有收藏歌曲", "播放任意一首歌，点一下 ♡，它就会出现在这里。", "goSearch", "去找点好听的"));
  }

  function renderRecent() {
    const list = store.data.recents;
    remember(list);
    ui.contexts["recent"] = list;
    let rows = "";
    let lastLabel = "";
    list.forEach((t, i) => {
      const label = U.relativeDate(t.playedAt || Date.now());
      if (label !== lastLabel) {
        rows += `<div class="recents-label">${esc(label)}</div>`;
        lastLabel = label;
      }
      rows += trackRowHTML(t, i, "recent");
    });
    view.innerHTML = `<div class="page-head"><div class="page-head-row"><div><h1 class="page-title">最近播放</h1>` +
      `<p class="page-sub">${list.length ? `最近听过 ${list.length} 首。` : "听过的歌会按时间留在这里。"}</p></div>` +
      (list.length ? `<div class="list-actions"><button class="btn btn-primary" data-action="playAll" data-ctx="recent"><svg class="icon"><use href="#i-play"/></svg>继续播放</button>` +
        `<button class="btn btn-quiet" data-action="clearRecents">清空</button></div>` : "") +
      `</div></div>` +
      (list.length ? `<div class="tracklist">${rows}</div>` : emptyHTML("i-clock", "还没有播放记录", "随便点一首，让这里热闹起来。", "goSearch", "去发现音乐"));
  }

  function collageHTML(tracks) {
    const cells = [];
    for (let i = 0; i < 4; i++) cells.push(artHTML(tracks[i] || { name: "playlist" + i }));
    return `<span class="art" style="--g1:#232329;--g2:#101014"><span class="collage">${cells.join("")}</span></span>`;
  }

  function renderPlaylist(id) {
    const pl = store.findPlaylist(id);
    if (!pl) {
      view.innerHTML = `<div class="page-head"><h1 class="page-title">歌单不存在</h1><p class="page-sub">它可能已经被删除了。</p></div>` + emptyHTML("i-note", "找不到这张歌单", "回到首页，继续听点别的。", "goHome", "回到首页");
      return;
    }
    const tracks = pl.tracks;
    remember(tracks);
    ui.contexts["pl:" + id] = tracks;
    view.innerHTML = `<div class="playlist-hero">` +
      collageHTML(tracks) +
      `<div class="playlist-copy"><span class="kicker">歌单</span><h1>${esc(pl.name)}</h1>` +
      `<p class="meta">${tracks.length} 首歌曲 · 创建于 ${new Date(pl.createdAt).toLocaleDateString("zh-CN")}</p>` +
      `<div class="actions">` +
      `<button class="btn btn-primary" data-action="playAll" data-ctx="pl:${esc(id)}"><svg class="icon"><use href="#i-play"/></svg>播放</button>` +
      `<button class="btn btn-quiet" data-action="shuffleList" data-ctx="pl:${esc(id)}"><svg class="icon"><use href="#i-shuffle"/></svg>随机</button>` +
      `<button class="btn btn-quiet" data-action="renamePlaylist" data-id="${esc(id)}">重命名</button>` +
      `<button class="btn btn-quiet" data-action="deletePlaylist" data-id="${esc(id)}">删除</button>` +
      `</div></div></div>` +
      (tracks.length
        ? tracklistHTML(tracks, "pl:" + id)
        : emptyHTML("i-plus", "歌单还是空的", "在任意歌曲的“更多”里，选择添加到歌单。", "goSearch", "去找歌"));
  }

  /* ================= settings ================= */
  function scriptTag(def) {
    if (def.status === "loading") return `<span class="tag">加载中…</span>`;
    if (def.status === "error") return `<span class="tag err">加载失败</span>`;
    if (def.status === "ready") return `<span class="tag ok">已加载</span>`;
    return `<span class="tag">未启用</span>`;
  }

  function renderSettings() {
    const s = store.data.settings;
    const qualityButtons = [["128k", "标准"], ["320k", "高品质"], ["flac", "无损"]]
      .map(([v, label]) => `<button class="${s.quality === v ? "active" : ""}" data-action="setQuality" data-value="${v}">${label}</button>`).join("");
    const themeButtons = [["dark", "深色"], ["light", "浅色"], ["system", "跟随系统"]]
      .map(([v, label]) => `<button class="${(s.theme || "dark") === v ? "active" : ""}" data-action="setTheme" data-value="${v}">${label}</button>`).join("");

    const scriptsHTML = JM.lx.scripts.map((def) => {
      const enabled = def.status === "ready" || def.status === "loading";
      const tags = Object.keys(def.sources || {}).slice(0, 5).map((k) => {
        const src = def.sources[k];
        const hasSearch = (src.actions || []).includes("search");
        return `<span class="tag ${hasSearch ? "ok" : ""}">${esc(engineName(k, src.name))}</span>`;
      }).join("");
      const searchable = Object.keys(def.sources || {}).filter((k) => {
        const src = def.sources[k];
        return (src.actions || []).includes("search");
      }).map((k) => engineName(k, def.sources[k].name));
      const capability = def.status === "ready"
        ? (searchable.length ? `可搜索：${searchable.join("、")}` : "仅用于解析播放地址，不提供搜索")
        : "";
      return `<div class="script-row">` +
        `<div class="script-avatar"><svg class="icon"><use href="#i-note"/></svg></div>` +
        `<div class="script-info"><strong>${esc(def.name)}${def.custom ? "（自定义）" : ""}</strong>` +
        `<span>${esc(def.desc || "")}${def.author ? " · " + esc(def.author) : ""}</span>` +
        `<div class="script-tags">${scriptTag(def)}${tags}</div>` +
        (capability ? `<span class="script-note">${esc(capability)}</span>` : "") +
        (def.status === "error" ? `<span class="script-error">${esc(def.error)}</span>` : "") +
        `</div>` +
        (def.custom ? `<button class="icon-btn" data-action="removeScript" data-url="${esc(def.file)}" title="移除"><svg class="icon"><use href="#i-trash"/></svg></button>` : "") +
        `<button class="switch${enabled ? " on" : ""}" data-action="toggleScript" data-id="${esc(def.id)}" aria-label="启用 ${esc(def.name)}" aria-pressed="${enabled}"></button>` +
        `</div>`;
    }).join("");

    view.innerHTML = `<div class="settings">` +
      `<div class="page-head"><h1 class="page-title">设置</h1><p class="page-sub">音质、外观和音源，都在这里。</p></div>` +

      `<section class="settings-section"><h2>播放</h2><p>音质越高，加载越慢。默认优先 320K。</p>` +
      `<div class="setting-card"><div class="setting-row"><div class="setting-copy"><strong>音质</strong><span>无损需要音源支持，部分歌曲会自动降级。</span></div>` +
      `<div class="setting-control"><div class="segmented">${qualityButtons}</div></div></div>` +
      `<div class="setting-row"><div class="setting-copy"><strong>外观</strong><span>跟随系统时，会随 macOS / iOS 的深浅色切换。</span></div>` +
      `<div class="setting-control"><div class="segmented">${themeButtons}</div></div></div></div></section>` +

      `<section class="settings-section"><h2>音源脚本</h2><p>兼容 lx-music / KMusic 的自定义音源脚本。脚本在浏览器本地运行，只负责解析播放地址。</p>` +
      `<div class="setting-card">${scriptsHTML}` +
      `<div class="inline-input"><input id="scriptUrl" placeholder="粘贴音源脚本链接（GitHub / jsDelivr / 任意 HTTPS .js）">` +
      `<button class="btn btn-quiet small" data-action="addScript">添加</button></div></div>` +
      `<div class="chip-row"><button class="btn btn-quiet small" data-action="reloadScripts"><svg class="icon"><use href="#i-refresh"/></svg>重新加载全部脚本</button>` +
      `<a class="btn btn-quiet small" href="https://github.com/Mac-XK/KMusic" target="_blank" rel="noreferrer"><svg class="icon"><use href="#i-external"/></svg>脚本来源</a></div></section>` +

      `<section class="settings-section"><h2>数据</h2><p>收藏、歌单和播放记录都保存在这台设备的浏览器里。</p>` +
      `<div class="setting-card">` +
      `<div class="setting-row"><div class="setting-copy"><strong>最近播放</strong><span>${store.data.recents.length} 条记录</span></div><button class="btn btn-quiet small" data-action="clearRecents">清空</button></div>` +
      `<div class="setting-row"><div class="setting-copy"><strong>搜索历史</strong><span>${store.data.searchHistory.length} 条记录</span></div><button class="btn btn-quiet small" data-action="clearSearch">清空</button></div>` +
      `<div class="setting-row"><div class="setting-copy"><strong>重置所有数据</strong><span>收藏、歌单、设置都会被清空，且无法恢复。</span></div><button class="btn btn-quiet small" data-action="resetData">重置</button></div>` +
      `</div></section>` +

      `<section class="settings-section"><h2>关于</h2><div class="setting-card"><div class="about-card">` +
      `<strong>JustMusic</strong> 是一个纯静态的在线音乐播放器，界面参考 Apple Music 的克制与留白。` +
      `音频来自公开接口与第三方音源脚本，仅供学习交流，音乐版权归原作者所有。请勿用于商业用途。<br><br>` +
      `音源脚本来自 <a href="https://github.com/Mac-XK/KMusic" target="_blank" rel="noreferrer">Mac-XK/KMusic</a>，` +
      `兼容 <a href="https://github.com/lyswhut/lx-music-desktop" target="_blank" rel="noreferrer">lx-music</a> 格式。` +
      `</div></div></section></div>`;
  }

  /* ================= player UI ================= */
  function syncPlayerBar() {
    const track = player.current;
    const likeBtn = $("#pbLike");
    likeBtn.classList.toggle("liked", !!(track && store.isFavorite(track.key)));
    likeBtn.querySelector("use").setAttribute("href", track && store.isFavorite(track.key) ? "#i-heart-fill" : "#i-heart");

    $("#pbTitle").textContent = track ? track.name : "还没有播放歌曲";
    $("#pbArtist").textContent = track ? track.singer : "挑一首喜欢的开始";

    const artKey = track ? track.key : "";
    if (artKey !== ui.lastPbArt) {
      ui.lastPbArt = artKey;
      $("#pbArt").innerHTML = track ? artHTML(track) : artHTML({ name: "empty" });
    }

    const buffering = player.state.resolving || (player.state.loading && !player.isPlaying);
    const icon = buffering ? "#i-refresh" : player.isPlaying ? "#i-pause" : "#i-play";
    $("#pbPlay").querySelector("use").setAttribute("href", icon);
    $("#pbPlay").classList.toggle("spin", buffering);

    $("#pbShuffle").classList.toggle("active", player.state.shuffle);
    const rep = player.state.repeat;
    $("#pbRepeat").classList.toggle("active", rep !== "off");
    $("#pbRepeat").querySelector("use").setAttribute("href", rep === "one" ? "#i-repeat-one" : "#i-repeat");

    const vol = player.volume;
    $("#volRange").value = vol;
    $("#volRange2").value = vol;
    $("#volRange").style.setProperty("--v", vol * 100 + "%");
    $("#volRange2").style.setProperty("--v", vol * 100 + "%");
    $("#volBtn").querySelector("use").setAttribute("href", player.state.muted || vol === 0 ? "#i-volume-x" : "#i-volume");

    document.title = track ? `${track.name} · ${track.singer} — JustMusic` : "JustMusic · 在线音乐";
  }

  function syncNowPlaying(force) {
    const track = player.current;
    const key = track ? track.key : "";
    const bg = $("#npBg");
    const glow = $("#npGlow");
    const cover = track && track.cover ? JM.api.upgrade(track.cover) : "";

    if (force || key !== ui.lastNpArt) {
      ui.lastNpArt = key;
      $("#npArt").innerHTML = track ? artHTML(track) : artHTML({ name: "empty" });
      $("#npTitle").textContent = track ? track.name : "还没有播放歌曲";
      $("#npArtist").textContent = track ? track.singer : "挑一首喜欢的开始";
      $("#npAlbum").textContent = track && track.album ? track.album : "";
      $("#npSource").textContent = track ? track.sourceName || "JustMusic" : "JustMusic";
      $("#npQuality").textContent = track ? `${JM.api.QUALITY_LABEL[player.quality] || "高品质"} · ${track.source === "kw" ? "KW" : (track.engineSource || track.source).toUpperCase()}` : "";
      if (cover) {
        bg.src = cover;
        bg.style.opacity = "";
        glow.style.backgroundImage = `url("${cover}")`;
      } else {
        bg.removeAttribute("src");
        bg.style.opacity = "0";
        glow.style.backgroundImage = "none";
      }
    }

    const liked = !!(track && store.isFavorite(track.key));
    const npLike = $("#npLike");
    npLike.classList.toggle("liked", liked);
    npLike.querySelector("use").setAttribute("href", liked ? "#i-heart-fill" : "#i-heart");

    const buffering = player.state.resolving || (player.state.loading && !player.isPlaying);
    const icon = buffering ? "#i-refresh" : player.isPlaying ? "#i-pause" : "#i-play";
    $("#npPlay").querySelector("use").setAttribute("href", icon);
    $("#npPlay").classList.toggle("spin", buffering);
    $("#npShuffle").classList.toggle("active", player.state.shuffle);
    $("#npRepeat").classList.toggle("active", player.state.repeat !== "off");
    $("#npRepeat").querySelector("use").setAttribute("href", player.state.repeat === "one" ? "#i-repeat-one" : "#i-repeat");
  }

  function syncProgress() {
    const audio = player.audio;
    const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (player.current && player.current.duration) || 0;
    const cur = audio.currentTime || 0;
    const pct = dur ? Math.min(100, (cur / dur) * 100) : 0;

    $("#pbCur").textContent = U.fmtTime(cur);
    $("#pbDur").textContent = U.fmtTime(dur);
    $("#npCur").textContent = U.fmtTime(cur);
    $("#npDur").textContent = U.fmtTime(dur);

    $("#pbFill").style.width = pct + "%";
    $("#npFill").style.width = pct + "%";
    $("#pbProgress").querySelector(".progress-knob").style.left = pct + "%";
    $("#npProgress").querySelector(".progress-knob").style.left = pct + "%";
  }

  function renderLyrics() {
    const host = $("#lyricsInner");
    if (!host) return;
    if (player.state.lyricsLoading) {
      host.innerHTML = `<div class="lyric-loading"><span></span><span></span><span></span></div>`;
      return;
    }
    const lines = player.lyrics;
    if (!lines.length) {
      host.innerHTML = `<p class="lyric-empty">${player.current ? "这首歌暂时没有歌词，去听听旋律吧。" : "播放歌曲后，歌词会在这里滚动。"}</p>`;
      return;
    }
    host.innerHTML = lines.map((line) => `<p class="lyric-line" data-action="seekLyric" data-time="${line.t}">${esc(line.text)}</p>`).join("");
    ui.lyricsIndex = -1;
    syncLyricActive(player.audio.currentTime || 0);
  }

  function syncLyricActive(t) {
    const lines = player.lyrics;
    if (!lines.length) return;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].t <= t + 0.2) idx = i;
      else break;
    }
    if (idx === ui.lyricsIndex) return;
    ui.lyricsIndex = idx;
    const host = $("#lyricsInner");
    if (!host) return;
    const nodes = $$(".lyric-line", host);
    nodes.forEach((node, i) => node.classList.toggle("active", i === idx));
    const active = nodes[idx];
    if (active && $("#nowPlaying").classList.contains("open")) {
      const box = $("#lyrics");
      const top = active.offsetTop - box.clientHeight / 2 + active.offsetHeight / 2;
      box.scrollTo({ top, behavior: "smooth" });
    }
  }

  function renderQueue() {
    const host = $("#queueList");
    const queue = player.queue;
    if (!queue.length) {
      host.innerHTML = `<p class="queue-empty">队列是空的。播放一首歌，或者从搜索结果里挑几首。</p>`;
      return;
    }
    host.innerHTML = queue.map((t, i) => `<div class="queue-item${i === player.index ? " current" : ""}" data-action="playQueue" data-index="${i}">` +
      `<span class="q-index">${i === player.index && player.isPlaying ? "♪" : i + 1}</span>` +
      `<span class="q-cover">${artHTML(t)}</span>` +
      `<span class="q-main"><span class="q-title">${esc(t.name)}</span><span class="q-artist">${esc(t.singer)}</span></span>` +
      `<button class="icon-btn" data-action="removeQueue" data-index="${i}" aria-label="移出队列"><svg class="icon"><use href="#i-x"/></svg></button>` +
      `</div>`).join("");
  }

  function openNowPlaying() {
    if (!player.current) {
      toast("先挑一首歌吧", "i-note");
      return;
    }
    $("#nowPlaying").classList.add("open");
    $("#nowPlaying").setAttribute("aria-hidden", "false");
    syncNowPlaying(true);
    renderLyrics();
    ui.lyricsIndex = -1;
    setTimeout(() => syncLyricActive(player.audio.currentTime || 0), 60);
  }

  function closeNowPlaying() {
    $("#nowPlaying").classList.remove("open");
    $("#nowPlaying").setAttribute("aria-hidden", "true");
  }

  function toggleQueue() {
    const open = !$("#queuePanel").classList.contains("open");
    $("#queuePanel").classList.toggle("open", open);
    $("#queuePanel").setAttribute("aria-hidden", open ? "false" : "true");
    if (open) renderQueue();
  }

  function closeQueue() {
    $("#queuePanel").classList.remove("open");
    $("#queuePanel").setAttribute("aria-hidden", "true");
  }

  function openSidebar() {
    sidebar.classList.add("open");
    scrim.classList.add("show");
    ui.sidebarOpen = true;
  }

  function closePanels() {
    sidebar.classList.remove("open");
    scrim.classList.remove("show");
    ui.sidebarOpen = false;
  }

  /* ================= refresh bits ================= */
  function refreshPlayingStates() {
    const key = player.current ? player.current.key : "";
    $$(".card[data-key]").forEach((c) => c.classList.toggle("is-playing", c.dataset.key === key));
    $$(".track[data-key]").forEach((t) => t.classList.toggle("is-current", t.dataset.key === key));
  }

  function refreshLikes() {
    $$("[data-like-key]").forEach((btn) => {
      const liked = store.isFavorite(btn.dataset.likeKey);
      btn.classList.toggle("liked", liked);
      const use = btn.querySelector("use");
      if (use) use.setAttribute("href", liked ? "#i-heart-fill" : "#i-heart");
    });
    const likeBtn = $("#pbLike");
    const liked = !!(player.current && store.isFavorite(player.current.key));
    likeBtn.classList.toggle("liked", liked);
    likeBtn.querySelector("use").setAttribute("href", liked ? "#i-heart-fill" : "#i-heart");
    const npLike = $("#npLike");
    npLike.classList.toggle("liked", liked);
    npLike.querySelector("use").setAttribute("href", liked ? "#i-heart-fill" : "#i-heart");
  }

  /* ================= modal ================= */
  function openModal(html) {
    modalRoot.innerHTML = `<div class="modal">${html}</div>`;
    modalRoot.classList.add("open");
    const input = modalRoot.querySelector("input");
    if (input) setTimeout(() => { input.focus(); input.select(); }, 60);
  }

  function closeModal() {
    modalRoot.classList.remove("open");
    setTimeout(() => {
      if (!modalRoot.classList.contains("open")) modalRoot.innerHTML = "";
    }, 260);
  }

  function confirmDialog(title, desc, label, fn, danger) {
    ui.confirmFn = fn;
    openModal(`<h3>${esc(title)}</h3><p>${esc(desc)}</p><div class="modal-actions">` +
      `<button class="btn btn-quiet" data-action="closeModal">取消</button>` +
      `<button class="btn ${danger ? "btn-accent" : "btn-primary"}" data-action="confirmYes">${esc(label)}</button></div>`);
  }

  function openCreatePlaylist(pending) {
    ui.pendingTrack = pending || null;
    openModal(`<h3>新建歌单</h3><p>给这张歌单起个名字。</p>` +
      `<input class="modal-input" id="plName" maxlength="40" placeholder="例如：深夜循环">` +
      `<div class="modal-actions"><button class="btn btn-quiet" data-action="closeModal">取消</button>` +
      `<button class="btn btn-primary" data-action="createPlaylistConfirm">创建</button></div>`);
  }

  function openRenamePlaylist(id) {
    const pl = store.findPlaylist(id);
    if (!pl) return;
    openModal(`<h3>重命名歌单</h3><p>起一个顺口的名字。</p>` +
      `<input class="modal-input" id="plName" maxlength="40" value="${esc(pl.name)}">` +
      `<div class="modal-actions"><button class="btn btn-quiet" data-action="closeModal">取消</button>` +
      `<button class="btn btn-primary" data-action="renameConfirm" data-id="${esc(id)}">保存</button></div>`);
  }

  function openAddToPlaylist(track) {
    if (!track) return;
    ui.menuTrack = track;
    const list = store.data.playlists;
    openModal(`<h3>添加到歌单</h3><p>${esc(track.name)} · ${esc(track.singer)}</p>` +
      `<div class="modal-list">` +
      (list.length ? list.map((p) => `<button class="modal-playlist" data-action="addToPlaylist" data-id="${esc(p.id)}">` +
        artHTML({ name: p.name }) + `<span>${esc(p.name)}</span><span class="count">${p.tracks.length} 首</span></button>`).join("")
        : `<p class="queue-empty">还没有歌单，先建一个。</p>`) +
      `</div><div class="modal-actions"><button class="btn btn-quiet" data-action="createPlaylistFromTrack">新建歌单</button>` +
      `<button class="btn btn-primary" data-action="closeModal">完成</button></div>`);
  }

  function openTrackMenu(key) {
    const track = findTrack(key);
    if (!track) return;
    ui.menuTrack = track;
    const liked = store.isFavorite(track.key);
    const inPlaylist = ui.route.name === "playlist" && ui.route.id;
    openModal(`<h3>${esc(track.name)}</h3><p>${esc(track.singer)}${track.album ? " · " + esc(track.album) : ""}</p>` +
      `<div class="modal-list">` +
      `<button class="modal-playlist" data-action="menuPlay"><svg class="icon"><use href="#i-play"/></svg><span>立即播放</span></button>` +
      `<button class="modal-playlist" data-action="menuNext"><svg class="icon"><use href="#i-queue"/></svg><span>下一首播放</span></button>` +
      `<button class="modal-playlist" data-action="menuAdd"><svg class="icon"><use href="#i-plus"/></svg><span>添加到歌单</span></button>` +
      `<button class="modal-playlist" data-action="menuLike"><svg class="icon"><use href="${liked ? "#i-heart-fill" : "#i-heart"}"/></svg><span>${liked ? "取消收藏" : "收藏"}</span></button>` +
      (inPlaylist ? `<button class="modal-playlist" data-action="menuRemove"><svg class="icon"><use href="#i-trash"/></svg><span>从这张歌单移除</span></button>` : "") +
      `</div><div class="modal-actions"><button class="btn btn-quiet" data-action="closeModal">关闭</button></div>`);
  }

  /* ================= actions ================= */
  async function handleAction(action, el) {
    switch (action) {
      case "togglePlay":
        player.toggle();
        break;
      case "prev": player.prev(); break;
      case "next": player.next(false); break;
      case "toggleShuffle": player.toggleShuffle(); break;
      case "cycleRepeat": player.cycleRepeat(); break;
      case "toggleMute": player.toggleMute(); break;
      case "openNowPlaying": openNowPlaying(); break;
      case "closeNowPlaying": closeNowPlaying(); break;
      case "openLyrics": openNowPlaying(); break;
      case "toggleQueue": toggleQueue(); break;
      case "closeQueue": closeQueue(); break;
      case "openSidebar": openSidebar(); break;
      case "closePanels": closePanels(); break;
      case "historyBack": history.back(); break;
      case "historyForward": history.forward(); break;
      case "openSettings": location.hash = "#/settings"; break;

      case "likeCurrent": {
        if (!player.current) { toast("还没有播放歌曲", "i-note"); break; }
        const liked = store.toggleFavorite(player.current);
        toast(liked ? `已收藏「${player.current.name}」` : "已取消收藏", liked ? "i-heart-fill" : "i-heart");
        syncPlayerBar();
        syncNowPlaying();
        break;
      }
      case "addCurrent":
        if (!player.current) { toast("还没有播放歌曲", "i-note"); break; }
        openAddToPlaylist(player.current);
        break;
      case "copyLink": {
        if (!player.current) break;
        const t = player.current;
        copyText(`${t.name} - ${t.singer}${t.album ? " · " + t.album : ""}（来自 JustMusic）`);
        break;
      }

      case "playCard": {
        const ctx = el.dataset.ctx;
        const idx = Number(el.dataset.index);
        const list = ui.contexts[ctx];
        if (list && list[idx]) player.playTrack(list[idx], list, idx);
        break;
      }
      case "rowPlay": {
        const ctx = el.dataset.ctx;
        const idx = Number(el.dataset.index);
        const list = ui.contexts[ctx];
        if (list && list[idx]) player.playTrack(list[idx], list, idx);
        break;
      }
      case "playQueue": {
        const idx = Number(el.dataset.index);
        player.playAt(idx);
        if (!$("#nowPlaying").classList.contains("open")) { /* keep */ }
        break;
      }
      case "removeQueue":
        player.removeAt(Number(el.dataset.index));
        break;

      case "like": {
        const track = findTrack(el.dataset.likeKey);
        if (!track) break;
        const liked = store.toggleFavorite(track);
        toast(liked ? "已收藏" : "已取消收藏", liked ? "i-heart-fill" : "i-heart");
        break;
      }
      case "more":
        openTrackMenu(el.dataset.key);
        break;

      case "shelfMore": {
        const def = SHELVES.find((s) => s.id === el.dataset.shelf);
        if (def) {
          const variant = ui.shelfVariant[def.id] || 0;
          submitSearch(def.queries[variant % def.queries.length]);
        }
        break;
      }
      case "retryShelf":
        delete ui.shelves[el.dataset.shelf];
        delete ui.shelfPromises[el.dataset.shelf];
        ensureShelf(el.dataset.shelf);
        break;
      case "playFeatured": playShelf("mandarin", false); break;
      case "shuffleFeatured": playShelf("mandarin", true); break;
      case "heroShuffle": {
        ui.shelfVariant.mandarin = ((ui.shelfVariant.mandarin || 0) + 1) % 3;
        ui.heroCopy = (ui.heroCopy + 1) % HERO_COPY.length;
        ui.heroTracks = [];
        const hero = $(".hero");
        if (hero) hero.outerHTML = heroHTML();
        delete ui.shelfPromises.mandarin;
        ensureShelf("mandarin");
        break;
      }

      case "useQuery": {
        submitSearch(el.dataset.q);
        break;
      }
      case "clearSearch":
        store.clearSearchHistory();
        toast("搜索历史已清空");
        renderView();
        break;
      case "searchTab": {
        const q = ui.route.query.get("q") || "";
        location.hash = `#/search?q=${encodeURIComponent(q)}&src=${encodeURIComponent(el.dataset.src)}`;
        break;
      }
      case "retrySearch":
        ui.search.key = "";
        runSearch(ui.route.query.get("q") || "", ui.route.query.get("src") || "kw");
        break;
      case "loadMore":
        loadMoreSearch();
        break;

      case "playAll": {
        const list = ui.contexts[el.dataset.ctx] || [];
        if (!list.length) { toast("这里还没有歌曲", "i-note"); break; }
        player.setQueue(list, 0, true);
        break;
      }
      case "shuffleList": {
        const list = (ui.contexts[el.dataset.ctx] || []).slice();
        if (!list.length) { toast("这里还没有歌曲", "i-note"); break; }
        list.sort(() => Math.random() - 0.5);
        player.setQueue(list, 0, true);
        break;
      }
      case "clearRecents":
        store.clearRecents();
        toast("播放记录已清空");
        break;

      case "createPlaylist":
        openCreatePlaylist(null);
        break;
      case "createPlaylistFromTrack":
        openCreatePlaylist(ui.menuTrack);
        break;
      case "createPlaylistConfirm": {
        const input = $("#plName");
        const name = input ? input.value : "";
        const pl = store.createPlaylist(name);
        if (ui.pendingTrack) store.addToPlaylist(pl.id, ui.pendingTrack);
        ui.pendingTrack = null;
        closeModal();
        toast(`已创建「${pl.name}」`, "i-check");
        renderSidebarPlaylists();
        break;
      }
      case "renamePlaylist":
        openRenamePlaylist(el.dataset.id);
        break;
      case "renameConfirm": {
        const input = $("#plName");
        store.renamePlaylist(el.dataset.id, input ? input.value : "");
        closeModal();
        toast("已重命名");
        renderView();
        break;
      }
      case "deletePlaylist":
        confirmDialog("删除这张歌单？", "歌单会被删除，里面的歌曲不会从收藏里消失。", "删除", () => {
          store.deletePlaylist(el.dataset.id);
          toast("歌单已删除");
          location.hash = "#/home";
        }, true);
        break;
      case "addToPlaylist": {
        if (!ui.menuTrack) break;
        const ok = store.addToPlaylist(el.dataset.id, ui.menuTrack);
        toast(ok ? "已添加到歌单" : "这首歌已经在歌单里了", ok ? "i-check" : "i-note");
        closeModal();
        break;
      }
      case "menuPlay":
        if (ui.menuTrack) player.setQueue([ui.menuTrack], 0, true);
        closeModal();
        break;
      case "menuNext":
        if (ui.menuTrack) { player.addNext(ui.menuTrack); toast("已加入下一首"); }
        closeModal();
        break;
      case "menuAdd":
        closeModal();
        openAddToPlaylist(ui.menuTrack);
        break;
      case "menuLike":
        if (ui.menuTrack) {
          const liked = store.toggleFavorite(ui.menuTrack);
          toast(liked ? "已收藏" : "已取消收藏", liked ? "i-heart-fill" : "i-heart");
        }
        closeModal();
        break;
      case "menuRemove":
        if (ui.menuTrack && ui.route.name === "playlist") {
          store.removeFromPlaylist(ui.route.id, ui.menuTrack.key);
          toast("已从歌单移除");
        }
        closeModal();
        break;

      case "seekLyric": {
        const t = Number(el.dataset.time);
        if (player.audio && isFinite(t)) player.audio.currentTime = t;
        break;
      }

      case "setQuality":
        store.setSetting("quality", el.dataset.value);
        toast(`音质：${JM.api.QUALITY_LABEL[el.dataset.value]}`);
        renderView();
        break;
      case "setTheme":
        store.setSetting("theme", el.dataset.value);
        applyTheme();
        renderView();
        break;
      case "toggleTheme":
        cycleTheme();
        break;

      case "toggleScript": {
        const def = JM.lx.scripts.find((s) => s.id === el.dataset.id);
        if (!def) break;
        const turningOff = def.status === "ready" || def.status === "loading";
        store.setScriptEnabled(def.id, !turningOff);
        await JM.lx.toggle(def);
        renderSourceCard();
        if (ui.route.name === "settings") renderSettings();
        break;
      }
      case "reloadScripts":
        toast("正在重新加载脚本…", "i-refresh");
        await JM.lx.reloadAll();
        renderSourceCard();
        if (ui.route.name === "settings") renderSettings();
        break;
      case "addScript": {
        const input = $("#scriptUrl");
        const url = input ? input.value.trim() : "";
        if (!url) { toast("先粘贴一个脚本链接", "i-link"); break; }
        const normalized = JM.lx.normalizeScriptUrl(url);
        if (!normalized) { toast("这个链接看起来不太对", "i-x"); break; }
        const def = JM.lx.addCustomScript(normalized, "自定义音源");
        store.addCustomScript(normalized, "自定义音源");
        toast("正在加载脚本…", "i-refresh");
        if (def) await JM.lx.loadScript(def);
        renderSettings();
        renderSourceCard();
        break;
      }
      case "removeScript": {
        const url = el.dataset.url;
        store.removeCustomScript(url);
        const def = JM.lx.scripts.find((s) => s.file === url);
        if (def) { def.status = "idle"; def.sources = {}; def.handlers = {}; }
        renderSettings();
        break;
      }

      case "resetData":
        confirmDialog("重置所有数据？", "收藏、歌单、播放记录和设置都会被清空，无法恢复。", "重置", () => {
          store.resetAll();
          applyTheme();
          toast("已重置");
          location.hash = "#/home";
        }, true);
        break;

      case "confirmYes":
        if (ui.confirmFn) ui.confirmFn();
        ui.confirmFn = null;
        closeModal();
        break;
      case "closeModal":
        closeModal();
        break;
      case "goSearch":
        location.hash = "#/search";
        break;
      case "goHome":
        location.hash = "#/home";
        break;
      default:
        break;
    }
  }

  /* ================= events ================= */
  function bindStatic() {
    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-action]");
      if (el) {
        const action = el.dataset.action;
        // let real links work
        if (el.tagName === "A" && el.getAttribute("href")) return;
        e.preventDefault();
        handleAction(action, el);
        return;
      }
      if (e.target === scrim) closePanels();
      if (e.target === modalRoot) closeModal();
    });

    document.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || e.target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const input = $("#searchInput");
        if (input) { input.focus(); input.select(); }
        return;
      }

      if (e.key === "Escape") {
        if (modalRoot.classList.contains("open")) closeModal();
        else if ($("#queuePanel").classList.contains("open")) closeQueue();
        else if ($("#nowPlaying").classList.contains("open")) closeNowPlaying();
        else if (sidebar.classList.contains("open")) closePanels();
        else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        return;
      }

      if (e.key === "Enter" && (e.target.id === "searchInput" || e.target.id === "pageSearch")) {
        e.preventDefault();
        submitSearch(e.target.value);
        return;
      }
      if (e.key === "Enter" && e.target.id === "scriptUrl") {
        e.preventDefault();
        handleAction("addScript", e.target);
        return;
      }
      if (e.key === "Enter" && e.target.id === "plName") {
        e.preventDefault();
        const btn = modalRoot.querySelector('[data-action="createPlaylistConfirm"], [data-action="renameConfirm"]');
        if (btn) handleAction(btn.dataset.action, btn);
        return;
      }

      if (typing) return;

      if (e.code === "Space") {
        e.preventDefault();
        player.toggle();
      } else if (e.key === "ArrowRight") {
        player.seekBy(5);
      } else if (e.key === "ArrowLeft") {
        player.seekBy(-5);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        player.setVolume(player.state.volume + 0.05);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        player.setVolume(player.state.volume - 0.05);
      } else if (e.key === "Enter") {
        const card = e.target.closest && e.target.closest('[data-action="playCard"]');
        if (card) handleAction("playCard", card);
      }
    });

    window.addEventListener("hashchange", () => {
      closePanels();
      closeQueue();
      render();
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 820) closePanels();
    });

    // search inputs: mirror values
    const topInput = $("#searchInput");
    topInput.addEventListener("input", () => {
      const pageInput = $("#pageSearch");
      if (pageInput && pageInput.value !== topInput.value) pageInput.value = topInput.value;
    });

    // volume
    ["#volRange", "#volRange2"].forEach((sel) => {
      const range = $(sel);
      range.addEventListener("input", () => player.setVolume(Number(range.value)));
    });

    // progress bars
    bindSeek($("#pbProgress"));
    bindSeek($("#npProgress"));

    // theme follow system
    if (window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      const handler = () => { if (store.data.settings.theme === "system") applyTheme(); };
      if (mq.addEventListener) mq.addEventListener("change", handler);
      else if (mq.addListener) mq.addListener(handler);
    }
  }

  function bindSeek(el) {
    let dragging = false;
    const ratioAt = (e) => {
      const rect = el.getBoundingClientRect();
      return U.clamp((e.clientX - rect.left) / rect.width, 0, 1);
    };
    const preview = (ratio) => {
      const pct = ratio * 100;
      el.querySelector(".progress-fill").style.width = pct + "%";
      el.querySelector(".progress-knob").style.left = pct + "%";
    };
    el.addEventListener("pointerdown", (e) => {
      dragging = true;
      el.classList.add("dragging");
      el.setPointerCapture(e.pointerId);
      preview(ratioAt(e));
    });
    el.addEventListener("pointermove", (e) => {
      if (dragging) preview(ratioAt(e));
    });
    el.addEventListener("pointerup", (e) => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("dragging");
      player.seek(ratioAt(e));
    });
    el.addEventListener("pointercancel", () => {
      dragging = false;
      el.classList.remove("dragging");
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); player.seekBy(5); }
      if (e.key === "ArrowLeft") { e.preventDefault(); player.seekBy(-5); }
    });
  }

  /* ================= player subscriptions ================= */
  function bindPlayer() {
    player.on((type, payload) => {
      if (type === "time") {
        syncProgress();
        syncLyricActive(player.audio.currentTime || 0);
        return;
      }
      if (type === "track") {
        ui.lyricsIndex = -1;
        syncPlayerBar();
        syncNowPlaying(true);
        renderLyrics();
        renderQueue();
        refreshPlayingStates();
        const p = $("#pbProgress");
        if (p) p.querySelector(".progress-fill").style.width = "0%";
        return;
      }
      if (type === "lyrics") {
        renderLyrics();
        if ($("#nowPlaying").classList.contains("open")) syncLyricActive(player.audio.currentTime || 0);
        return;
      }
      if (type === "queue") {
        renderQueue();
        refreshPlayingStates();
        return;
      }
      if (type === "error") {
        toast(payload || "播放失败，换一首试试", "i-x");
        return;
      }
      if (type === "needtrack") {
        playShelf("mandarin", false);
        return;
      }
      syncPlayerBar();
      syncNowPlaying(false);
      refreshPlayingStates();
      syncProgress();
    });
  }

  /* ================= boot ================= */
  function boot() {
    applyTheme();
    bindStatic();
    bindPlayer();

    JM.store.on(() => {
      renderSidebarPlaylists();
      refreshLikes();
      if (ui.route.name === "favorites" || ui.route.name === "recent" || ui.route.name === "playlist") {
        renderView();
      }
    });

    JM.lx.on(() => {
      renderSourceCard();
      if (ui.route.name === "settings") {
        const active = document.activeElement;
        if (!active || active.id !== "scriptUrl") renderSettings();
      } else if (ui.route.name === "search" && ui.route.query.get("q")) {
        renderView();
      }
    });

    renderSidebarPlaylists();
    renderSourceCard();
    syncPlayerBar();
    syncNowPlaying(true);
    syncProgress();

    if (!location.hash) {
      history.replaceState(null, "", "#/home");
    }
    render();
    JM.lx.init();
  }

  boot();
})();
