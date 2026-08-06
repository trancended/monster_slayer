/**
 * Areny: biom, horyzont i losowe przeszkody — nowa arena po każdym wygranym poziomie.
 *
 * Wcześniej arena była jedna: pięć filarów na okręgu, ten sam kolor od pierwszego
 * do dwusetnego encounteru. Po dziesięciu falach gracz przestawał widzieć postęp,
 * bo **nic w kadrze się nie zmieniało** — rosły tylko liczby.
 *
 * Trzy zasady, które trzymają to w ryzach:
 *
 * 1. **Determinizm.** Układ areny to czysta funkcja `(ziarno świata, runda)`.
 *    Nic się nie zapisuje: po F5 wracasz na tę samą arenę, a headless symulator
 *    balansu widzi dokładnie to, co gracz (GDD §11.3).
 *
 * 2. **Biom to semantyka miejsca, nie szczegół renderowania.** „Mroźny Szelf jest
 *    lodowy i niebieski" mówi to samo w 3D, w 2D i w opisie tekstowym — dokładnie
 *    jak `EnemyDef.appearance` opisuje stworzenie, a nie jego bryły. Dlatego
 *    paleta mieszka tutaj, obok reguł kolizji, a nie w warstwie graficznej.
 *
 * 3. **Losowość nie może zepsuć walki.** Środek zostaje pusty (tam wraca gracz
 *    po śmierci), pierścień krawędziowy zostaje przejezdny (tam wchodzą wrogowie),
 *    a każda arena ma minimum dwie przeszkody zrywające linię wzroku wrogom
 *    dystansowym (GDD §9.3). Reszta jest losowa.
 */
import { Rng } from "../core/rng.ts";
import { TAU } from "../core/math.ts";

export const ARENA_RADIUS = 19;

/**
 * Co ile rund zmienia się biom, czyli kolor areny i widok na horyzoncie.
 * Pięć rund to pełny rytm strefy (lekki → średni → ciężki → boss), więc zmiana
 * wypada razem z domknięciem etapu, a nie w jego środku.
 */
export const ROUNDS_PER_BIOME = 5;

/** Rodzaj przeszkody. Symulacja czyta z niej tylko `r`; kształt to sprawa renderera. */
export type PropKind = "rock" | "tree" | "pillar" | "crystal" | "stump" | "bones";

/** Widok na horyzoncie. Renderer buduje z tego bryły, rdzeń zna tylko nazwę. */
export type BackdropKind =
  | "peaks"
  | "forest"
  | "spires"
  | "dunes"
  | "glacier"
  | "ruins"
  | "void"
  | "volcano"
  | "marsh"
  | "steppe";

/** Co świeci nad areną. `none` zostawia samo niebo — wtedy klimat robi mgła. */
export type SkyBody = "sun" | "moon" | "ringed" | "eclipse" | "none";

export interface Obstacle {
  x: number;
  y: number;
  /** Promień kolizji. Jedyne pole tej struktury, które czyta symulacja. */
  r: number;
  kind: PropKind;
  /** Wysokość w metrach — renderer skaluje bryłę, sim jej nie zna. */
  h: number;
  /** Obrót wokół pionu. Dwie takie same skały obok siebie czytają się jak kopia. */
  rot: number;
  /** Ziarno wariantu: renderer dobiera z niego drobne różnice kształtu. */
  variant: number;
}

export interface BiomeDef {
  id: string;
  /** Nazwa arenowa — HUD pokazuje ją po każdym przejściu. */
  name: string;
  /** Mgła i kolor kadru. To ona niesie klimat (patrz `render3d/scene.ts`). */
  fog: number;
  /** Podłoże poza areną i płyta areny. */
  ground: number;
  groundInner: number;
  /** Świecący rant areny. */
  rim: number;
  /** Kolor przeszkód i ich świecącego akcentu (runy, kryształy, liście). */
  prop: number;
  propAccent: number;
  /** Barwa słońca i wypełnienia — chłodne bagno kontra rozpalona kuźnia. */
  sun: number;
  ambientSky: number;
  ambientGround: number;
  backdrop: BackdropKind;
  sky: {
    body: SkyBody;
    bodyColor: number;
    /** Barwa u horyzontu; zenit renderer wyprowadza z niej, gasząc ją do mgły. */
    haze: number;
    /** Wstęgi zorzy. Kosztują kilka przezroczystych plansz, więc tylko tam, gdzie mają sens. */
    aurora?: boolean;
  };
  /** Z czego są przeszkody na tej arenie. Pierwszy wpis dominuje. */
  props: PropKind[];
  /** Ile przeszkód losować: `[min, max]`. Gaj jest gęsty, wydmy puste. */
  density: [number, number];
}

