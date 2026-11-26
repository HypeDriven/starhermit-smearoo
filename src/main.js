import { files, frame, onStart, onRender, onFocus, onFixedUpdate, openMenu, quit, setFixedRate, setReady, strings } from "starhermit:engine";
import { loadClip, play } from "starhermit:audio";
import { OffscreenCanvas, ImageData, createImageBitmap } from "starhermit:canvas";
import { onAction, onPointerButton, onPointerMove, onTouch, setCursor } from "starhermit:input";
import * as draw from "starhermit:draw";
import { keys, translations } from "./words.js";

const colors = ["#f74d6c", "#ff9742", "#ffd33e", "#48c485", "#419cf6", "#9b71f0"];
const shades = ["#b92e59", "#c96032", "#da9825", "#268c67", "#2a66bc", "#6947b8"];
const ink = "#302345";
const tile = 48;
const columns = 16;
const rows = 12;
const width = columns * tile;
const height = rows * tile;
const paper = new OffscreenCanvas(width, height);
const context = paper.getContext("2d");
const pixelTile = new ImageData(tile, tile);
const sound = {};
const contacts = new Map();
const box = (x, y, width, height) => ({ x, y, width, height });
const hit = (r, x, y) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const t = (key) => strings.t(key);
const now = () => frame().time;

let wasm, pixels, cursor, grain, layout, music;
let loaded = 0, total = 1, failed = false, ready = false;
let selected = 0, marked = false, paintChanged = false, panel = "", muted = false;
let swap = -10, rapid = false, lastSquish = -10, lastTouch = -10, lastFlick = -10;
let focus = true;
let pointerX = -1, pointerY = -1;
let cursorOnPaper = false;
let touchX = -1, touchY = -1;
const audioPaths = {
  dip: "sfx/dip.wav", plop: "sfx/plop.wav", smear: "sfx/smear.wav",
  flick: "sfx/flick.wav", gallery: "sfx/gallery.wav", paper: "sfx/paper.wav",
  menu: "sfx/menu.wav", music: "assets/music.ogg",
};

function audio(event, gain, pitch = 1, pan = 0) {
  if (!muted && sound[event]) play(sound[event], { gain, pitch, pan });
}
function startMusic() {
  if (!music && !muted && sound.music) music = play(sound.music, { gain: 0.26, loop: true, bus: "music" });
}

onStart(() => {
  setFixedRate(60);
  const tables = {};
  for (const locale of Object.keys(translations)) {
    tables[locale] = {};
    keys.forEach((key, index) => { tables[locale][key] = translations[locale][index]; });
  }
  for (const [alias, locale] of Object.entries({
    en: "en-US", es: "es-419", de: "de-DE", fr: "fr-FR", pt: "pt-BR", it: "it-IT",
    zh: "zh-CN", hi: "hi-IN", bn: "bn-BD", ru: "ru-RU", ja: "ja-JP", ur: "ur-PK",
  })) tables[alias] = tables[locale];
  strings.load(tables);
  setReady(false, { label: t("loading") });
  const tasks = [
    files.readBytesAsync("assets/paint.wasm").then((bytes) => WebAssembly.instantiate(bytes))
      .then(({ instance }) => {
        wasm = instance.exports;
        const address = wasm.pixels();
        pixels = new Uint8Array(wasm.memory.buffer, address, tile * tile * 4);
      }),
    createImageBitmap("assets/grain.png").then((image) => { grain = image; }),
    files.readBytesAsync("assets/cursor.rgba").then((data) => {
      cursor = { image: { data, width: 32, height: 32 }, hotspot: [10, 8], fallback: "crosshair" };
    }),
  ];
  for (const event of Object.keys(audioPaths)) {
    tasks.push(loadClip(audioPaths[event]).then((clip) => { sound[event] = clip; }));
  }
  total = tasks.length;
  Promise.all(tasks.map((task) => task.then(() => { loaded++; }))).then(() => {
    ready = true;
    wasm.activity();
    setReady(true);
  }).catch((error) => {
    failed = true;
    setReady(true);
    console.error(String(error));
  });
});

