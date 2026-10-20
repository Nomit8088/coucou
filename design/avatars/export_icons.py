"""Export the DeepSeek whale-girl avatar as a portable, multi-platform icon bundle.

The vector master is ``blue-maid.svg``; every other file is derived from it here,
so the bundle can be regenerated at any time and stays in sync with the drawing.

    python design/avatars/export_icons.py

Steps:
  1. render the SVG at 1024 px on a black and on a white background (headless
     Chrome), which gives exact alpha by difference matting — no magic wand;
  2. rebuild a transparent RGBA master PNG from the two renders;
  3. downscale that master into every size and container mainstream toolchains
     want (Windows .ico, macOS .icns, web, Android, iOS).

Requires: Pillow, and Chrome/Edge for the two renders.
"""

from __future__ import annotations

import os
import platform
import struct
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SVG = HERE / "blue-maid.svg"
BUNDLE = HERE / "bundle"
MASTER = 1024

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
]


def find_browser() -> str:
    for path in CHROME_CANDIDATES:
        if os.path.exists(path):
            return path
    raise SystemExit("No Chrome/Edge found — install one, or adapt CHROME_CANDIDATES.")


def render(browser: str, background: str, out: Path) -> None:
    """Screenshot the SVG, centred and scaled to MASTER×MASTER, on a solid fill.

    The page, not the SVG, carries the size: the drawing's own width is 768 so
    loading it directly would crop it. ``--default-background-color`` fills
    whatever the drawing does not cover, which is what makes matting exact.
    """
    out.parent.mkdir(parents=True, exist_ok=True)
    page = out.with_suffix(".html")
    # No background of its own: the fill has to come from
    # --default-background-color, otherwise both renders would share one colour.
    page.write_text(
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        f"<style>html,body{{margin:0;padding:0;overflow:hidden;"
        f"width:{MASTER}px;height:{MASTER}px;background:transparent}}"
        f"img{{width:{MASTER}px;height:{MASTER}px;display:block}}</style></head>"
        f"<body><img src='{SVG.as_uri()}'></body></html>",
        encoding="utf-8",
    )

    args = [
        browser,
        "--headless",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--hide-scrollbars",
        f"--default-background-color={background}",
        f"--screenshot={out}",
        f"--window-size={MASTER},{MASTER}",
        "--force-device-scale-factor=1",
        page.as_uri(),
    ]

    if platform.system() == "Windows":
        # A direct spawn of Chrome from this process can silently hand the URL
        # to an already-running browser and write nothing; Start-Process waits
        # for the headless run itself. Arguments go as a PowerShell array so
        # spaces in paths need no hand-rolled quoting.
        array = ",".join("'" + a.replace("'", "''") + "'" for a in args[1:])
        subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             f"Start-Process -FilePath '{browser}' -Wait -NoNewWindow "
             f"-ArgumentList @({array})"],
            capture_output=True,
            text=True,
            timeout=180,
        )
    else:
        subprocess.run(args, capture_output=True, text=True, timeout=180)

    page.unlink(missing_ok=True)
    if not out.exists():
        raise SystemExit(f"rendering failed for background {background}")


def matte(black: Path, white: Path) -> Image.Image:
    """Difference matting: alpha from the two backgrounds, colour unmixed.

    A pixel at coverage ``a`` reads ``a·C`` over black and ``a·C + (1-a)·255``
    over white, so ``255 - (white - black)`` is ``a·255``.
    """
    b = Image.open(black).convert("RGB")
    w = Image.open(white).convert("RGB")
    width, height = b.size
    bd, wd = b.tobytes(), w.tobytes()
    out = bytearray(width * height * 4)

    for i in range(width * height):
        rgb = i * 3
        br, bg, bb = bd[rgb], bd[rgb + 1], bd[rgb + 2]
        wr, wg, wb = wd[rgb], wd[rgb + 1], wd[rgb + 2]
        alpha = 1.0 - (((wr - br) + (wg - bg) + (wb - bb)) / 3.0) / 255.0
        alpha = min(1.0, max(0.0, alpha))
        rgba = i * 4
        if alpha > 0.005:
            inv = 1.0 / alpha
            out[rgba] = min(255, max(0, round(br * inv)))
            out[rgba + 1] = min(255, max(0, round(bg * inv)))
            out[rgba + 2] = min(255, max(0, round(bb * inv)))
            out[rgba + 3] = round(alpha * 255)
    return Image.frombytes("RGBA", (width, height), bytes(out))


