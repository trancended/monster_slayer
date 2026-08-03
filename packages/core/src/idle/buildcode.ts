/**
 * Kod builda (v4 §5.8) — to jest kanał dystrybucji gry, a nie feature poboczny.
 * Gracz wkleja `MS4:…` w komentarz na Reddicie, ktoś inny wkleja go u siebie
 * i widzi build w podglądzie. Dlatego kod musi być: krótki (mieści się w
 * komentarzu), odporny (wklejony śmieć to normalny przypadek, nie wyjątek)
 * i pozbawiony danych osobowych (lecą tylko liczby i identyfikatory).
 *
 * Format: `MS4:` + base64url ze skompresowanego (LZSS) ładunku JSON.
 * Dlaczego własny base64, własne UTF-8 i własny kompresor: `packages/core`
 * ma twardą granicę (`lib: ES2022`, `types: []`, README §Architektura) —
 * `btoa`, `TextEncoder` i `CompressionStream` po prostu tu nie istnieją.
 * Kilkadziesiąt linii kodu jest świadomą ceną za to, że ten sam moduł
 * policzy kod builda w przeglądarce, w symulatorze i (docelowo) w teście
 * serwerowym bez żadnego shimu.
 *
 * Ładunek nie jest zaszyfrowany ani podpisany — kod builda to publiczna
 * treść do udostępniania, a nie zapis stanu. Zaufanie do liczb w nim
 * zawartych ma zero znaczenia: `applyBuild` nigdy nic nie tworzy z powietrza.
 */
import { z } from "zod";
import { format } from "../core/bignum.ts";
import {
  IDLE_SLOTS,
  UPGRADE_IDS,
  failResult,
  okResult,
  type ActionResult,
  type IdleItem,
  type IdleRarityId,
  type IdleRates,
  type IdleSlot,
  type IdleState,
} from "./types.ts";

/** Prefiks jest jednocześnie numerem generacji formatu (v4 §5.8). */
export const BUILD_CODE_PREFIX = "MS4";

/** Wersja ładunku. Kod z przyszłej wersji odrzucamy — lepiej „nie umiem", niż zły build. */
export const BUILD_PAYLOAD_VERSION = 1;

/** Wersja kontenera (nagłówek binarny). Rośnie tylko przy zmianie kompresji. */
const CONTAINER_VERSION = 1;

// ─────────────────────────────────────────────────────────────── kształt

/** Afiks bez etykiety — tekst dorabia strona odczytująca z własnych danych. */
export interface BuildAffix {
  stat: string;
  base: number;
  roll: number;
  value: number;
  pct: boolean;
}

/**
 * Odchudzony `IdleItem`: bez `id` (identyfikator instancji nie znaczy nic
 * u drugiego gracza) i bez etykiet afiksów (odtwarzalne z `data/affixes.json`).
 * Zostaje to, co pozwala rozpoznać przedmiot i policzyć jego wkład w DPS.
 */
export interface BuildItem {
  slot: IdleSlot;
  baseId: string;
  name: string;
  rarity: IdleRarityId;
  zone: number;
  quality: number;
  upgradeLevel: number;
  rerolls: number;
  uniqueId?: string;
  affixes: BuildAffix[];
}

export interface BuildPayload {
  v: number;
  name: string;
  zone: number;
  prestigePoints: number;
  upgrades: Record<string, number>;
  skills: Record<string, number>;
  prestigeNodes: Record<string, number>;
  equipment: BuildItem[];
  /** Sformatowany DPS, wyłącznie do podglądu read-only. Nigdy nie wchodzi do wzorów. */
  dps: string;
  createdAt: number;
}