function getLayout(w, h, insets, key) {
  const usableWidth = w - insets.left - insets.right;
  const usableHeight = h - insets.top - insets.bottom;
  const unit = Math.min(usableWidth / 390, usableHeight / 420, Math.max(0.75, Math.min(usableWidth, usableHeight) / 600));
  const u = unit;
  const margin = 22 * u;
  const left = insets.left + margin;
  const top = insets.top + 78 * u;
  const bottom = h - insets.bottom;
  const compact = usableWidth < usableHeight * 1.1;
  const trayWidth = (compact ? 68 : 155) * u;
  const roomWidth = usableWidth - margin * 2 - trayWidth - 18 * u;
  const roomHeight = bottom - top - 46 * u;
  const trayHeight = Math.min(roomHeight, (compact ? 465 : 294) * u);
  const tray = box(left, top + (roomHeight - trayHeight) / 2, trayWidth, trayHeight);
  const canvasX = left + trayWidth + 18 * u;
  const surface = box(canvasX, top, roomWidth, roomHeight);
  const buckets = [];
  const rowCount = compact ? 6 : 3;
  const colCount = compact ? 1 : 2;
  for (let i = 0; i < colors.length; i++) {
    const bw = trayWidth / colCount;
    const bh = (trayHeight - 16 * u) / rowCount;
    buckets.push(box(tray.x + (i % colCount) * bw, tray.y + 8 * u + Math.floor(i / colCount) * bh, bw, bh));
  }
  const buttonSize = (compact ? 56 : 46) * u;
  const menu = box(w - insets.right - margin - buttonSize, insets.top + 17 * u, buttonSize, buttonSize);
  const audioButton = box(menu.x - buttonSize - 9 * u, menu.y, buttonSize, buttonSize);
  const gallery = box(insets.left + margin * 1.3, insets.top + 63 * u,
    usableWidth - 2.6 * margin, usableHeight - 99 * u);
  return { key, w, h, u, left, bottom, insets, margin, surface, gallery, tray, buckets, menu, audioButton };
}

function paintPoint(x, y) {
  const r = layout.surface;
  return [Math.max(0, Math.min(width - 1, (x - r.x) / r.width * width)),
    Math.max(0, Math.min(height - 1, (y - r.y) / r.height * height))];
}

function cancelContacts() {
  for (const stroke of contacts.values()) wasm.end(stroke.slot);
  contacts.clear();
}

function changePanel(value) {
  cancelContacts();
  wasm.activity();
  audio("menu", 0.35);
  panel = value;
}

function choices() {
  if (!panel) return [];
  if (panel === "confirm") return [
    ["fresh", () => {
      wasm.clear();
      context.clearRect(0, 0, width, height);
      marked = false;
      paintChanged = false;
      panel = "";
      audio("paper", 0.68);
    }],
    ["cancel", () => changePanel("")],
  ];
  return [
    ["resume", () => changePanel("")],
    ["fresh", () => changePanel("confirm")],
    ["options", () => { changePanel(""); openMenu(); }],
    ["quit", () => { cancelContacts(); quit(); }],
  ];
}

function panelLayout() {
  const { w, h, u } = layout;
  const options = choices();
  const pw = Math.min(w - 36 * u, 390 * u);
  const ph = (96 + options.length * 59) * u;
  const card = box((w - pw) / 2, (h - ph) / 2, pw, ph);
  return {
    card,
    buttons: options.map(([key, action], index) => ({
      key, action, area: box(card.x + 22 * u, card.y + (74 + 59 * index) * u, pw - 44 * u, 47 * u),
    })),
  };
}

