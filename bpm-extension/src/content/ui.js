/** Das schwebende Panel (nur im Top-Frame), gekapselt in einem Shadow-Root. */
(() => {
  const NS = globalThis.__BPMX;
  if (!NS || NS.ui) return;

  const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .panel {
    position: fixed; width: 302px; background: #14161c; color: #e7e9ee;
    border: 1px solid #2b2f3a; border-radius: 12px; overflow: hidden;
    box-shadow: 0 10px 34px rgba(0,0,0,.55); font-size: 12px; user-select: none;
  }
  .head {
    display: flex; align-items: center; gap: 8px; padding: 8px 10px;
    background: linear-gradient(180deg,#1d2029,#171a22); cursor: grab; border-bottom: 1px solid #2b2f3a;
  }
  .head.drag { cursor: grabbing; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #4b5162; flex: none; }
  .dot.on { background: #35d07f; box-shadow: 0 0 8px #35d07f88; }
  .title { font-weight: 600; letter-spacing: .3px; flex: 1; font-size: 12px; }
  .iconbtn {
    background: transparent; border: 0; color: #9aa1b1; cursor: pointer; padding: 2px 5px;
    border-radius: 6px; font-size: 14px; line-height: 1;
  }
  .iconbtn:hover { background: #262b36; color: #fff; }
  .body { padding: 10px; display: grid; gap: 10px; }
  .hidden { display: none !important; }

  .readout { display: flex; align-items: baseline; gap: 8px; }
  .bpm { font-size: 38px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
  .bpm.dim { color: #6b7285; }
  .unit { font-size: 11px; color: #8b93a5; letter-spacing: 1px; }
  .status { margin-left: auto; text-align: right; color: #8b93a5; font-size: 10px; line-height: 1.3; white-space: nowrap; }
  .conf { height: 4px; border-radius: 3px; background: #262b36; overflow: hidden; }
  .conf > i { display: block; height: 100%; width: 0; background: linear-gradient(90deg,#e2b93b,#35d07f); transition: width .3s; }

  .row { display: flex; align-items: center; gap: 5px; flex-wrap: nowrap; }
  .row .lbl { color: #8b93a5; flex: none; }
  .row.quick > .btn { flex: 1 1 0; min-width: 0; padding: 5px 4px; }
  .grow { flex: 1; }
  input[type=range] { -webkit-appearance: none; appearance: none; height: 4px; border-radius: 3px; background: #2b2f3a; width: 100%; }
  input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%;
    background: #6ea8fe; border: 2px solid #14161c; cursor: pointer;
  }
  input[type=number] {
    width: 62px; flex: none; background: #0f1116; color: #e7e9ee; border: 1px solid #2b2f3a;
    border-radius: 6px; padding: 4px 6px; font-size: 12px; font-variant-numeric: tabular-nums;
  }
  select {
    background: #0f1116; color: #e7e9ee; border: 1px solid #2b2f3a; border-radius: 6px;
    padding: 3px 6px; font-size: 11px;
  }
  button.btn {
    background: #232833; color: #dfe3ec; border: 1px solid #333a49; border-radius: 7px;
    padding: 5px 8px; cursor: pointer; font-size: 11px; flex: none; white-space: nowrap;
  }
  button.btn.grow { flex: 1 1 auto; }
  button.btn:hover { background: #2c3341; }
  button.btn.primary { background: #2f6df6; border-color: #2f6df6; color: #fff; }
  button.btn.primary:hover { background: #3b78ff; }
  button.btn.on { background: #1f4d33; border-color: #2f7a51; color: #c9f3dc; }
  button.btn:disabled { opacity: .45; cursor: default; }
  .rate { font-variant-numeric: tabular-nums; color: #6ea8fe; margin-left: auto; text-align: right; font-weight: 600; flex: none; }
  .note { color: #8b93a5; font-size: 10px; line-height: 1.35; }
  .warn { color: #f0b429; }
  .err { color: #ff7b72; }
  .sep { height: 1px; background: #232833; }
  `;

  const HTML = `
  <div class="panel" part="panel">
    <div class="head">
      <span class="dot"></span>
      <span class="title">BPM &amp; Tempo</span>
      <button class="iconbtn" data-act="min" title="Minimieren">–</button>
      <button class="iconbtn" data-act="close" title="Schliessen">×</button>
    </div>
    <div class="body">
      <div>
        <div class="readout">
          <span class="bpm dim" data-el="bpm">--</span>
          <span class="unit">BPM</span>
          <span class="status" data-el="status">bereit</span>
        </div>
        <div class="conf" style="margin-top:6px"><i data-el="conf"></i></div>
      </div>

      <div class="row">
        <button class="btn primary grow" data-act="toggle" data-el="toggle">Messung starten</button>
        <select data-el="mode" title="Audioquelle">
          <option value="tab">Tab-Audio</option>
          <option value="element">Media-Element</option>
        </select>
      </div>

      <div class="sep"></div>

      <div class="row">
        <span class="lbl">Ziel-BPM</span>
        <input type="number" data-el="target" step="0.5" min="20" max="400">
        <button class="btn" data-act="bpm-" title="-1 BPM">–</button>
        <button class="btn" data-act="bpm+" title="+1 BPM">+</button>
        <span class="rate" data-el="rate">1.00×</span>
      </div>

      <input type="range" data-el="rateSlider" min="0.5" max="2" step="0.005" value="1">

      <div class="row quick">
        <button class="btn" data-act="half">0.5×</button>
        <button class="btn" data-act="minus5">-5%</button>
        <button class="btn" data-act="plus5">+5%</button>
        <button class="btn" data-act="double">2×</button>
        <button class="btn grow" data-act="reset">Reset</button>
      </div>

      <div class="row">
        <button class="btn" data-act="pitch" data-el="pitch">Tonhöhe halten</button>
        <button class="btn" data-act="lock" data-el="lock" title="Rate nach Track-/Playerwechsel erneut erzwingen">Rate fixieren</button>
        <button class="btn grow" data-act="tap" data-el="tap" title="Im Takt klicken, um die BPM manuell zu setzen">Tap</button>
      </div>

      <div class="note" data-el="note"></div>
    </div>
  </div>`;

  const ui = {
    host: null, root: null, el: {}, handlers: {}, mounted: false, minimized: false,
    tapTimes: [],

    mount(handlers) {
      ui.handlers = handlers;
      if (ui.mounted) return;
      const host = document.createElement("div");
      host.id = "bpmx-host";
      const root = host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = STYLE;
      root.append(style);
      const wrap = document.createElement("div");
      wrap.innerHTML = HTML;
      root.append(wrap.firstElementChild);
      (document.body || document.documentElement).append(host);

      ui.host = host;
      ui.root = root;
      ui.panel = root.querySelector(".panel");
      for (const n of root.querySelectorAll("[data-el]")) ui.el[n.dataset.el] = n;
      ui.bodyEl = root.querySelector(".body");

      ui._position();
      ui._bind();
      ui.mounted = true;
      if (NS.settings.minimized) ui.setMinimized(true);
    },

    _position() {
      const p = NS.settings.panelPos;
      const panel = ui.panel;
      if (p && typeof p.left === "number") {
        panel.style.left = NS.clamp(p.left, 0, Math.max(0, innerWidth - 60)) + "px";
        panel.style.top = NS.clamp(p.top, 0, Math.max(0, innerHeight - 40)) + "px";
      } else {
        panel.style.right = "18px";
        panel.style.top = "84px";
      }
    },

    _bind() {
      const root = ui.root;
      const h = ui.handlers;

      // Seiten wie YouTube reagieren auf Tastendruecke - im Panel abfangen.
      for (const ev of ["keydown", "keyup", "keypress"]) {
        ui.panel.addEventListener(ev, (e) => e.stopPropagation(), true);
      }
      ui.panel.addEventListener("mousedown", (e) => e.stopPropagation(), true);
      ui.panel.addEventListener("wheel", (e) => e.stopPropagation(), true);

      root.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === "close") return h.onClose && h.onClose();
        if (act === "min") return ui.setMinimized(!ui.minimized);
        if (act === "toggle") return h.onToggle && h.onToggle();
        if (act === "reset") { ui.tapTimes = []; return h.onReset && h.onReset(); }
        if (act === "pitch") return h.onTogglePitch && h.onTogglePitch();
        if (act === "lock") return h.onToggleLock && h.onToggleLock();
        if (act === "tap") return ui._tap();
        if (act === "bpm-") return h.onNudgeBpm && h.onNudgeBpm(-1);
        if (act === "bpm+") return h.onNudgeBpm && h.onNudgeBpm(1);
        if (act === "half") return h.onSetRate && h.onSetRate(0.5);
        if (act === "double") return h.onSetRate && h.onSetRate(2);
        if (act === "minus5") return h.onScaleRate && h.onScaleRate(0.95);
        if (act === "plus5") return h.onScaleRate && h.onScaleRate(1.05);
      });

      ui.el.rateSlider.addEventListener("input", (e) => {
        h.onSetRate && h.onSetRate(parseFloat(e.target.value));
      });
      ui.el.target.addEventListener("change", (e) => {
        const v = parseFloat(e.target.value);
        if (isFinite(v) && v > 0) h.onSetTargetBpm && h.onSetTargetBpm(v);
      });
      ui.el.mode.addEventListener("change", (e) => h.onSetMode && h.onSetMode(e.target.value));

      ui._drag();
      addEventListener("resize", () => ui._position(), { passive: true });
    },

    _drag() {
      const head = ui.root.querySelector(".head");
      let sx = 0, sy = 0, ox = 0, oy = 0, on = false;
      const move = (e) => {
        if (!on) return;
        const left = NS.clamp(ox + e.clientX - sx, 0, innerWidth - ui.panel.offsetWidth);
        const top = NS.clamp(oy + e.clientY - sy, 0, innerHeight - 32);
        ui.panel.style.left = left + "px";
        ui.panel.style.top = top + "px";
        ui.panel.style.right = "auto";
      };
      const up = () => {
        if (!on) return;
        on = false;
        head.classList.remove("drag");
        removeEventListener("mousemove", move, true);
        removeEventListener("mouseup", up, true);
        NS.saveSettings({ panelPos: { left: ui.panel.offsetLeft, top: ui.panel.offsetTop } });
      };
      head.addEventListener("mousedown", (e) => {
        if (e.target.closest("button")) return;
        const r = ui.panel.getBoundingClientRect();
        on = true; sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
        head.classList.add("drag");
        addEventListener("mousemove", move, true);
        addEventListener("mouseup", up, true);
        e.preventDefault();
      });
    },

    _tap() {
      const now = performance.now();
      if (ui.tapTimes.length && now - ui.tapTimes[ui.tapTimes.length - 1] > 2500) ui.tapTimes = [];
      ui.tapTimes.push(now);
      if (ui.tapTimes.length > 8) ui.tapTimes.shift();
      if (ui.tapTimes.length < 2) { ui.el.tap.textContent = "Tap …"; return; }
      const first = ui.tapTimes[0], last = ui.tapTimes[ui.tapTimes.length - 1];
      const bpm = 60000 / ((last - first) / (ui.tapTimes.length - 1));
      ui.el.tap.textContent = "Tap " + NS.round1(bpm);
      ui.handlers.onTapBpm && ui.handlers.onTapBpm(bpm);
    },

    setMinimized(min) {
      ui.minimized = min;
      ui.bodyEl.classList.toggle("hidden", min);
      NS.saveSettings({ minimized: min });
    },

    render(s) {
      if (!ui.mounted) return;
      const e = ui.el;
      // Angezeigt wird, was gerade zu hoeren ist: Referenz x Rate. Solange die
      // Referenz nicht fixiert ist, ist das exakt der Messwert - nur ruhiger.
      const shown = s.base > 0 ? NS.round1(s.base * s.rate) : (s.detected > 0 ? NS.round1(s.detected) : null);
      e.bpm.textContent = shown != null ? shown.toFixed(1) : "--";
      e.bpm.classList.toggle("dim", shown == null);
      e.conf.style.width = Math.round((s.confidence || 0) * 100) + "%";
      ui.root.querySelector(".dot").classList.toggle("on", !!s.active);

      e.toggle.textContent = s.active ? "Messung stoppen" : "Messung starten";
      e.toggle.classList.toggle("primary", !s.active);
      e.mode.value = s.mode;

      e.rate.textContent = s.rate.toFixed(2) + "×";
      e.rateSlider.value = String(NS.clamp(s.rate, 0.5, 2));
      if (document.activeElement !== ui.host) {
        const t = s.base > 0 ? NS.round1(s.base * s.rate) : "";
        if (e.target.value !== String(t)) e.target.value = t === "" ? "" : String(t);
      }
      e.target.disabled = !(s.base > 0);

      e.pitch.classList.toggle("on", s.preservePitch);
      e.pitch.textContent = s.preservePitch ? "Tonhöhe hält" : "Tonhöhe frei";
      e.lock.classList.toggle("on", s.lockRate);

      let status = "", cls = "";
      if (s.error) { status = s.error; cls = "err"; }
      else if (!s.active) status = "Messung aus";
      else if (s.silent) { status = "kein Ton erkannt"; cls = "warn"; }
      else if (!s.ready) status = "höre zu …";
      else status = s.base > 0 ? "Original " + NS.round1(s.base) : "";
      e.status.className = "status " + cls;
      e.status.textContent = status;

      const notes = [];
      if (!s.hasMedia) notes.push("Kein <audio>/<video> in diesem Frame – Tempo lässt sich erst ändern, wenn ein Player läuft.");
      if (s.baseLocked) notes.push("Referenz-BPM fixiert (Reset löst sie wieder).");
      if (s.mode === "element" && !s.webAudioSafe) notes.push("Element-Modus hier riskant (CORS) – Tab-Audio nutzen.");
      e.note.innerHTML = notes.map((n) => `<div>${n}</div>`).join("");
    },

    destroy() {
      if (ui.host) ui.host.remove();
      ui.host = null; ui.mounted = false; ui.el = {};
    }
  };

  NS.ui = ui;
})();
