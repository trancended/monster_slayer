/**
 * Proceduralny bestiariusz — nowi bossowie i nowe jednostki bez końca.
 *
 * Ręcznie pisany roster kończy się po ośmiu wpisach; gra idle ma trwać setki
 * encounterów. Ten moduł generuje **każdego kolejnego bossa jako inną walkę**
 * i po każdym z nich odblokowuje nowe typy sług.
 *
 * Trzy zasady, które trzymają to w ryzach:
 *
 * 1. **Determinizm.** Bestiariusz to czysta funkcja `(ziarno, liczba tierów)`.
 *    Nic się nie zapisuje — po przeładowaniu strony wychodzą te same potwory,
 *    a `defIdx` zapisane przy encji dalej wskazuje na to samo (GDD §11.3).
 *
 * 2. **Zestawy ataków bez powtórzeń.** Bossowie losują zestaw z tasowanej
 *    talii, a nie niezależnym rzutem. Niezależne losowanie z siedmiu zestawów
 *    daje dwóch bossów pod rząd z tym samym w jednym przypadku na siedem —
 *    czyli regularnie, a gracz to natychmiast czyta jako „ta sama walka".
 *
 * 3. **Żadnych atrybutów na niby.** `GENERATED_TRAITS` wylicza wyłącznie cechy,
 *    które symulacja naprawdę wykonuje; pilnuje tego test. Wygenerowanie cechy,
 *    której nikt nie odczytuje, dałoby bossa opisanego jako „regenerujący",
 *    który się nie regeneruje.
 */
import { Rng } from "../core/rng.ts";
import type { EnemyDef } from "../data/schema.ts";

/**
 * Cechy, które symulacja realnie wykonuje. Każdy wpis ma swoje miejsce
 * odczytu — kolejność jak w kodzie: `ai.ts` (aura, enrage, summon),
 * `world.ts` (frontalBlock, poisonPool, thorns).
 */
export const GENERATED_TRAITS = [
  "aura",
  "frontalBlock",
  "poisonPool",
  "enrage",
  "thorns",
  "summon",
] as const;

export type GeneratedTrait = (typeof GENERATED_TRAITS)[number];

/** Ile tierów bossów budujemy z góry. 80 bossów to ~400 encounterów. */
export const MAX_BOSS_TIERS = 80;

/**
 * Ile gatunków budujemy z góry: szesnaście szablonów w dwóch cyklach nazw.
 * Gatunek zmienia się co dziesięć rund, czyli po dwóch pokonanych bossach —
 * 32 gatunki pokrywają ~320 rund, a bossowie sięgają dalej niż to.
 */
export const MAX_SPECIES = 32;

/** Ile jednostek ma gatunek: po jednej na archetyp, żeby fala miała rytm. */
export const UNITS_PER_SPECIES = 5;

/** Co ile rund wchodzi nowy gatunek. */
export const ROUNDS_PER_SPECIES = 10;

/**
 * Ilu bossów trzeba pokonać na jeden gatunek. Dwa progi (rundy i bossowie)
 * pilnują tego samego tempa z dwóch stron: gatunek jest nagrodą za bossów,
 * a nie za przewinięcie licznika fal.
 */
export const BOSSES_PER_SPECIES = 2;

/**
 * Ile ostatnich zestawów ataku jest zablokowanych przy losowaniu kolejnego.
 * Cztery to najwięcej, co da się zagwarantować przy siedmiu zestawach bez
 * zapętlenia doboru.
 */
const MIN_KIT_GAP = 4;

/** Ile nowych typów sług wchodzi po każdym pokonanym bossie. */
export const UNLOCKS_PER_BOSS = 2;

// ─────────────────────────────────────────────────────────── zestawy ataków

interface AttackKit {
  id: string;
  /** Człon nazwy bossa — nazwa ma zapowiadać, co on robi. */
  epithet: string;
  archetype: string;
  weapon: string;
  build: string;
  /** Zdanie do dziennika: czego gracz ma się spodziewać. */
  tell: string;
  make(rng: Rng): EnemyDef["attack"];
}

/*
 * Każdy zestaw używa wyłącznie pól, które `ai.ts` faktycznie wykonuje:
 * `melee` czyta `range`/`arcDeg`, `combo` dokłada `hits`/`hitInterval`,
 * `projectile` wymaga podobiektu `projectile`, `charge` — `chargeSpeed`.
 * `shape` steruje telegrafem i **musi** zgadzać się z rzeczywistym zasięgiem,
 * inaczej telegraf kłamie (GDD §10.3).
 */