export interface ApplyPlan {
  /** Ile ulepszeń gracz ma już na poziomie buildu (reszty kod nie kupi — patrz `applyBuild`). */
  upgrades: number;
  /** Ile PUNKTÓW umiejętności zostanie rozdanych wg buildu. */
  skills: number;
  /** Ile punktów prestiżu zostanie rozdanych w drzewku trwałym. */
  prestigeNodes: number;
  itemsMatched: number;
  itemsMissing: number;
  /** Komunikaty po polsku, gotowe do wyświetlenia pod przyciskiem „Zastosuj". */
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────── limity

/**
 * Twarde sufity wielkości. Bez nich wklejony (albo złośliwie spreparowany)
 * kod potrafi wygenerować 100 000 węzłów i zamrozić panel postaci.
 */
const MAX_UPGRADE_KEYS = 32;
const MAX_SKILL_KEYS = 400;
const MAX_NODE_KEYS = 400;
const MAX_AFFIXES = 12;
const MAX_NAME_CHARS = 24;
const MAX_ID_CHARS = 48;
/** Kod dłuższy niż to nie jest już „do wklejenia w komentarz" — odrzucamy od razu. */
const MAX_CODE_CHARS = 16384;

const RARITY_IDS: readonly IdleRarityId[] = ["common", "magic", "rare", "epic", "unique"];

/**
 * Statystyki afiksów w kolejności, w której trafiają do kodu jako indeksy.
 * Kolejność jest **zamrożona razem z prefiksem `MS4`** — dopisywać wolno tylko
 * na końcu, przestawianie unieważnia wszystkie kody w obiegu.
 */
const AFFIX_STATS: readonly string[] = [
  "flatDamage",
  "increasedDamage",
  "attackSpeed",
  "critChance",
  "critMult",
  "areaDamage",
  "goldFind",
  "magicFind",
  "offlineEfficiency",
  "offlineCapHours",
];

// ─────────────────────────────────────────────────────────── schemat zod

const BuildAffixSchema = z
  .object({
    stat: z.string().min(1).max(MAX_ID_CHARS),
    base: z.number().finite(),
    roll: z.number().finite(),
    value: z.number().finite(),
    pct: z.boolean(),
  })
  .strict();

const BuildItemSchema = z
  .object({
    slot: z.enum([...IDLE_SLOTS] as [IdleSlot, ...IdleSlot[]]),
    baseId: z.string().min(1).max(MAX_ID_CHARS),
    name: z.string().max(MAX_NAME_CHARS * 2),
    rarity: z.enum(["common", "magic", "rare", "epic", "unique"]),
    zone: z.number().int().min(1).max(1_000_000),
    quality: z.number().min(0).max(1),
    upgradeLevel: z.number().int().min(0).max(100),
    rerolls: z.number().int().min(0).max(1_000_000),
    uniqueId: z.string().min(1).max(MAX_ID_CHARS).optional(),
    affixes: z.array(BuildAffixSchema).max(MAX_AFFIXES),
  })
  .strict();

const levelRecord = (maxKeys: number) =>
  z
    .record(z.string().min(1).max(MAX_ID_CHARS), z.number().int().min(1).max(1_000_000))
    .refine((r) => Object.keys(r).length <= maxKeys, { message: "za dużo kluczy" });

export const BuildPayloadSchema = z
  .object({
    v: z.number().int().min(1),
    name: z.string().max(MAX_NAME_CHARS),
    zone: z.number().int().min(1).max(1_000_000),
    prestigePoints: z.number().int().min(0).max(1e12),
    upgrades: levelRecord(MAX_UPGRADE_KEYS),
    skills: levelRecord(MAX_SKILL_KEYS),
    prestigeNodes: levelRecord(MAX_NODE_KEYS),
    equipment: z.array(BuildItemSchema).max(IDLE_SLOTS.length),
    dps: z.string().max(32),
    createdAt: z.number().int().min(0),
  })
  .strict();

// ────────────────────────────────────────────────────────── budowa ładunku

/**
 * Ładunek ze stanu. Osobno od `encodeBuild`, bo dzięki temu test round-tripu
 * ma z czym porównać wynik dekodowania — a bez takiego testu format binarny
 * psuje się cicho i wychodzi dopiero u gracza.
 */
export function buildPayload(state: IdleState, rates: IdleRates | null, now: number): BuildPayload {
  const equipment: BuildItem[] = [];
  for (const slot of IDLE_SLOTS) {
    const item = state.equipment[slot];
    if (item) equipment.push(toBuildItem(item, slot));
  }

  return {
    v: BUILD_PAYLOAD_VERSION,
    // Jedyne pole pisane przez gracza — przycięte i oczyszczone, bo kod idzie publicznie.
    name: sanitizeName(state.buildName),
    zone: clampInt(state.deepestZone, 1, 1_000_000),
    // Suma PP: build opisuje, ile punktów trzeba mieć, żeby go odtworzyć.
    prestigePoints: clampInt(state.prestige.points + state.prestige.spent, 0, 1e12),
    upgrades: levelsOf(state.upgrades, MAX_UPGRADE_KEYS),
    skills: levelsOf(state.skills, MAX_SKILL_KEYS),
    prestigeNodes: levelsOf(state.prestige.nodes, MAX_NODE_KEYS),
    equipment,
    dps: rates ? format(rates.dps, { notation: state.notation }) : "",
    // Zaokrąglenie do pełnej minuty: dokładny timestamp nie wnosi nic do podglądu,
    // a mniej precyzyjny znacznik to mniej materiału do wiązania kodu z osobą.
    createdAt: Math.max(0, Math.floor(now / 60_000) * 60_000),
  };
}

function toBuildItem(item: IdleItem, slot: IdleSlot): BuildItem {
  const out: BuildItem = {
    slot,
    baseId: cutId(item.baseId),
    name: sanitizeName(item.name, MAX_NAME_CHARS * 2),
    rarity: RARITY_IDS.includes(item.rarity) ? item.rarity : "common",
    zone: clampInt(item.zone, 1, 1_000_000),
    quality: round4(clamp01(item.quality)),
    upgradeLevel: clampInt(item.upgradeLevel, 0, 100),
    rerolls: clampInt(item.rerolls, 0, 1_000_000),
    affixes: item.affixes.slice(0, MAX_AFFIXES).map((a) => ({
      stat: cutId(a.stat),
      base: round4(a.base),
      roll: round4(a.roll),
      value: round4(a.value),
      pct: a.pct === true,
    })),
  };
  if (item.uniqueId) out.uniqueId = cutId(item.uniqueId);
  return out;
}

// ──────────────────────────────────────────────────────────── API kodu

export function encodeBuild(state: IdleState, rates: IdleRates | null, now: number): string {
  return encodePayload(buildPayload(state, rates, now));
}

/** Kodowanie gotowego ładunku — wydzielone dla testu round-tripu. */
export function encodePayload(payload: BuildPayload): string {
  const json = JSON.stringify(payloadToTuple(payload));
  const raw = utf8Encode(json);
  const body = lzssCompress(raw, DICT_BYTES);

  const header: number[] = [CONTAINER_VERSION];
  writeVarint(header, raw.length);
  const sum = checksum16(raw);
  header.push((sum >> 8) & 0xff, sum & 0xff);

  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return `${BUILD_CODE_PREFIX}:${bytesToBase64Url(out)}`;
}

/**
 * Dekodowanie. Zwraca `null` zamiast rzucać, bo wklejony śmieć to normalny
 * przypadek użycia: gracz kopiuje kod razem z połową zdania, Reddit łamie
 * linię, klient poczty wstawia twardą spację. Każdy z tych przypadków ma
 * skończyć się komunikatem „to nie jest kod builda", a nie stack trace'em.
 */
export function decodeBuild(code: string): BuildPayload | null {
  try {
    if (typeof code !== "string" || code.length > MAX_CODE_CHARS) return null;

    const prefix = `${BUILD_CODE_PREFIX}:`;
    const start = code.indexOf(prefix);
    if (start < 0) return null;
    // Białe znaki lecą precz: kod przeżywa zawijanie wierszy i kopiowanie z czatu.
    const body = code.slice(start + prefix.length).replace(/[\s ]+/g, "");
    if (body.length === 0) return null;

    const bytes = base64UrlToBytes(body);
    if (!bytes || bytes.length < 4) return null;
    if (bytes[0] !== CONTAINER_VERSION) return null;

    const cursor = { pos: 1 };
    const rawLength = readVarint(bytes, cursor);
    if (rawLength === null || rawLength <= 0 || rawLength > 1 << 20) return null;
    if (cursor.pos + 2 > bytes.length) return null;
    const expected = (bytes[cursor.pos] << 8) | bytes[cursor.pos + 1];
    cursor.pos += 2;

    const raw = lzssDecompress(bytes.subarray(cursor.pos), rawLength, DICT_BYTES);
    if (!raw) return null;
    // Suma kontrolna łapie to, czego JSON nie złapie: podmianę cyfry w liczbie.
    if (checksum16(raw) !== expected) return null;

    const json = utf8Decode(raw);
    if (json === null) return null;

    const tuple: unknown = JSON.parse(json);
    const payload = tupleToPayload(tuple);
    if (!payload) return null;

    const parsed = BuildPayloadSchema.safeParse(payload);
    if (!parsed.success) return null;
    // Kod z przyszłości: pola, których nie rozumiemy, mogłyby pokazać
    // graczowi build, którego nie da się odtworzyć. Lepiej odmówić.
    if (parsed.data.v > BUILD_PAYLOAD_VERSION) return null;
    return parsed.data as BuildPayload;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────── ładunek ⇄ krotka (kompaktowo)

type AffixTuple = [number | string, number, number, number, number];
type ItemTuple = [
  number,
  string,
  string,
  number,
  number,
  number,
  number,
  number,
  string | number,
  AffixTuple[],
];
type PayloadTuple = [
  number,
  string,
  number,
  number,
  number,
  string,
  [number | string, number][],
  [string, number][],
  [string, number][],
  ItemTuple[],
];

/**
 * Krotka zamiast obiektu: nazwy pól to ~40% JSON-a, a przy kodzie, który ma
 * się zmieścić w komentarzu, każdy bajt przed kompresją jest widoczny w wyniku.
 * Słowniki (sloty, rzadkości, statystyki, ulepszenia) jadą jako indeksy.
 */
function payloadToTuple(p: BuildPayload): PayloadTuple {
  return [
    p.v,
    p.name,
    p.zone,
    p.prestigePoints,
    Math.round(p.createdAt / 60_000),
    p.dps,
    Object.entries(p.upgrades).map(([k, v]): [number | string, number] => {
      const idx = UPGRADE_IDS.indexOf(k as (typeof UPGRADE_IDS)[number]);
      return [idx >= 0 ? idx : k, v];
    }),
    Object.entries(p.skills),
    Object.entries(p.prestigeNodes),
    p.equipment.map(
      (it): ItemTuple => [
        IDLE_SLOTS.indexOf(it.slot),
        it.baseId,
        it.name,
        RARITY_IDS.indexOf(it.rarity),
        it.zone,
        it.quality,
        it.upgradeLevel,
        it.rerolls,
        it.uniqueId ?? 0,
        it.affixes.map((a): AffixTuple => {
          const idx = AFFIX_STATS.indexOf(a.stat);
          return [idx >= 0 ? idx : a.stat, a.base, a.roll, a.value, a.pct ? 1 : 0];
        }),
      ],
    ),
  ];
}

/** Odczyt krotki. Wszystko defensywnie — na wejściu jest dowolny JSON. */
function tupleToPayload(raw: unknown): BuildPayload | null {
  if (!Array.isArray(raw) || raw.length < 10) return null;

  const name = asString(raw[1]);
  const dps = asString(raw[5]);
  if (name === null || dps === null) return null;

  const upgrades = readLevels(raw[6], (k) =>
    typeof k === "number" ? (UPGRADE_IDS[k] ?? null) : asId(k),
  );
  const skills = readLevels(raw[7], asId);
  const nodes = readLevels(raw[8], asId);
  if (!upgrades || !skills || !nodes) return null;

  const equipment = readItems(raw[9]);
  if (!equipment) return null;

  const minutes = asNumber(raw[4]);
  if (minutes === null) return null;

  const v = asNumber(raw[0]);
  const zone = asNumber(raw[2]);
  const pp = asNumber(raw[3]);
  if (v === null || zone === null || pp === null) return null;

  return {
    v: Math.round(v),
    name,
    zone: Math.round(zone),
    prestigePoints: Math.round(pp),
    upgrades,
    skills,
    prestigeNodes: nodes,
    equipment,
    dps,
    createdAt: Math.round(minutes) * 60_000,
  };
}

function readLevels(
  raw: unknown,
  key: (k: unknown) => string | null,
): Record<string, number> | null {
  if (!Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2) return null;
    const k = key(entry[0]);
    const v = asNumber(entry[1]);
    if (k === null || v === null) return null;
    out[k] = Math.round(v);
  }
  return out;
}

function readItems(raw: unknown): BuildItem[] | null {
  if (!Array.isArray(raw)) return null;
  const out: BuildItem[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 10) return null;
    const slot = IDLE_SLOTS[asIndex(entry[0])];
    const rarity = RARITY_IDS[asIndex(entry[3])];
    const baseId = asId(entry[1]);
    const name = asString(entry[2]);
    const zone = asNumber(entry[4]);
    const quality = asNumber(entry[5]);
    const upgradeLevel = asNumber(entry[6]);
    const rerolls = asNumber(entry[7]);
    if (!slot || !rarity || baseId === null || name === null) return null;
    if (zone === null || quality === null || upgradeLevel === null || rerolls === null) return null;

    const affixesRaw = entry[9];
    if (!Array.isArray(affixesRaw)) return null;
    const affixes: BuildAffix[] = [];
    for (const a of affixesRaw) {
      if (!Array.isArray(a) || a.length < 5) return null;
      const stat = typeof a[0] === "number" ? (AFFIX_STATS[a[0]] ?? null) : asId(a[0]);
      const base = asNumber(a[1]);
      const roll = asNumber(a[2]);
      const value = asNumber(a[3]);
      if (stat === null || base === null || roll === null || value === null) return null;
      affixes.push({ stat, base, roll, value, pct: a[4] === 1 || a[4] === true });
    }

    const item: BuildItem = {
      slot,
      baseId,
      name,
      rarity,
      zone: Math.round(zone),
      quality,
      upgradeLevel: Math.round(upgradeLevel),
      rerolls: Math.round(rerolls),
      affixes,
    };
    const uniqueId = entry[8];
    if (typeof uniqueId === "string" && uniqueId !== "") {
      const id = asId(uniqueId);
      if (id === null) return null;
      item.uniqueId = id;
    }
    out.push(item);
  }
  return out;
}

// ───────────────────────────────────────────────────── „zastosuj co się da"

interface Assignment {
  slot: IdleSlot;
  item: IdleItem;
}

interface Plan {
  plan: ApplyPlan;
  assignments: Assignment[];
  skills: Record<string, number>;
  nodes: Record<string, number>;
  nodePoints: number;
  /** Przedmioty, które po zastosowaniu buildu wracają do skrytki. */
  unequipped: number;
}

export function planApply(state: IdleState, payload: BuildPayload): ApplyPlan {
  return computePlan(state, payload).plan;
}

/**
 * „Zastosuj co się da": respec drzewka, rozdanie punktów prestiżu i założenie
 * **posiadanych** przedmiotów. Świadomie **nie** rusza ulepszeń za złoto —
 * kupionego postępu nikt graczowi nie odbiera (v4 §12: cofanie postępu to
 * jednorazowa strata zaufania), a dokupić za niego nie możemy, bo to kosztuje
 * złoto. Kod builda nigdy nie tworzy przedmiotów ani punktów z powietrza:
 * gdyby tworzył, przestałby być kodem builda, a stałby się kodem na cheaty.
 */
export function applyBuild(state: IdleState, payload: BuildPayload): ActionResult<ApplyPlan> {
  if (payload.v > BUILD_PAYLOAD_VERSION) {
    return failResult("Ten kod pochodzi z nowszej wersji gry.");
  }

  const computed = computePlan(state, payload);
  const { plan } = computed;

  // Respec jest darmowy i natychmiastowy (v4 §5.4) — nadpisujemy alokację w całości.
  state.skills = computed.skills;
  state.prestige.nodes = computed.nodes;
  const totalPp = state.prestige.points + state.prestige.spent;
  state.prestige.spent = computed.nodePoints;
  state.prestige.points = Math.max(0, totalPp - computed.nodePoints);

  // Ekwipunek przebudowujemy w całości: wszystko idzie do puli, wraca tylko to,
  // czego chce build. Reszta ląduje w skrytce — nic nie znika.
  const pool = ownedPool(state);
  const taken = new Set<string>();
  state.equipment = {};
  for (const a of computed.assignments) {
    taken.add(a.item.id);
    // Pierścienie bywają zapisane w drugim slocie — bez podmiany pola `slot`
    // deserializacja wyrzuciłaby przedmiot przy następnym wczytaniu zapisu.
    state.equipment[a.slot] = a.item.slot === a.slot ? a.item : { ...a.item, slot: a.slot };
  }
  state.stash = pool.filter((it) => !taken.has(it.id));

  // Nazwę przejmujemy tylko wtedy, gdy gracz swojej nie nadał — inaczej
  // wklejenie cudzego kodu kasowałoby jego własną etykietę.
  if (payload.name && (state.buildName === "" || state.buildName === "Bez nazwy")) {
    state.buildName = payload.name;
  }

  const parts = [
    `${plan.itemsMatched}/${plan.itemsMatched + plan.itemsMissing} przedmiotów`,
    `${plan.skills} pkt umiejętności`,
    `${plan.prestigeNodes} pkt prestiżu`,
  ];
  return okResult(`Zastosowano build: ${parts.join(", ")}.`, plan);
}

function computePlan(state: IdleState, payload: BuildPayload): Plan {
  const warnings: string[] = [];

  // — ulepszenia: tylko diagnoza, kod ich nie kupuje
  let matchedUpgrades = 0;
  let shortUpgrades = 0;
  for (const [id, want] of Object.entries(payload.upgrades)) {
    const have = state.upgrades[id as (typeof UPGRADE_IDS)[number]] ?? 0;
    if (have >= want) matchedUpgrades++;
    else shortUpgrades++;
  }
  if (shortUpgrades > 0) {
    warnings.push(
      `Ulepszeń poniżej poziomu buildu: ${shortUpgrades}. Tych nie da się przenieść kodem — kupuje się je za złoto.`,
    );
  }

  // — umiejętności: budżet to suma już rozdanych punktów. Pula punktów żyje
  //   poza `IdleState`, więc jedyna uczciwa granica to „tyle, ile gracz ma".
  const skillBudget = sumLevels(state.skills);
  const skillWant = sumLevels(payload.skills);
  const skills = allocate(payload.skills, skillBudget);
  const skillUsed = sumLevels(skills);
  if (skillWant > skillBudget) {
    warnings.push(
      `Za mało punktów umiejętności: build chce ${skillWant}, masz ${skillBudget}. Rozdano ${skillUsed}.`,
    );
  }

  // — prestiż: tu budżet znamy dokładnie (niewydane + wydane)
  const ppBudget = state.prestige.points + state.prestige.spent;
  const ppWant = sumLevels(payload.prestigeNodes);
  const nodes = allocate(payload.prestigeNodes, ppBudget);
  const nodeUsed = sumLevels(nodes);
  if (ppWant > ppBudget) {
    warnings.push(
      `Za mało punktów prestiżu: build chce ${ppWant}, masz ${ppBudget}. Rozdano ${nodeUsed}.`,
    );
  }

  // — przedmioty
  const { assignments, missing } = matchEquipment(state, payload);
  if (missing > 0) {
    warnings.push(`Brakuje ${missing} przedmiotów z buildu — kod ich nie tworzy, trzeba je znaleźć.`);
  }
  const unequipped = Math.max(0, countEquipped(state) - assignments.length);
  if (unequipped > 0) {
    warnings.push(`Zdjęto ${unequipped} przedmiotów spoza buildu — czekają w skrytce.`);
  }

  if (state.challenges.activeId) {
    warnings.push(
      "Trwa wyzwanie — jego ograniczenie nadal obowiązuje, część bonusów z tego buildu nie zadziała.",
    );
  }

  return {
    plan: {
      upgrades: matchedUpgrades,
      skills: skillUsed,
      prestigeNodes: nodeUsed,
      itemsMatched: assignments.length,
      itemsMissing: missing,
      warnings,
    },
    assignments,
    skills,
    nodes,
    nodePoints: nodeUsed,
    unequipped,
  };
}

function matchEquipment(
  state: IdleState,
  payload: BuildPayload,
): { assignments: Assignment[]; missing: number } {
  const pool = ownedPool(state);
  const used = new Set<string>();
  const assignments: Assignment[] = [];
  let missing = 0;

  for (const want of payload.equipment) {
    let best: IdleItem | null = null;
    let bestScore = 0;
    for (const item of pool) {
      if (used.has(item.id)) continue;
      const score = candidateScore(want, item);
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
    if (best) {
      used.add(best.id);
      assignments.push({ slot: want.slot, item: best });
    } else {
      missing++;
    }
  }
  return { assignments, missing };
}

/**
 * Dopasowanie przedmiotu. Warunek konieczny to ta sama baza (i ten sam unikat,
 * jeśli build go wymaga) — bez tego „zastosuj co się da" zakładałoby losowe
 * rzeczy i gracz nie wiedziałby, co właściwie dostał. Reszta to ranking:
 * lepsza rzadkość, wyższe ulepszenie, wyższa jakość, więcej wspólnych afiksów.
 */
function candidateScore(want: BuildItem, item: IdleItem): number {
  if (item.baseId !== want.baseId) return 0;
  if (want.uniqueId && item.uniqueId !== want.uniqueId) return 0;
  if (!slotsCompatible(item.slot, want.slot)) return 0;

  let score = 1;
  if (item.rarity === want.rarity) score += 40;
  score += Math.min(item.upgradeLevel, 20) * 2;
  score += clamp01(item.quality) * 10;
  const wanted = new Set(want.affixes.map((a) => a.stat));
  for (const a of item.affixes) if (wanted.has(a.stat)) score += 5;
  return score;
}

/** Pierścienie są wymienne między slotami — reszta slotów nie. */
function slotsCompatible(a: IdleSlot, b: IdleSlot): boolean {
  if (a === b) return true;
  const ring = (s: IdleSlot) => s === "ring1" || s === "ring2";
  return ring(a) && ring(b);
}

function ownedPool(state: IdleState): IdleItem[] {
  const out: IdleItem[] = [];
  for (const slot of IDLE_SLOTS) {
    const item = state.equipment[slot];
    if (item) out.push(item);
  }
  out.push(...state.stash);
  return out;
}

function countEquipped(state: IdleState): number {
  let n = 0;
  for (const slot of IDLE_SLOTS) if (state.equipment[slot]) n++;
  return n;
}

/** Rozdanie punktów do wyczerpania budżetu. Kolejność kluczy jest posortowana → wynik deterministyczny. */
function allocate(want: Record<string, number>, budget: number): Record<string, number> {
  const out: Record<string, number> = {};
  let left = Math.max(0, Math.floor(budget));
  for (const key of Object.keys(want).sort()) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, Math.floor(want[key] ?? 0)));
    if (take > 0) {
      out[key] = take;
      left -= take;
    }
  }
  return out;
}

