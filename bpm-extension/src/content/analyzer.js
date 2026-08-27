/**
 * BPM-Erkennung: Spectral-Flux-Onset-Huellkurve + Autokorrelation mit
 * Harmonischen-Summe, Tempo-Prior und Clustering ueber die letzten Schaetzungen.
 */
(() => {
  const NS = globalThis.__BPMX;
  if (!NS || NS.Analyzer) return;

  const HOP = 512;            // ScriptProcessor-Blockgroesse -> ~10.7 ms Rasterung
  const FFT = 2048;
  const MIN_BPM = 60, MAX_BPM = 200;
  const WINDOW_SEC = 10;      // Analysefenster
  const MIN_SEC = 4;          // ab hier erste Schaetzung
  const EST_EVERY = 24;       // alle ~0.25 s neu schaetzen
  const HISTORY = 12;

  class Analyzer {
    constructor(onUpdate) {
      this.onUpdate = onUpdate;
      this.ctx = null;
      this.source = null;
      this.stream = null;
      this.mode = null;        // 'tab' | 'element'
      this.running = false;
      this.env = null;         // Ring-Buffer der Onset-Huellkurve
      this.envLen = 0;
      this.envWrite = 0;
      this.filled = 0;
      this.prevSpec = null;
      this.spec = null;
      this.hops = 0;
      this.rms = 0;
      this.quietHops = 0;
      this.history = [];
      this.result = { bpm: 0, confidence: 0, ready: false, silent: false, level: 0 };
    }

    get fsEnv() { return this.ctx ? this.ctx.sampleRate / HOP : 0; }

    async startTab(streamId) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
        video: false
      });
      this.stream = stream;
      this._ensureCtx();
      const src = this.ctx.createMediaStreamSource(stream);
      // Ohne Rueckgabe an die Ausgabe waere der Tab waehrend der Aufnahme stumm.
      const out = this.ctx.createGain();
      out.gain.value = 1;
      src.connect(out).connect(this.ctx.destination);
      this._wire(src, "tab");
    }

    startElement(el) {
      this._ensureCtx();
      // Pro Element darf es nur eine Source geben - deshalb cachen.
      let src = Analyzer._elementSources.get(el);
      if (!src) {
        src = this.ctx.createMediaElementSource(el);
        Analyzer._elementSources.set(el, src);
        src.connect(this.ctx.destination);
      }
      this._wire(src, "element");
    }

    _ensureCtx() {
      if (!this.ctx || this.ctx.state === "closed") {
        this.ctx = Analyzer._sharedCtx && Analyzer._sharedCtx.state !== "closed"
          ? Analyzer._sharedCtx
          : new AudioContext({ latencyHint: "playback" });
        Analyzer._sharedCtx = this.ctx;
      }
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    }

    _wire(src, mode) {
      const ctx = this.ctx;
      this.mode = mode;
      this.source = src;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT;
      analyser.smoothingTimeConstant = 0;
      const proc = ctx.createScriptProcessor(HOP, 1, 1);
      const mute = ctx.createGain();
      mute.gain.value = 0;

      src.connect(analyser);
      analyser.connect(proc);
      proc.connect(mute).connect(ctx.destination);

      this.analyser = analyser;
      this.proc = proc;
      this.mute = mute;

      this.spec = new Float32Array(analyser.frequencyBinCount);
      this.prevSpec = new Float32Array(analyser.frequencyBinCount);
      this.prevSpec.fill(-100);

      // Drei Baender, jeweils auf ihre Bandbreite normiert und gewichtet: sonst
      // uebertoenen die vielen Hoehen-Bins den Kick, der den Takt traegt.
      const nyq = ctx.sampleRate / 2;
      const bin = (hz) => NS.clamp(Math.round((hz / nyq) * analyser.frequencyBinCount), 1, analyser.frequencyBinCount - 1);
      this.bands = [
        { lo: bin(40), hi: bin(250), w: 0.5 },
        { lo: bin(250), hi: bin(2000), w: 0.3 },
        { lo: bin(2000), hi: bin(8000), w: 0.2 }
      ];

      this.envLen = Math.ceil(WINDOW_SEC * this.fsEnv);
      this.env = new Float32Array(this.envLen);
      this.envWrite = 0;
      this.filled = 0;
      this.hops = 0;
      this.history = [];
      this.running = true;

      proc.onaudioprocess = (e) => this._onBlock(e);
    }

    _onBlock(e) {
      if (!this.running) return;
      const buf = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      this.rms = this.rms * 0.9 + rms * 0.1;
      if (this.rms < 1e-4) this.quietHops++; else this.quietHops = 0;

      this.analyser.getFloatFrequencyData(this.spec);
      let flux = 0;
      const s = this.spec, p = this.prevSpec;
      for (const band of this.bands) {
        let sum = 0;
        for (let b = band.lo; b <= band.hi; b++) {
          const cur = s[b] < -100 ? -100 : s[b];
          const d = cur - p[b];
          if (d > 0) sum += d;
          p[b] = cur;
        }
        flux += band.w * (sum / Math.max(1, band.hi - band.lo + 1));
      }

      this.env[this.envWrite] = flux;
      this.envWrite = (this.envWrite + 1) % this.envLen;
      if (this.filled < this.envLen) this.filled++;
      this.hops++;

      if (this.hops % EST_EVERY === 0) this._estimate();
    }

    /** Ring-Buffer linearisieren und Onsets betonen. */
    _envelope() {
      const n = this.filled;
      const x = new Float32Array(n);
      const start = (this.envWrite - n + this.envLen) % this.envLen;
      for (let i = 0; i < n; i++) x[i] = this.env[(start + i) % this.envLen];
      return Analyzer.enhance(x, this.fsEnv);
    }

    _estimate() {
      const fs = this.fsEnv;
      if (this.filled < MIN_SEC * fs) return this._emit({ ready: false });
      if (this.quietHops > 2.5 * fs) return this._emit({ ready: false, silent: true });

      const est = Analyzer.estimateTempo(this._envelope(), fs);
      if (!est) return;
      let conf = est.confidence;
      if (this.rms < 5e-3) conf *= 0.4;

      this.history.push({ bpm: est.bpm, conf });
      if (this.history.length > HISTORY) this.history.shift();
      this._emitCluster();
    }

    /** Stabiler Anzeigewert: groesste uebereinstimmende Gruppe der letzten Schaetzungen. */
    _emitCluster() {
      const h = this.history;
      let bestSum = -1, bestGroup = null;
      const total = h.reduce((s, e) => s + e.conf, 0) || 1;
      for (const cand of h) {
        const group = h.filter((e) => Math.abs(e.bpm - cand.bpm) / cand.bpm < 0.03);
        const sum = group.reduce((s, e) => s + e.conf, 0);
        if (sum > bestSum) { bestSum = sum; bestGroup = group; }
      }
      if (!bestGroup || !bestGroup.length) return this._emit({ ready: false });
      const wsum = bestGroup.reduce((s, e) => s + e.conf, 0) || 1;
      const bpm = bestGroup.reduce((s, e) => s + e.bpm * e.conf, 0) / wsum;
      const meanConf = wsum / bestGroup.length;
      const agree = bestSum / total;
      const confidence = NS.clamp(meanConf * (0.45 + 0.55 * agree), 0, 1);
      this._emit({ ready: h.length >= 3 && confidence > 0.05, bpm, confidence, silent: false });
    }

    _emit(patch) {
      this.result = {
        ...this.result,
        level: this.rms,
        mode: this.mode,
        ...patch
      };
      if (this.onUpdate) this.onUpdate(this.result);
    }

    stop() {
      this.running = false;
      try { if (this.proc) this.proc.onaudioprocess = null; } catch (_) {}
      for (const node of [this.proc, this.mute, this.analyser]) {
        try { node && node.disconnect(); } catch (_) {}
      }
      if (this.mode === "tab") {
        try { this.source && this.source.disconnect(); } catch (_) {}
        if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
      }
      // Im Element-Modus bleiben Source und Context bewusst bestehen:
      // createMediaElementSource ist nicht rueckgaengig zu machen, ein
      // geschlossener Context wuerde die Seite dauerhaft stumm schalten.
      this.result = { bpm: 0, confidence: 0, ready: false, silent: false, level: 0 };
    }
  }

  /**
   * Adaptive Schwelle (gleitendes Mittel abziehen), halbwellig gleichrichten,
   * anschliessend auf Mittelwert 0 / Standardabweichung 1 normieren.
   */
  Analyzer.enhance = function (x, fs) {
    const n = x.length;
    const w = Math.max(3, Math.round(0.35 * fs));
    const out = new Float32Array(n);
    const pre = new Float32Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - w), b = Math.min(n, i + w + 1);
      const mean = (pre[b] - pre[a]) / (b - a);
      const v = x[i] - mean;
      out[i] = v > 0 ? v : 0;
    }
    // Onsets ueber ~3 Frames verteilen: sonst rastet die Autokorrelation auf
    // ganzzahligen Lags ein und das Tempo wird um bis zu 1 % daneben liegen.
    const sm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? out[i - 1] : out[i];
      const b = i + 1 < n ? out[i + 1] : out[i];
      sm[i] = 0.25 * a + 0.5 * out[i] + 0.25 * b;
    }

    let mean = 0;
    for (let i = 0; i < n; i++) mean += sm[i];
    mean /= n;
    let varSum = 0;
    for (let i = 0; i < n; i++) { const d = sm[i] - mean; varSum += d * d; }
    const sd = Math.sqrt(varSum / n) || 1;
    for (let i = 0; i < n; i++) sm[i] = (sm[i] - mean) / sd;
    return sm;
  };

  /**
   * Autokorrelation der Onset-Huellkurve, verstaerkt um ihre Harmonischen und
   * gewichtet mit einem Tempo-Prior um 125 BPM. Liefert {bpm, confidence}.
   */
  Analyzer.estimateTempo = function (x, fs) {
    const n = x.length;
    const lagMin = Math.max(2, Math.floor(60 * fs / MAX_BPM));
    const lagMax = Math.min(n - 4, Math.ceil(60 * fs / MIN_BPM));
    if (lagMax <= lagMin) return null;

    const acf = new Float32Array(lagMax * 3 + 4);
    const acfMax = Math.min(acf.length - 1, n - 2);
    for (let l = lagMin; l <= acfMax; l++) {
      let s = 0;
      const m = n - l;
      for (let i = 0; i < m; i++) s += x[i] * x[i + l];
      acf[l] = s / m;
    }

    const score = new Float32Array(lagMax + 2);
    let best = lagMin, bestVal = -Infinity, sum = 0, count = 0;
    for (let l = lagMin; l <= lagMax; l++) {
      let v = acf[l];
      if (2 * l <= acfMax) v += 0.5 * acf[2 * l];
      if (3 * l <= acfMax) v += 0.25 * acf[3 * l];
      const bpm = 60 * fs / l;
      v *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / 135) / 0.75, 2));
      score[l] = v;
      sum += v; count++;
      if (v > bestVal) { bestVal = v; best = l; }
    }

    // Feinsuche mit interpoliertem Lag: eine Rasterstelle sind bei 128 BPM
    // schon rund 3 BPM - das ist fuer Tempoangleich viel zu grob.
    let lag = best, lagVal = -Infinity;
    for (let d = -1; d <= 1.0001; d += 0.02) {
      const l = best + d;
      if (l < lagMin || l > lagMax) continue;
      let v = Analyzer.acfAt(x, l) + 0.5 * Analyzer.acfAt(x, 2 * l) + 0.25 * Analyzer.acfAt(x, 3 * l);
      v *= Math.exp(-0.5 * Math.pow(Math.log2((60 * fs / l) / 135) / 0.75, 2));
      if (v > lagVal) { lagVal = v; lag = l; }
    }
    lag = Analyzer.refineWithOnsets(x, lag);
    let bpm = 60 * fs / lag;

    // Halftime-Korrektur: wechseln sich starke und schwache Schlaege regelmaessig
    // ab, ist der echte Puls halb so schnell (typisch fuer HipHop/Trap).
    const alt = Analyzer.beatAlternation(x, lag);
    if (alt < 0.7 && bpm / 2 >= 68) bpm /= 2;

    while (bpm < 68) bpm *= 2;
    while (bpm > 200) bpm /= 2;

    // Konfidenz aus dem z-Wert des Peaks gegenueber allen anderen Lags
    let mean = sum / Math.max(1, count), varSum = 0;
    for (let l = lagMin; l <= lagMax; l++) { const d = score[l] - mean; varSum += d * d; }
    const sd = Math.sqrt(varSum / Math.max(1, count)) || 1e-9;
    const z = (bestVal - mean) / sd;
    return { bpm, z, confidence: Math.max(0, Math.min(1, (z - 1.2) / 3.5)) };
  };

  /**
   * Feinbestimmung der Schlagperiode: Onset-Spitzen mit Subframe-Genauigkeit
   * suchen, ihnen Schlagnummern zuordnen und eine gewichtete Gerade
   * t = t0 + k * L hindurchlegen. Ueber 10 s ergibt das ~0.1 % Genauigkeit.
   */
  Analyzer.refineWithOnsets = function (x, lag0) {
    const n = x.length;
    const peaks = [];
    for (let i = 1; i < n - 1; i++) {
      if (x[i] > 1 && x[i] > x[i - 1] && x[i] >= x[i + 1]) {
        const den = x[i - 1] - 2 * x[i] + x[i + 1];
        const off = den !== 0 ? 0.5 * (x[i - 1] - x[i + 1]) / den : 0;
        peaks.push({ t: i + (Math.abs(off) < 1 ? off : 0), w: x[i] });
      }
    }
    if (peaks.length < 6) return lag0;

    let L = lag0, t0 = peaks[0].t;
    for (let iter = 0; iter < 5; iter++) {
      let sw = 0, sk = 0, st = 0, skk = 0, skt = 0, used = 0;
      for (const p of peaks) {
        const k = Math.round((p.t - t0) / L);
        if (Math.abs(p.t - (t0 + k * L)) > 0.2 * L) continue;   // Offbeats/Stoerungen raus
        const w = p.w;
        sw += w; sk += w * k; st += w * p.t; skk += w * k * k; skt += w * k * p.t;
        used++;
      }
      if (used < 6) return lag0;
      const den = sw * skk - sk * sk;
      if (den === 0) return lag0;
      const newL = (sw * skt - sk * st) / den;
      const newT0 = (st - newL * sk) / sw;
      if (!isFinite(newL) || Math.abs(newL - lag0) / lag0 > 0.04) return lag0;
      const done = Math.abs(newL - L) < 1e-4;
      L = newL; t0 = newT0;
      if (done) break;
    }
    return L;
  };

  /** Autokorrelation bei gebrochenem Lag (linear interpoliert). */
  Analyzer.acfAt = function (x, lag) {
    const n = x.length;
    const li = Math.floor(lag), fr = lag - li;
    const m = n - li - 1;
    if (m <= 0) return 0;
    let s = 0;
    for (let i = 0; i < m; i++) {
      const a = x[i + li], b = x[i + li + 1];
      s += x[i] * (a + (b - a) * fr);
    }
    return s / m;
  };

  /**
   * Verhaeltnis der mittleren Onset-Staerke auf geraden zu ungeraden Schlaegen
   * (1 = gleich stark, klein = deutliche Halftime-Betonung).
   */
  Analyzer.beatAlternation = function (x, lag) {
    const n = x.length;
    const at = (t) => {
      const i = Math.round(t);
      if (i < 0 || i >= n) return null;
      let v = x[i];
      if (i > 0) v = Math.max(v, x[i - 1]);
      if (i + 1 < n) v = Math.max(v, x[i + 1]);
      return v > 0 ? v : 0;
    };
    // Phase suchen, die die Schlaege am besten trifft
    let bestPhi = 0, bestS = -Infinity;
    const steps = Math.max(4, Math.round(lag));
    for (let k = 0; k < steps; k++) {
      const phi = (k * lag) / steps;
      let sum = 0, cnt = 0;
      for (let t = phi; t < n; t += lag) { const v = at(t); if (v != null) { sum += v; cnt++; } }
      if (cnt >= 4 && sum / cnt > bestS) { bestS = sum / cnt; bestPhi = phi; }
    }
    let even = 0, ec = 0, odd = 0, oc = 0, k = 0;
    for (let t = bestPhi; t < n; t += lag, k++) {
      const v = at(t);
      if (v == null) continue;
      if (k % 2 === 0) { even += v; ec++; } else { odd += v; oc++; }
    }
    if (ec < 3 || oc < 3) return 1;
    const a = even / ec, b = odd / oc, hi = Math.max(a, b);
    return hi > 0 ? Math.min(a, b) / hi : 1;
  };

  Analyzer._elementSources = new WeakMap();
  Analyzer._sharedCtx = null;
  NS.Analyzer = Analyzer;
})();
