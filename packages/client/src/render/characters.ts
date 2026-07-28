/**
 * Sylwetki postaci rysowane proceduralnie — bez atlasów i bez plików graficznych.
 *
 * Każda postać to lista prymitywów w znormalizowanej przestrzeni:
 *   x ∈ ⟨−1, 1⟩  — szerokość, 0 to oś ciała
 *   y ∈ ⟨−1, 0⟩  — wysokość, 0 to stopy, −1 czubek głowy
 * Dzięki temu ten sam opis skaluje się z promienia encji i da się z niego
 * wygenerować także białą sylwetkę na hit flash (GDD §5.6) bez powtarzania
 * geometrii.
 *
 * Kolory: `PRIMARY` podstawia `color` z `data/enemies.json`, więc paleta
 * pozostaje sterowana danymi, a nie zaszyta w kodzie renderera.
 */
import type { Graphics } from "pixi.js";
import { ISO_W } from "./iso.ts";

/** Sentinele podmieniane kolorem bazowym encji. */
export const PRIMARY = -1;
export const PRIMARY_DARK = -2;
export const PRIMARY_LIGHT = -3;

export type Prim =
  | { t: "poly"; pts: number[]; c: number; a?: number }
  | { t: "circle"; x: number; y: number; r: number; c: number; a?: number }
  | { t: "ellipse"; x: number; y: number; rx: number; ry: number; c: number; a?: number }
  | { t: "rect"; x: number; y: number; w: number; h: number; c: number; a?: number; r?: number }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; c: number; w: number; a?: number };

const BONE = 0xe8e2d0;
const BONE_DARK = 0xa9a290;
const STEEL = 0x9fb0c8;
const STEEL_DARK = 0x5a6b84;
const LEATHER = 0x6b4a2f;
const DARK = 0x1a1f2b;
const WOOD = 0x7a5230;
const BLOOD = 0x8f2b2b;
const GLOW = 0x7ce0ff;
const EMBER = 0xff8a3d;
const TOXIC = 0x9be34a;