function sumLevels(record: Record<string, number>): number {
  let sum = 0;
  for (const v of Object.values(record)) if (Number.isFinite(v) && v > 0) sum += Math.floor(v);
  return sum;
}

// ────────────────────────────────────────────────────────────── kompresja

/**
 * LZSS z oknem 4 kB: 8 tokenów na bajt flag, token to literał (1 B) albo
 * dopasowanie (2 B: 12 bitów odległości + 4 bity długości, 3–18 bajtów).
 * To najprostszy algorytm, który realnie ściska powtarzalny JSON — a ładunek
 * builda to dziewięć niemal identycznych struktur przedmiotu pod rząd.
 */
const LZ_WINDOW = 4096;
const LZ_MIN_MATCH = 3;
const LZ_MAX_MATCH = 18;
const LZ_HASH_BITS = 15;
const LZ_MAX_CHAIN = 96;

/**
 * Słownik startowy — okno kompresora zaczyna „zapełnione" tym tekstem, więc
 * nawet pierwszy przedmiot w ładunku ma do czego się odwołać. Krótki kod
 * (kilkaset bajtów) zyskuje na tym najwięcej, bo nie zdąży zbudować własnej
 * historii. **Zamrożony razem z prefiksem `MS4`**: każda zmiana treści
 * unieważnia wszystkie kody w obiegu, więc idzie w parze z `MS5`.
 */