def scaled(master: Image.Image, size: int) -> Image.Image:
    return master.resize((size, size), Image.LANCZOS)


def write_icns(master: Image.Image, path: Path) -> None:
    """PNG-backed .icns, the representation modern macOS apps ship."""
    kinds = {32: b"icp5", 64: b"icp6", 128: b"ic07", 256: b"ic08",
             512: b"ic09", 1024: b"ic10"}
    chunks = bytearray()
    with tempfile.TemporaryDirectory() as tmp:
        for size, kind in sorted(kinds.items()):
            png = Path(tmp) / f"{size}.png"
            scaled(master, size).save(png, format="PNG")
            data = png.read_bytes()
            chunks += kind + struct.pack(">I", len(data) + 8) + data
    path.write_bytes(b"icns" + struct.pack(">I", 8 + len(chunks)) + bytes(chunks))


PNG_SIZES = [16, 24, 32, 48, 64, 96, 128, 180, 192, 256, 384, 512, 768, 1024]

ANDROID = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}

IOS = {
    "20@1x": 20, "20@2x": 40, "20@3x": 60,
    "29@1x": 29, "29@2x": 58, "29@3x": 87,
    "40@1x": 40, "40@2x": 80, "40@3x": 120,
    "60@2x": 120, "60@3x": 180,
    "76@1x": 76, "76@2x": 152,
    "83.5@2x": 167,
    "1024@1x": 1024,
}


def main() -> None:
    browser = find_browser()
    for sub in ("png", "windows", "macos", "web", "android", "ios"):
        (BUNDLE / sub).mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        black = Path(tmp) / "black.png"
        white = Path(tmp) / "white.png"
        render(browser, "ff000000", black)
        render(browser, "ffffffff", white)
        master = matte(black, white)

    master.save(BUNDLE / f"whale-maid-{MASTER}.png", format="PNG")
    print(f"whale-maid-{MASTER}.png — master, alpha {master.getchannel('A').getextrema()}")

    for size in PNG_SIZES:
        scaled(master, size).save(BUNDLE / "png" / f"whale-maid-{size}.png", format="PNG")
    print(f"png/ — {len(PNG_SIZES)} sizes")

    scaled(master, 256).save(BUNDLE / "windows" / "icon.ico", format="ICO",
                             sizes=[(16, 16), (24, 24), (32, 32), (48, 48),
                                    (64, 64), (128, 128), (256, 256)],
                             append_images=[scaled(master, s) for s in (16, 24, 32, 48, 64, 128)])
    print("windows/icon.ico — 16…256")

    write_icns(master, BUNDLE / "macos" / "icon.icns")
    print("macos/icon.icns — 32…1024")

    scaled(master, 180).save(BUNDLE / "web" / "apple-touch-icon.png", format="PNG")
    scaled(master, 192).save(BUNDLE / "web" / "icon-192.png", format="PNG")
    scaled(master, 512).save(BUNDLE / "web" / "icon-512.png", format="PNG")
    scaled(master, 32).save(BUNDLE / "web" / "favicon.ico", format="ICO",
                            sizes=[(16, 16), (32, 32), (48, 48)],
                            append_images=[scaled(master, s) for s in (16, 48)])
    print("web/ — favicon.ico, apple-touch-icon, 192, 512")

    for density, size in ANDROID.items():
        scaled(master, size).save(BUNDLE / "android" / f"mipmap-{density}.png", format="PNG")
    scaled(master, 512).save(BUNDLE / "android" / "play-store-512.png", format="PNG")
    print(f"android/ — {len(ANDROID)} densities + play store")

    for name, size in IOS.items():
        scaled(master, size).save(BUNDLE / "ios" / f"AppIcon-{name}.png", format="PNG")
    print(f"ios/ — {len(IOS)} sizes")


if __name__ == "__main__":
    main()
