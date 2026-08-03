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

/** Ile tierów bossów budujemy z góry. 40 bossów to ~200 encounterów. */
export const MAX_BOSS_TIERS = 40;

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

function pickAttributes(rng: Rng, tier: number, count: number, boss: boolean): Record<string, unknown> {
  const pool = ATTRIBUTES.filter((a) => boss || !a.bossOnly);
  const chosen = shuffled(pool, rng).slice(0, Math.min(count, pool.length));
  const traits: Record<string, unknown> = {};
  for (const a of chosen) traits[a.trait] = a.make(rng, tier);
  return traits;
}

/** Nazwy atrybutów do wyświetlenia — HUD pokazuje, z czym gracz ma do czynienia. */
export function traitLabels(traits: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const a of ATTRIBUTES) if (traits[a.trait] !== undefined) out.push(a.name);
  return out;
}

function makeBoss(tier: number, kit: AttackKit, rng: Rng): EnemyDef {
  const domain = DOMAINS[rng.int(0, DOMAINS.length - 1)]!;
  const title = BOSS_TITLES[rng.int(0, BOSS_TITLES.length - 1)]!;

  // Baza rośnie łagodnie, bo skalowanie strefą (`zoneScaling`) dokłada swoje
  // przy odradzaniu. Bez tego dwa mnożniki mnożyłyby się w ścianę.
  const growth = Math.pow(1.34, tier - 1);

  return {
    id: `boss_t${tier}`,
    name: `${title} ${domain.of}`,
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
    color: domain.color,
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
      head: rng.pick(["horned", "skull", "hooded", "orc"]),
      weapon: kit.weapon,
      cape: rng.chance(0.6),
      shield: rng.chance(0.25),
      accent: domain.accent,
      scale: 1.3 + tier * 0.012,
    },
  };
}

function makeMinion(tier: number, slot: number, rng: Rng): EnemyDef {
  const domain = DOMAINS[rng.int(0, DOMAINS.length - 1)]!;
  const archetype = rng.pick(["swarmer", "ranged", "bruiser", "caster", "bomber"]);
  const noun = rng.pick(MINION_NOUNS[archetype]!);
  const growth = Math.pow(1.3, tier);

  const ranged = archetype === "ranged" || archetype === "caster";
  const bomber = archetype === "bomber";
  const tough = archetype === "bruiser";

  const attack: EnemyDef["attack"] = bomber
    ? {
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
      }
    : ranged
      ? {
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
        }
      : {
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

  return {
    id: `unit_t${tier}_${slot}`,
    name: `${domain.adj} ${noun}`,
    archetype,
    hp: Math.round((tough ? 120 : ranged ? 55 : 70) * growth),
    damage: Math.round((bomber ? 32 : tough ? 20 : 11) * Math.pow(1.16, tier)),
    poise: tough ? 26 : 12,
    armor: Math.round(tough ? 3 + tier : tier * 0.5),
    xp: Math.round((tough ? 60 : 34) * growth),
    gold: Math.round(14 * growth),
    radius: tough ? 0.5 : bomber ? 0.44 : 0.38,
    mass: tough ? 1.6 : 0.8,
    moveSpeed: ranged ? rng.range(3.4, 4.2) : rng.range(4.2, 5.6),
    color: domain.color,
    attack,
    // Szeregowi dostają najwyżej jeden atrybut — inaczej pakiet dziesięciu
    // wrogów niesie tyle reguł naraz, że nie da się ich odczytać w walce.
    traits: rng.chance(0.45) ? pickAttributes(rng, tier, 1, false) : {},
    dropChance: bomber ? 0.06 : tough ? 0.12 : 0.05,
    appearance: {
      build: tough ? "hulking" : bomber ? "crawler" : ranged ? "slim" : "normal",
      head: rng.pick(["goblin", "skull", "orc", "hooded", "insect", "horned"]),
      weapon: bomber
        ? "claws"
        : archetype === "caster"
          ? "staff"
          : archetype === "ranged"
            ? rng.pick(["bow", "spear"])
            : rng.pick(["sword", "axe", "dagger"]),
      accent: domain.accent,
      scale: tough ? 1.1 : 1,
    },
  };
}

// ────────────────────────────────────────────────────────────── bestiariusz

export interface Bestiary {
  /** `bosses[t]` to boss tieru `t+1`. Każdy z innym zestawem ataków. */
  bosses: EnemyDef[];
  /** `unlocks[t]` wchodzi do puli po pokonaniu bossa tieru `t+1`. */
  unlocks: EnemyDef[][];
}

/**
 * Buduje cały bestiariusz z góry. Generowanie na żądanie byłoby oszczędniejsze,
 * ale `defIdx` encji to indeks w `enemyDefs` — tablica musi mieć ten sam
 * kształt w każdej sesji, inaczej wczytany zapis wskazywałby na innego potwora.
 */
export function generateBestiary(seed: number, tiers = MAX_BOSS_TIERS): Bestiary {
  const bosses: EnemyDef[] = [];
  const unlocks: EnemyDef[][] = [];

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
    bosses.push(makeBoss(tier, kit, rng));

    const batch: EnemyDef[] = [];
    for (let slot = 0; slot < UNLOCKS_PER_BOSS; slot++) {
      batch.push(makeMinion(tier, slot, rng));
    }
    unlocks.push(batch);
  }

  return { bosses, unlocks };
}