const LZ_DICT =
  '],[[0,"","],["0,0],[[0.5,0.6,0.7,0.75,0.8,0.85,0.9,0.95,1,0,1],[2],[3],[4],[5],[6],[7],[8],' +
  '",[[0,",[[1,",[[2,",[[3,"weapon","helmet","chest","gloves","boots","belt","amulet","ring1",' +
  '"ring2","common","magic","rare","epic","unique","damage","attackSpeed","critChance",' +
  '"critMult","goldFind","areaDamage","magicFind","flatDamage","increasedDamage","node_",' +
  '"skill_","keystone_","unique_","sword_","axe_","bow_","staff_","dagger_","hammer_","plate_",' +
  '"leather_","robe_","ring_","amulet_","_t1","_t2","_t3","_t4","_t5",0],[';

let dictCache: Uint8Array | null = null;
const DICT_BYTES: Uint8Array = (() => {
  if (!dictCache) dictCache = utf8Encode(LZ_DICT);
  return dictCache;
})();

function lzssCompress(input: Uint8Array, dict: Uint8Array): Uint8Array {
  const buf = new Uint8Array(dict.length + input.length);
  buf.set(dict, 0);
  buf.set(input, dict.length);
  const start = dict.length;
  const end = buf.length;

  const hashSize = 1 << LZ_HASH_BITS;
  const head = new Int32Array(hashSize).fill(-1);
  const prev = new Int32Array(Math.max(1, end)).fill(-1);
  const mask = hashSize - 1;
  const hashAt = (i: number): number => ((buf[i] << 10) ^ (buf[i + 1] << 5) ^ buf[i + 2]) & mask;
  const insert = (i: number): void => {
    if (i + LZ_MIN_MATCH > end) return;
    const h = hashAt(i);
    prev[i] = head[h];
    head[h] = i;
  };

  // Słownik wjeżdża do łańcuchów, inaczej byłby martwym balastem.
  for (let i = 0; i < start; i++) insert(i);

  const out: number[] = [];
  let flagIndex = 0;
  let bit = 0;
  let pos = start;
  out.push(0);

  while (pos < end) {
    let bestLen = 0;
    let bestDist = 0;

    if (pos + LZ_MIN_MATCH <= end) {
      const maxLen = Math.min(LZ_MAX_MATCH, end - pos);
      let cand = head[hashAt(pos)];
      let guard = 0;
      while (cand >= 0 && guard++ < LZ_MAX_CHAIN) {
        const dist = pos - cand;
        if (dist > LZ_WINDOW) break;
        if (buf[cand + bestLen] === buf[pos + bestLen]) {
          let len = 0;
          while (len < maxLen && buf[cand + len] === buf[pos + len]) len++;
          if (len > bestLen) {
            bestLen = len;
            bestDist = dist;
            if (len >= maxLen) break;
          }
        }
        cand = prev[cand];
      }
    }

    if (bestLen >= LZ_MIN_MATCH) {
      const d = bestDist - 1;
      out.push((d >> 4) & 0xff, ((d & 0x0f) << 4) | (bestLen - LZ_MIN_MATCH));
      for (let k = 0; k < bestLen; k++) insert(pos + k);
      pos += bestLen;
    } else {
      out[flagIndex] |= 1 << bit;
      out.push(buf[pos]);
      insert(pos);
      pos++;
    }

    if (++bit === 8) {
      bit = 0;
      if (pos < end) {
        flagIndex = out.length;
        out.push(0);
      }
    }
  }

  return Uint8Array.from(out);
}