/*
 * Dwadzieścia cztery biomy = sto dwadzieścia rund bez powtórki. Potem cykl
 * wraca, ale układ przeszkód i horyzont losują się z numeru rundy, więc
 * „Popielna Równina" w rundzie 121 nie jest tą samą planszą co w rundzie 1.
 */
export const BIOMES: readonly BiomeDef[] = [
  {
    id: "ashen_plain",
    name: "Popielna Równina",
    fog: 0x140f0d,
    ground: 0x241c18,
    groundInner: 0x372b23,
    rim: 0xff7a3d,
    prop: 0x4a3f38,
    propAccent: 0xff6a2a,
    sun: 0xffd2a8,
    ambientSky: 0x6b4436,
    ambientGround: 0x1d1310,
    backdrop: "volcano",
    sky: { body: "eclipse", bodyColor: 0xff8b45, haze: 0x5a2a1c },
    props: ["rock", "stump", "bones"],
    density: [6, 9],
  },
  {
    id: "emerald_grove",
    name: "Szmaragdowy Gaj",
    fog: 0x0a1410,
    ground: 0x14251b,
    groundInner: 0x1f3a28,
    rim: 0x6ee8a8,
    prop: 0x3f6b3a,
    propAccent: 0x9be34a,
    sun: 0xfff2c8,
    ambientSky: 0x3f6f52,
    ambientGround: 0x101a14,
    backdrop: "forest",
    sky: { body: "sun", bodyColor: 0xfff0b0, haze: 0x2c5240 },
    props: ["tree", "rock", "stump"],
    density: [8, 12],
  },
  {
    id: "frost_shelf",
    name: "Mroźny Szelf",
    fog: 0x0b1420,
    ground: 0x1a2634,
    groundInner: 0x2b3d50,
    rim: 0x8fe8ff,
    prop: 0x6a90a8,
    propAccent: 0xbdf0ff,
    sun: 0xdcefff,
    ambientSky: 0x46708f,
    ambientGround: 0x131b26,
    backdrop: "glacier",
    sky: { body: "moon", bodyColor: 0xd8ecff, haze: 0x27455f, aurora: true },
    props: ["crystal", "rock"],
    density: [5, 8],
  },
  {
    id: "sunken_marsh",
    name: "Zatopione Moczary",
    fog: 0x0d1410,
    ground: 0x1a2317,
    groundInner: 0x27331f,
    rim: 0x9be34a,
    prop: 0x4a5a32,
    propAccent: 0xd4ff4a,
    sun: 0xe8f0b8,
    ambientSky: 0x415838,
    ambientGround: 0x131a12,
    backdrop: "marsh",
    sky: { body: "moon", bodyColor: 0xcfe8a8, haze: 0x2e4030 },
    props: ["tree", "stump", "bones"],
    density: [7, 11],
  },
  {
    id: "crimson_dunes",
    name: "Karmazynowe Wydmy",
    fog: 0x1a0f0b,
    ground: 0x3a2418,
    groundInner: 0x4e3220,
    rim: 0xffa23d,
    prop: 0x7a4a28,
    propAccent: 0xffc76a,
    sun: 0xffd090,
    ambientSky: 0x8a4f2c,
    ambientGround: 0x24140c,
    backdrop: "dunes",
    sky: { body: "sun", bodyColor: 0xff9a4a, haze: 0x7a3a1e },
    props: ["rock", "bones"],
    density: [4, 7],
  },
  {
    id: "void_terrace",
    name: "Taras Pustki",
    fog: 0x0a0812,
    ground: 0x171327,
    groundInner: 0x241d3c,
    rim: 0xc06bff,
    prop: 0x3b3160,
    propAccent: 0xb07cff,
    sun: 0xd8c8ff,
    ambientSky: 0x4a3a7a,
    ambientGround: 0x120e1e,
    backdrop: "void",
    sky: { body: "ringed", bodyColor: 0x9b6bff, haze: 0x2a2048, aurora: true },
    props: ["crystal", "pillar"],
    density: [5, 8],
  },
  {
    id: "bone_yard",
    name: "Kostnica",
    fog: 0x14120e,
    ground: 0x2a2620,
    groundInner: 0x3d372c,
    rim: 0xffe1a8,
    prop: 0x8c8271,
    propAccent: 0xff5a3c,
    sun: 0xffeccf,
    ambientSky: 0x6a5c46,
    ambientGround: 0x1a1610,
    backdrop: "ruins",
    sky: { body: "moon", bodyColor: 0xf0e2c0, haze: 0x4a3f2e },
    props: ["bones", "pillar", "stump"],
    density: [7, 10],
  },
  {
    id: "rust_foundry",
    name: "Rdzawa Kuźnia",
    fog: 0x120e0c,
    ground: 0x241c19,
    groundInner: 0x3a2a22,
    rim: 0xffb03d,
    prop: 0x6d5a4a,
    propAccent: 0xff8c1a,
    sun: 0xffd9a0,
    ambientSky: 0x6f4a30,
    ambientGround: 0x1b1310,
    backdrop: "spires",
    sky: { body: "none", bodyColor: 0xff8c1a, haze: 0x5a3420 },
    props: ["pillar", "rock"],
    density: [6, 9],
  },
  {
    id: "azure_cliffs",
    name: "Lazurowe Urwiska",
    fog: 0x0a1018,
    ground: 0x172530,
    groundInner: 0x223a48,
    rim: 0x7ce0ff,
    prop: 0x40606e,
    propAccent: 0x9be8ff,
    sun: 0xe6f4ff,
    ambientSky: 0x3f6f8f,
    ambientGround: 0x101a20,
    backdrop: "peaks",
    sky: { body: "sun", bodyColor: 0xffe9cf, haze: 0x2a4a62 },
    props: ["tree", "rock"],
    density: [6, 9],
  },
  {
    id: "golden_steppe",
    name: "Złocisty Step",
    fog: 0x141008,
    ground: 0x2c2412,
    groundInner: 0x40341a,
    rim: 0xffd166,
    prop: 0x6b5a2c,
    propAccent: 0xffe08a,
    sun: 0xffe6a8,
    ambientSky: 0x7a6030,
    ambientGround: 0x1c160c,
    backdrop: "steppe",
    sky: { body: "moon", bodyColor: 0xfff0c0, haze: 0x5a4620 },
    props: ["tree", "stump", "rock"],
    density: [5, 8],
  },
  {
    id: "obsidian_maw",
    name: "Obsydianowa Paszcza",
    fog: 0x0c0a0c,
    ground: 0x18161a,
    groundInner: 0x241f26,
    rim: 0xff4a5a,
    prop: 0x2a2630,
    propAccent: 0xff3b30,
    sun: 0xffb8b0,
    ambientSky: 0x5a2a34,
    ambientGround: 0x120f12,
    backdrop: "volcano",
    sky: { body: "eclipse", bodyColor: 0xff3b30, haze: 0x3a1620 },
    props: ["pillar", "crystal", "rock"],
    density: [6, 9],
  },
  {
    id: "pale_bloom",
    name: "Blade Kwiecie",
    fog: 0x120e16,
    ground: 0x241d29,
    groundInner: 0x35293c,
    rim: 0xffa8e0,
    prop: 0x5a4462,
    propAccent: 0xffb0e8,
    sun: 0xffe4f4,
    ambientSky: 0x6a4a72,
    ambientGround: 0x1a1420,
    backdrop: "forest",
    sky: { body: "ringed", bodyColor: 0xffc0e8, haze: 0x4a2c52, aurora: true },
    props: ["tree", "crystal", "stump"],
    density: [8, 11],
  },
  {
    id: "storm_reach",
    name: "Burzowy Zasięg",
    fog: 0x0c1018,
    ground: 0x1b2430,
    groundInner: 0x2a3745,
    rim: 0xa8d8ff,
    prop: 0x4a5a68,
    propAccent: 0xdcefff,
    sun: 0xdce8ff,
    ambientSky: 0x46607f,
    ambientGround: 0x121820,
    backdrop: "peaks",
    sky: { body: "eclipse", bodyColor: 0xa8d8ff, haze: 0x35506e, aurora: true },
    props: ["pillar", "rock"],
    density: [6, 9],
  },
  {
    id: "amber_woods",
    name: "Bursztynowy Bór",
    fog: 0x120f0a,
    ground: 0x261e14,
    groundInner: 0x3a2e1c,
    rim: 0xffc266,
    prop: 0x6b4a24,
    propAccent: 0xffcf7a,
    sun: 0xffe8b8,
    ambientSky: 0x6e5232,
    ambientGround: 0x181208,
    backdrop: "forest",
    sky: { body: "sun", bodyColor: 0xffd28a, haze: 0x5a3f22 },
    props: ["tree", "stump", "rock"],
    density: [9, 13],
  },
  {
    id: "salt_flats",
    name: "Solne Pustacie",
    fog: 0x141416,
    ground: 0x2e2e30,
    groundInner: 0x424246,
    rim: 0xe8f0ff,
    prop: 0x8a8a92,
    propAccent: 0xffffff,
    sun: 0xf4f4ff,
    ambientSky: 0x6a6a74,
    ambientGround: 0x18181c,
    backdrop: "dunes",
    sky: { body: "sun", bodyColor: 0xe0e4ee, haze: 0x50505a },
    props: ["rock", "bones"],
    density: [4, 7],
  },
  {
    id: "ember_gorge",
    name: "Żarowy Jar",
    fog: 0x120a08,
    ground: 0x261410,
    groundInner: 0x3a1e16,
    rim: 0xff6a2a,
    prop: 0x4a2418,
    propAccent: 0xff8a3d,
    sun: 0xffc0a0,
    ambientSky: 0x6e2e1c,
    ambientGround: 0x180c08,
    backdrop: "volcano",
    sky: { body: "none", bodyColor: 0xff6a2a, haze: 0x50201a },
    props: ["rock", "pillar", "crystal"],
    density: [6, 9],
  },
  {
    id: "mirror_lake",
    name: "Lustrzana Toń",
    fog: 0x0a1216,
    ground: 0x14262c,
    groundInner: 0x1e3a42,
    rim: 0x7cf0e0,
    prop: 0x2e5a5e,
    propAccent: 0x9bffee,
    sun: 0xdcfff8,
    ambientSky: 0x3a6e70,
    ambientGround: 0x0e1a1e,
    backdrop: "marsh",
    sky: { body: "moon", bodyColor: 0xd8fff4, haze: 0x28484e, aurora: true },
    props: ["tree", "crystal", "stump"],
    density: [7, 10],
  },
  {
    id: "iron_wastes",
    name: "Żelazne Pustkowia",
    fog: 0x101216,
    ground: 0x212630,
    groundInner: 0x323844,
    rim: 0xbfe4ff,
    prop: 0x5a6270,
    propAccent: 0xcfe8ff,
    sun: 0xe8f0ff,
    ambientSky: 0x505c70,
    ambientGround: 0x14181e,
    backdrop: "spires",
    sky: { body: "eclipse", bodyColor: 0xbfe4ff, haze: 0x3a4453 },
    props: ["pillar", "rock", "bones"],
    density: [7, 10],
  },
  {
    id: "violet_barrens",
    name: "Fioletowe Ugory",
    fog: 0x100c16,
    ground: 0x201a2a,
    groundInner: 0x30263e,
    rim: 0xb07cff,
    prop: 0x4a3a62,
    propAccent: 0xc79bff,
    sun: 0xe8dcff,
    ambientSky: 0x5a4680,
    ambientGround: 0x16101e,
    backdrop: "steppe",
    sky: { body: "ringed", bodyColor: 0xc79bff, haze: 0x3a2c56, aurora: true },
    props: ["stump", "crystal", "tree"],
    density: [6, 9],
  },
  {
    id: "bleached_reef",
    name: "Wyblakła Rafa",
    fog: 0x0e1214,
    ground: 0x1e2a2c,
    groundInner: 0x2e3e40,
    rim: 0xffe8c0,
    prop: 0x7a8a80,
    propAccent: 0xfff0d0,
    sun: 0xfff4e0,
    ambientSky: 0x5e7068,
    ambientGround: 0x121a1a,
    backdrop: "ruins",
    sky: { body: "sun", bodyColor: 0xffe0b0, haze: 0x44544e },
    props: ["bones", "pillar", "rock"],
    density: [8, 11],
  },
  {
    id: "nightbloom",
    name: "Nocny Kwiat",
    fog: 0x0c0e16,
    ground: 0x1a1e2e,
    groundInner: 0x282e44,
    rim: 0xff7ac0,
    prop: 0x3e3a5e,
    propAccent: 0xff9bd8,
    sun: 0xf0dcff,
    ambientSky: 0x4a4278,
    ambientGround: 0x10121c,
    backdrop: "forest",
    sky: { body: "moon", bodyColor: 0xffb0e0, haze: 0x302c4e, aurora: true },
    props: ["tree", "crystal"],
    density: [9, 12],
  },
  {
    id: "cinder_steps",
    name: "Żużlowe Stopnie",
    fog: 0x0e0c0a,
    ground: 0x1e1a16,
    groundInner: 0x2e2822,
    rim: 0xff9a4a,
    prop: 0x3e3630,
    propAccent: 0xffb066,
    sun: 0xffd8b0,
    ambientSky: 0x60483a,
    ambientGround: 0x120e0c,
    backdrop: "ruins",
    sky: { body: "none", bodyColor: 0xff9a4a, haze: 0x463228 },
    props: ["pillar", "stump", "rock"],
    density: [7, 10],
  },
  {
    id: "glass_desert",
    name: "Szklana Pustynia",
    fog: 0x140f14,
    ground: 0x2c2230,
    groundInner: 0x3e3244,
    rim: 0xd8a8ff,
    prop: 0x6a5a7a,
    propAccent: 0xe8c0ff,
    sun: 0xf4e0ff,
    ambientSky: 0x70588a,
    ambientGround: 0x181218,
    backdrop: "dunes",
    sky: { body: "ringed", bodyColor: 0xd8a8ff, haze: 0x5a4468 },
    props: ["crystal", "rock"],
    density: [5, 8],
  },
  {
    id: "deep_hollow",
    name: "Głucha Czeluść",
    fog: 0x08090c,
    ground: 0x14161c,
    groundInner: 0x20242c,
    rim: 0x7ce0ff,
    prop: 0x2a2e38,
    propAccent: 0x9be8ff,
    sun: 0xc8e0f0,
    ambientSky: 0x2e3a4a,
    ambientGround: 0x0c0e12,
    backdrop: "void",
    sky: { body: "none", bodyColor: 0x7ce0ff, haze: 0x1c2430, aurora: true },
    props: ["crystal", "pillar", "bones"],
    density: [5, 8],
  },
];