function press(id, x, y) {
  if (!ready || !layout) return;
  const showing = wasm.show_time(1) > 0;
  wasm.activity();
  startMusic();
  if (showing) {
    // The visible painting has moved during the showcase. Wake it without leaving a stray mark.
    return;
  }
  if (panel) {
    const button = panelLayout().buttons.find((item) => hit(item.area, x, y));
    if (button) button.action();
    return;
  }
  if (hit(layout.menu, x, y)) { changePanel("menu"); return; }
  if (hit(layout.audioButton, x, y)) {
    muted = !muted;
    if (music) music.fade(muted ? 0 : 0.26, 0.18);
    if (!muted) { startMusic(); audio("menu", 0.35); }
    return;
  }
  const paletteIndex = layout.buckets.findIndex((r) => hit(r, x, y));
  const time = now();
  if (paletteIndex >= 0) {
    if (paletteIndex !== selected) {
      rapid = time - swap < 0.48;
      swap = time;
    }
    selected = paletteIndex;
    audio("dip", 0.56, 0.86 + paletteIndex * 0.075, -0.45);
    return;
  }
  if (!hit(layout.surface, x, y) || contacts.size >= 10) return;
  const usedSlots = Array.from(contacts.values()).map((stroke) => stroke.slot);
  let slot = 0;
  while (usedSlots.includes(slot)) slot++;
  const [px, py] = paintPoint(x, y);
  const splash = rapid && time - swap < 0.68;
  rapid = false;
  contacts.set(id, { slot, time, x: px, y: py });
  const aspect = Math.sqrt(width * layout.surface.height / (height * layout.surface.width));
  wasm.begin(slot, px, py, selected, splash, aspect);
  marked = paintChanged = true;
  audio("plop", 0.69, 0.85 + selected * 0.067, px / width - 0.5);
  if (splash) audio("flick", 0.53, 1.07, px / width - 0.5);
}

function move(id, x, y) {
  if (!ready || !layout) return;
  wasm.activity();
  const stroke = contacts.get(id);
  if (!stroke) return;
  const [px, py] = paintPoint(x, y);
  if (Math.hypot(px - stroke.x, py - stroke.y) < 1.5) return;
  const time = now();
  const splatter = wasm.drag(stroke.slot, px, py, Math.min(0.25, time - stroke.time || 1 / 60));
  paintChanged = true;
  stroke.x = px;
  stroke.y = py;
  stroke.time = time;
  if (splatter && time - lastFlick > 0.11) {
    audio("flick", 0.43, 0.98 + selected * 0.04, px / width - 0.5);
    lastFlick = time;
  } else if (time - lastSquish > 0.16) {
    audio("smear", 0.28, 0.92 + selected * 0.052, px / width - 0.5);
    lastSquish = time;
  }
}

function release(id) {
  if (!ready) return;
  const stroke = contacts.get(id);
  if (stroke) wasm.end(stroke.slot);
  contacts.delete(id);
  wasm.activity();
}

onTouch(({ id, phase, x, y, control }) => {
  if (control) return;
  lastTouch = now();
  touchX = x;
  touchY = y;
  if (phase === "start") press(id, x, y);
  else if (phase === "move") move(id, x, y);
  else {
    if (phase === "end" && contacts.has(id)) move(id, x, y);
    release(id);
  }
});
function fromTouch(x, y) {
  return now() - lastTouch < 0.65 && Math.hypot(x - touchX, y - touchY) < 9 * frame().scale;
}
onPointerButton(({ button, pressed, x, y }) => {
  if (button !== 0 || fromTouch(x, y)) return;
  if (pressed) press(-1, x, y);
  else {
    if (contacts.has(-1)) move(-1, x, y);
    release(-1);
  }
});
onPointerMove((x, y) => {
  pointerX = x;
  pointerY = y;
  if (!fromTouch(x, y)) move(-1, x, y);
});
onFocus((focused) => {
  focus = focused;
  if (ready) { cancelContacts(); wasm.activity(); }
});
onAction(({ action, pressed }) => {
  if (!ready || !pressed) return;
  wasm.activity();
  if (action === "menu") changePanel(panel ? "" : "menu");
});

onFixedUpdate((step) => {
  if (ready && focus && !panel && !frame().overlayOpen && wasm.tick(step)) audio("gallery", 0.48);
});

function round(r, radius, color) {
  draw.roundRect(r.x, r.y, r.width, r.height, radius, color);
}

function label(text, x, y, size, color = ink, align = "center", maxWidth) {
  const options = { size, weight: "bold", color, align, maxWidth };
  if (/^(ar|ur)/.test(strings.locale)) options.direction = "rtl";
  draw.text(text, x, y, options);
}