function lzssDecompress(comp: Uint8Array, outLength: number, dict: Uint8Array): Uint8Array | null {
  const limit = dict.length + outLength;
  const out = new Uint8Array(limit);
  out.set(dict, 0);
  let o = dict.length;
  let p = 0;

  while (o < limit) {
    if (p >= comp.length) return null; // strumień urwany w połowie
    const flags = comp[p++];
    for (let b = 0; b < 8 && o < limit; b++) {
      if ((flags >> b) & 1) {
        if (p >= comp.length) return null;
        out[o++] = comp[p++];
      } else {
        if (p + 1 >= comp.length) return null;
        const b0 = comp[p++];
        const b1 = comp[p++];
        const dist = ((b0 << 4) | (b1 >> 4)) + 1;
        const len = (b1 & 0x0f) + LZ_MIN_MATCH;
        let src = o - dist;
        // Odwołanie przed początek bufora albo poza deklarowaną długość
        // oznacza uszkodzony kod — nie „prawie dobry", tylko do odrzucenia.
        if (src < 0 || o + len > limit) return null;
        for (let k = 0; k < len; k++) out[o++] = out[src++];
      }
    }
  }
  return out.subarray(dict.length);
}

// ─────────────────────────────────────────────────── base64url / UTF-8 / suma

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const B64_REVERSE: Int16Array = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i++) table[B64_CHARS.charCodeAt(i)] = i;
  return table;
})();

