/** Gemeinsamer Namespace + kleine Helfer fuer alle Content-Script-Dateien. */
(() => {
  if (globalThis.__BPMX) return;

  const DEFAULTS = {
    preservePitch: true,   // Tonhoehe beim Tempowechsel halten
    panelPos: null,        // {left, top} in px
    minimized: false,
    lastTargetRate: 1
  };

  const NS = {
    DEFAULTS,
    isTop: window.top === window,
    settings: { ...DEFAULTS },

    clamp: (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v),
    round1: (v) => Math.round(v * 10) / 10,

    async loadSettings() {
      try {
        const s = await chrome.storage.local.get(DEFAULTS);
        NS.settings = { ...DEFAULTS, ...s };
      } catch (_) { /* Storage kann in seltenen Faellen fehlen */ }
      return NS.settings;
    },
    saveSettings(patch) {
      Object.assign(NS.settings, patch);
      try { chrome.storage.local.set(patch); } catch (_) {}
    },

    /** Nachricht an den Service Worker (fire & forget, Fehler egal). */
    send(msg) {
      try { return chrome.runtime.sendMessage(msg).catch(() => null); }
      catch (_) { return Promise.resolve(null); }
    },
    toTop(payload) { return NS.send({ t: "toTop", payload }); },
    toAllFrames(payload) { return NS.send({ t: "toAllFrames", payload }); }
  };

  globalThis.__BPMX = NS;
})();