function brand(x, y, u) {
  draw.circle(x + 16 * u, y + 19 * u, 14 * u, "#ffbc52");
  draw.circle(x + 27 * u, y + 11 * u, 6 * u, "#ffbc52");
  draw.circle(x + 6 * u, y + 7 * u, 4 * u, "#ffbc52");
  draw.circle(x + 13 * u, y + 19 * u, 1.65 * u, ink);
  draw.circle(x + 21 * u, y + 19 * u, 1.65 * u, ink);
  draw.strokeArc(x + 17 * u, y + 21 * u, 4 * u, 0.1, Math.PI - 0.1, ink, 1.4 * u);
  draw.text("Smearoo", x + 39 * u, y - 3 * u, { size: 36 * u, weight: 900, color: ink });
}

function chrome(r, type) {
  const u = layout.u;
  const x = r.x + r.width * 0.5;
  const y = r.y + r.height * 0.5;
  round(box(r.x, r.y + 3 * u, r.width, r.height), 13 * u, "#d7c5ea");
  round(r, 13 * u, "#fff9ff");
  if (type === "menu") {
    for (let offset = -1; offset <= 1; offset++) draw.circle(x + offset * 7 * u, y, 2 * u, ink);
  } else {
    draw.path("M0 7H4L11 1V19L4 13H0Z", x - 12 * u, y - 10 * u, { scale: u, fill: ink });
    if (muted) {
      draw.line(x + 3 * u, y - 4 * u, x + 10 * u, y + 4 * u, ink, 2 * u);
      draw.line(x + 10 * u, y - 4 * u, x + 3 * u, y + 4 * u, ink, 2 * u);
    } else {
      draw.strokeArc(x - 3 * u, y, 8 * u, -0.64, 0.64, ink, 1.7 * u);
      draw.strokeArc(x - 3 * u, y, 13 * u, -0.61, 0.61, ink, 1.7 * u);
    }
  }
}

function bucket(r, index) {
  const u = layout.u;
  const x = r.x + r.width / 2;
  const y = r.y + r.height / 2;
  const size = Math.min(r.width * 0.79, r.height * 0.79);
  const active = selected === index;
  if (active) {
    draw.circle(x, y, size * 0.59, "#fff9e9");
    draw.strokeCircle(x, y, size * 0.59, ink, 2 * u);
  }
  draw.ellipse(x + size * 0.04, y + size * 0.32, size * 0.43, size * 0.12, "#ddabc7");
  draw.strokeArc(x, y - size * 0.15, size * 0.35, Math.PI, 2 * Math.PI, shades[index], 3 * u);
  round(box(x - size * 0.34, y - size * 0.105, size * 0.68, size * 0.46), size * 0.13, shades[index]);
  round(box(x - size * 0.30, y - size * 0.11, size * 0.58, size * 0.40), size * 0.11, colors[index]);
  draw.ellipse(x, y - size * 0.105, size * 0.36, size * 0.15, shades[index]);
  draw.ellipse(x, y - size * 0.145, size * 0.32, size * 0.106, colors[index]);
  draw.ellipse(x - size * 0.12, y - size * 0.165, size * 0.083, size * 0.027, "#fff3da");
  draw.circle(x + size * 0.13, y + size * 0.106, size * 0.05, "#fff3da");
  draw.circle(x + size * 0.06, y + size * 0.04, size * 0.024, "#fff3da");
}

function studio() {
  const { w, h, u, left, bottom, insets, menu, audioButton, tray, buckets } = layout;
  draw.rect(0, 0, w, h, "#eee3fb");
  draw.ellipse(w * 0.23, h * 0.96, w * 0.46, h * 0.27, "#f4ddf3");
  draw.ellipse(w * 0.86, h * 0.10, w * 0.31, h * 0.38, "#f5eafb");
  brand(left, insets.top + 19 * u, u);
  chrome(audioButton, "sound");
  chrome(menu, "menu");
  round(box(tray.x, tray.y + 5 * u, tray.width, tray.height), 21 * u, "#ddabc7");
  round(tray, 21 * u, "#f9ccdf");
  buckets.forEach(bucket);
  label(t("hint"), layout.surface.x + layout.surface.width / 2, bottom - 34 * u, 16 * u,
    "#58456e", "center", layout.surface.width);
}