/**
 * Wymiary przeszkód wg rodzaju. Promień to kolizja **i** zasłona dla pocisków
 * (`world.updateProjectiles`), więc pień drzewa jest cienki celowo: gaj ma
 * utrudniać strzelanie, a nie zamieniać arenę w labirynt.
 */
const PROP_SHAPES: Record<PropKind, { r: [number, number]; h: [number, number] }> = {
  rock: { r: [0.95, 1.5], h: [0.9, 2.0] },
  tree: { r: [0.55, 0.8], h: [4.2, 7.5] },
  pillar: { r: [0.85, 1.15], h: [3.0, 5.2] },
  crystal: { r: [0.7, 1.15], h: [2.2, 4.2] },
  stump: { r: [0.6, 0.95], h: [0.7, 1.3] },
  bones: { r: [0.8, 1.25], h: [1.4, 2.8] },
};

/** Od tego promienia przeszkoda realnie zrywa linię wzroku (GDD §9.3). */
const BLOCKER_RADIUS = 0.9;

/** Ile takich zasłon gwarantujemy na każdej arenie. */
export const MIN_BLOCKERS = 2;

/** Pusty środek: punkt odrodzenia gracza plus miejsce na walkę wokół niego. */
const CENTER_KEEPOUT = 4.6;

/**
 * Ile metrów od krawędzi zostaje wolne. Wrogowie wchodzą na `ARENA_RADIUS − 1.5`
 * (`World.edgePoint`), więc pierścień wejściowy musi być przejezdny — inaczej
 * pakiet wysypuje się w kamień i przez sekundę rozpycha się w miejscu.
 */
