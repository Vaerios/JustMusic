/* ============================================================
   JustMusic — playback engine
   ============================================================ */
(function () {
  const JM = (window.JM = window.JM || {});
  const audio = document.getElementById("audio");

  const state = {
    queue: [],
    index: -1,
    current: null,
    playing: false,
    loading: false,
    resolving: false,
    shuffle: false,
    repeat: "off",
    volume: 0.85,
    muted: false,
    lyrics: [],
    lyricsLoading: false,
    error: "",
  };

  const listeners = new Set();
  let loadToken = 0;
  let failureStreak = 0;
  let retriedLow = false;

  function quality() {
    const q = JM.store && JM.store.data.settings.quality;
    return q === "128k" || q === "flac" ? q : "320k";
  }

  function emit(type, payload) {
    listeners.forEach((fn) => {
      try { fn(type || "state", payload); } catch (err) { /* ignore */ }
    });
  }

  /* ---------------- media session ---------------- */
  function updateMediaSession(track) {
    if (!("mediaSession" in navigator) || !window.MediaMetadata) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.name || "",
        artist: track.singer || "",
        album: track.album || "JustMusic",
        artwork: track.cover
          ? [{ src: JM.api.upgrade(track.cover), sizes: "500x500", type: "image/jpeg" }]
          : [],
      });
    } catch (err) { /* ignore */ }
  }

  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.setActionHandler("play", () => toggle());
      navigator.mediaSession.setActionHandler("pause", () => toggle());
      navigator.mediaSession.setActionHandler("previoustrack", () => prev());
      navigator.mediaSession.setActionHandler("nexttrack", () => next(false));
      navigator.mediaSession.setActionHandler("seekto", (e) => {
        if (typeof e.seekTime === "number" && audio.duration) {
          audio.currentTime = Math.min(e.seekTime, audio.duration);
        }
      });
      navigator.mediaSession.setActionHandler("seekbackward", () => {
        audio.currentTime = Math.max(0, audio.currentTime - 10);
      });
      navigator.mediaSession.setActionHandler("seekforward", () => {
        audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
      });
    } catch (err) { /* ignore */ }
  }

  /* ---------------- lyrics ---------------- */
  async function loadLyrics(track, token) {
    state.lyrics = [];
    state.lyricsLoading = true;
    emit("lyrics");
    try {
      const lines = await JM.api.getLyrics(track);
      if (token !== loadToken) return;
      state.lyrics = Array.isArray(lines) ? lines : [];
    } catch (err) {
      if (token !== loadToken) return;
      state.lyrics = [];
    }
    state.lyricsLoading = false;
    emit("lyrics");
  }

  /* ---------------- loading a track ---------------- */
  function handlePlaybackFailure(message) {
    state.resolving = false;
    state.loading = false;
    state.error = message;
    emit("state");
    emit("error", message);
    failureStreak++;
    if (failureStreak <= 3 && state.queue.length > 1) {
      const token = loadToken;
      setTimeout(() => {
        if (token === loadToken && !state.playing) next(true);
      }, 1400);
    }
  }

  async function load(track, autoplay, opts = {}) {
    if (!track) return;
    const token = ++loadToken;
    retriedLow = false;
    state.current = track;
    state.error = "";
    state.resolving = true;
    state.loading = true;
    state.playing = false;
    state.lyrics = [];
    state.lyricsLoading = true;
    emit("state");
    emit("track", track);

    if (JM.store) JM.store.addRecent(track);
    updateMediaSession(track);
    loadLyrics(track, token);

    try {
      const url = await JM.api.getStream(track, opts.quality || quality());
      if (token !== loadToken) return;
      audio.src = url;
      audio.volume = state.muted ? 0 : state.volume;
      audio.muted = state.muted;
      state.resolving = false;
      emit("state");
      if (autoplay !== false) {
        const p = audio.play();
        if (p && p.catch) {
          p.catch((err) => {
            if (!err || err.name === "AbortError") return;
            if (err.name === "NotAllowedError") {
              state.playing = false;
              state.loading = false;
              state.error = "浏览器拦截了自动播放，点一下播放按钮";
              emit("state");
              emit("error", state.error);
            }
            // Any other failure is reported by the audio "error" listener,
            // which retries with a backup source.
          });
        }
      }
    } catch (err) {
      if (token !== loadToken) return;
      handlePlaybackFailure((err && err.message) || "音源解析失败");
    }
  }

  /* ---------------- queue ---------------- */
  function setQueue(tracks, startIndex, autoplay) {
    state.queue = Array.isArray(tracks) ? tracks.slice() : [];
    state.index = JM.util.clamp(startIndex || 0, 0, Math.max(0, state.queue.length - 1));
    failureStreak = 0;
    emit("queue");
    if (state.queue.length) load(state.queue[state.index], autoplay !== false);
  }

  function playTrack(track, queue, index) {
    if (queue && queue.length) {
      setQueue(queue, index || 0, true);
    } else {
      setQueue([track], 0, true);
    }
  }

  function playAt(index) {
    if (index < 0 || index >= state.queue.length) return;
    state.index = index;
    failureStreak = 0;
    load(state.queue[index], true);
    emit("queue");
  }

  function addNext(track) {
    if (!track) return;
    const at = state.index < 0 ? 0 : state.index + 1;
    state.queue.splice(at, 0, track);
    if (state.index < 0) state.index = -1;
    emit("queue");
  }

  function addToQueue(track) {
    if (!track) return;
    if (!state.queue.length) {
      setQueue([track], 0, false);
      return;
    }
    state.queue.push(track);
    emit("queue");
  }

  function removeAt(index) {
    if (index < 0 || index >= state.queue.length) return;
    state.queue.splice(index, 1);
    if (index < state.index) state.index--;
    else if (index === state.index) {
      state.index = Math.min(state.index, state.queue.length - 1);
      if (state.queue.length) load(state.queue[Math.max(0, state.index)], state.playing);
      else stop();
    }
    emit("queue");
  }

  function stop() {
    state.playing = false;
    state.loading = false;
    state.resolving = false;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    emit("state");
  }

  /* ---------------- transport ---------------- */
  function toggle() {
    if (!state.current) {
      emit("needtrack");
      return;
    }
    if (audio.paused) {
      if (!audio.src) {
        load(state.current, true);
        return;
      }
      const p = audio.play();
      if (p && p.catch) p.catch(() => {});
    } else {
      audio.pause();
    }
  }

  function pause() {
    if (!audio.paused) audio.pause();
  }

  function next(auto) {
    if (!state.queue.length) return;
    if (state.repeat === "one" && auto) {
      audio.currentTime = 0;
      const p = audio.play();
      if (p && p.catch) p.catch(() => {});
      return;
    }
    let target;
    if (state.shuffle && state.queue.length > 1) {
      let guard = 0;
      do {
        target = Math.floor(Math.random() * state.queue.length);
        guard++;
      } while (target === state.index && guard < 12);
    } else {
      target = state.index + 1;
      if (target >= state.queue.length) {
        if (auto && state.repeat !== "all") {
          state.playing = false;
          emit("state");
          return;
        }
        target = 0;
      }
    }
    state.index = target;
    if (!auto) failureStreak = 0;
    load(state.queue[target], true);
    emit("queue");
  }

  function prev() {
    if (!state.queue.length) return;
    if (audio.currentTime > 3 && !audio.paused) {
      audio.currentTime = 0;
      return;
    }
    let target;
    if (state.shuffle && state.queue.length > 1) {
      target = Math.floor(Math.random() * state.queue.length);
    } else {
      target = state.index - 1;
      if (target < 0) target = state.queue.length - 1;
    }
    state.index = target;
    failureStreak = 0;
    load(state.queue[target], true);
    emit("queue");
  }

  function seek(ratio) {
    if (!audio.duration || !isFinite(audio.duration)) return;
    audio.currentTime = JM.util.clamp(ratio, 0, 1) * audio.duration;
    emit("time");
  }

  function seekBy(seconds) {
    if (!audio.duration) return;
    audio.currentTime = JM.util.clamp(audio.currentTime + seconds, 0, audio.duration);
  }

  function setVolume(v) {
    state.volume = JM.util.clamp(Number(v), 0, 1);
    state.muted = state.volume === 0;
    audio.volume = state.volume;
    audio.muted = state.muted;
    if (JM.store) {
      JM.store.data.settings.volume = state.volume;
      JM.store.save();
    }
    emit("state");
  }

  function toggleMute() {
    state.muted = !state.muted;
    audio.muted = state.muted;
    emit("state");
  }

  function toggleShuffle() {
    state.shuffle = !state.shuffle;
    emit("state");
  }

  function cycleRepeat() {
    state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
    emit("state");
  }

  /* ---------------- audio events ---------------- */
  audio.addEventListener("play", () => {
    state.playing = true;
    state.loading = false;
    emit("state");
  });
  audio.addEventListener("pause", () => {
    state.playing = false;
    emit("state");
  });
  audio.addEventListener("playing", () => {
    state.loading = false;
    state.resolving = false;
    state.error = "";
    failureStreak = 0;
    emit("state");
  });
  audio.addEventListener("waiting", () => {
    state.loading = true;
    emit("state");
  });
  audio.addEventListener("canplay", () => {
    state.loading = false;
    emit("state");
  });
  audio.addEventListener("loadedmetadata", () => {
    failureStreak = 0;
    emit("time");
  });
  audio.addEventListener("timeupdate", () => {
    if (state.loading) {
      state.loading = false;
      emit("state");
    }
    emit("time");
  });
  audio.addEventListener("durationchange", () => emit("time"));
  audio.addEventListener("ended", () => {
    next(true);
  });
  audio.addEventListener("error", () => {
    if (!state.current || !audio.src) return;
    if (!retriedLow) {
      retriedLow = true;
      const token = loadToken;
      state.resolving = true;
      state.error = "";
      emit("state");
      // The official Netease / QQ URL can be rejected (VIP, expired token,
      // host unreachable). A fresh Kuwo match is the most reliable backup.
      JM.api
        .getBackupStream(state.current)
        .then((url) => {
          if (token !== loadToken) return;
          state.resolving = false;
          audio.src = url;
          audio.play().catch(() => {});
        })
        .catch(() => {
          if (token !== loadToken) return;
          handlePlaybackFailure("播放失败，换一首试试");
        });
    } else {
      handlePlaybackFailure("播放失败，换一首试试");
    }
  });

  function initVolume() {
    const saved = JM.store && JM.store.data.settings.volume;
    state.volume = typeof saved === "number" ? JM.util.clamp(saved, 0, 1) : 0.85;
    audio.volume = state.volume;
    audio.muted = false;
  }

  initVolume();

  JM.player = {
    audio,
    state,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setQueue,
    playTrack,
    playAt,
    addNext,
    addToQueue,
    removeAt,
    load,
    toggle,
    pause,
    next,
    prev,
    seek,
    seekBy,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    stop,
    get current() { return state.current; },
    get queue() { return state.queue; },
    get index() { return state.index; },
    get isPlaying() { return state.playing; },
    get lyrics() { return state.lyrics; },
    get volume() { return state.muted ? 0 : state.volume; },
    get quality() { return quality(); },
  };
})();