/** base64url bez wypełniania `=` — kod ma się kleić do URL-a i do Markdowna. */
function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + B64_CHARS[(n >> 6) & 63] + B64_CHARS[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + B64_CHARS[(n >> 6) & 63];
  }
  return out;
}

function base64UrlToBytes(text: string): Uint8Array | null {
  const clean = text.replace(/=+$/, "");
  const len = clean.length;
  if (len % 4 === 1) return null; // takiej długości base64 nie da się wyprodukować
  const outLen = Math.floor((len * 3) / 4);
  const out = new Uint8Array(outLen);

  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < len; i++) {
    const code = clean.charCodeAt(i);
    const v = code < 128 ? B64_REVERSE[code] : -1;
    if (v < 0) return null; // także `+` i `/` — to nie jest base64url
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return o === outLen ? out : out.subarray(0, o);
}

function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    // Para zastępcza — bez tego emoji w nazwie builda rozjeżdża kod.
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        cp = ((cp - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
        i++;
      }
    }
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
  }
  return Uint8Array.from(out);
}

/** `null` przy niepoprawnym UTF-8 — uszkodzony kod nie ma prawa dać „prawie tekstu". */
function utf8Decode(bytes: Uint8Array): string | null {
  const chunks: string[] = [];
  let buffer: number[] = [];
  const flush = (): void => {
    if (buffer.length > 0) {
      chunks.push(String.fromCharCode(...buffer));
      buffer = [];
    }
  };

  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i];
    let cp: number;
    let size: number;
    if (b0 < 0x80) {
      cp = b0;
      size = 1;
    } else if ((b0 & 0xe0) === 0xc0) {
      cp = b0 & 0x1f;
      size = 2;
    } else if ((b0 & 0xf0) === 0xe0) {
      cp = b0 & 0x0f;
      size = 3;
    } else if ((b0 & 0xf8) === 0xf0) {
      cp = b0 & 0x07;
      size = 4;
    } else return null;

    if (i + size > bytes.length) return null;
    for (let k = 1; k < size; k++) {
      const b = bytes[i + k];
      if ((b & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (b & 63);
    }
    if (cp > 0x10ffff) return null;
    i += size;

    if (cp < 0x10000) buffer.push(cp);
    else {
      const v = cp - 0x10000;
      buffer.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    }
    if (buffer.length >= 4096) flush();
  }
  flush();
  return chunks.join("");
}