const EDGE_KEEPOUT = 3.4;

/** Minimalny prześwit między przeszkodami — tyle, żeby dało się przejść i uniknąć. */
const MIN_GAP = 1.35;

export interface ArenaLayout {
  /** Numer rundy, dla której powstał ten układ. */
  round: number;
  /** Numer biomu od początku gry, licząc od 1 — HUD mówi „Arena III". */
  biomeIndex: number;
  biome: BiomeDef;
  obstacles: Obstacle[];
  /** Ziarno wariantów horyzontu: ten sam biom w rundzie 6 i 66 ma inny widok. */
  seed: number;
}

/** Biom rundy wraz z jego numerem porządkowym (od 0). */
export function biomeForRound(round: number): { biome: BiomeDef; index: number } {
  const safe = Math.max(1, Math.floor(round));
  const index = Math.floor((safe - 1) / ROUNDS_PER_BIOME);
  return { biome: BIOMES[index % BIOMES.length]!, index };
}

/**
 * Pierwszy wpis `props` dominuje: waga maleje liniowo z pozycją na liście.
 * Dzięki temu gaj jest z drzew z paroma kamieniami, a nie mieszanką pół na pół —
 * arena ma mieć rozpoznawalny motyw, nie inwentarz rekwizytów.
 */
function pickKind(props: readonly PropKind[], rng: Rng): PropKind {
  let total = 0;
  for (let i = 0; i < props.length; i++) total += props.length - i;
  let roll = rng.range(0, total);
  for (let i = 0; i < props.length; i++) {
    roll -= props.length - i;
    if (roll <= 0) return props[i]!;
  }
  return props[props.length - 1]!;
}