const KITS: AttackKit[] = [
  {
    id: "whirl",
    epithet: "Wichru",
    archetype: "miniboss",
    weapon: "greatsword",
    build: "heavy",
    tell: "seria szerokich cięć — wyjdź bokiem, nie do tyłu",
    make: (rng) => ({
      kind: "combo",
      range: 3.2,
      telegraph: 0.62,
      active: 0.2,
      recovery: 0.75,
      cooldown: 2.1,
      poiseDamage: 16,
      knockback: 0.35,
      shape: "cone",
      arcDeg: 130,
      hits: rng.int(3, 5),
      hitInterval: 0.26,
    }),
  },
  {
    id: "taran",
    epithet: "Taranu",
    archetype: "miniboss",
    weapon: "axe",
    build: "hulking",
    tell: "szarża po linii prostej — zejdź z toru",
    make: (rng) => ({
      kind: "charge",
      range: 11,
      telegraph: 0.72,
      active: 0.9,
      recovery: 1.05,
      cooldown: 2.6,
      poiseDamage: 26,
      knockback: 1.1,
      shape: "line",
      chargeSpeed: rng.range(15, 19),
      chargeDistance: rng.range(10, 13),
    }),
  },
  {
    id: "grad",
    epithet: "Gradu",
    archetype: "caster",
    weapon: "staff",
    build: "heavy",
    tell: "gęsty ostrzał z dystansu — skracaj dystans",
    make: (rng) => ({
      kind: "projectile",
      range: 12,
      telegraph: 0.34,
      active: 0.16,
      recovery: 0.3,
      cooldown: rng.range(0.75, 1.05),
      poiseDamage: 7,
      knockback: 0.15,
      shape: "line",
      element: "fire",
      projectile: { speed: 13.5, radius: 0.26, lifetime: 2.2 },
    }),
  },
  {
    id: "grom",
    epithet: "Gromu",
    archetype: "miniboss",
    weapon: "greatsword",
    build: "hulking",
    tell: "uderzenie w ziemię — wybija z równowagi w całym kręgu",
    make: (rng) => ({
      kind: "melee",
      range: rng.range(4.0, 5.0),
      telegraph: 0.88,
      active: 0.22,
      recovery: 0.95,
      cooldown: 2.4,
      poiseDamage: 34,
      knockback: 1.4,
      shape: "circle",
      radiusMeters: rng.range(4.0, 5.0),
      arcDeg: 360,
    }),
  },
  {
    id: "wlocznia",
    epithet: "Włóczni",
    archetype: "ranged",
    weapon: "spear",
    build: "heavy",
    tell: "wolny, ciężki pocisk — da się go obejść, nie przeczekać",
    make: (rng) => ({
      kind: "projectile",
      range: 13,
      telegraph: 0.78,
      active: 0.2,
      recovery: 0.55,
      cooldown: 2.0,
      poiseDamage: 22,
      knockback: 0.8,
      shape: "line",
      projectile: { speed: rng.range(7.5, 9.5), radius: 0.52, lifetime: 3.0 },
    }),
  },
  {
    id: "kosa",
    epithet: "Kosy",
    archetype: "bruiser",
    weapon: "greatsword",
    build: "heavy",
    tell: "szeroki zamach obejmujący prawie cały przód",
    make: (rng) => ({
      kind: "melee",
      range: rng.range(3.4, 4.2),
      telegraph: 0.55,
      active: 0.18,
      recovery: 0.6,
      cooldown: 1.5,
      poiseDamage: 20,
      knockback: 0.7,
      shape: "cone",
      arcDeg: rng.int(150, 200),
    }),
  },
  {
    id: "seria",
    epithet: "Serii",
    archetype: "bruiser",
    weapon: "sword",
    build: "normal",
    tell: "szybkie pchnięcia w wąskim stożku — trzymaj dystans lub wchodź w bok",
    make: (rng) => ({
      kind: "combo",
      range: 2.6,
      telegraph: 0.38,
      active: 0.14,
      recovery: 0.5,
      cooldown: 1.35,
      poiseDamage: 11,
      knockback: 0.22,
      shape: "cone",
      arcDeg: 64,
      hits: rng.int(4, 6),
      hitInterval: 0.17,
    }),
  },
];

// ──────────────────────────────────────────────────────────────── atrybuty

interface AttributeDef {
  trait: GeneratedTrait;
  name: string;
  /** Czy ma sens tylko dla bossa (przyzywanie sług przez szeregowego to chaos). */
  bossOnly?: boolean;
  make(rng: Rng, tier: number): unknown;
}

const ATTRIBUTES: AttributeDef[] = [
  {
    trait: "aura",
    name: "Dowódca",
    make: (rng) => ({ radius: rng.range(4.5, 7), damageBonus: rng.range(0.15, 0.35) }),
  },
  {
    trait: "frontalBlock",
    name: "Opoka",
    make: (rng) => ({ arcDeg: rng.int(90, 150), reduction: rng.range(0.4, 0.7) }),
  },
  {
    trait: "poisonPool",
    name: "Jadowity",
    make: (rng, tier) => ({
      radius: rng.range(1.8, 2.8),
      dps: rng.range(5, 9) * (1 + tier * 0.15),
      duration: rng.range(4, 7),
    }),
  },
  {
    trait: "enrage",
    name: "Furia",
    make: (rng) => ({
      hpThreshold: rng.range(0.3, 0.5),
      damageMult: rng.range(1.35, 1.8),
      speedMult: rng.range(1.2, 1.45),
    }),
  },
  {
    trait: "thorns",
    name: "Cierniowy",
    make: (rng) => ({ reflectPct: rng.range(0.1, 0.22), range: 2.6 }),
  },
  {
    trait: "summon",
    name: "Przyzywacz",
    bossOnly: true,
    make: (rng) => ({ interval: rng.range(7, 12), count: rng.int(2, 3) }),
  },
];

// ───────────────────────────────────────────────────────────────── nazwy

const BOSS_TITLES = [
  "Herold", "Pożeracz", "Kat", "Tyran", "Strażnik",
  "Zwiastun", "Władca", "Rzeźnik", "Pasterz", "Wygnaniec",
];

const DOMAINS = [
  { of: "Popiołów", adj: "Popielny", color: 0x8a7f74, accent: 0xff7a3d },
  { of: "Zgnilizny", adj: "Zgniły", color: 0x6f8f4a, accent: 0x9be34a },
  { of: "Otchłani", adj: "Otchłanny", color: 0x4a4a7a, accent: 0x9b6bff },
  { of: "Rdzy", adj: "Rdzawy", color: 0x9a5a2c, accent: 0xffa23d },
  { of: "Kości", adj: "Kościany", color: 0xd8d2be, accent: 0xff5a3c },
  { of: "Żelaza", adj: "Żelazny", color: 0x6d7a8c, accent: 0xbfe4ff },
  { of: "Pustki", adj: "Pusty", color: 0x3d4658, accent: 0x7ce0ff },
  { of: "Zarazy", adj: "Skażony", color: 0x7a8f3a, accent: 0xd4ff4a },
  { of: "Bagien", adj: "Bagienny", color: 0x4a6b52, accent: 0x6ee8a8 },
  { of: "Mroku", adj: "Upiorny", color: 0x3a3550, accent: 0xc06bff },
  { of: "Szronu", adj: "Mroźny", color: 0x6a90a8, accent: 0x8fe8ff },
  { of: "Głodu", adj: "Wygłodniały", color: 0x8c4a4a, accent: 0xff4a5a },
];

