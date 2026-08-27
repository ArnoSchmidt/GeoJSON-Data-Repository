/**
 * Controller: haelt den Zustand, verbindet Analyzer, Media-Steuerung und UI.
 * Laeuft in jedem Frame, das Panel/den Analyzer gibt es nur im Top-Frame.
 */
(() => {
  const NS = globalThis.__BPMX;
  if (!NS || NS.main) return;
  const media = NS.media;
  media.init();

  const st = {
    active: false,
    mode: "tab",
    detected: 0,        // gemessene BPM des tatsaechlich hoerbaren Signals
    confidence: 0,
    ready: false,
    silent: false,
    base: 0,            // BPM des Originals (ohne Tempoaenderung)
    baseLocked: false,
    rate: 1,
    preservePitch: true,
    lockRate: false,
    hasMedia: false,
    playing: false,
    webAudioSafe: false,
    error: ""
  };

  let analyzer = null;
  let remoteMedia = null;     // Media-Status aus einem Sub-Frame
  let remoteSeen = 0;
  let renderTimer = null;

  /* ---------------- Sub-Frames ---------------- */

  if (!NS.isTop) {
    let last = 0;
    media.onStateChange = (s) => {
      const now = Date.now();
      if (s.hasMedia && now - last > 400) { last = now; NS.toTop({ t: "frameMedia", state: s }); }
    };
    setInterval(() => {
      const s = media.state();
      if (s.hasMedia) NS.toTop({ t: "frameMedia", state: s });
    }, 1500);
  }

  /* ---------------- Tempo-Steuerung ---------------- */

  function applyEverywhere() {
    const payload = { t: "applyRate", rate: st.rate, preservePitch: st.preservePitch, lock: st.lockRate };
    media.apply(payload);
    NS.toAllFrames(payload);
  }

  function setRate(rate, lockBase = true) {
    st.rate = NS.clamp(rate, 0.25, 4);
    if (lockBase && st.base > 0) st.baseLocked = true;
    applyEverywhere();
    render();
  }

  const handlers = {
    onToggle: () => (st.active ? stopAnalysis() : startAnalysis()),
    onSetRate: (r) => setRate(r),
    onScaleRate: (f) => setRate(st.rate * f),
    onSetTargetBpm: (bpm) => { if (st.base > 0) setRate(bpm / st.base); },
    onNudgeBpm: (d) => { if (st.base > 0) setRate((st.base * st.rate + d) / st.base); },
    onTapBpm: (bpm) => {
      // Getappt wird das, was gerade laeuft -> auf das Original zurueckrechnen.
      st.base = bpm / st.rate;
      st.baseLocked = true;
      render();
    },
    onReset: () => {
      st.baseLocked = false;
      st.rate = 1;
      applyEverywhere();
      render();
    },
    onTogglePitch: () => {
      st.preservePitch = !st.preservePitch;
      NS.saveSettings({ preservePitch: st.preservePitch });
      applyEverywhere();
      render();
    },
    onToggleLock: () => { st.lockRate = !st.lockRate; applyEverywhere(); render(); },
    onSetMode: (m) => {
      st.mode = m;
      if (st.active) { stopAnalysis(); startAnalysis(); } else render();
    },
    onClose: () => { stopAnalysis(); NS.ui.destroy(); stopRender(); }
  };

  /* ---------------- Analyse ---------------- */

  function onAnalyzerUpdate(res) {
    st.detected = res.ready ? res.bpm : 0;
    st.confidence = res.ready ? res.confidence : 0;
    st.ready = !!res.ready;
    st.silent = !!res.silent;
    if (res.ready && !st.baseLocked) st.base = res.bpm / st.rate;
    render();
  }

  async function startAnalysis() {
    st.error = "";
    if (!analyzer) analyzer = new NS.Analyzer(onAnalyzerUpdate);
    try {
      if (st.mode === "element") {
        const el = media.active();
        if (!el) throw new Error("Kein Media-Element in diesem Frame gefunden.");
        if (!media.isWebAudioSafe(el)) {
          throw new Error("Quelle ist CORS-geschützt – bitte Tab-Audio verwenden.");
        }
        analyzer.startElement(el);
        st.active = true;
      } else {
        const res = await NS.send({ t: "startCapture" });
        if (!res || !res.ok) throw new Error((res && res.error) || "Tab-Audio konnte nicht gestartet werden.");
        st.active = true;
      }
    } catch (err) {
      st.active = false;
      st.error = err && err.message ? err.message : String(err);
    }
    render();
  }

  function stopAnalysis() {
    if (analyzer) analyzer.stop();
    st.active = false;
    st.detected = 0;
    st.confidence = 0;
    st.ready = false;
    render();
  }

  /** Wird vom Service Worker aufgerufen, sobald eine Stream-ID vorliegt. */
  async function beginCapture(streamId) {
    if (!analyzer) analyzer = new NS.Analyzer(onAnalyzerUpdate);
    try {
      await analyzer.startTab(streamId);
      st.active = true;
      st.mode = "tab";
      st.error = "";
      render();
      return { ok: true };
    } catch (err) {
      st.active = false;
      st.error = "Tab-Audio abgelehnt: " + (err && err.message ? err.message : String(err));
      render();
      return { ok: false, error: st.error };
    }
  }

  /* ---------------- UI ---------------- */

  function refreshMediaState() {
    const local = media.state();
    const remote = remoteMedia && Date.now() - remoteSeen < 4000 ? remoteMedia : null;
    const s = local.hasMedia ? local : (remote || local);
    st.hasMedia = s.hasMedia;
    st.playing = s.playing;
    st.webAudioSafe = !!s.webAudioSafe;
    // Rate, die der Player selbst gesetzt hat, uebernehmen (z. B. YouTube-Menue).
    if (s.hasMedia && !st.lockRate && Math.abs(s.rate - st.rate) > 1e-3) st.rate = s.rate;
  }

  function render() {
    if (!NS.isTop || !NS.ui.mounted) return;
    NS.ui.render(st);
  }

  function startRender() {
    if (renderTimer) return;
    renderTimer = setInterval(() => { refreshMediaState(); render(); }, 250);
  }
  function stopRender() {
    if (renderTimer) clearInterval(renderTimer);
    renderTimer = null;
  }

  async function showPanel() {
    await NS.loadSettings();
    st.preservePitch = NS.settings.preservePitch;
    NS.ui.mount(handlers);
    applyEverywhere();
    refreshMediaState();
    startRender();
    render();
  }

  /* ---------------- Messaging ---------------- */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg && msg.t) {
      case "ping":
        sendResponse({ ok: true, top: NS.isTop });
        return false;

      case "applyRate":
        media.apply(msg);
        sendResponse({ ok: true });
        return false;

      case "frameMedia":
        if (NS.isTop) { remoteMedia = msg.state; remoteSeen = Date.now(); }
        sendResponse({ ok: true });
        return false;
    }

    if (!NS.isTop) { sendResponse({ ok: false }); return false; }

    switch (msg.t) {
      case "beginCapture":
        beginCapture(msg.streamId).then(sendResponse);
        return true;

      case "togglePanel":
        if (NS.ui.mounted) {
          handlers.onClose();
          sendResponse({ ok: true, open: false });
        } else {
          showPanel().then(() => sendResponse({ ok: true, open: true, wantsCapture: !st.active && st.mode === "tab" }));
          return true;
        }
        return false;

      case "showPanel":
        (async () => {
          if (!NS.ui.mounted) await showPanel();
          sendResponse({ ok: true, state: { ...st } });
        })();
        return true;

      case "getState":
        refreshMediaState();
        sendResponse({ ok: true, state: { ...st }, panel: NS.ui.mounted });
        return false;

      case "cmd": {
        const fn = handlers[msg.fn];
        if (typeof fn !== "function") { sendResponse({ ok: false, error: "Unbekanntes Kommando" }); return false; }
        Promise.resolve(fn(msg.value)).then(() => {
          refreshMediaState();
          sendResponse({ ok: true, state: { ...st } });
        });
        return true;
      }
    }
    return false;
  });

  NS.main = { st, handlers, showPanel };

  // Panel nach einem Reload wiederherstellen, wenn es zuletzt offen war? Bewusst
  // nicht: Tab-Audio braucht ohnehin eine neue Nutzeraktion (activeTab).
})();