/**
 * Wolne miejsce dla przeszkody o promieniu `r`. Losujemy równomiernie **po
 * powierzchni** pierścienia (stąd pierwiastek) — losowanie po promieniu upychałoby
 * przeszkody w środku, bo tam okrąg jest krótszy.
 */
function findSpot(
  rng: Rng,
  r: number,
  placed: readonly Obstacle[],
  avoid: readonly { x: number; y: number; r: number }[],
): { x: number; y: number } | null {
  const inner = CENTER_KEEPOUT + r;
  const outer = ARENA_RADIUS - EDGE_KEEPOUT - r;
  if (outer <= inner) return null;

  for (let attempt = 0; attempt < 28; attempt++) {
    const a = rng.range(0, TAU);
    const d = Math.sqrt(rng.range(inner * inner, outer * outer));
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;

    let ok = true;
    for (const o of placed) {
      if (Math.hypot(x - o.x, y - o.y) < o.r + r + MIN_GAP) {
        ok = false;
        break;
      }
    }
    if (ok) {
      for (const a2 of avoid) {
        if (Math.hypot(x - a2.x, y - a2.y) < a2.r + r + MIN_GAP) {
          ok = false;
          break;
        }
      }
    }
    if (ok) return { x, y };
  }
  return null;
}

/**
 * Układ areny dla rundy. `avoid` to punkty, na których nie wolno nic postawić —
 * przede wszystkim aktualna pozycja gracza: arena zmienia się w trakcie oddechu,
 * więc drzewo nie ma prawa wyrosnąć tam, gdzie ktoś stoi.
 */
