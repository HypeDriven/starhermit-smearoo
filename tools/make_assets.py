#!/usr/bin/env python3
"""Make Smearoo's original artwork and PCM sound palette."""
from array import array
from math import exp, sin, tau
from pathlib import Path
from random import Random
from subprocess import run
import argparse
import sys
import wave

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SFX = ROOT / "sfx"
RATE = 24_000
INK = "#302345"
COLORS = ["#f74d6c", "#ff9742", "#ffd33e", "#48c485", "#419cf6", "#9b71f0"]
rng = Random(1806)


def eyes(draw, x, y, scale):
    for off in (-0.16, 0.16):
        draw.ellipse((x + (off - .042)*scale, y - .055*scale,
                      x + (off + .042)*scale, y + .055*scale), fill=INK)
    draw.arc((x - .105*scale, y - .015*scale, x + .105*scale, y + .17*scale),
             10, 170, fill=INK, width=max(2, int(scale * .033)))


def art(cover_source):
    grain = Image.new("RGB", (256, 192))
    grain.putdata([(248+n, 244+n, 235+n) for n in (rng.randrange(0, 8) for _ in range(256*192))])
    grain.save(ASSETS / "grain.png")

    if cover_source:
        image = Image.open(cover_source).convert("RGB")
    else:
        image = Image.new("RGB", (1200, 675), "#eee3fb")
        d = ImageDraw.Draw(image)
        d.ellipse((-176, 285, 805, 915), fill="#f6dcee")
        d.ellipse((744, -340, 1478, 448), fill="#e5d2fb")
        paper = [(448, 166), (1107, 103), (1150, 556), (487, 619)]
        d.polygon([(x+7, y+17) for x, y in paper], fill="#c7b4df")
        d.polygon(paper, fill="#fffbef")
        d.line([(490, 535), (581, 483), (674, 496), (807, 426), (948, 435), (1093, 361)],
               fill="#ffe48a", width=68, joint="curve")
        for x, y, color, scale in [(622, 312, COLORS[0], 167), (818, 259, COLORS[4], 148),
                                   (962, 430, COLORS[3], 141)]:
            s = scale
            d.ellipse((x-s*.5, y-s*.45, x+s*.5, y+s*.45), fill=color)
            d.ellipse((x-s*.52, y-s*.21, x-s*.13, y+s*.26), fill=color)
            d.ellipse((x+s*.25, y-s*.55, x+s*.55, y-s*.25), fill=color)
            d.ellipse((x-s*.56, y-s*.52, x-s*.40, y-s*.36), fill=color)
            d.ellipse((x+s*.48, y+s*.27, x+s*.60, y+s*.39), fill=color)
            d.arc((x-s*.37, y-s*.34, x+s*.30, y+s*.30), 204, 260, fill="#fff3d8", width=7)
            eyes(d, x, y, s)
    d = ImageDraw.Draw(image)
    font = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    d.text((54, 279), "Smearoo", fill=INK, font=ImageFont.truetype(font, 83),
           stroke_width=5, stroke_fill="#fff5e8")
    for n, color in enumerate(COLORS):
        x = 66 + n * 59
        y = 405 + (n % 2) * 11
        d.ellipse((x, y, x+34, y+22), fill=color)
        d.ellipse((x+5, y+5, x+14, y+9), fill="#fff3d8")
    if cover_source or not (ASSETS / "coverart.png").exists():
        image.save(ASSETS / "coverart.png", optimize=True)
        image.save(ASSETS / "cover.jpg", quality=91, optimize=True)

    icon = Image.new("RGBA", (256, 256))
    d = ImageDraw.Draw(icon)
    d.rounded_rectangle((4, 4, 252, 252), 55, fill="#eee3fb")
    d.ellipse((45, 57, 208, 218), fill="#ffbc52")
    d.ellipse((163, 41, 222, 101), fill="#ffbc52")
    d.ellipse((39, 43, 71, 75), fill="#ffbc52")
    eyes(d, 127, 132, 144)
    icon.save(ASSETS / "icon.png")
    icon.resize((64, 64), Image.Resampling.LANCZOS).save(ROOT / "favicon.png")

    cursor = Image.new("RGBA", (128, 128))
    d = ImageDraw.Draw(cursor)
    d.line([(53, 68), (111, 111)], fill=INK, width=31)
    d.line([(53, 66), (111, 109)], fill="#ffe178", width=18)
    d.ellipse((17, 16, 76, 78), fill=INK)
    d.ellipse((24, 22, 68, 73), fill="#f74d6c")
    d.arc((30, 29, 61, 64), 180, 268, fill="#fff4ec", width=5)
    cursor = cursor.resize((32, 32), Image.Resampling.LANCZOS)
    (ASSETS / "cursor.rgba").write_bytes(cursor.tobytes())


