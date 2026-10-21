#!/usr/bin/env python3
"""Generate a small geometric PNG fixture with no person or private data."""

import struct
import zlib
from pathlib import Path

SIZE = 512


def chunk(kind, payload):
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(
        ">I", zlib.crc32(kind + payload) & 0xFFFFFFFF
    )


rows = []
for y in range(SIZE):
    row = bytearray([0])
    for x in range(SIZE):
        border = x < 24 or x >= SIZE - 24 or y < 24 or y >= SIZE - 24
        diagonal_gap = ((x + y // 2) % 58) < 17
        square = 170 < x < 342 and 170 < y < 342
        disk = (x - 256) ** 2 + (y - 256) ** 2 < 54 ** 2
        dark = border or (not diagonal_gap and not square) or disk
        row.extend((32, 49, 57) if dark else (245, 243, 235))
    rows.append(bytes(row))

raw = b"".join(rows)
png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
Path(__file__).with_name("synthetic-panel.png").write_bytes(png)