/** FNV-1a złożone do 16 bitów. Dwa bajty w kodzie za wykrycie podmiany cyfry — opłacalny handel. */
function checksum16(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ((h >>> 16) ^ (h & 0xffff)) & 0xffff;
}

function writeVarint(out: number[], value: number): void {
  let v = value >>> 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
}

function readVarint(bytes: Uint8Array, cursor: { pos: number }): number | null {
  let result = 0;
  let shift = 0;
  while (cursor.pos < bytes.length) {
    const b = bytes[cursor.pos++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return result >>> 0;
    shift += 7;
    if (shift > 28) return null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────── drobiazgi

/**
 * Nazwa builda to jedyne pole tekstowe pisane przez gracza, a kod trafia
 * publicznie — obcinamy długość i wycinamy znaki sterujące. Nic więcej
 * osobowego w ładunku nie ma: same liczby i identyfikatory.
 */
function sanitizeName(raw: string, limit = MAX_NAME_CHARS): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/[\u0000-\u001F\u007F]/g, " ").trim().replace(/\s+/g, " ");
  return clean.slice(0, limit);
}

function cutId(raw: string): string {
  return typeof raw === "string" ? raw.slice(0, MAX_ID_CHARS) : "";
}

function levelsOf(src: Record<string, number>, maxKeys: number): Record<string, number> {
  const out: Record<string, number> = {};
  let count = 0;
  for (const key of Object.keys(src).sort()) {
    if (count >= maxKeys) break;
    const raw = src[key];
    if (!Number.isFinite(raw) || raw <= 0) continue;
    const id = cutId(key);
    if (id === "") continue;
    out[id] = clampInt(raw, 1, 1_000_000);
    count++;
  }
  return out;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asIndex(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : -1;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asId(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_ID_CHARS ? v : null;
}

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(v)));
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function round4(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 10_000) / 10_000 : 0;
}
