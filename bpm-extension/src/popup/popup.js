/** Popup: spiegelt den Zustand des Panels und schickt Kommandos dorthin. */
const $ = (id) => document.getElementById(id);
let tabId = null;
let state = null;
let poll = null;

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function bg(msg) {
  return chrome.runtime.sendMessage({ ...msg, tabId }).catch(() => null);
}
function toContent(payload) {
  return bg({ t: "toContent", payload });
}
function cmd(fn, value) {
  return toContent({ t: "cmd", fn, value }).then((res) => {
    if (res && res.ok && res.state) render(res.state);
    return res;
  });
}

function render(s) {
  state = s;
  const shown = s.base > 0 ? s.base * s.rate : s.detected;
  $("bpm").textContent = shown > 0 ? shown.toFixed(1) : "--";
  $("bpm").classList.toggle("dim", !(shown > 0));
  $("conf").style.width = Math.round((s.confidence || 0) * 100) + "%";
  $("dot").classList.toggle("on", !!s.active);
  $("toggle").textContent = s.active ? "Messung stoppen" : "Messung starten";
  $("toggle").classList.toggle("primary", !s.active);
  $("rate").textContent = s.rate.toFixed(2) + "×";
  $("rateSlider").value = String(Math.min(2, Math.max(0.5, s.rate)));
  $("target").disabled = !(s.base > 0);
  if (document.activeElement !== $("target")) {
    $("target").value = s.base > 0 ? (Math.round(s.base * s.rate * 10) / 10) : "";
  }
  $("pitch").classList.toggle("on", s.preservePitch);
  $("pitch").textContent = s.preservePitch ? "Tonhöhe hält" : "Tonhöhe frei";

  let cls = "status", txt;
  if (s.error) { cls += " err"; txt = s.error; }
  else if (!s.active) txt = "Messung aus";
  else if (s.silent) { cls += " warn"; txt = "kein Ton erkannt"; }
  else if (!s.ready) txt = "höre zu …";
  else txt = s.base > 0 ? "Original " + (Math.round(s.base * 10) / 10) + " BPM" : "";
  $("status").className = cls;
  $("status").textContent = txt;
}

function offline(reason) {
  $("status").className = "status err";
  $("status").textContent = reason;
  $("toggle").disabled = true;
}

async function refresh() {
  const res = await toContent({ t: "getState" });
  if (!res || !res.ok) return offline("Auf dieser Seite nicht verfügbar");
  $("toggle").disabled = false;
  render(res.state);
}

async function start() {
  await toContent({ t: "showPanel" });
  if (state && state.mode === "element") return cmd("onToggle");
  const res = await bg({ t: "startCapture" });   // Popup-Klick liefert activeTab
  if (!res || !res.ok) offline((res && res.error) || "Start fehlgeschlagen");
  await refresh();
}

document.addEventListener("DOMContentLoaded", async () => {
  const tab = await currentTab();
  if (!tab || tab.id == null) return offline("Kein aktiver Tab");
  tabId = tab.id;
  await refresh();
  poll = setInterval(refresh, 500);

  $("toggle").addEventListener("click", () => (state && state.active ? cmd("onToggle") : start()));
  $("panel").addEventListener("click", () => toContent({ t: "showPanel" }).then(refresh));
  $("reset").addEventListener("click", () => cmd("onReset"));
  $("pitch").addEventListener("click", () => cmd("onTogglePitch"));
  $("minus5").addEventListener("click", () => cmd("onScaleRate", 0.95));
  $("plus5").addEventListener("click", () => cmd("onScaleRate", 1.05));
  $("rateSlider").addEventListener("input", (e) => cmd("onSetRate", parseFloat(e.target.value)));
  $("target").addEventListener("change", (e) => {
    const v = parseFloat(e.target.value);
    if (isFinite(v) && v > 0) cmd("onSetTargetBpm", v);
  });
});

addEventListener("unload", () => poll && clearInterval(poll));
