/**
 * Prueft den Tempo-Schaetzer (Autokorrelation + Harmonische + Prior) gegen
 * synthetische Onset-Huellkurven mit bekanntem Tempo.
 *   node tools/test-tempo.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
globalThis.__BPMX = { clamp: (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v) };
new Function(fs.readFileSync(path.join(dir, "../src/content/analyzer.js"), "utf8"))();
const { Analyzer } = globalThis.__BPMX;

const FS = 48000 / 512; // wie im Analyzer: ein Huellkurvenwert je 512 Samples

function synth(bpm, seconds, { offbeats = 0.5, noise = 0.15, jitter = 0.004, seed = 7 } = {}) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const n = Math.round(seconds * FS);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = noise * rnd();
  const beat = 60 / bpm;
  let k = 0;
  for (let t = 0.2; t < seconds; t += beat / 2, k++) {
    const onBeat = k % 2 === 0;
    const amp = onBeat ? (k % 8 === 0 ? 1.3 : 1.0) : offbeats;
    const tt = t + (rnd() - 0.5) * jitter;
    const idx = Math.round(tt * FS);
    // kurzer Anstieg/Abfall wie bei echten Onsets
    for (let d = -1; d <= 2; d++) {
      const j = idx + d;
      if (j >= 0 && j < n) x[j] += amp * (d < 0 ? 0.3 : d === 0 ? 1 : d === 1 ? 0.6 : 0.25);
    }
  }
  return x;
}

const cases = [
  { bpm: 70 }, { bpm: 85 }, { bpm: 98 }, { bpm: 110 }, { bpm: 120 },
  { bpm: 128 }, { bpm: 140 }, { bpm: 150 }, { bpm: 174 }, { bpm: 186 },
  { bpm: 128, opts: { offbeats: 0.9 }, label: "dichte Achtel" },
  { bpm: 100, opts: { noise: 0.6 }, label: "verrauscht" },
  { bpm: 145, opts: { offbeats: 0, jitter: 0.02 }, label: "nur Viertel, ungenau" }
];

let fail = 0;

// Negativkontrolle: strukturloses Rauschen darf keine hohe Konfidenz liefern.
{
  let seed = 99;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const noise = new Float32Array(Math.round(10 * FS));
  for (let i = 0; i < noise.length; i++) noise[i] = rnd();
  const r = Analyzer.estimateTempo(Analyzer.enhance(noise, FS), FS);
  const ok = r.confidence < 0.5;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  Rauschen ohne Takt -> Konfidenz ${r.confidence.toFixed(2)} (soll < 0.50)`);
}

for (const c of cases) {
  const env = Analyzer.enhance(synth(c.bpm, 10, c.opts), FS);
  const r = Analyzer.estimateTempo(env, FS);
  const err = Math.abs(r.bpm - c.bpm) / c.bpm * 100;
  const ok = err < 2.0;
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  soll ${String(c.bpm).padStart(3)} BPM  ->  ${r.bpm.toFixed(1).padStart(6)} BPM` +
    `  (${err.toFixed(2)} % Abweichung, Konfidenz ${r.confidence.toFixed(2)}, z ${r.z.toFixed(1)})` +
    (c.label ? `  [${c.label}]` : "")
  );
}
const total = cases.length + 1;
console.log(fail ? `\n${fail} von ${total} Faellen fehlgeschlagen` : `\nalle ${total} Faelle bestanden`);
process.exit(fail ? 1 : 0);
