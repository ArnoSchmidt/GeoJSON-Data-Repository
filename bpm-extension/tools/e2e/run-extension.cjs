/**
 * Integrationstest der geladenen Extension in echtem Chromium:
 * Manifest laedt, Service Worker laeuft, Content-Script ist in allen Frames,
 * das Panel montiert und Tempoaenderungen erreichen auch das iframe.
 *
 *   npm i -g playwright   # einmalig
 *   node tools/e2e/run-extension.cjs
 */
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const here = __dirname;
const ext = path.join(here, "..", "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bpm-ext-"));
const wav = path.join(tmp, "click128.wav");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".wav": "audio/wav" };
const checks = [];
const check = (name, ok, extra = "") => {
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`);
};

(async () => {
  execFileSync("python3", [path.join(here, "make-clicktrack.py"), wav]);

  const server = http.createServer((req, res) => {
    const name = req.url.split("?")[0].replace(/^\//, "") || "page-media.html";
    const file = name === "click128.wav" ? wav : path.join(here, name);
    if (!file.startsWith(here) && file !== wav) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end("nope"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  }).listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/`;

  const { chromium } = require("playwright");
  const context = await chromium.launchPersistentContext(path.join(tmp, "profile"), {
    headless: false,
    args: [
      "--headless=new",
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`
    ]
  });

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15000 });
  check("Service Worker der Extension laeuft", !!sw, sw.url().split("/").slice(-2).join("/"));

  const page = await context.newPage();
  await page.goto(base + "page-media.html");
  await page.waitForTimeout(1200);

  // Ohne "tabs"-Berechtigung filtert query() nicht nach URL - der Testtab ist der aktive.
  const pong = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const res = await chrome.tabs.sendMessage(tab.id, { t: "ping" }, { frameId: 0 });
    return { tabId: tab.id, res };
  });
  check("Content-Script antwortet im Top-Frame", !!(pong.res && pong.res.ok && pong.res.top));

  const shown = await sw.evaluate(
    (tabId) => chrome.tabs.sendMessage(tabId, { t: "showPanel" }, { frameId: 0 }),
    pong.tabId
  );
  check("Panel laesst sich per Nachricht oeffnen", !!(shown && shown.ok));
  check("Panel ist im DOM", await page.locator("#bpmx-host").count() === 1);
  check("BPM-Anzeige sichtbar", await page.locator('[data-el="bpm"]').isVisible());

  const rates = () => page.evaluate(() => ({
    top: document.getElementById("top").playbackRate,
    pitch: document.getElementById("top").preservesPitch
  }));
  const frameRate = () => page.frames()[1].evaluate(() => ({
    rate: document.getElementById("inner").playbackRate,
    pitch: document.getElementById("inner").preservesPitch
  }));

  await page.locator('[data-act="plus5"]').click();
  await page.waitForTimeout(600);
  let r = await rates(), f = await frameRate();
  check("+5 % aendert die Rate im Top-Frame", Math.abs(r.top - 1.05) < 1e-3, `rate=${r.top}`);
  check("+5 % erreicht auch das iframe", Math.abs(f.rate - 1.05) < 1e-3, `rate=${f.rate}`);

  await page.locator('[data-act="half"]').click();
  await page.waitForTimeout(600);
  r = await rates(); f = await frameRate();
  check("0.5x setzt beide Frames", Math.abs(r.top - 0.5) < 1e-3 && Math.abs(f.rate - 0.5) < 1e-3, `top=${r.top} frame=${f.rate}`);

  await page.locator('[data-act="pitch"]').click();
  await page.waitForTimeout(600);
  r = await rates(); f = await frameRate();
  check("Tonhoehen-Schalter wirkt in beiden Frames", r.pitch === false && f.pitch === false, `top=${r.pitch} frame=${f.pitch}`);

  await page.locator('[data-act="reset"]').click();
  await page.waitForTimeout(600);
  r = await rates(); f = await frameRate();
  check("Reset stellt 1.0x wieder her", Math.abs(r.top - 1) < 1e-3 && Math.abs(f.rate - 1) < 1e-3, `top=${r.top} frame=${f.rate}`);

  // Tempo, das der Player selbst setzt, wird uebernommen (Rate nicht fixiert)
  await page.evaluate(() => { document.getElementById("top").playbackRate = 1.4; });
  await page.waitForTimeout(800);
  const state = await sw.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { t: "getState" }, { frameId: 0 }), pong.tabId);
  check("Externe Ratenaenderung wird uebernommen", Math.abs(state.state.rate - 1.4) < 1e-3, `state.rate=${state.state.rate}`);

  // "Rate fixieren": von der Seite gesetzte Raten werden zurueckgesetzt
  await page.locator('[data-act="lock"]').click();
  await page.locator('[data-act="half"]').click();
  await page.waitForTimeout(400);
  await page.evaluate(() => { document.getElementById("top").playbackRate = 1; });
  await page.waitForTimeout(600);
  r = await rates();
  check("Fixierte Rate wird wiederhergestellt", Math.abs(r.top - 0.5) < 1e-3, `rate=${r.top}`);

  await page.locator('[data-act="lock"]').click();
  await page.waitForTimeout(300);
  await page.evaluate(() => { document.getElementById("top").playbackRate = 1; });
  await page.waitForTimeout(600);
  r = await rates();
  check("Ohne Fixierung bleibt die Rate der Seite stehen", Math.abs(r.top - 1) < 1e-3, `rate=${r.top}`);

  await page.locator('[data-act="close"]').click();
  await page.waitForTimeout(400);
  check("Panel laesst sich schliessen", await page.locator("#bpmx-host").count() === 0);

  await context.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  const fail = checks.filter((c) => !c).length;
  console.log(fail ? `\n${fail} von ${checks.length} Pruefungen fehlgeschlagen` : `\nalle ${checks.length} Pruefungen bestanden`);
  process.exit(fail ? 1 : 0);
})();
