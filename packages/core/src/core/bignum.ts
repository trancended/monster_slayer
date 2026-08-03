/**
 * Wielkie liczby (v4 §7.6). Gra idle przekracza `Number.MAX_SAFE_INTEGER`
 * po kilkunastu godzinach — decyzja o reprezentacji zapada raz i na zawsze,
 * bo późniejsza migracja dotyka każdej formuły w projekcie.
 *
 * Reprezentacja: `{ m, e }` → wartość `m · 10^e`, znormalizowana do `1 ≤ |m| < 10`.
 * Zero to jedyny wyjątek: `{ m: 0, e: 0 }`.
 *
 * Dlaczego nie `BigInt`: potrzebujemy ułamków i mnożenia przez 1.09 w pętli,
 * a nie dokładności co do jedności przy 1e300. Mantysa `float64` daje ~15 cyfr
 * znaczących — dla licznika złota to o rząd wielkości więcej, niż widzi gracz.
 *
 * Typ jest **niemutowalny z konwencji**: każda operacja zwraca nowy obiekt.
 * W ścieżkach gorących (pętla 60 Hz) używaj zwykłych `number` — Big służy
 * warstwie idle, która tyka co sekundę, nie co klatkę.
 */

export interface Big {
  /** Mantysa, `1 ≤ |m| < 10` (albo dokładnie 0). */
  readonly m: number;
  /** Wykładnik dziesiętny. */
  readonly e: number;
}

export const BIG_ZERO: Big = { m: 0, e: 0 };
export const BIG_ONE: Big = { m: 1, e: 0 };

/** Powyżej tego wykładnika `toNumber()` przestaje być wiarygodne. */
const SAFE_EXP = 15;
/** Różnica wykładników, przy której składnik dodawania znika w zaokrągleniu. */
const ADD_EPSILON_EXP = 17;

function make(m: number, e: number): Big {
  if (m === 0 || !Number.isFinite(m)) return BIG_ZERO;
  const shift = Math.floor(Math.log10(Math.abs(m)));
  if (shift === 0) return { m, e };
  const scaled = m / Math.pow(10, shift);
  // log10 na granicy dekady potrafi dać 0.9999999 → korekta o jeden krok.
  if (Math.abs(scaled) >= 10) return { m: scaled / 10, e: e + shift + 1 };
  if (Math.abs(scaled) < 1) return { m: scaled * 10, e: e + shift - 1 };
  return { m: scaled, e: e + shift };
}

/** Konstruktor z `number` albo z pary mantysa/wykładnik. */
export function big(value: number | Big, exponent = 0): Big {
  if (typeof value === "object") return value;
  if (!Number.isFinite(value) || value === 0) return BIG_ZERO;
  return make(value, exponent);
}

export function isBig(v: unknown): v is Big {
  return typeof v === "object" && v !== null && typeof (v as Big).m === "number";
}

export function isZero(a: Big): boolean {
  return a.m === 0;
}

export function neg(a: Big): Big {
  return a.m === 0 ? BIG_ZERO : { m: -a.m, e: a.e };
}

export function abs(a: Big): Big {
  return a.m < 0 ? { m: -a.m, e: a.e } : a;
}

export function add(a: Big, b: Big): Big {
  if (a.m === 0) return b;
  if (b.m === 0) return a;
  const [hi, lo] = a.e >= b.e ? [a, b] : [b, a];
  const delta = hi.e - lo.e;
  // Składnik mniejszy o 17 rzędów wielkości nie zmieni mantysy float64.
  if (delta > ADD_EPSILON_EXP) return hi;
  return make(hi.m + lo.m / Math.pow(10, delta), hi.e);
}

export function sub(a: Big, b: Big): Big {
  return add(a, neg(b));
}

export function mul(a: Big, b: Big): Big {
  if (a.m === 0 || b.m === 0) return BIG_ZERO;
  return make(a.m * b.m, a.e + b.e);
}

export function div(a: Big, b: Big): Big {
  if (b.m === 0) return BIG_ZERO; // dzielenie przez zero traktujemy jak 0
  if (a.m === 0) return BIG_ZERO;
  return make(a.m / b.m, a.e - b.e);
}

/** Skrót na najczęstszą operację: skalowanie zwykłą liczbą. */
export function scale(a: Big, k: number): Big {
  if (a.m === 0 || k === 0 || !Number.isFinite(k)) return BIG_ZERO;
  return make(a.m * k, a.e);
}