def wav(path, data):
    with wave.open(str(path), "wb") as output:
        output.setparams((1, 2, RATE, 0, "NONE", ""))
        pcm = array("h", (int(max(-1, min(1, sample)) * 32767) for sample in data))
        if sys.byteorder != "little":
            pcm.byteswap()
        output.writeframes(pcm.tobytes())


def effects():
    specs = {
        "dip": (.23, 255, 132, .09, .25),
        "plop": (.29, 164, -104, .14, .54),
        "smear": (.22, 112, -44, .48, .12),
        "flick": (.27, 490, -271, .29, .28),
        "gallery": (.85, 475, 180, .008, .34),
        "paper": (.42, 103, 205, .66, .11),
        "menu": (.16, 510, -98, .025, .35),
    }
    for name, (duration, base, sweep, noise, pitch) in specs.items():
        path = SFX / f"{name}.wav"
        if path.exists():
            continue
        data = []
        last = 0
        for i in range(int(duration * RATE)):
            t = i / RATE
            frac = t / duration
            val = sin(tau * (base*t + sweep*t*frac*.5)) * pitch
            val += sin(tau * (base*1.51*t + sweep*t*frac*.22)) * pitch * .31
            last = last * .72 + rng.uniform(-1, 1) * .28
            val += last * noise * (0.76 + .24 * sin(tau * t * 37))
            envelope = min(1, t / .009) * exp(-3.7 * frac) * min(1, (1-frac)*12)
            data.append(val * envelope)
        wav(path, data)


def music():
    # Four soft chords under a sparse mallet melody. All notes wrap into the loop.
    length = 16
    data = [0.0] * (length * RATE)

    def note(start, midi, gain, decay):
        hz = 440 * 2 ** ((midi - 69) / 12)
        offset = round(start * RATE)
        for i in range(int(decay * 5 * RATE)):
            t = i / RATE
            sample = sin(tau*hz*t) + .24*sin(tau*hz*2*t)*exp(-4*t)
            data[(offset+i) % len(data)] += sample * gain * min(1, t/.023) * exp(-t/decay)

    for bar, (bass, chord, melody) in enumerate([
        (48, (60, 64, 67), (76, 79, 81, 79, 76)),
        (45, (57, 60, 64), (72, 76, 79, 76, 74)),
        (41, (57, 60, 65), (69, 72, 77, 76, 72)),
        (43, (59, 62, 67), (71, 74, 79, 74, 71)),
    ]):
        start = 4 * bar
        note(start, bass, .15, .48)
        for delay, tone in zip((0.35, 1.06, 2.25), chord):
            note(start+delay, tone, .12, .43)
        for delay, tone in zip((0, .65, 1.55, 2.6, 3.28), melody):
            note(start+delay, tone, .17, .31)
    tmp = ASSETS / "music.tmp.wav"
    wav(tmp, data)
    run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(tmp), "-c:a", "libvorbis",
         "-q:a", "4", str(ASSETS / "music.ogg")], check=True)
    tmp.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cover", type=Path, help="use a generated background for the cover")
    parser.add_argument("--art-only", action="store_true")
    args = parser.parse_args()
    art(args.cover)
    if not args.art_only:
        effects()
        music()
