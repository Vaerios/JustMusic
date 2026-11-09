/* ============================================================
   JustMusic — local store & utilities
   ============================================================ */
(function () {
  const JM = (window.JM = window.JM || {});
  const KEY = "justmusic.v1";

  const DEFAULT_SETTINGS = {
    quality: "320k",
    theme: "dark",
    scripts: { feichangdao: true },
    customScripts: [],
  };

  const defaults = {
    version: 1,
    settings: DEFAULT_SETTINGS,
    favorites: [],
    recents: [],
    playlists: [],
    searchHistory: [],
  };

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  const data = clone(defaults);
  const listeners = new Set();

  function emit() {
    listeners.forEach((fn) => {
      try { fn(data); } catch (err) { /* ignore */ }
    });
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (err) {
      /* storage may be unavailable in private mode */
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      data.settings = Object.assign({}, DEFAULT_SETTINGS, parsed.settings || {});
      data.settings.scripts = Object.assign({}, DEFAULT_SETTINGS.scripts, (parsed.settings && parsed.settings.scripts) || {});
      data.settings.customScripts = Array.isArray(parsed.settings && parsed.settings.customScripts)
        ? parsed.settings.customScripts : [];
      data.favorites = Array.isArray(parsed.favorites) ? parsed.favorites : [];
      data.recents = Array.isArray(parsed.recents) ? parsed.recents : [];
      data.playlists = Array.isArray(parsed.playlists) ? parsed.playlists : [];
      data.searchHistory = Array.isArray(parsed.searchHistory) ? parsed.searchHistory : [];
    } catch (err) {
      /* corrupted storage: start fresh */
    }
  }

  function uid(prefix) {
    return `${prefix || "id"}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  function sameTrack(a, b) {
    return a && b && a.key === b.key;
  }

  function isFavorite(key) {
    return data.favorites.some((t) => t.key === key);
  }

  function toggleFavorite(track) {
    if (!track) return false;
    const idx = data.favorites.findIndex((t) => t.key === track.key);
    if (idx >= 0) data.favorites.splice(idx, 1);
    else data.favorites.unshift(clean(track));
    save();
    emit();
    return idx < 0;
  }

  function clean(track) {
    const copy = Object.assign({}, track);
    delete copy.url;
    delete copy._raw;
    delete copy.extra;
    return copy;
  }

  function addRecent(track) {
    if (!track) return;
    const idx = data.recents.findIndex((t) => t.key === track.key);
    if (idx >= 0) data.recents.splice(idx, 1);
    data.recents.unshift(Object.assign(clean(track), { playedAt: Date.now() }));
    if (data.recents.length > 80) data.recents.length = 80;
    save();
  }

  function clearRecents() {
    data.recents = [];
    save();
    emit();
  }

  function createPlaylist(name) {
    const cleanName = String(name || "").trim().slice(0, 40) || "新建歌单";
    const playlist = { id: uid("pl"), name: cleanName, createdAt: Date.now(), tracks: [] };
    data.playlists.unshift(playlist);
    save();
    emit();
    return playlist;
  }

  function findPlaylist(id) {
    return data.playlists.find((p) => p.id === id) || null;
  }

  function renamePlaylist(id, name) {
    const p = findPlaylist(id);
    if (!p) return;
    p.name = String(name || "").trim().slice(0, 40) || p.name;
    save();
    emit();
  }

  function deletePlaylist(id) {
    const idx = data.playlists.findIndex((p) => p.id === id);
    if (idx >= 0) data.playlists.splice(idx, 1);
    save();
    emit();
  }

  function addToPlaylist(id, track) {
    const p = findPlaylist(id);
    if (!p || !track) return false;
    if (p.tracks.some((t) => t.key === track.key)) return false;
    p.tracks.push(clean(track));
    save();
    emit();
    return true;
  }

  function removeFromPlaylist(id, trackKey) {
    const p = findPlaylist(id);
    if (!p) return;
    p.tracks = p.tracks.filter((t) => t.key !== trackKey);
    save();
    emit();
  }

  function addSearchHistory(term) {
    const q = String(term || "").trim();
    if (!q) return;
    data.searchHistory = [q].concat(data.searchHistory.filter((x) => x !== q)).slice(0, 8);
    save();
  }

  function clearSearchHistory() {
    data.searchHistory = [];
    save();
    emit();
  }

  function setSetting(key, value) {
    data.settings[key] = value;
    save();
    emit();
  }

  function setScriptEnabled(id, enabled) {
    data.settings.scripts[id] = !!enabled;
    save();
    emit();
  }

  function addCustomScript(url, name) {
    const list = data.settings.customScripts;
    if (list.some((s) => s.url === url)) return false;
    list.push({ url, name: name || "自定义音源", enabled: true });
    save();
    emit();
    return true;
  }

  function removeCustomScript(url) {
    data.settings.customScripts = data.settings.customScripts.filter((s) => s.url !== url);
    save();
    emit();
  }

  function resetAll() {
    data.favorites = [];
    data.recents = [];
    data.playlists = [];
    data.searchHistory = [];
    data.settings = clone(DEFAULT_SETTINGS);
    save();
    emit();
  }

  /* ---------------- utils ---------------- */
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtTime(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  function hashString(str) {
    let h = 2166136261;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
  }

  function gradientFor(seed) {
    const h = hashString(seed) % 360;
    const h2 = (h + 42) % 360;
    return [
      `hsl(${h} 38% 26%)`,
      `hsl(${h2} 34% 12%)`,
    ];
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function debounce(fn, wait) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function dayOfYear() {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    return Math.floor((now - start) / 86400000);
  }

  function relativeDate(ts) {
    const d = new Date(ts);
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const diff = startOfToday - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (diff === 0) return "今天";
    if (diff === 86400000) return "昨天";
    if (diff < 7 * 86400000) return `${Math.round(diff / 86400000)} 天前`;
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  }

  load();

  JM.store = {
    data,
    save,
    emit,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    off(fn) { listeners.delete(fn); },
    isFavorite,
    toggleFavorite,
    addRecent,
    clearRecents,
    createPlaylist,
    findPlaylist,
    renamePlaylist,
    deletePlaylist,
    addToPlaylist,
    removeFromPlaylist,
    addSearchHistory,
    clearSearchHistory,
    setSetting,
    setScriptEnabled,
    addCustomScript,
    removeCustomScript,
    resetAll,
    sameTrack,
    clean,
    uid,
  };

  JM.util = {
    esc,
    fmtTime,
    hashString,
    gradientFor,
    clamp,
    debounce,
    dayOfYear,
    relativeDate,
  };
})();