/** `a^k` dla wykładnika rzeczywistego. */
export function pow(a: Big, k: number): Big {
  if (a.m === 0) return k === 0 ? BIG_ONE : BIG_ZERO;
  if (k === 0) return BIG_ONE;
  if (a.m < 0 && !Number.isInteger(k)) return BIG_ZERO;
  const sign = a.m < 0 && Math.abs(k % 2) === 1 ? -1 : 1;
  const l = (Math.log10(Math.abs(a.m)) + a.e) * k;
  const e = Math.floor(l);
  return make(sign * Math.pow(10, l - e), e);
}

/** `base^k`, gdzie `base` jest zwykłą liczbą — rdzeń krzywych wykładniczych. */
export function powNum(base: number, k: number): Big {
  if (base <= 0) return BIG_ZERO;
  const l = Math.log10(base) * k;
  const e = Math.floor(l);
  return make(Math.pow(10, l - e), e);
}

/** Logarytm dziesiętny. Dla wartości ≤ 0 zwraca `-Infinity`. */
export function log10(a: Big): number {
  if (a.m <= 0) return -Infinity;
  return Math.log10(a.m) + a.e;
}

export function sqrt(a: Big): Big {
  if (a.m <= 0) return BIG_ZERO;
  return pow(a, 0.5);
}

/** −1, 0 albo 1. */
export function cmp(a: Big, b: Big): number {
  if (a.m === 0 && b.m === 0) return 0;
  if (a.m === 0) return b.m > 0 ? -1 : 1;
  if (b.m === 0) return a.m > 0 ? 1 : -1;
  if (a.m > 0 !== b.m > 0) return a.m > 0 ? 1 : -1;
  const sign = a.m > 0 ? 1 : -1;
  if (a.e !== b.e) return a.e > b.e ? sign : -sign;
  if (a.m === b.m) return 0;
  return a.m > b.m ? 1 : -1;
}

export const lt = (a: Big, b: Big): boolean => cmp(a, b) < 0;
export const lte = (a: Big, b: Big): boolean => cmp(a, b) <= 0;
export const gt = (a: Big, b: Big): boolean => cmp(a, b) > 0;
export const gte = (a: Big, b: Big): boolean => cmp(a, b) >= 0;

export function min(a: Big, b: Big): Big {
  return cmp(a, b) <= 0 ? a : b;
}

export function max(a: Big, b: Big): Big {
  return cmp(a, b) >= 0 ? a : b;
}

export function sum(values: readonly Big[]): Big {
  let acc = BIG_ZERO;
  for (const v of values) acc = add(acc, v);
  return acc;
}

/**
 * Konwersja do `number`. Powyżej 1e15 traci precyzję — używaj wyłącznie tam,
 * gdzie wynik i tak trafia do wykresu albo do porównania rzędu wielkości.
 */
export function toNumber(a: Big): number {
  if (a.m === 0) return 0;
  if (a.e > 308) return a.m > 0 ? Infinity : -Infinity;
  if (a.e < -308) return 0;
  return a.m * Math.pow(10, a.e);
}

/** Czy wartość mieści się w bezpiecznym zakresie `number`. */
export function isSafe(a: Big): boolean {
  return a.m === 0 || a.e <= SAFE_EXP;
}

/** Część całkowita — używana wszędzie, gdzie liczymy „ile poziomów / sztuk". */
export function floorBig(a: Big): Big {
  if (a.m === 0 || a.e >= SAFE_EXP) return a;
  return big(Math.floor(toNumber(a)));
}

// ───────────────────────────────────────────────────────────── formatowanie

/**
 * Polska notacja skrócona (skala długa — obowiązująca w PL, w odróżnieniu
 * od amerykańskiej „billion"). Indeks tablicy to wykładnik / 3.
 */
const SHORT_UNITS = [
  "", // 1e0
  "tys.", // 1e3
  "mln", // 1e6
  "mld", // 1e9
  "bln", // 1e12  bilion
  "bld", // 1e15  biliard
  "trl", // 1e18  trylion
  "trd", // 1e21  tryliard
  "kwa", // 1e24  kwadrylion
  "kwd", // 1e27  kwadryliard
  "kwi", // 1e30  kwintylion
  "kwl", // 1e33  kwintyliard
  "sxl", // 1e36  sekstylion
  "sxd", // 1e39  sekstyliard
  "spl", // 1e42  septylion
  "spd", // 1e45  septyliard
] as const;

export type Notation = "short" | "scientific" | "engineering";

export interface FormatOptions {
  notation?: Notation;
  /** Cyfry po przecinku dla notacji skróconej. */
  decimals?: number;
}

/**
 * Formatowanie do UI. `short` jest domyślne, bo to jedyna notacja, którą
 * czyta się jednym rzutem oka; gracze twardsi przełączają się na `scientific`
 * w opcjach (v4 §7.6).
 */