/** Rdzenie nazw sług wg archetypu — nazwa ma zdradzać zachowanie. */
const MINION_NOUNS: Record<string, string[]> = {
  swarmer: ["Kąsacz", "Szarpacz", "Pomiot", "Sługa"],
  ranged: ["Miotacz", "Łucznik", "Procarz", "Ciskacz"],
  bruiser: ["Siepacz", "Rębacz", "Zbir", "Tłuk"],
  caster: ["Szeptacz", "Zaklinacz", "Wróż", "Klecha"],
  bomber: ["Pękacz", "Ropień", "Nabrzmiały", "Bąbel"],
};

// ───────────────────────────────────────────────────────── budowa jednostek

/** Tasowanie Fishera–Yatesa — talia zestawów bez powtórzeń w obrębie cyklu. */
function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function pickAttributes(
  rng: Rng,
  tier: number,
  count: number,
  boss: boolean,
  fits?: (trait: GeneratedTrait) => boolean,
): Record<string, unknown> {
  const pool = ATTRIBUTES.filter((a) => (boss || !a.bossOnly) && (!fits || fits(a.trait)));
  const chosen = shuffled(pool, rng).slice(0, Math.min(count, pool.length));
  const traits: Record<string, unknown> = {};
  for (const a of chosen) traits[a.trait] = a.make(rng, tier);
  return traits;
}

/** Wartości jednej, wskazanej cechy — potrzebne dla sygnatury gatunku. */
function makeTrait(trait: GeneratedTrait, rng: Rng, tier: number): Record<string, unknown> {
  const def = ATTRIBUTES.find((a) => a.trait === trait);
  return def ? { [def.trait]: def.make(rng, tier) } : {};
}

/**
 * Czy cecha ma sens dla tego archetypu. Zasada 3 tego modułu („żadnych atrybutów
 * na niby") wymaga nie tylko miejsca odczytu w kodzie, ale i tego, żeby ten odczyt
 * kiedykolwiek nastąpił: `poisonPool` czyta wyłącznie `World.explode`, więc kaster
 * „Jadowity" nigdy nie zostawiłby kałuży, a `thorns` sprawdza dystans zwarcia,
 * więc łucznik „Cierniowy" nie odbiłby ani jednego obrażenia.
 */
function traitFits(trait: GeneratedTrait, archetype: UnitArchetype): boolean {
  if (trait === "poisonPool") return archetype === "bomber";
  if (trait === "thorns") return archetype === "swarmer" || archetype === "bruiser";
  if (trait === "summon") return false;
  return true;
}

/** Nazwy atrybutów do wyświetlenia — HUD pokazuje, z czym gracz ma do czynienia. */
export function traitLabels(traits: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const a of ATTRIBUTES) if (traits[a.trait] !== undefined) out.push(a.name);
  return out;
}

/**
 * Do którego gatunku należy boss danego tieru. Bossowie wypadają co 5 rund,
 * gatunek zmienia się co 10 — więc na etap przypadają dokładnie dwie walki
 * z bossem, a boss wygląda jak szczytowy okaz tego, co właśnie zalewa arenę.
 */
export function speciesStageForBossTier(tier: number): number {
  // Sufit jak w `World.speciesStage`: przy 80 tierach bossów wyszłoby 39 etapów,
  // czyli bossowie w barwach gatunków, których gracz nigdy nie zobaczy na arenie.
  return Math.max(0, Math.min(MAX_SPECIES, Math.floor((Math.max(1, tier) - 1) / 2)));
}

function makeBoss(tier: number, kit: AttackKit, rng: Rng, usedNames: Set<string>): EnemyDef {
  const domain = DOMAINS[rng.int(0, DOMAINS.length - 1)]!;
  const stage = speciesStageForBossTier(tier);
  // Etap 0 to ręczny roster (gobliny, szkielety, orki) — tam boss zostaje przy
  // starej mitologii domen. Od etapu 1 nosi barwy swojego gatunku.
  const sp = stage >= 1 ? speciesTemplateFor(stage) : null;
  const of = sp ? sp.of : domain.of;

  // Nazwa musi być niepowtarzalna: dwóch „Heroldów Kości" gracz czyta jako
  // powtórzoną walkę, nawet jeśli mają zupełnie inne ataki.
  let name = "";
  for (let attempt = 0; attempt < 12; attempt++) {
    name = `${BOSS_TITLES[rng.int(0, BOSS_TITLES.length - 1)]!} ${of}`;
    if (!usedNames.has(name)) break;
  }
  usedNames.add(name);

  // Baza rośnie łagodnie, bo skalowanie strefą (`zoneScaling`) dokłada swoje
  // przy odradzaniu. Bez tego dwa mnożniki mnożyłyby się w ścianę.
  const growth = Math.pow(1.34, tier - 1);

  return {
    id: `boss_t${tier}`,
    name,
    archetype: kit.archetype,
    hp: Math.round(1600 * growth),
    damage: Math.round(26 * Math.pow(1.19, tier - 1)),
    poise: Math.round(60 + tier * 8),
    armor: Math.round(4 + tier * 1.6),
    xp: Math.round(400 * growth),
    gold: Math.round(160 * growth),
    radius: 0.72,
    mass: 3.4,
    moveSpeed: rng.range(3.0, 3.9),
    color: sp ? sp.color : domain.color,
    isBoss: true,
    breakBar: Math.round(140 + tier * 22),
    breakWindow: 3.2,
    breakDamageBonus: 1.6,
    kit: kit.id,
    tell: kit.tell,
    attack: kit.make(rng),
    // Boss dostaje 2–3 atrybuty; przy jednym walki zlewają się mimo różnych
    // ataków, przy czterech nie da się już odczytać, co go definiuje.
    traits: pickAttributes(rng, tier, rng.int(2, 3), true),
    dropChance: 1,
    appearance: {
      build: kit.build,
      head: sp ? rng.pick(sp.heads) : rng.pick(["horned", "skull", "hooded", "orc"]),
      weapon: kit.weapon,
      cape: rng.chance(0.6),
      shield: rng.chance(0.25),
      accent: sp ? sp.accent : domain.accent,
      scale: 1.3 + tier * 0.012,
    },
  };
}