export function generateArena(
  round: number,
  worldSeed: number,
  avoid: readonly { x: number; y: number; r: number }[] = [],
): ArenaLayout {
  const safeRound = Math.max(1, Math.floor(round));
  const { biome, index } = biomeForRound(safeRound);

  // Osobny strumień na rundę: dołożenie rundy nie przesuwa poprzednich, więc
  // arena nr 7 wygląda tak samo niezależnie od tego, kiedy się na niej stanie.
  const seed = ((worldSeed ^ 0x5eed10c5) + safeRound * 0x9e3779b9) >>> 0;
  const rng = new Rng(seed);

  const obstacles: Obstacle[] = [];
  const wanted = rng.int(biome.density[0], biome.density[1]);
  const blockerKinds = biome.props.filter((k) => PROP_SHAPES[k].r[1] >= BLOCKER_RADIUS);

  for (let i = 0; i < wanted; i++) {
    // Pierwsze dwie przeszkody muszą zrywać linię wzroku. Bez nich łucznicy
    // strzelają przez całą arenę i jedyną odpowiedzią jest bieg w ich stronę.
    const forceBlocker = i < MIN_BLOCKERS && blockerKinds.length > 0;
    const kind = forceBlocker ? rng.pick(blockerKinds) : pickKind(biome.props, rng);
    const shape = PROP_SHAPES[kind];
    const rMin = forceBlocker ? Math.max(shape.r[0], BLOCKER_RADIUS) : shape.r[0];
    const r = rng.range(rMin, shape.r[1]);

    const spot = findSpot(rng, r, obstacles, avoid);
    // Brak miejsca kończy dokładanie: lepiej arena luźniejsza od zamierzonej
    // niż taka, przez którą nie da się przejść.
    if (!spot) continue;

    obstacles.push({
      x: spot.x,
      y: spot.y,
      r,
      kind,
      h: rng.range(shape.h[0], shape.h[1]),
      rot: rng.range(0, TAU),
      variant: rng.nextUint32(),
    });
  }

  return { round: safeRound, biomeIndex: index + 1, biome, obstacles, seed };
}
