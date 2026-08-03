/**
 * Proceduralne **bryły** postaci — zastępują wytłaczanie płaskich sylwetek.
 *
 * Poprzednie podejście (wielokąt 2D wyciągnięty na 0.26 m) dawało postacie
 * płaskie jak piernik: z boku znikały, światło nie miało na czym pracować,
 * a cień był prostokątem. Tutaj każda postać jest **złożona z brył o realnej
 * głębi** — tors, miednica, głowa, barki, ramiona, nogi, broń — z proporcjami
 * i akcentami zależnymi od archetypu.
 *
 * Nadal zero assetów: wszystko powstaje z pudełek, walców i kul, sterowane
 * jedną tablicą opisów. Dodanie wroga to wpis w `PLANS`, nie sesja w edytorze 3D.
 *
 * Wydajność: bryły jednej postaci są **scalane w jedną siatkę** (z podziałem
 * na materiały), a materiały są współdzielone per kolor. Instancje dzielą
 * geometrię, więc dwudziesty goblin kosztuje jedną macierz.
 */
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";

/** Promień odniesienia, dla którego budowane są proporcje (gracz). */
export const REFERENCE_RADIUS = 0.42;

export function toColor3(hex: number): Color3 {
  return new Color3(((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255);
}

function shade(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

// ────────────────────────────────────────────────────────────── materiały

const materials = new Map<string, StandardMaterial>();

/**
 * Materiały współdzielone per (kolor, emisja). Bez cache'u każda z ~24 postaci
 * wnosiłaby kilkanaście własnych materiałów, a każdy materiał to osobne
 * wywołanie rysowania.
 */
function mat(scene: Scene, hex: number, emissive = 0): StandardMaterial {
  const key = `${hex}|${emissive}`;
  const cached = materials.get(key);
  if (cached) return cached;

  const m = new StandardMaterial(`bm_${key}`, scene);
  const base = toColor3(hex);
  m.diffuseColor = base;
  // Zero odbić lustrzanych: stylizacja jest matowa, a specular na bryłach
  // tworzy paski czytane jako błąd cieniowania.
  m.specularColor = Color3.Black();
  if (emissive > 0) m.emissiveColor = base.scale(emissive);
  m.freeze();
  materials.set(key, m);
  return m;
}

/**
 * Siatki zwalniamy **bez** materiałów, a materiały osobno z cache'u. Materiał
 * jest współdzielony przez tułów, obie nogi i wszystkie postacie w tym kolorze,
 * więc `dispose(false, true)` na siatce skasowałby go pozostałym.
 */
export function clearBodyCaches(): void {
  for (const t of templates.values()) {
    t.body.dispose();
    t.legL?.dispose();
    t.legR?.dispose();
  }
  templates.clear();
  for (const m of materials.values()) m.dispose();
  materials.clear();
}

// ───────────────────────────────────────────────────────── prymitywy brył

interface PartOpts {
  rx?: number;
  ry?: number;
  rz?: number;
  emissive?: number;
}

/**
 * `into` wskazuje kolekcję, do której trafiają kolejne bryły. Nogi muszą
 * wylądować w osobnych siatkach, bo scalona postać to jedna instancja —
 * a instancji nie da się animować od środka. Rozdzielamy więc geometrię
 * na trzy grupy przy budowaniu, nie przy renderowaniu.
 */
type Ctx = { scene: Scene; parts: Mesh[]; legL: Mesh[]; legR: Mesh[]; into: Mesh[] };

function push(ctx: Ctx, mesh: Mesh, hex: number, o: PartOpts): Mesh {
  mesh.material = mat(ctx.scene, hex, o.emissive ?? 0);
  if (o.rx) mesh.rotation.x = o.rx;
  if (o.ry) mesh.rotation.y = o.ry;
  if (o.rz) mesh.rotation.z = o.rz;
  ctx.into.push(mesh);
  return mesh;
}

function box(ctx: Ctx, w: number, h: number, d: number, x: number, y: number, z: number, hex: number, o: PartOpts = {}): Mesh {
  const m = CreateBox("b", { width: w, height: h, depth: d }, ctx.scene);
  m.position.set(x, y, z);
  return push(ctx, m, hex, o);
}

function cyl(ctx: Ctx, dTop: number, dBot: number, h: number, x: number, y: number, z: number, hex: number, o: PartOpts = {}): Mesh {
  const m = CreateCylinder("c", { diameterTop: dTop, diameterBottom: dBot, height: h, tessellation: 10 }, ctx.scene);
  m.position.set(x, y, z);
  return push(ctx, m, hex, o);
}

function sph(ctx: Ctx, d: number, x: number, y: number, z: number, hex: number, o: PartOpts = {}): Mesh {
  const m = CreateSphere("s", { diameter: d, segments: 8 }, ctx.scene);
  m.position.set(x, y, z);
  return push(ctx, m, hex, o);
}

// ─────────────────────────────────────────────────────────── plan postaci

export type Weapon = "sword" | "dagger" | "spear" | "bow" | "axe" | "staff" | "greatsword" | "claws";
export type HeadKind = "helmet" | "goblin" | "skull" | "orc" | "hooded" | "horned" | "insect";
export type Build = "slim" | "normal" | "heavy" | "hulking" | "crawler";

export interface BodyPlan {
  build: Build;
  head: HeadKind;
  weapon: Weapon;
  shield?: boolean;
  cape?: boolean;
  /** Kolor świecących akcentów (oczy, runy, jad). */
  accent: number;
  /** Dodatkowy mnożnik wysokości — mini-boss ma górować nad resztą. */
  scale?: number;
}

const STEEL = 0x8f9fb5;
const STEEL_DARK = 0x4a5870;
const BONE = 0xe8e2d0;
const BONE_DARK = 0xa39c88;
const LEATHER = 0x5c3f28;
const WOOD = 0x6b4a2c;
const DARK = 0x171b25;

export const PLANS: Record<string, BodyPlan> = {
  player: { build: "normal", head: "helmet", weapon: "sword", shield: true, cape: true, accent: 0x7ce0ff },
  goblin_scout: { build: "slim", head: "goblin", weapon: "dagger", accent: 0xffd93b },
  goblin_thrower: { build: "slim", head: "goblin", weapon: "spear", accent: 0xffd93b },
  skeleton_warrior: { build: "normal", head: "skull", weapon: "sword", shield: true, accent: 0xff5a3c },
  skeleton_archer: { build: "slim", head: "skull", weapon: "bow", accent: 0xff5a3c },
  plague_crawler: { build: "crawler", head: "insect", weapon: "claws", accent: 0x9be34a },
  orc_berserker: { build: "hulking", head: "orc", weapon: "axe", accent: 0xff8a3d },
  orc_shaman: { build: "heavy", head: "hooded", weapon: "staff", accent: 0x9be34a },
  rot_knight: { build: "heavy", head: "horned", weapon: "greatsword", cape: true, accent: 0xff3b30, scale: 1.35 },
};

/** Proporcje ciała wg budowy. Wartości w metrach dla `REFERENCE_RADIUS`. */
const BUILDS: Record<Build, {
  height: number; torsoW: number; torsoD: number; torsoH: number;
  legH: number; legW: number; armW: number; shoulder: number; hunch: number;
}> = {
  slim:    { height: 1.45, torsoW: 0.44, torsoD: 0.30, torsoH: 0.46, legH: 0.42, legW: 0.13, armW: 0.11, shoulder: 0.28, hunch: 0.16 },
  normal:  { height: 1.80, torsoW: 0.58, torsoD: 0.36, torsoH: 0.60, legH: 0.60, legW: 0.17, armW: 0.14, shoulder: 0.36, hunch: 0.04 },
  heavy:   { height: 1.92, torsoW: 0.72, torsoD: 0.44, torsoH: 0.66, legH: 0.60, legW: 0.20, armW: 0.17, shoulder: 0.44, hunch: 0.06 },
  hulking: { height: 2.05, torsoW: 0.88, torsoD: 0.52, torsoH: 0.70, legH: 0.60, legW: 0.24, armW: 0.21, shoulder: 0.54, hunch: 0.14 },
  crawler: { height: 0.95, torsoW: 0.72, torsoD: 0.62, torsoH: 0.34, legH: 0.24, legW: 0.09, armW: 0.09, shoulder: 0.30, hunch: 0.30 },
};

// ───────────────────────────────────────────────────────────── budowanie

/**
 * Buduje ciało. Wszystko jest asymetryczne z premedytacją: broń uniesiona
 * po prawej, tarcza wysunięta w lewo, tors lekko pochylony. Symetryczna
 * postać w rzucie 3/4 czyta się jak manekin.
 */
function buildBody(ctx: Ctx, plan: BodyPlan, primary: number): void {
  const b = BUILDS[plan.build];
  const dark = shade(primary, 0.6);
  const light = shade(primary, 1.3);

  const hipY = b.legH;
  const torsoY = hipY + b.torsoH / 2;
  const neckY = hipY + b.torsoH;

  if (plan.build === "crawler") {
    buildCrawler(ctx, plan, primary);
    return;
  }

  // — nogi. Budowane we współrzędnych **względem biodra**, bo to wokół biodra
  // noga się obraca w marszu. Neutralna poza jest symetryczna: wysunięcie
  // przedniej nogi robi teraz animacja, nie zapieczona geometria.
  const legX = b.torsoW * 0.26;
  for (const [side, into] of [[-1, ctx.legL], [1, ctx.legR]] as const) {
    ctx.into = into;
    box(ctx, b.legW, b.legH, b.legW * 1.15, side * legX, -b.legH / 2, 0, dark);
    box(ctx, b.legW * 1.2, 0.09, b.legW * 1.7, side * legX, 0.045 - b.legH, 0.03, DARK);
  }
  ctx.into = ctx.parts;

  // — miednica i tors: walec zwężający się ku górze daje sylwetkę, nie skrzynię
  cyl(ctx, b.torsoW * 0.9, b.torsoW * 0.78, 0.16, 0, hipY + 0.05, 0, dark);
  const torso = box(ctx, b.torsoW, b.torsoH, b.torsoD, 0, torsoY, 0, primary);
  torso.rotation.x = -b.hunch;

  // — pas
  box(ctx, b.torsoW * 1.04, 0.09, b.torsoD * 1.06, 0, hipY + 0.1, 0, LEATHER);

  // — barki jako kule: zaokrąglają sylwetkę i łapią światło
  sph(ctx, b.shoulder * 0.62, -b.shoulder, neckY - 0.08, 0, light);
  sph(ctx, b.shoulder * 0.62, b.shoulder, neckY - 0.08, 0, light);

  // — ramiona. Prawe uniesione z bronią, lewe opuszczone (albo z tarczą).
  const armLen = b.torsoH * 0.92;
  const rightArm = box(ctx, b.armW, armLen, b.armW, b.shoulder + 0.04, neckY - armLen * 0.42, 0.02, dark);
  rightArm.rotation.z = -0.85;
  const leftArm = box(ctx, b.armW, armLen, b.armW, -b.shoulder - 0.02, neckY - armLen * 0.55, 0.04, dark);
  leftArm.rotation.z = plan.shield ? 0.35 : 0.12;

  // — szyja
  cyl(ctx, 0.13, 0.16, 0.1, 0, neckY + 0.04, 0, dark);

  buildHead(ctx, plan, primary, neckY + 0.1);
  buildWeapon(ctx, plan, b, neckY);

  if (plan.shield) {
    // Tarcza: spłaszczony walec wysunięty przed lewe ramię.
    const shield = cyl(ctx, b.torsoW * 0.82, b.torsoW * 0.82, 0.07, -b.shoulder - 0.16, neckY - armLen * 0.6, 0.14, STEEL_DARK);
    shield.rotation.x = Math.PI / 2;
    shield.rotation.z = 0.2;
    const boss = cyl(ctx, 0.14, 0.14, 0.09, -b.shoulder - 0.16, neckY - armLen * 0.6, 0.19, plan.accent, { emissive: 0.5 });
    boss.rotation.x = Math.PI / 2;
  }

  if (plan.cape) {
    // Peleryna: klin za plecami, odchylony — sugeruje ruch nawet w bezruchu.
    const cape = box(ctx, b.torsoW * 0.92, b.torsoH * 1.25, 0.05, 0, torsoY - 0.06, -b.torsoD / 2 - 0.04, shade(primary, 0.45));
    cape.rotation.x = 0.16;
  }
}

function buildHead(ctx: Ctx, plan: BodyPlan, primary: number, y: number): void {
  const acc = plan.accent;
  const dark = shade(primary, 0.6);

  switch (plan.head) {
    case "helmet": {
      box(ctx, 0.30, 0.28, 0.30, 0, y + 0.14, 0, STEEL);
      // Szczelina przyłbicy — jedyny ciemny element, więc czyta się jako twarz.
      box(ctx, 0.24, 0.07, 0.03, 0, y + 0.14, 0.155, DARK);
      box(ctx, 0.18, 0.045, 0.03, 0, y + 0.14, 0.155, acc, { emissive: 0.8 });
      // Grzebień
      const crest = box(ctx, 0.05, 0.20, 0.26, 0, y + 0.34, -0.02, acc, { emissive: 0.55 });
      crest.rotation.x = 0.2;
      break;
    }
    case "goblin": {
      sph(ctx, 0.30, 0, y + 0.13, 0.02, shade(primary, 1.25));
      // Uszy: stożki na boki — najmocniejszy wyróżnik sylwetki goblina.
      const earL = cyl(ctx, 0.01, 0.13, 0.30, -0.19, y + 0.18, -0.02, shade(primary, 1.1));
      earL.rotation.z = 1.15;
      const earR = cyl(ctx, 0.01, 0.13, 0.30, 0.19, y + 0.18, -0.02, shade(primary, 1.1));
      earR.rotation.z = -1.15;
      sph(ctx, 0.055, -0.06, y + 0.15, 0.14, acc, { emissive: 0.9 });
      sph(ctx, 0.055, 0.06, y + 0.15, 0.14, acc, { emissive: 0.9 });
      break;
    }
    case "skull": {
      sph(ctx, 0.26, 0, y + 0.13, 0, BONE);
      box(ctx, 0.19, 0.10, 0.13, 0, y + 0.04, 0.08, BONE_DARK); // żuchwa
      sph(ctx, 0.07, -0.06, y + 0.15, 0.10, acc, { emissive: 1 });
      sph(ctx, 0.07, 0.06, y + 0.15, 0.10, acc, { emissive: 1 });
      break;
    }
    case "orc": {
      box(ctx, 0.34, 0.28, 0.32, 0, y + 0.14, 0.02, shade(primary, 1.2));
      box(ctx, 0.22, 0.10, 0.12, 0, y + 0.05, 0.16, shade(primary, 0.9)); // szczęka
      // Kły do góry — sylwetka orka bez nich to po prostu duży człowiek.
      const tuskL = cyl(ctx, 0.01, 0.05, 0.14, -0.08, y + 0.11, 0.2, BONE);
      tuskL.rotation.x = 0.25;
      const tuskR = cyl(ctx, 0.01, 0.05, 0.14, 0.08, y + 0.11, 0.2, BONE);
      tuskR.rotation.x = 0.25;
      sph(ctx, 0.05, -0.07, y + 0.19, 0.15, acc, { emissive: 0.9 });
      sph(ctx, 0.05, 0.07, y + 0.19, 0.15, acc, { emissive: 0.9 });
      break;
    }
    case "hooded": {
      // Kaptur: stożek, twarz w cieniu, tylko oczy.
      cyl(ctx, 0.06, 0.36, 0.40, 0, y + 0.18, -0.02, shade(primary, 0.75));
      box(ctx, 0.20, 0.16, 0.06, 0, y + 0.12, 0.13, DARK);
      sph(ctx, 0.05, -0.05, y + 0.13, 0.15, acc, { emissive: 1 });
      sph(ctx, 0.05, 0.05, y + 0.13, 0.15, acc, { emissive: 1 });
      break;
    }
    case "horned": {
      box(ctx, 0.34, 0.32, 0.32, 0, y + 0.16, 0, STEEL_DARK);
      box(ctx, 0.26, 0.06, 0.03, 0, y + 0.14, 0.17, acc, { emissive: 0.9 });
      // Rogi na boki i w górę — sylwetka rozpoznawalna z każdej strony.
      const hornL = cyl(ctx, 0.015, 0.09, 0.34, -0.20, y + 0.34, -0.02, BONE_DARK);
      hornL.rotation.z = 0.75;
      const hornR = cyl(ctx, 0.015, 0.09, 0.34, 0.20, y + 0.34, -0.02, BONE_DARK);
      hornR.rotation.z = -0.75;
      break;
    }
    case "insect": {
      sph(ctx, 0.28, 0, y + 0.02, 0.22, shade(primary, 1.15));
      sph(ctx, 0.07, -0.08, y + 0.06, 0.34, acc, { emissive: 1 });
      sph(ctx, 0.07, 0.08, y + 0.06, 0.34, acc, { emissive: 1 });
      break;
    }
  }
}

function buildWeapon(ctx: Ctx, plan: BodyPlan, b: (typeof BUILDS)[Build], neckY: number): void {
  const hx = b.shoulder + 0.22;
  const hy = neckY - 0.08;

  switch (plan.weapon) {
    case "sword": {
      const blade = box(ctx, 0.07, 0.78, 0.03, hx, hy + 0.42, 0.04, 0xd7dfe9);
      blade.rotation.z = -0.35;
      box(ctx, 0.24, 0.05, 0.05, hx - 0.06, hy + 0.06, 0.04, 0xffd166); // jelec
      box(ctx, 0.05, 0.16, 0.05, hx - 0.1, hy - 0.06, 0.04, LEATHER);
      break;
    }
    case "greatsword": {
      const blade = box(ctx, 0.11, 1.22, 0.04, hx + 0.06, hy + 0.62, 0.04, 0xc9d3e2);
      blade.rotation.z = -0.28;
      box(ctx, 0.34, 0.06, 0.06, hx, hy + 0.06, 0.04, STEEL_DARK);
      box(ctx, 0.06, 0.24, 0.06, hx - 0.06, hy - 0.1, 0.04, LEATHER);
      break;
    }
    case "dagger": {
      const blade = box(ctx, 0.05, 0.30, 0.025, hx - 0.04, hy + 0.16, 0.05, 0xd7dfe9);
      blade.rotation.z = -0.5;
      box(ctx, 0.04, 0.10, 0.04, hx - 0.1, hy - 0.02, 0.05, WOOD);
      break;
    }
    case "spear": {
      const shaft = cyl(ctx, 0.045, 0.045, 1.55, hx - 0.02, hy + 0.18, 0.02, WOOD);
      shaft.rotation.z = -0.42;
      const tip = cyl(ctx, 0.005, 0.10, 0.26, hx + 0.56, hy + 0.86, 0.02, STEEL);
      tip.rotation.z = -0.42;
      break;
    }
    case "bow": {
      // Łuk: trzy segmenty łamane — pełny łuk wymagałby torusa z wycinkiem.
      const mid = cyl(ctx, 0.05, 0.05, 0.55, hx, hy + 0.18, 0.06, WOOD);
      const upper = cyl(ctx, 0.04, 0.05, 0.42, hx - 0.09, hy + 0.62, 0.06, WOOD);
      upper.rotation.z = 0.45;
      const lower = cyl(ctx, 0.05, 0.04, 0.42, hx - 0.09, hy - 0.26, 0.06, WOOD);
      lower.rotation.z = -0.45;
      void mid;
      break;
    }
    case "axe": {
      const shaft = cyl(ctx, 0.06, 0.06, 1.0, hx, hy + 0.3, 0.03, WOOD);
      shaft.rotation.z = -0.3;
      const head = box(ctx, 0.30, 0.34, 0.07, hx + 0.26, hy + 0.76, 0.03, STEEL);
      head.rotation.z = -0.3;
      box(ctx, 0.12, 0.34, 0.09, hx + 0.16, hy + 0.74, 0.03, STEEL_DARK, { rz: -0.3 });
      break;
    }
    case "staff": {
      const shaft = cyl(ctx, 0.05, 0.055, 1.55, hx - 0.04, hy + 0.28, 0.02, WOOD);
      shaft.rotation.z = -0.12;
      // Kryształ na szczycie — świeci, więc kaster jest rozpoznawalny z dystansu.
      sph(ctx, 0.20, hx + 0.05, hy + 1.06, 0.02, plan.accent, { emissive: 1 });
      break;
    }
    case "claws": {
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const c = cyl(ctx, 0.005, 0.035, 0.20, side * 0.3, 0.16, 0.3 + i * 0.06, BONE);
          c.rotation.x = -0.8;
          c.rotation.z = side * 0.3;
        }
      }
      break;
    }
  }
}

/** Pełzacz: niski, sześcionożny, z workami jadu na grzbiecie. */
const CRAWLER_BODY_Y = 0.34;

function buildCrawler(ctx: Ctx, plan: BodyPlan, primary: number): void {
  const dark = shade(primary, 0.62);
  const bodyY = CRAWLER_BODY_Y;

  // Odwłok — spłaszczona kula, dłuższa niż szersza.
  const abdomen = sph(ctx, 0.62, 0, bodyY, -0.12, primary);
  abdomen.scaling.set(1, 0.72, 1.25);

  // Worki jadu: świecące bąble na grzbiecie. To one czytają „wybuchowy".
  sph(ctx, 0.20, -0.14, bodyY + 0.20, -0.20, plan.accent, { emissive: 0.85 });
  sph(ctx, 0.16, 0.12, bodyY + 0.19, -0.34, plan.accent, { emissive: 0.85 });
  sph(ctx, 0.13, 0.02, bodyY + 0.22, -0.02, plan.accent, { emissive: 0.85 });

  buildHead(ctx, plan, primary, bodyY - 0.1);

  // Sześć odnóży, po trzy na stronę, każde pod innym kątem. Strony trafiają
  // do osobnych siatek jak nogi dwunoga — pełzacz nie chodzi, tylko przebiera
  // odnóżami, ale ten sam wymach naprzemienny czyta się jako bieg owada.
  // Współrzędne są względem biodra (`bodyY`), bo tam jest oś obrotu.
  for (const [side, into] of [[-1, ctx.legL], [1, ctx.legR]] as const) {
    ctx.into = into;
    for (let i = 0; i < 3; i++) {
      const z = -0.32 + i * 0.28;
      const upper = cyl(ctx, 0.06, 0.07, 0.34, side * 0.30, 0.06, z, dark);
      upper.rotation.z = side * 0.95;
      const lower = cyl(ctx, 0.04, 0.06, 0.32, side * 0.50, -0.14, z, dark);
      lower.rotation.z = side * -0.35;
    }
  }
  ctx.into = ctx.parts;

  buildWeapon(ctx, plan, BUILDS.crawler, bodyY);
}

// ────────────────────────────────────────────────────────────── szablony

const templates = new Map<string, BodyTemplate>();

/**
 * Szablon postaci: tułów oraz dwie nogi jako **osobne** siatki. Podział jest
 * ceną animacji — instancja Babylona nie ma własnej hierarchii, więc noga,
 * która ma się bujać niezależnie od tułowia, musi być własną siatką.
 * Koszt: trzy macierze na postać zamiast jednej.
 */
export interface BodyTemplate {
  body: Mesh;
  legL: Mesh | null;
  legR: Mesh | null;
  /** Wysokość osi obrotu nóg (biodro) w metrach — punkt montażu instancji. */
  hipY: number;
  /**
   * Skala wymachu. Odnóża owada przebierają drobno — ten sam kąt co u dwunoga
   * wyglądałby jak wiosłowanie, więc pełzacz dostaje ułamek amplitudy.
   */
  swingScale: number;
}

function mergeGroup(parts: Mesh[], name: string, scale: number): Mesh | null {
  if (parts.length === 0) return null;
  const merged =
    parts.length === 1
      ? parts[0]!
      : (Mesh.MergeMeshes(parts, true, true, undefined, false, true) ?? parts[0]!);

  if (scale !== 1) {
    merged.scaling.setAll(scale);
    merged.bakeCurrentTransformIntoVertices();
  }
  merged.name = name;
  merged.isVisible = false;
  merged.isPickable = false;
  return merged;
}

/**
 * Zamienia opis stworzenia z rdzenia na plan bryły. Rdzeń mówi „krępy, rogaty,
 * z dwuręcznym mieczem" — nazwy pokrywają się ze słownikiem tego modułu, więc
 * tłumaczenie jest sprawdzeniem, nie mapowaniem. Nieznana wartość spada na
 * bezpieczny domyślnik: proceduralny wróg ma wyglądać dziwnie, a nie wysypać
 * renderer.
 */
export function planFromAppearance(a: {
  build: string;
  head: string;
  weapon: string;
  shield?: boolean;
  cape?: boolean;
  accent: number;
  scale?: number;
}): BodyPlan {
  const build = (BUILDS[a.build as Build] ? a.build : "normal") as Build;
  const head = (HEADS.has(a.head) ? a.head : "helmet") as HeadKind;
  const weapon = (WEAPONS.has(a.weapon) ? a.weapon : "sword") as Weapon;
  return {
    build,
    head,
    weapon,
    shield: a.shield,
    cape: a.cape,
    accent: a.accent,
    scale: a.scale,
  };
}

const HEADS = new Set<string>(["helmet", "goblin", "skull", "orc", "hooded", "horned", "insect"]);
const WEAPONS = new Set<string>([
  "sword", "dagger", "spear", "bow", "axe", "staff", "greatsword", "claws",
]);

export function getBodyTemplate(
  scene: Scene,
  id: string,
  primary: number,
  override?: BodyPlan,
): BodyTemplate {
  const key = `${id}|${primary}`;
  const cached = templates.get(key);
  if (cached) return cached;

  const plan = override ?? PLANS[id] ?? PLANS.player!;
  const ctx: Ctx = { scene, parts: [], legL: [], legR: [], into: [] };
  ctx.into = ctx.parts;
  buildBody(ctx, plan, primary);

  const scale = plan.scale ?? 1;
  const template: BodyTemplate = {
    body: mergeGroup(ctx.parts, `body_${key}`, scale)!,
    legL: mergeGroup(ctx.legL, `legL_${key}`, scale),
    legR: mergeGroup(ctx.legR, `legR_${key}`, scale),
    hipY: (plan.build === "crawler" ? CRAWLER_BODY_Y : BUILDS[plan.build].legH) * scale,
    swingScale: plan.build === "crawler" ? 0.45 : 1,
  };
  templates.set(key, template);
  return template;
}

/**
 * Wysokość bryły w metrach — do pasków HP i efektów nad głową. Potwory
 * generowane nie mają wpisu w `PLANS`, więc plan trzeba podać; bez tego pasek
 * HP kolosa wisiałby na wysokości człowieka.
 */
export function bodyHeight(id: string, radiusMeters: number, override?: BodyPlan): number {
  const plan = override ?? PLANS[id] ?? PLANS.player!;
  const base = BUILDS[plan.build].height * (plan.scale ?? 1);
  return base * (radiusMeters / REFERENCE_RADIUS);
}

/** Mnożnik skali instancji: promień kolizji → skala szablonu. */
export function scaleForRadius(radiusMeters: number): number {
  return radiusMeters / REFERENCE_RADIUS;
}
