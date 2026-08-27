#!/usr/bin/env python3
"""Erzeugt die Extension-Icons (schlichtes BPM-Balken-Motiv) ohne externe Abhaengigkeiten."""
import struct, zlib, os

BG = (20, 22, 28)
BARS = [((110, 168, 254), 0.42), ((53, 208, 127), 0.70), ((226, 185, 59), 0.55), ((110, 168, 254), 0.88)]

def render(size):
    px = [[BG for _ in range(size)] for _ in range(size)]
    r = size * 0.22  # abgerundete Ecken
    pad = max(1, round(size * 0.16))
    inner = size - 2 * pad
    gap = max(1, round(inner * 0.08))
    bw = (inner - gap * (len(BARS) - 1)) / len(BARS)
    for i, (color, h) in enumerate(BARS):
        x0 = pad + i * (bw + gap)
        x1 = x0 + bw
        bh = inner * h
        y1 = size - pad
        y0 = y1 - bh
        for y in range(size):
            for x in range(size):
                if x0 - 0.5 <= x <= x1 - 0.5 and y0 <= y < y1:
                    px[y][x] = color
    # Ecken transparent machen -> Alpha-Kanal
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            a = 255
            for cx, cy in ((r, r), (size - r, r), (r, size - r), (size - r, size - r)):
                dx, dy = x + .5 - cx, y + .5 - cy
                inside_quadrant = (x + .5 < r or x + .5 > size - r) and (y + .5 < r or y + .5 > size - r)
                if inside_quadrant and (dx * dx + dy * dy) ** .5 > r:
                    a = 0
            c = px[y][x]
            row += bytes((c[0], c[1], c[2], a))
        rows.append(bytes(row))
    return b"".join(rows)

def png(size, path):
    raw = render(size)
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    out = b"\x89PNG\r\n\x1a\n"
    out += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    out += chunk(b"IDAT", zlib.compress(raw, 9))
    out += chunk(b"IEND", b"")
    open(path, "wb").write(out)

if __name__ == "__main__":
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
    for s in (16, 32, 48, 128):
        png(s, os.path.join(here, f"icon{s}.png"))
        print("icons/icon%d.png" % s)