export function format(value: Big | number, opts: FormatOptions = {}): string {
  const a = big(value);
  if (a.m === 0) return "0";

  const notation = opts.notation ?? "short";
  const sign = a.m < 0 ? "-" : "";
  const m = Math.abs(a.m);

  if (notation === "scientific") {
    const d = opts.decimals ?? 2;
    if (a.e >= -3 && a.e <= 5) return sign + plain(m, a.e);
    return `${sign}${m.toFixed(d)}e${a.e}`;
  }

  if (notation === "engineering") {
    const group = Math.floor(a.e / 3);
    const mant = m * Math.pow(10, a.e - group * 3);
    if (group === 0) return sign + plain(m, a.e);
    return `${sign}${mant.toFixed(2)}e${group * 3}`;
  }

  // — short
  if (a.e < 3) return sign + plain(m, a.e);

  const group = Math.floor(a.e / 3);
  const unit = SHORT_UNITS[group];
  if (unit === undefined) {
    const d = opts.decimals ?? 2;
    return `${sign}${m.toFixed(d)}e${a.e}`;
  }
  const mant = m * Math.pow(10, a.e - group * 3);
  const decimals = opts.decimals ?? (mant < 10 ? 2 : mant < 100 ? 1 : 0);
  return `${sign}${trimZeros(mant.toFixed(decimals))} ${unit}`;
}

/** Liczby poniżej tysiąca — bez separatorów, z sensowną liczbą miejsc. */
function plain(mantissa: number, exponent: number): string {
  const v = mantissa * Math.pow(10, exponent);
  if (Number.isInteger(v)) return groupThousands(v.toString());
  if (Math.abs(v) >= 100) return groupThousands(v.toFixed(0));
  if (Math.abs(v) >= 10) return v.toFixed(1);
  if (Math.abs(v) >= 1) return trimZeros(v.toFixed(2));
  return trimZeros(v.toPrecision(2));
}

/**
 * Separator tysięcy zgodny z polską typografią: spacja **niełamliwa**.
 * Zwykła spacja pozwoliłaby przeglądarce złamać `14 302` na dwie linie —
 * a licznik zabójstw na ekranie powrotu jest jedną liczbą, nie dwiema.
 * Zapisany jako escape, bo w źródle jest nie do odróżnienia od zwykłej spacji.
 */
export const THOUSANDS_SEPARATOR = "\u00A0";

function groupThousands(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS_SEPARATOR);
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** Sam licznik całkowity (zabici, przedmioty) — bez notacji naukowej do 1e6. */
export function formatCount(value: Big | number): string {
  const a = big(value);
  if (a.e < 6) return groupThousands(Math.round(toNumber(a)).toString());
  return format(a);
}

/** `1 h 42 min`, `38 s` — używane na ekranie powrotu i przy szacowaniu czasu. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem > 0 ? `${h} h ${rem} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const hRem = h % 24;
  return hRem > 0 ? `${d} d ${hRem} h` : `${d} d`;
}

// ───────────────────────────────────────────────────────── serializacja

/**
 * Zapis do JSON-a. Format tekstowy `"m|e"` zamiast obiektu: krótszy w save'ie
 * i odporny na to, że ktoś kiedyś zmieni nazwy pól.
 */
export function bigToJSON(a: Big): string {
  return a.m === 0 ? "0" : `${a.m}|${a.e}`;
}

export function bigFromJSON(raw: unknown): Big {
  if (typeof raw === "number") return big(raw);
  if (isBig(raw)) return make(raw.m, raw.e);
  if (typeof raw !== "string") return BIG_ZERO;
  const idx = raw.indexOf("|");
  if (idx < 0) {
    const n = Number(raw);
    return Number.isFinite(n) ? big(n) : BIG_ZERO;
  }
  const m = Number(raw.slice(0, idx));
  const e = Number(raw.slice(idx + 1));
  return Number.isFinite(m) && Number.isFinite(e) ? make(m, e) : BIG_ZERO;
}

/** Parsowanie wejścia gracza / kodu builda: `"1.2e9"`, `"3 mln"`, `"12500"`. */
export function bigParse(text: string): Big {
  const t = text.trim().replace(/[\s  ]/g, " ").toLowerCase();
  if (t === "") return BIG_ZERO;

  const unitIdx = SHORT_UNITS.findIndex((u) => u !== "" && t.endsWith(u));
  if (unitIdx > 0) {
    const num = Number(t.slice(0, t.length - SHORT_UNITS[unitIdx]!.length).trim().replace(",", "."));
    return Number.isFinite(num) ? make(num, unitIdx * 3) : BIG_ZERO;
  }

  const sci = /^(-?\d+(?:[.,]\d+)?)e(-?\d+)$/.exec(t);
  if (sci) return make(Number(sci[1]!.replace(",", ".")), Number(sci[2]));

  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? big(n) : BIG_ZERO;
}