/** Archetypy szeregowych. Kolejność jest stała — z niej wynikają slot i `defIdx`. */
export type UnitArchetype = "swarmer" | "ranged" | "bruiser" | "caster" | "bomber";

export const UNIT_ARCHETYPES: readonly UnitArchetype[] = [
  "swarmer",
  "ranged",
  "bruiser",
  "caster",
  "bomber",
];

/**
 * Baza jednostki wg archetypu — jedno miejsce dla sług bossów i dla gatunków.
 * `cost` to **koszt budżetowy fali**: zagrożenie względem własnego etapu, nie
 * liczba HP. Liczenie kosztu z absolutnego HP dawało falę z jednym wrogiem
 * w setnej rundzie, bo HP rośnie wykładniczo, a budżet fali liniowo.
 */
const UNIT_BASE: Record<
  UnitArchetype,
  {
    hp: number;
    damage: number;
    poise: number;
    xp: number;
    radius: number;
    mass: number;
    speed: [number, number];
    cost: number;
    build: string;
    dropChance: number;
  }
> = {
  swarmer: { hp: 70, damage: 11, poise: 12, xp: 34, radius: 0.38, mass: 0.8, speed: [4.2, 5.6], cost: 1.2, build: "normal", dropChance: 0.05 },
  ranged: { hp: 55, damage: 11, poise: 12, xp: 34, radius: 0.38, mass: 0.8, speed: [3.4, 4.2], cost: 1.6, build: "slim", dropChance: 0.05 },
  bruiser: { hp: 120, damage: 20, poise: 26, xp: 60, radius: 0.5, mass: 1.6, speed: [4.2, 5.6], cost: 4.0, build: "hulking", dropChance: 0.12 },
  caster: { hp: 55, damage: 11, poise: 12, xp: 34, radius: 0.38, mass: 0.8, speed: [3.4, 4.2], cost: 2.0, build: "slim", dropChance: 0.05 },
  bomber: { hp: 70, damage: 32, poise: 12, xp: 34, radius: 0.44, mass: 0.8, speed: [4.2, 5.6], cost: 1.8, build: "crawler", dropChance: 0.06 },
};

/** Atak wg archetypu. Używa wyłącznie pól, które `ai.ts` faktycznie wykonuje. */
function unitAttack(archetype: UnitArchetype, rng: Rng): EnemyDef["attack"] {
  if (archetype === "bomber") {
    return {
      kind: "explode",
      range: 1.3,
      telegraph: 0.62,
      active: 0.1,
      recovery: 0.2,
      cooldown: 1,
      poiseDamage: 18,
      knockback: 0.9,
      shape: "circle",
      radiusMeters: rng.range(2.4, 3.2),
    };
  }
  if (archetype === "ranged" || archetype === "caster") {
    return {
      kind: "projectile",
      range: rng.range(8, 11),
      telegraph: rng.range(0.5, 0.8),
      active: 0.15,
      recovery: 0.4,
      cooldown: rng.range(1.4, 2.4),
      poiseDamage: 8,
      knockback: 0.2,
      shape: "line",
      projectile: { speed: rng.range(9, 13), radius: 0.24, lifetime: 2.4 },
    };
  }
  const tough = archetype === "bruiser";
  return {
    kind: "melee",
    range: rng.range(1.6, 2.6),
    telegraph: rng.range(0.36, 0.6),
    active: 0.12,
    recovery: rng.range(0.3, 0.5),
    cooldown: rng.range(0.9, 1.6),
    poiseDamage: tough ? 16 : 9,
    knockback: tough ? 0.6 : 0.25,
    shape: "cone",
    arcDeg: rng.int(70, 120),
  };
}

/** Broń wg archetypu; `melee` to pula gatunku, bo ona najmocniej niesie motyw. */
function unitWeapon(archetype: UnitArchetype, rng: Rng, melee: readonly string[]): string {
  if (archetype === "bomber") return "claws";
  if (archetype === "caster") return "staff";
  if (archetype === "ranged") return rng.pick(["bow", "spear"]);
  return rng.pick(melee);
}

