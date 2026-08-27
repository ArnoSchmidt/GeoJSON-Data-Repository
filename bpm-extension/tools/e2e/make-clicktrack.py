#!/usr/bin/env python3
"""Erzeugt einen 26 s langen Click-Track mit exakt 128 BPM (Kick + Achtel-HiHat + Pad)."""
import math, random, struct, sys, wave

SR, BPM, DUR = 44100, 128, 26

def build():
    n = SR * DUR
    buf = [0.0] * n
    beat = 60.0 / BPM
    t, k = 0.0, 0
    random.seed(4)
    while t < DUR:
        start = int(t * SR)
        accent = 1.0 if k % 4 == 0 else 0.72
        for i in range(int(0.12 * SR)):                      # Kick
            if start + i >= n: break
            env = math.exp(-i / (0.045 * SR))
            f = 110 * math.exp(-i / (0.02 * SR)) + 48
            buf[start + i] += accent * 0.85 * env * math.sin(2 * math.pi * f * i / SR)
        for off in (0.0, beat / 2):                          # HiHat auf jeder Achtel
            s2 = int((t + off) * SR)
            for i in range(int(0.02 * SR)):
                if s2 + i >= n: break
                env = math.exp(-i / (0.004 * SR))
                buf[s2 + i] += (0.22 if off else 0.3) * env * (random.random() * 2 - 1)
        t += beat; k += 1
    for i in range(n):                                       # Pad, damit es nicht nur Impulse sind
        buf[i] += 0.06 * math.sin(2 * math.pi * 220 * i / SR) * (0.5 + 0.5 * math.sin(2 * math.pi * 0.3 * i / SR))
    mx = max(abs(v) for v in buf) or 1.0
    return b"".join(struct.pack("<h", int(max(-1, min(1, v / mx * 0.9)) * 32767)) for v in buf)

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "click128.wav"
    w = wave.open(out, "w")
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(build()); w.close()
    print(out)