function painting(area, amount, seconds) {
  const { u } = layout;
  round(box(area.x - 3 * u, area.y + 7 * u, area.width + 6 * u, area.height), 14 * u, "#c6b3d9");
  round(box(area.x - 3 * u, area.y - 3 * u, area.width + 6 * u, area.height + 6 * u), 14 * u, "#fff9ef");
  const { x, y, width: w, height: h } = area;
  draw.image(grain, x, y, w, h);
  if (marked && amount === 0) {
    draw.image(paper, x, y, w, h);
  } else if (marked) {
    const zoom = 1 + amount * (0.13 + 0.12 * Math.sin(seconds * 0.26) ** 2);
    const fx = lerp(wasm.focus_x(), 0.5 + Math.sin(seconds * 0.33) * 0.38, 0.46);
    const fy = lerp(wasm.focus_y(), 0.5 + Math.cos(seconds * 0.27) * 0.34, 0.42);
    const source = box((width - width / zoom) * fx, (height - height / zoom) * fy, width / zoom, height / zoom);
    draw.image(paper, x, y, w, h, { source });
  }
  draw.strokeRoundRect(x, y, w, h, 5 * u, "#ebdfd4", u);
}

function flushPaint() {
  if (!paintChanged) return;
  paintChanged = false;
  for (let index = wasm.shade_next(0); index >= 0; index = wasm.shade_next(index + 1)) {
    pixelTile.data.set(pixels);
    context.putImageData(pixelTile, index % columns * tile, Math.floor(index / columns) * tile);
  }
}

function modal() {
  const { w, h, u } = layout;
  const { card, buttons } = panelLayout();
  draw.rect(0, 0, w, h, [0.16, 0.10, 0.24, 0.62]);
  round(box(card.x, card.y + 6 * u, card.width, card.height), 24 * u, "#a58abb");
  round(card, 24 * u, "#fff4e3");
  label(t(panel === "confirm" ? "confirm" : "menu"), w / 2, card.y + 17 * u, 21 * u,
    ink, "center", card.width - 28 * u);
  buttons.forEach(({ key, area }, i) => {
    round(area, 14 * u, i === 0 ? "#ffd365" : "#eddef9");
    label(t(key), w / 2, area.y + 12 * u, 17 * u);
  });
}

onRender((alpha) => {
  const { width: w, height: h, safeArea } = frame();
  if (w <= safeArea.left + safeArea.right || h <= safeArea.top + safeArea.bottom) return;
  const key = `${w}:${h}:${safeArea.left}:${safeArea.top}:${safeArea.right}:${safeArea.bottom}`;
  if (!layout || layout.key !== key) {
    if (ready) cancelContacts();
    layout = getLayout(w, h, safeArea, key);
  }
  const { u, surface, margin, gallery } = layout;
  if (!ready) {
    draw.rect(0, 0, w, h, "#eee3fb");
    brand(w / 2 - 92 * u, h / 2 - 80 * u, u);
    label(t(failed ? "failed" : "loading"), w / 2, h / 2 - 26 * u, 15 * u, ink, "center", w - margin * 2);
    if (!failed) {
      round(box(w / 2 - 105 * u, h / 2 + 12 * u, 210 * u, 14 * u), 7 * u, "#d9c7ec");
      if (loaded) round(box(w / 2 - 105 * u, h / 2 + 12 * u, 210 * u * loaded / total, 14 * u), 7 * u, "#a878ef");
    }
    return;
  }

  const seconds = wasm.show_time(alpha);
  const amount = smooth(seconds / 1.8);
  const onPaper = !panel && seconds <= 0 && hit(surface, pointerX, pointerY);
  if (onPaper !== cursorOnPaper) {
    setCursor(onPaper ? cursor : "default");
    cursorOnPaper = onPaper;
  }
  flushPaint();
  if (amount < 1) {
    draw.retain("studio", `${key}:${selected}:${muted}:${strings.locale}`, studio);
  }
  if (amount > 0) {
    draw.rect(0, 0, w, h, [0.19, 0.13, 0.27, amount]);
    const area = box(lerp(surface.x, gallery.x, amount), lerp(surface.y, gallery.y, amount),
      lerp(surface.width, gallery.width, amount), lerp(surface.height, gallery.height, amount));
    painting(area, amount, seconds);
    if (amount > 0.45) label(t("gallery"), gallery.x + gallery.width / 2, layout.insets.top + 17 * u, 24 * u, [1, 0.95, 0.85, amount],
      "center", w - margin * 2);
  } else {
    painting(surface, 0, 0);
  }
  if (panel) modal();
});