function makeMinion(tier: number, slot: number, rng: Rng): EnemyDef {
  const domain = DOMAINS[rng.int(0, DOMAINS.length - 1)]!;
  const archetype = rng.pick(UNIT_ARCHETYPES);
  const noun = rng.pick(MINION_NOUNS[archetype]!);
  const growth = Math.pow(1.3, tier);
  const base = UNIT_BASE[archetype];
  const tough = archetype === "bruiser";

  return {
    id: `unit_t${tier}_${slot}`,
    name: `${domain.adj} ${noun}`,
    archetype,
    hp: Math.round(base.hp * growth),
    damage: Math.round(base.damage * Math.pow(1.16, tier)),
    poise: base.poise,
    armor: Math.round(tough ? 3 + tier : tier * 0.5),
    xp: Math.round(base.xp * growth),
    gold: Math.round(14 * growth),
    radius: base.radius,
    mass: base.mass,
    moveSpeed: rng.range(base.speed[0], base.speed[1]),
    color: domain.color,
    cost: base.cost,
    attack: unitAttack(archetype, rng),
    // Szeregowi dostają najwyżej jeden atrybut — inaczej pakiet dziesięciu
    // wrogów niesie tyle reguł naraz, że nie da się ich odczytać w walce.
    traits: rng.chance(0.45)
      ? pickAttributes(rng, tier, 1, false, (t) => traitFits(t, archetype))
      : {},
    dropChance: base.dropChance,
    appearance: {
      build: base.build,
      head: rng.pick(["goblin", "skull", "orc", "hooded", "insect", "horned"]),
      weapon: unitWeapon(archetype, rng, ["sword", "axe", "dagger"]),
      accent: domain.accent,
      scale: tough ? 1.1 : 1,
    },
  };
}

// ──────────────────────────────────────────────────────────────── gatunki

/**
 * Gatunek to **cała fala naraz**, nie jeden potwór: pięć jednostek o wspólnej
 * sylwetce, palecie i sygnaturze, po jednej na archetyp. Bez tego dwudziesta
 * runda wyglądała jak druga — same orki i gobliny, tylko z większym HP.
 */
export interface SpeciesTemplate {
  id: string;
  /** Nazwa pierwszego cyklu i drugiego (etapy 11–20). Obie pisane ręcznie,
   *  bo polska odmiana przymiotnika nie da się skleić automatycznie. */
  name: string;
  elderName: string;
  /** Dopełniacz do nazw bossów: „Pożeracz Roju". */
  of: string;
  /** Jednozdaniowa zapowiedź — HUD ogłasza ją przy zmianie gatunku. */
  tell: string;
  color: number;
  accent: number;
  heads: string[];
  /** Pula broni białej — topór trolla kontra kordelas dworu. */
  melee: string[];
  /** Nazwy jednostek wg archetypu. Nazwa ma zdradzać zachowanie. */
  nouns: Record<UnitArchetype, string>;
  /** Cecha definiująca gatunek. Trafia tylko na te archetypy, na których działa. */
  signature: GeneratedTrait;
  /**
   * Modyfikatory wobec bazy archetypu. Gatunek ma mieć **charakter, nie inną
   * sumę sił**: `hpMult + damageMult ≈ 2`, więc konstrukty są twarde i słabe,
   * a upiory kruche i bijące — ale żadne nie jest po prostu mocniejsze.
   *
   * To nie kosmetyka. Eskalacja siły należy wyłącznie do krzywej etapu
   * (`speciesGrowth`); gdyby doszły do niej wahania ±60% z charakteru gatunku,
   * co drugi „nowy, mocniejszy gatunek" byłby w praktyce słabszy od poprzedniego.
   * Pilnuje tego test `species.test.ts` → „kolejny gatunek jest realnie mocniejszy".
   */
  hpMult: number;
  damageMult: number;
  speedMult: number;
  armorBonus: number;
  /** Mnożnik rozmiaru sylwetki: kolos ma górować, rój ma się kłębić. */
  scale: number;
}