function shade(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

// ─────────────────────────────────────────────────────────── definicje

/** Bohater: hełm z grzebieniem, tarcza, miecz uniesiony w prawo. */
const PLAYER: Prim[] = [
  { t: "poly", pts: [-0.52, -0.72, -0.86, -0.12, -0.2, -0.3], c: 0x2f5f80 }, // peleryna
  { t: "rect", x: -0.42, y: -0.32, w: 0.32, h: 0.32, c: DARK },
  { t: "rect", x: 0.1, y: -0.32, w: 0.32, h: 0.32, c: DARK },
  { t: "rect", x: -0.46, y: -0.06, w: 0.4, h: 0.08, c: 0x3b2a1c, r: 2 },
  { t: "rect", x: 0.06, y: -0.06, w: 0.4, h: 0.08, c: 0x3b2a1c, r: 2 },
  { t: "poly", pts: [-0.5, -0.34, -0.44, -0.76, 0.44, -0.76, 0.5, -0.34], c: PRIMARY },
  { t: "poly", pts: [-0.44, -0.76, 0.44, -0.76, 0.3, -0.5, -0.3, -0.5], c: PRIMARY_LIGHT, a: 0.9 },
  { t: "rect", x: -0.16, y: -0.7, w: 0.32, h: 0.13, c: GLOW, a: 0.95 }, // emblemat
  { t: "ellipse", x: -0.52, y: -0.72, rx: 0.22, ry: 0.14, c: PRIMARY_DARK },
  { t: "ellipse", x: 0.52, y: -0.72, rx: 0.22, ry: 0.14, c: PRIMARY_DARK },
  { t: "circle", x: 0, y: -0.88, r: 0.2, c: STEEL }, // hełm
  { t: "rect", x: -0.16, y: -0.9, w: 0.32, h: 0.08, c: DARK }, // szczelina przyłbicy
  { t: "poly", pts: [0, -1.16, 0.08, -0.94, -0.08, -0.94], c: GLOW }, // grzebień
  { t: "ellipse", x: -0.66, y: -0.5, rx: 0.2, ry: 0.28, c: STEEL_DARK }, // tarcza
  { t: "ellipse", x: -0.66, y: -0.5, rx: 0.1, ry: 0.15, c: GLOW, a: 0.8 },
  { t: "poly", pts: [0.5, -0.62, 0.62, -0.55, 1.06, -1.02, 0.98, -1.1], c: 0xdfe7f2 }, // ostrze
  { t: "line", x1: 0.42, y1: -0.52, x2: 0.66, y2: -0.72, c: 0xffd166, w: 0.09 }, // jelec
];

/** Goblin: mały, przygarbiony, wielkie spiczaste uszy. */
function goblin(weapon: Prim[]): Prim[] {
  return [
    { t: "rect", x: -0.34, y: -0.26, w: 0.26, h: 0.26, c: PRIMARY_DARK },
    { t: "rect", x: 0.08, y: -0.26, w: 0.26, h: 0.26, c: PRIMARY_DARK },
    { t: "poly", pts: [-0.42, -0.28, -0.32, -0.66, 0.32, -0.66, 0.42, -0.28], c: PRIMARY },
    { t: "poly", pts: [-0.3, -0.3, -0.24, -0.6, 0.24, -0.6, 0.3, -0.3], c: LEATHER, a: 0.9 },
    { t: "circle", x: 0.04, y: -0.78, r: 0.19, c: PRIMARY_LIGHT }, // głowa
    { t: "poly", pts: [-0.14, -0.86, -0.62, -1.0, -0.16, -0.7], c: PRIMARY }, // lewe ucho
    { t: "poly", pts: [0.22, -0.86, 0.68, -1.02, 0.24, -0.7], c: PRIMARY }, // prawe ucho
    { t: "circle", x: 0.0, y: -0.8, r: 0.035, c: 0xffd93b },
    { t: "circle", x: 0.13, y: -0.8, r: 0.035, c: 0xffd93b },
    { t: "poly", pts: [-0.02, -0.72, 0.16, -0.72, 0.07, -0.64], c: DARK, a: 0.85 }, // zęby
    ...weapon,
  ];
}

const GOBLIN_SCOUT: Prim[] = goblin([
  { t: "line", x1: 0.44, y1: -0.5, x2: 0.78, y2: -0.72, c: STEEL, w: 0.1 }, // sztylet
  { t: "line", x1: 0.4, y1: -0.46, x2: 0.5, y2: -0.54, c: WOOD, w: 0.12 },
]);

const GOBLIN_THROWER: Prim[] = goblin([
  { t: "line", x1: -0.5, y1: -1.02, x2: 0.9, y2: -0.86, c: WOOD, w: 0.07 }, // oszczep
  { t: "poly", pts: [0.86, -0.92, 1.12, -0.85, 0.86, -0.78], c: STEEL },
]);

/** Szkielet: żebra, czaszka, kości bez mięśni. */
function skeleton(extra: Prim[]): Prim[] {
  return [
    { t: "line", x1: -0.2, y1: -0.3, x2: -0.24, y2: -0.02, c: BONE, w: 0.11 },
    { t: "line", x1: 0.2, y1: -0.3, x2: 0.24, y2: -0.02, c: BONE, w: 0.11 },
    { t: "poly", pts: [-0.3, -0.34, -0.34, -0.72, 0.34, -0.72, 0.3, -0.34], c: BONE_DARK },
    { t: "line", x1: -0.26, y1: -0.44, x2: 0.26, y2: -0.44, c: BONE, w: 0.075 }, // żebra
    { t: "line", x1: -0.28, y1: -0.54, x2: 0.28, y2: -0.54, c: BONE, w: 0.075 },
    { t: "line", x1: -0.29, y1: -0.64, x2: 0.29, y2: -0.64, c: BONE, w: 0.075 },
    { t: "line", x1: 0, y1: -0.7, x2: 0, y2: -0.36, c: BONE_DARK, w: 0.06 }, // kręgosłup
    // Ramiona: kość biegnąca w dół, nie kula przy głowie — kula czytała się jak ucho.
    { t: "line", x1: -0.34, y1: -0.7, x2: -0.44, y2: -0.4, c: BONE, w: 0.1 },
    { t: "line", x1: 0.34, y1: -0.7, x2: 0.44, y2: -0.4, c: BONE, w: 0.1 },
    { t: "circle", x: 0, y: -0.88, r: 0.2, c: BONE }, // czaszka
    { t: "circle", x: -0.07, y: -0.9, r: 0.045, c: 0xff5a3c },
    { t: "circle", x: 0.07, y: -0.9, r: 0.045, c: 0xff5a3c },
    { t: "rect", x: -0.07, y: -0.79, w: 0.14, h: 0.05, c: BONE_DARK },
    ...extra,
  ];
}

const SKELETON_WARRIOR: Prim[] = skeleton([
  { t: "ellipse", x: -0.62, y: -0.52, rx: 0.24, ry: 0.3, c: STEEL_DARK }, // tarcza
  { t: "ellipse", x: -0.62, y: -0.52, rx: 0.13, ry: 0.17, c: STEEL },
  { t: "poly", pts: [0.5, -0.6, 0.6, -0.55, 0.98, -1.0, 0.9, -1.06], c: STEEL }, // miecz
  { t: "line", x1: 0.44, y1: -0.52, x2: 0.64, y2: -0.68, c: BONE_DARK, w: 0.08 },
]);

const SKELETON_ARCHER: Prim[] = skeleton([
  { t: "line", x1: 0.6, y1: -1.04, x2: 0.6, y2: -0.24, c: WOOD, w: 0.1 }, // łuk
  { t: "line", x1: 0.6, y1: -1.04, x2: 0.86, y2: -0.64, c: WOOD, w: 0.09 },
  { t: "line", x1: 0.86, y1: -0.64, x2: 0.6, y2: -0.24, c: WOOD, w: 0.09 },
  { t: "line", x1: 0.6, y1: -1.02, x2: 0.6, y2: -0.26, c: 0xd8d0bc, w: 0.035 }, // cięciwa
  { t: "poly", pts: [0.2, -0.66, 0.62, -0.62, 0.2, -0.58], c: BONE },
]);

/** Ork: masywne barki, kły, ciężka broń. */
function orc(extra: Prim[]): Prim[] {
  return [
    { t: "rect", x: -0.42, y: -0.3, w: 0.34, h: 0.3, c: PRIMARY_DARK },
    { t: "rect", x: 0.08, y: -0.3, w: 0.34, h: 0.3, c: PRIMARY_DARK },
    { t: "poly", pts: [-0.62, -0.32, -0.52, -0.78, 0.52, -0.78, 0.62, -0.32], c: PRIMARY },
    { t: "poly", pts: [-0.4, -0.34, -0.34, -0.7, 0.34, -0.7, 0.4, -0.34], c: LEATHER, a: 0.85 },
    // Barki niżej i szerzej niż głowa — inaczej czytają się jak uszy.
    { t: "ellipse", x: -0.66, y: -0.66, rx: 0.26, ry: 0.14, c: PRIMARY_LIGHT },
    { t: "ellipse", x: 0.66, y: -0.66, rx: 0.26, ry: 0.14, c: PRIMARY_LIGHT },
    { t: "line", x1: -0.66, y1: -0.64, x2: -0.72, y2: -0.34, c: PRIMARY, w: 0.16 }, // ramiona
    { t: "line", x1: 0.66, y1: -0.64, x2: 0.72, y2: -0.34, c: PRIMARY, w: 0.16 },
    { t: "circle", x: 0, y: -0.92, r: 0.26, c: PRIMARY_LIGHT }, // głowa
    { t: "poly", pts: [-0.15, -0.86, -0.22, -0.66, -0.08, -0.84], c: BONE }, // kły
    { t: "poly", pts: [0.15, -0.86, 0.22, -0.66, 0.08, -0.84], c: BONE },
    { t: "circle", x: -0.1, y: -0.98, r: 0.045, c: 0xff4d2e },
    { t: "circle", x: 0.1, y: -0.98, r: 0.045, c: 0xff4d2e },
    ...extra,
  ];
}

const ORC_BERSERKER: Prim[] = orc([
  { t: "line", x1: 0.5, y1: -0.42, x2: 0.92, y2: -0.96, c: WOOD, w: 0.11 }, // topór
  { t: "poly", pts: [0.74, -1.16, 1.18, -0.98, 0.78, -0.76, 0.88, -0.96], c: STEEL },
  { t: "line", x1: -0.2, y1: -1.02, x2: 0.2, y2: -1.02, c: BLOOD, w: 0.07, a: 0.9 }, // barwy wojenne
]);

const ORC_SHAMAN: Prim[] = [
  { t: "poly", pts: [-0.62, -0.02, -0.36, -0.8, 0.36, -0.8, 0.62, -0.02], c: PRIMARY }, // szata
  { t: "poly", pts: [-0.4, -0.04, -0.24, -0.66, 0.24, -0.66, 0.4, -0.04], c: PRIMARY_DARK, a: 0.9 },
  { t: "poly", pts: [-0.36, -0.8, 0.36, -0.8, 0.26, -1.0, -0.26, -1.0], c: PRIMARY_LIGHT }, // kaptur
  { t: "poly", pts: [-0.26, -1.0, -0.44, -1.22, -0.16, -1.02], c: BONE }, // rogi
  { t: "poly", pts: [0.26, -1.0, 0.44, -1.22, 0.16, -1.02], c: BONE },
  { t: "ellipse", x: 0, y: -0.86, rx: 0.16, ry: 0.12, c: DARK },
  { t: "circle", x: -0.07, y: -0.87, r: 0.04, c: EMBER },
  { t: "circle", x: 0.07, y: -0.87, r: 0.04, c: EMBER },
  { t: "line", x1: 0.62, y1: -0.02, x2: 0.62, y2: -1.06, c: WOOD, w: 0.09 }, // kostur
  { t: "circle", x: 0.62, y: -1.16, r: 0.16, c: EMBER, a: 0.95 },
  { t: "circle", x: 0.62, y: -1.16, r: 0.08, c: 0xffe9b0 },
];

/** Pełzacz Zarazy: niski, wielonogi, z pulsującymi workami jadu. */
const PLAGUE_CRAWLER: Prim[] = [
  ...[-1, 1].flatMap((side) =>
    [0.1, 0.34, 0.58].map(
      (off, i): Prim => ({
        t: "line",
        x1: side * 0.2,
        y1: -0.34,
        x2: side * (0.7 + i * 0.14),
        y2: -0.02 - off * 0.1,
        c: PRIMARY_DARK,
        w: 0.09,
      }),
    ),
  ),
  { t: "ellipse", x: 0, y: -0.42, rx: 0.62, ry: 0.42, c: PRIMARY }, // odwłok
  { t: "ellipse", x: -0.2, y: -0.56, rx: 0.16, ry: 0.13, c: TOXIC, a: 0.95 },
  { t: "ellipse", x: 0.22, y: -0.5, rx: 0.13, ry: 0.11, c: TOXIC, a: 0.95 },
  { t: "ellipse", x: 0.02, y: -0.68, rx: 0.11, ry: 0.09, c: TOXIC, a: 0.85 },
  // Przednia para odnóży rysowana PO odwłoku — inaczej tułów przykrywa nogi
  // i stwór czyta się jak sama kula.
  { t: "line", x1: -0.1, y1: -0.4, x2: -0.72, y2: -0.06, c: PRIMARY_DARK, w: 0.1 },
  { t: "line", x1: 0.16, y1: -0.4, x2: 0.72, y2: -0.06, c: PRIMARY_DARK, w: 0.1 },
  { t: "ellipse", x: 0.34, y: -0.34, rx: 0.28, ry: 0.22, c: PRIMARY_LIGHT }, // głowa
  { t: "circle", x: 0.42, y: -0.4, r: 0.05, c: 0xff3b2e },
  { t: "circle", x: 0.5, y: -0.3, r: 0.04, c: 0xff3b2e },
  { t: "poly", pts: [0.56, -0.36, 0.78, -0.42, 0.58, -0.28], c: BONE }, // żuwaczki
];

/** Rycerz Zgnilizny: wysoki, ciężki pancerz, rogaty hełm, dwuręczny miecz. */
const ROT_KNIGHT: Prim[] = [
  { t: "poly", pts: [-0.6, -0.68, -0.98, -0.02, -0.16, -0.24], c: 0x3a2b34 }, // podarty płaszcz
  { t: "rect", x: -0.4, y: -0.34, w: 0.32, h: 0.34, c: STEEL_DARK },
  { t: "rect", x: 0.08, y: -0.34, w: 0.32, h: 0.34, c: STEEL_DARK },
  { t: "poly", pts: [-0.54, -0.36, -0.46, -0.8, 0.46, -0.8, 0.54, -0.36], c: PRIMARY },
  { t: "poly", pts: [-0.34, -0.4, 0, -0.74, 0.34, -0.4, 0, -0.3], c: PRIMARY_LIGHT }, // napierśnik
  { t: "circle", x: 0, y: -0.52, r: 0.08, c: TOXIC, a: 0.9 }, // rana
  { t: "poly", pts: [-0.5, -0.66, -0.86, -0.82, -0.72, -0.5], c: PRIMARY_DARK }, // pauldrony
  { t: "poly", pts: [0.5, -0.66, 0.86, -0.82, 0.72, -0.5], c: PRIMARY_DARK },
  { t: "poly", pts: [-0.2, -0.82, -0.22, -1.04, 0.22, -1.04, 0.2, -0.82], c: STEEL_DARK }, // hełm
  { t: "rect", x: -0.18, y: -0.96, w: 0.36, h: 0.07, c: 0x120f14 },
  { t: "circle", x: -0.08, y: -0.93, r: 0.035, c: TOXIC },
  { t: "circle", x: 0.08, y: -0.93, r: 0.035, c: TOXIC },
  { t: "poly", pts: [-0.22, -1.04, -0.56, -1.34, -0.12, -1.06], c: BONE_DARK }, // rogi
  { t: "poly", pts: [0.22, -1.04, 0.56, -1.34, 0.12, -1.06], c: BONE_DARK },
  { t: "poly", pts: [0.62, -0.86, 0.78, -0.86, 0.74, -0.02, 0.7, 0.04, 0.66, -0.02], c: 0xc9d3e2 }, // miecz
  { t: "line", x1: 0.52, y1: -0.86, x2: 0.88, y2: -0.86, c: 0x8a7a4a, w: 0.09 },
  { t: "line", x1: 0.7, y1: -1.02, x2: 0.7, y2: -0.84, c: LEATHER, w: 0.07 },
];

/** Fallback — gdyby w danych pojawił się wróg bez zdefiniowanej sylwetki. */
const GENERIC: Prim[] = [
  { t: "rect", x: -0.34, y: -0.28, w: 0.28, h: 0.28, c: PRIMARY_DARK },
  { t: "rect", x: 0.06, y: -0.28, w: 0.28, h: 0.28, c: PRIMARY_DARK },
  { t: "poly", pts: [-0.46, -0.3, -0.38, -0.74, 0.38, -0.74, 0.46, -0.3], c: PRIMARY },
  { t: "circle", x: 0, y: -0.88, r: 0.2, c: PRIMARY_LIGHT },
  { t: "circle", x: -0.07, y: -0.9, r: 0.04, c: 0xffd93b },
  { t: "circle", x: 0.07, y: -0.9, r: 0.04, c: 0xffd93b },
];

export const CHARACTERS: Record<string, Prim[]> = {
  player: PLAYER,
  goblin_scout: GOBLIN_SCOUT,
  goblin_thrower: GOBLIN_THROWER,
  skeleton_warrior: SKELETON_WARRIOR,
  skeleton_archer: SKELETON_ARCHER,
  orc_berserker: ORC_BERSERKER,
  orc_shaman: ORC_SHAMAN,
  plague_crawler: PLAGUE_CRAWLER,
  rot_knight: ROT_KNIGHT,
};

/**
 * Rysuje postać do podanego `Graphics`.
 * `flat` (opcjonalny) wymusza jeden kolor na wszystkich wypełnieniach —
 * tak powstaje biała sylwetka nakładana addytywnie przy trafieniu.
 */
export function drawCharacter(
  g: Graphics,
  id: string,
  radius: number,
  primary: number,
  flat?: number,
): void {
  const prims = CHARACTERS[id] ?? GENERIC;
  // Osie muszą mieć zbliżoną skalę, inaczej kształt zaprojektowany jako szeroki
  // (ucho goblina, barki orka) wychodzi wąski i pionowy. Przy tych mnożnikach
  // tors o szerokości 1.0 jednostki ma proporcję ~0.45 do wysokości sylwetki.
  const unit = radius * ISO_W;
  const halfW = unit * 1.55;
  const height = unit * 3.0;

  const px = (nx: number) => nx * halfW;
  const py = (ny: number) => ny * height;
  const resolve = (c: number): number => {
    if (flat !== undefined) return flat;
    if (c === PRIMARY) return primary;
    if (c === PRIMARY_DARK) return shade(primary, 0.62);
    if (c === PRIMARY_LIGHT) return shade(primary, 1.35);
    return c;
  };

  for (const p of prims) {
    const color = resolve(p.c);
    const alpha = flat !== undefined ? 1 : (p.a ?? 1);

    switch (p.t) {
      case "poly": {
        const pts: number[] = [];
        for (let i = 0; i < p.pts.length; i += 2) {
          pts.push(px(p.pts[i]!), py(p.pts[i + 1]!));
        }
        g.poly(pts).fill({ color, alpha });
        break;
      }
      case "circle":
        g.circle(px(p.x), py(p.y), px(p.r)).fill({ color, alpha });
        break;
      case "ellipse":
        g.ellipse(px(p.x), py(p.y), px(p.rx), py(p.ry)).fill({ color, alpha });
        break;
      case "rect":
        if (p.r) {
          g.roundRect(px(p.x), py(p.y), px(p.w), py(p.h), p.r).fill({ color, alpha });
        } else {
          g.rect(px(p.x), py(p.y), px(p.w), py(p.h)).fill({ color, alpha });
        }
        break;
      case "line":
        g.moveTo(px(p.x1), py(p.y1))
          .lineTo(px(p.x2), py(p.y2))
          .stroke({ width: px(p.w), color, alpha, cap: "round" });
        break;
    }
  }
}

/**
 * Wysokość sylwetki w pikselach — do ustawienia pasków HP nad postacią.
 * Zapas 1.2 pokrywa rogi, grzebienie i uniesioną broń.
 */
export function characterHeight(radius: number): number {
  return radius * ISO_W * 3.0 * 1.2;
}
