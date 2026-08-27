/**
 * Findet und steuert die <audio>/<video>-Elemente im jeweiligen Frame.
 * Laeuft in JEDEM Frame (eingebettete Player liegen oft in einem iframe).
 */
(() => {
  const NS = globalThis.__BPMX;
  if (!NS || NS.media) return;

  const media = {
    elements: new Set(),
    desiredRate: 1,
    preservePitch: true,
    lockRate: false,      // Rate nach fremden Aenderungen wieder erzwingen
    onStateChange: null,

    /** Das aktuell relevante Element: bevorzugt das laufende mit der laengsten Dauer. */
    active() {
      let best = null, bestScore = -1;
      for (const el of media.elements) {
        if (!el.isConnected) { media.elements.delete(el); continue; }
        const playing = !el.paused && !el.ended && el.readyState >= 2;
        const dur = isFinite(el.duration) ? el.duration : 0;
        const score = (playing ? 1e6 : 0) + (el.muted || el.volume === 0 ? 0 : 1e3) + dur;
        if (score > bestScore) { bestScore = score; best = el; }
      }
      return best;
    },

    state() {
      const el = media.active();
      if (!el) return { hasMedia: false, playing: false, rate: 1, preservePitch: media.preservePitch };
      return {
        hasMedia: true,
        playing: !el.paused && !el.ended,
        rate: el.playbackRate,
        duration: isFinite(el.duration) ? el.duration : 0,
        currentTime: el.currentTime,
        preservePitch: media.preservePitch,
        webAudioSafe: media.isWebAudioSafe(el)
      };
    },

    /**
     * createMediaElementSource() liefert bei CORS-fremden Quellen dauerhaft
     * Stille - deshalb nur bei nachweislich unbedenklichen Quellen erlauben.
     */
    isWebAudioSafe(el) {
      if (!el) return false;
      if (el.srcObject) return true;
      const src = el.currentSrc || el.src || "";
      if (!src) return false;
      if (src.startsWith("blob:") || src.startsWith("data:") || src.startsWith("mediasource:")) return true;
      if (el.crossOrigin === "anonymous" || el.crossOrigin === "use-credentials") return true;
      try { return new URL(src, location.href).origin === location.origin; } catch (_) { return false; }
    },

    apply({ rate, preservePitch, lock }) {
      if (typeof preservePitch === "boolean") media.preservePitch = preservePitch;
      if (typeof lock === "boolean") media.lockRate = lock;
      if (typeof rate === "number" && isFinite(rate)) media.desiredRate = NS.clamp(rate, 0.25, 4);
      for (const el of media.elements) {
        if (!el.isConnected) { media.elements.delete(el); continue; }
        try {
          el.preservesPitch = media.preservePitch;
          el.mozPreservesPitch = media.preservePitch;
          el.webkitPreservesPitch = media.preservePitch;
          if (Math.abs(el.playbackRate - media.desiredRate) > 1e-4) el.playbackRate = media.desiredRate;
        } catch (_) {}
      }
      return media.state();
    },

    /**
     * Nach Track-/Playerwechseln nur die Tonhoehen-Einstellung nachziehen - die
     * Rate wird bewusst nur erzwungen, wenn der Nutzer sie fixiert hat.
     */
    reapply() {
      for (const el of media.elements) {
        if (!el.isConnected) { media.elements.delete(el); continue; }
        try {
          el.preservesPitch = media.preservePitch;
          el.mozPreservesPitch = media.preservePitch;
          el.webkitPreservesPitch = media.preservePitch;
          if (media.lockRate && Math.abs(el.playbackRate - media.desiredRate) > 1e-4) {
            el.playbackRate = media.desiredRate;
          }
        } catch (_) {}
      }
    },

    track(el) {
      if (media.elements.has(el)) return;
      media.elements.add(el);
      const notify = () => media.onStateChange && media.onStateChange(media.state());
      el.addEventListener("play", () => { media.reapply(); notify(); });
      el.addEventListener("pause", notify);
      el.addEventListener("loadedmetadata", () => { media.reapply(); notify(); });
      el.addEventListener("ratechange", () => {
        // Player wie YouTube setzen die Rate beim Trackwechsel zurueck.
        if (media.lockRate && Math.abs(el.playbackRate - media.desiredRate) > 1e-4) {
          try { el.playbackRate = media.desiredRate; } catch (_) {}
        }
        notify();
      });
      notify();
    },

    scan() {
      for (const el of document.querySelectorAll("audio, video")) media.track(el);
    },

    init() {
      media.scan();
      const mo = new MutationObserver(() => media.scan());
      mo.observe(document.documentElement || document, { childList: true, subtree: true });
      setInterval(() => media.scan(), 2000);
    }
  };

  NS.media = media;
})();