const SPECIES: readonly SpeciesTemplate[] = [
  {
    id: "cult_of_ash",
    name: "Kult Popiołu",
    elderName: "Prastary Kult Popiołu",
    of: "Popiołu",
    tell: "rytualiści — biją z dystansu i skażają grunt",
    color: 0x8a4a3a,
    accent: 0xff6a2a,
    heads: ["hooded", "horned"],
    melee: ["dagger", "sword"],
    nouns: { swarmer: "Zelota", ranged: "Ciskacz Żaru", bruiser: "Kadzidlarz", caster: "Piromanta", bomber: "Popielnik" },
    signature: "poisonPool",
    hpMult: 0.88,
    damageMult: 1.12,
    speedMult: 1.0,
    armorBonus: 0,
    scale: 1,
  },
  {
    id: "bone_legion",
    name: "Legion Kości",
    elderName: "Odwieczny Legion Kości",
    of: "Kości",
    tell: "karna formacja — trzymają gardę z przodu, obejdź ich",
    color: 0xd8d2be,
    accent: 0xff5a3c,
    heads: ["skull"],
    melee: ["sword", "axe"],
    nouns: { swarmer: "Kościej", ranged: "Chorąży", bruiser: "Marszałek Kości", caster: "Grabarz", bomber: "Trupojad" },
    signature: "frontalBlock",
    hpMult: 1.12,
    damageMult: 0.88,
    speedMult: 0.9,
    armorBonus: 2,
    scale: 1,
  },
  {
    id: "chitin_swarm",
    name: "Rój Chitynowy",
    elderName: "Prastary Rój Chitynowy",
    of: "Roju",
    tell: "szybkie i liczne — nie daj się otoczyć",
    color: 0x7a8f3a,
    accent: 0xd4ff4a,
    heads: ["insect"],
    melee: ["claws", "dagger"],
    nouns: { swarmer: "Kąsacz", ranged: "Plujka", bruiser: "Żuwaczka", caster: "Matecznik", bomber: "Larwa" },
    signature: "thorns",
    hpMult: 0.8,
    damageMult: 1.2,
    speedMult: 1.28,
    armorBonus: 0,
    scale: 0.95,
  },
  {
    id: "iron_constructs",
    name: "Żelazne Konstrukty",
    elderName: "Pierwotne Konstrukty",
    of: "Kuźni",
    tell: "opancerzone i wolne — łam je ciężkim ciosem",
    color: 0x6d7a8c,
    accent: 0xbfe4ff,
    heads: ["helmet", "horned"],
    melee: ["greatsword", "axe"],
    nouns: { swarmer: "Automat", ranged: "Balista", bruiser: "Kolos", caster: "Rdzeń Runiczny", bomber: "Kadłub" },
    signature: "frontalBlock",
    hpMult: 1.22,
    damageMult: 0.78,
    speedMult: 0.8,
    armorBonus: 4,
    scale: 1.1,
  },
  {
    id: "void_wraiths",
    name: "Upiory Pustki",
    elderName: "Wyższe Upiory Pustki",
    of: "Pustki",
    tell: "szybkie i kruche — wzmacniają się nawzajem",
    color: 0x4a4a7a,
    accent: 0x9b6bff,
    heads: ["hooded", "skull"],
    melee: ["dagger", "sword"],
    nouns: { swarmer: "Zjawa", ranged: "Szept", bruiser: "Mara", caster: "Widmo", bomber: "Cień" },
    signature: "aura",
    hpMult: 0.84,
    damageMult: 1.16,
    speedMult: 1.3,
    armorBonus: 0,
    scale: 1,
  },
  {
    id: "abyss_demons",
    name: "Demony Otchłani",
    elderName: "Książęta Otchłani",
    of: "Otchłani",
    tell: "im bliżej śmierci, tym groźniejsze — dobijaj szybko",
    color: 0x8c3a3a,
    accent: 0xff3b30,
    heads: ["horned"],
    melee: ["axe", "greatsword"],
    nouns: { swarmer: "Bies", ranged: "Czart", bruiser: "Piekielnik", caster: "Oprawca", bomber: "Rogacz" },
    signature: "enrage",
    hpMult: 1.05,
    damageMult: 0.95,
    speedMult: 1.05,
    armorBonus: 1,
    scale: 1.05,
  },
  {
    id: "frost_trolls",
    name: "Trolle Szronu",
    elderName: "Praojcowie Szronu",
    of: "Szronu",
    tell: "wolne kolosy — karzą za stanie w zasięgu",
    color: 0x6a90a8,
    accent: 0x8fe8ff,
    heads: ["orc"],
    melee: ["axe", "greatsword"],
    nouns: { swarmer: "Szroniarz", ranged: "Lodołam", bruiser: "Zwalisty", caster: "Mruk", bomber: "Gruchot" },
    signature: "enrage",
    hpMult: 1.2,
    damageMult: 0.8,
    speedMult: 0.85,
    armorBonus: 2,
    scale: 1.15,
  },
  {
    id: "plague_spawn",
    name: "Pomiot Zarazy",
    elderName: "Macierz Zarazy",
    of: "Zarazy",
    tell: "pękają w kałuże jadu — nie kończ ich w zwarciu",
    color: 0x6f8f4a,
    accent: 0x9be34a,
    heads: ["insect", "goblin"],
    melee: ["claws", "dagger"],
    nouns: { swarmer: "Zgnilec", ranged: "Miazma", bruiser: "Wrzód", caster: "Ropień", bomber: "Pękacz" },
    signature: "poisonPool",
    hpMult: 0.86,
    damageMult: 1.14,
    speedMult: 1.08,
    armorBonus: 0,
    scale: 1,
  },
  {
    id: "rust_titans",
    name: "Rdzawe Titany",
    elderName: "Kolosy Rdzy",
    of: "Rdzy",
    tell: "ściana żelaza — bez przełamania gardy nie zrobisz nic",
    color: 0x9a5a2c,
    accent: 0xffa23d,
    heads: ["helmet", "horned"],
    melee: ["greatsword", "axe"],
    nouns: { swarmer: "Zgrzyt", ranged: "Miot", bruiser: "Kuźnik", caster: "Zwora", bomber: "Wal" },
    signature: "frontalBlock",
    hpMult: 1.25,
    damageMult: 0.75,
    speedMult: 0.78,
    armorBonus: 5,
    scale: 1.2,
  },
  {
    id: "pale_court",
    name: "Blady Dwór",
    elderName: "Nieśmiertelny Dwór",
    of: "Dworu",
    tell: "walczą w szyku i dowodzą sobą — najpierw zdejmij dowódcę",
    color: 0xb0a0c0,
    accent: 0xffb0e8,
    heads: ["hooded", "helmet"],
    melee: ["sword", "spear"],
    nouns: { swarmer: "Straż", ranged: "Łucznik Dworu", bruiser: "Herold", caster: "Kanclerz", bomber: "Dworzanin" },
    signature: "aura",
    hpMult: 0.95,
    damageMult: 1.05,
    speedMult: 1.12,
    armorBonus: 1,
    scale: 1,
  },

  {
    id: "sand_wraiths",
    name: "Piaskowe Zmory",
    elderName: "Prastare Zmory",
    of: "Piasków",
    tell: "wynurzają się szybko i biją z zaskoczenia",
    color: 0xb08a5a,
    accent: 0xffe0a0,
    heads: ["hooded", "insect"],
    melee: ["dagger", "spear"],
    nouns: { swarmer: "Sypacz", ranged: "Prochowiec", bruiser: "Wydmuch", caster: "Suchy Głos", bomber: "Pylnik" },
    signature: "thorns",
    hpMult: 0.86,
    damageMult: 1.14,
    speedMult: 1.22,
    armorBonus: 0,
    scale: 1,
  },
  {
    id: "storm_heralds",
    name: "Heroldowie Burzy",
    elderName: "Wyżsi Heroldowie Burzy",
    of: "Burzy",
    tell: "walczą w szyku i wzmacniają się nawzajem",
    color: 0x5a7a9a,
    accent: 0xdcefff,
    heads: ["helmet", "horned"],
    melee: ["spear", "sword"],
    nouns: { swarmer: "Grzmot", ranged: "Piorunnik", bruiser: "Chorąży Burzy", caster: "Wieszcz", bomber: "Kula Gromu" },
    signature: "aura",
    hpMult: 1.08,
    damageMult: 0.92,
    speedMult: 1.05,
    armorBonus: 2,
    scale: 1.05,
  },
  {
    id: "fungal_brood",
    name: "Grzybowy Miot",
    elderName: "Macierz Grzybni",
    of: "Grzybni",
    tell: "pękają w zarodniki — nie kończ ich w zwarciu",
    color: 0x7a6a8a,
    accent: 0xc0ff8a,
    heads: ["insect", "goblin"],
    melee: ["claws", "dagger"],
    nouns: { swarmer: "Kapelusznik", ranged: "Zarodnik", bruiser: "Huba", caster: "Grzybnia", bomber: "Purchawka" },
    signature: "poisonPool",
    hpMult: 0.9,
    damageMult: 1.1,
    speedMult: 1.0,
    armorBonus: 0,
    scale: 1,
  },
  {
    id: "obsidian_wardens",
    name: "Obsydianowi Stróże",
    elderName: "Pierwotni Stróże",
    of: "Obsydianu",
    tell: "garda z przodu i twarda skorupa — obchodź, nie przepychaj",
    color: 0x38343e,
    accent: 0xff5a5a,
    heads: ["helmet", "horned"],
    melee: ["greatsword", "axe"],
    nouns: { swarmer: "Odłamek", ranged: "Miotacz Szkła", bruiser: "Stróż", caster: "Zwierciadlnik", bomber: "Skorupa" },
    signature: "frontalBlock",
    hpMult: 1.24,
    damageMult: 0.76,
    speedMult: 0.82,
    armorBonus: 4,
    scale: 1.1,
  },
  {
    id: "blood_choir",
    name: "Krwawy Chór",
    elderName: "Wieczny Chór",
    of: "Krwi",
    tell: "ranne wpadają w szał — dobijaj bez zwłoki",
    color: 0x8a2a3a,
    accent: 0xff4a6a,
    heads: ["hooded", "skull"],
    melee: ["dagger", "sword"],
    nouns: { swarmer: "Kantor", ranged: "Krwiopijca", bruiser: "Rzeźnik Chóru", caster: "Psalmista", bomber: "Naczynie" },
    signature: "enrage",
    hpMult: 1.02,
    damageMult: 0.98,
    speedMult: 1.15,
    armorBonus: 1,
    scale: 1,
  },
  {
    id: "star_husks",
    name: "Gwiezdne Łuski",
    elderName: "Prastare Łuski",
    of: "Gwiazd",
    tell: "odbijają część ciosów — uważaj w zwarciu",
    color: 0x4a5a8a,
    accent: 0xc0d8ff,
    heads: ["horned", "insect"],
    melee: ["spear", "greatsword"],
    nouns: { swarmer: "Iskrzyk", ranged: "Łuska", bruiser: "Skorupiec", caster: "Pustogłos", bomber: "Meteoryt" },
    signature: "thorns",
    hpMult: 1.16,
    damageMult: 0.84,
    speedMult: 0.92,
    armorBonus: 3,
    scale: 1.08,
  },
];

