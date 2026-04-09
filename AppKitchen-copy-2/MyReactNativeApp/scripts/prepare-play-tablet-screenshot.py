#!/usr/bin/env python3
"""
Turn any tablet/app capture into a Google Play–ready tablet screenshot.

Play Console (Tablet → 7" / 10") requires:
  - PNG or JPEG, max 8 MB each
  - Aspect ratio 16:9 OR 9:16
  - Each side between 320 and 3840 px

iPad simulators are usually ~4:3, so raw captures fail the ratio rule. This script
letterboxes/pillarboxes onto a compliant canvas (default 1920×1080, 16:9).

Capture (iOS Simulator):
  xcrun simctl io booted screenshot ~/Desktop/sheek-01.png

Then:
  python3 scripts/prepare-play-tablet-screenshot.py ~/Desktop/sheek-01.png -o store/tablet-01.png

Use the same prepared files for both "7-inch" and "10-inch" slots if you like;
Google cares about format/ratio/size, not physical tablet size per file.

Requires: pip install Pillow
"""
from __future__ import annotations

import argparse
import os
import sys

try:
    from PIL import Image
except ImportError:
    print("Install Pillow: pip install Pillow", file=sys.stderr)
    sys.exit(1)

# Sheek marketing background (matches web)
BG = (15, 23, 42)


def prepare(
    src_path: str,
    out_path: str,
    out_w: int,
    out_h: int,
    max_bytes: int,
) -> None:
    im = Image.open(src_path).convert("RGBA")
    sw, sh = im.size
    scale = min(out_w / sw, out_h / sh)
    nw = max(1, int(round(sw * scale)))
    nh = max(1, int(round(sh * scale)))
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (out_w, out_h), (*BG, 255))
    x = (out_w - nw) // 2
    y = (out_h - nh) // 2
    canvas.paste(resized, (x, y), resized)

    out_rgb = Image.new("RGB", (out_w, out_h), BG)
    out_rgb.paste(canvas, mask=canvas.split()[3])

    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
    out_rgb.save(out_path, "PNG", compress_level=9, optimize=True)

    size = os.path.getsize(out_path)
    if size > max_bytes:
        raise SystemExit(f"Output is {size} bytes; Play limit is {max_bytes} bytes. Lower resolution or use JPEG.")

    ratio = out_w / out_h
    if not (abs(ratio - 16 / 9) < 0.02 or abs(ratio - 9 / 16) < 0.02):
        print("Warning: canvas is not ~16:9 or ~9:16.", file=sys.stderr)

    print(f"Wrote {out_path} ({out_w}×{out_h}, {size // 1024} KB)")


def main() -> None:
    p = argparse.ArgumentParser(description="Letterbox screenshot to Google Play tablet spec.")
    p.add_argument("input", help="Source PNG/JPEG (e.g. from Simulator)")
    p.add_argument("-o", "--output", required=True, help="Output PNG path")
    p.add_argument(
        "--mode",
        choices=("landscape", "portrait"),
        default="landscape",
        help="16:9 landscape (default) or 9:16 portrait",
    )
    p.add_argument("--width", type=int, default=None, help="Override output width (with --height must stay 16:9 or 9:16)")
    p.add_argument("--height", type=int, default=None, help="Override output height")
    args = p.parse_args()

    if args.width is not None and args.height is not None:
        out_w, out_h = args.width, args.height
    elif args.mode == "landscape":
        out_w, out_h = 1920, 1080
    else:
        out_w, out_h = 1080, 1920

    for side, name in ((out_w, "width"), (out_h, "height")):
        if side < 320 or side > 3840:
            sys.exit(f"{name} {side} must be between 320 and 3840 px.")

    max_bytes = 8 * 1024 * 1024
    prepare(args.input, args.output, out_w, out_h, max_bytes)


if __name__ == "__main__":
    main()
