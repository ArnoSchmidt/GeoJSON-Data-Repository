/**
 * End-to-End-Test der Erkennung im echten Chromium:
 * spielt einen 128-BPM-Click-Track in einem <audio>-Element ab, laesst den
 * echten Analyzer (Web Audio) mithoeren und prueft die gemeldeten BPM -
 * auch bei veraenderter Abspielrate.
 *
 *   npm i -g playwright   # einmalig
 *   node tools/e2e/run-e2e.cjs
 */
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const here = __dirname;
const root = path.join(here, "..", "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bpm-e2e-"));

const FILES = {
  "/page.html": path.join(here, "page.html"),
  "/common.js": path.join(root, "src/content/common.js"),
  "/analyzer.js": path.join(root, "src/content/analyzer.js"),
  "/click128.wav": path.join(tmp, "click128.wav")
};
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".wav": "audio/wav" };

// Testfaelle: Rate, Pitch-Erhalt, erlaubte Abweichung, Oktavfehler erlaubt?
const CASES = [
  { rate: 0.7, pitch: true, tol: 2 },
  { rate: 0.8, pitch: true, tol: 2 },
  { rate: 0.9, pitch: true, tol: 2 },
  { rate: 1.0, pitch: true, tol: 2 },
  { rate: 1.0, pitch: false, tol: 2 },
  { rate: 1.1, pitch: true, tol: 2 },
  { rate: 1.25, pitch: true, tol: 2 }
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log("Click-Track erzeugen …");
  execFileSync("python3", [path.join(here, "make-clicktrack.py"), FILES["/click128.wav"]]);

  const server = http.createServer((req, res) => {
    const file = FILES[req.url.split("?")[0]];
    if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end("nope"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  }).listen(0);
  await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${server.address().port}/page.html`;

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

  let fail = 0;
  for (const c of CASES) {
    await page.goto(url);
    await page.evaluate(([r, p]) => window.__start(r, p), [c.rate, c.pitch]);
    await wait(12000);   // Analysefenster fuellen
    const st = await page.evaluate(() => window.__stat());
    const expected = 128 * c.rate;
    const err = Math.abs(st.median - expected) / expected * 100;
    const ok = err < c.tol;
    if (!ok) fail++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  Rate ${c.rate.toFixed(2)} (Pitch ${c.pitch ? "gehalten" : "frei"})` +
      `  erwartet ${expected.toFixed(1)}  gemessen ${st.median.toFixed(1)} BPM` +
      `  (${err.toFixed(1)} %, Konfidenz ${st.confidence.toFixed(2)})`
    );
  }

  await browser.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fail ? `\n${fail} von ${CASES.length} Faellen fehlgeschlagen` : `\nalle ${CASES.length} Faelle bestanden`);
  process.exit(fail ? 1 : 0);
})();