/**
 * Przydomek drugiego cyklu. Dopełniacz („z Głębi") nie odmienia się z rodzajem
 * rzeczownika, więc pasuje i do „Kąsacza", i do „Zjawy" — przymiotnik nie pasuje.
 */
const CYCLE_EPITHETS = ["", "z Głębi", "z Zaświatów"];

/**
 * Szablon gatunku dla etapu (od 1). Etap 0 to ręczny roster: gobliny i orki.
 *
 * Etap jest tu **domykany do zakresu**, bo liczba potrafi przyjść z zapisu:
 * starszy zapis bez pola `bossesDefeated` dawał `NaN`, a `SPECIES[NaN]` to
 * `undefined` — funkcja o typie zwrotnym `SpeciesTemplate` zwracała nic
 * i wywalała cały start gry na brakującym polu w zapisie.
 */
export function speciesTemplateFor(stage: number): SpeciesTemplate {
  const safe = Number.isFinite(stage) ? Math.max(1, Math.floor(stage)) : 1;
  return SPECIES[(safe - 1) % SPECIES.length]!;
}

/** Nazwa gatunku etapu — drugi cykl ma własną, ręcznie napisaną formę. */
export function speciesNameFor(stage: number): string {
  const t = speciesTemplateFor(stage);
  const safe = Number.isFinite(stage) ? Math.max(1, Math.floor(stage)) : 1;
  const cycle = Math.floor((safe - 1) / SPECIES.length);
  return cycle === 0 ? t.name : t.elderName;
}

/**
 * Siła gatunku etapu. Ten sam współczynnik co u sług bossów (1.3 na tier), ale
 * na etap wypadają dwa tiery — gatunek etapu k jest więc porównywalny z tym,
 * co odblokowuje boss tieru 2k. Bez tego dwie ścieżki progresji rozjechałyby się.
 */
function speciesGrowth(stage: number): number {
  return Math.pow(1.3, stage * 2);
}

function makeSpeciesUnit(
  stage: number,
  archetype: UnitArchetype,
  slot: number,
  rng: Rng,
): EnemyDef {
  const sp = speciesTemplateFor(stage);
  const cycle = Math.floor(Math.max(0, stage - 1) / SPECIES.length);
  const epithet = CYCLE_EPITHETS[Math.min(cycle, CYCLE_EPITHETS.length - 1)]!;
  const base = UNIT_BASE[archetype];
  const growth = speciesGrowth(stage);
  const tier = stage * 2;

  // Sygnatura gatunku, ale tylko tam, gdzie symulacja ją naprawdę wykona.
  const signature = traitFits(sp.signature, archetype) ? sp.signature : null;
  const traits =
    signature && rng.chance(0.7)
      ? makeTrait(signature, rng, tier)
      : rng.chance(0.3)
        ? pickAttributes(rng, tier, 1, false, (t) => traitFits(t, archetype))
        : {};

  return {
    id: `unit_s${stage}_${slot}`,
    name: epithet ? `${sp.nouns[archetype]} ${epithet}` : sp.nouns[archetype],
    archetype,
    hp: Math.round(base.hp * sp.hpMult * growth),
    damage: Math.round(base.damage * sp.damageMult * Math.pow(1.16, tier)),
    poise: Math.round(base.poise * (1 + sp.armorBonus * 0.08)),
    armor: Math.round(sp.armorBonus + tier * (archetype === "bruiser" ? 1 : 0.5)),
    xp: Math.round(base.xp * growth),
    gold: Math.round(14 * growth),
    radius: base.radius * (archetype === "bruiser" ? sp.scale : 1),
    mass: base.mass * sp.scale,
    moveSpeed: rng.range(base.speed[0], base.speed[1]) * sp.speedMult,
    color: sp.color,
    cost: base.cost,
    attack: unitAttack(archetype, rng),
    traits,
    dropChance: base.dropChance,
    appearance: {
      build: base.build,
      head: rng.pick(sp.heads),
      weapon: unitWeapon(archetype, rng, sp.melee),
      accent: sp.accent,
      scale: sp.scale * (archetype === "bruiser" ? 1.1 : 1),
    },
  };
}

// ────────────────────────────────────────────────────────────── bestiariusz

export interface Bestiary {
  /** `bosses[t]` to boss tieru `t+1`. Każdy z innym zestawem ataków. */
  bosses: EnemyDef[];
  /** `unlocks[t]` wchodzi do puli po pokonaniu bossa tieru `t+1`. */
  unlocks: EnemyDef[][];
  /**
   * `species[k]` to gatunek etapu `k+1` — pełny skład fali (jedna jednostka na
   * archetyp), który zastępuje poprzedni co dziesięć rund, po dwóch bossach.
   */
  species: EnemyDef[][];
  /** Metryczka gatunków w tej samej kolejności co `species` — dla HUD-u. */
  speciesInfo: {
    stage: number;
    id: string;
    name: string;
    tell: string;
    color: number;
    accent: number;
  }[];
}

/**
 * Buduje cały bestiariusz z góry. Generowanie na żądanie byłoby oszczędniejsze,
 * ale `defIdx` encji to indeks w `enemyDefs` — tablica musi mieć ten sam
 * kształt w każdej sesji, inaczej wczytany zapis wskazywałby na innego potwora.
 */
export function generateBestiary(
  seed: number,
  tiers = MAX_BOSS_TIERS,
  speciesCount = MAX_SPECIES,
): Bestiary {
  const bosses: EnemyDef[] = [];
  const unlocks: EnemyDef[][] = [];
  const usedBossNames = new Set<string>();

  /*
   * Talia zestawów: tasujemy ją i rozdajemy po kolei, dobierając nową po
   * wyczerpaniu — plus twardy zakaz powtórki wśród ostatnich `MIN_KIT_GAP`.
   *
   * Sam worek losujący nie wystarcza: na **styku dwóch tasowań** ostatni zestaw
   * jednej talii potrafi wypaść od razu jako pierwszy w następnej. Gracz
   * dostawał wtedy dwie identyczne walki pod rząd, mimo że w obrębie każdej
   * talii nic się nie powtarzało.
   */
  const deckRng = new Rng(seed ^ 0x8e37b21f);
  let deck: AttackKit[] = [];
  const recent: string[] = [];

  for (let tier = 1; tier <= tiers; tier++) {
    if (deck.length === 0) deck = shuffled(KITS, deckRng);

    // Bierzemy od końca pierwszy zestaw spoza okna ostatnich. Talia ma ich
    // siedem, a okno jest krótsze, więc wybór zawsze istnieje.
    let at = deck.length - 1;
    while (at > 0 && recent.includes(deck[at]!.id)) at--;
    const kit = deck.splice(at, 1)[0]!;

    recent.push(kit.id);
    if (recent.length > MIN_KIT_GAP) recent.shift();

    // Osobny strumień na tier: dołożenie tieru na końcu nie przesuwa
    // wcześniejszych potworów, więc zapisy pozostają zgodne.
    const rng = new Rng((seed ^ 0x51ed270b) + tier * 0x9e3779b9);
    bosses.push(makeBoss(tier, kit, rng, usedBossNames));

    const batch: EnemyDef[] = [];
    for (let slot = 0; slot < UNLOCKS_PER_BOSS; slot++) {
      batch.push(makeMinion(tier, slot, rng));
    }
    unlocks.push(batch);
  }

  // Gatunki: osobny strumień na etap, z tego samego powodu co tiery — dołożenie
  // etapu nie może przesunąć wcześniejszych, bo `defIdx` to indeks w tablicy.
  const species: EnemyDef[][] = [];
  const speciesInfo: Bestiary["speciesInfo"] = [];
  for (let stage = 1; stage <= speciesCount; stage++) {
    const rng = new Rng((seed ^ 0x2c9277b5) + stage * 0x85ebca6b);
    const units: EnemyDef[] = [];
    for (let slot = 0; slot < UNITS_PER_SPECIES; slot++) {
      units.push(makeSpeciesUnit(stage, UNIT_ARCHETYPES[slot % UNIT_ARCHETYPES.length]!, slot, rng));
    }
    species.push(units);

    const tpl = speciesTemplateFor(stage);
    speciesInfo.push({
      stage,
      id: tpl.id,
      name: speciesNameFor(stage),
      tell: tpl.tell,
      color: tpl.color,
      accent: tpl.accent,
    });
  }

  return { bosses, unlocks, species, speciesInfo };
}

