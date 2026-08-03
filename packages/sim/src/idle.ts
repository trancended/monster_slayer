/**
 * Symulator progresji idle — headless, ten sam kod co gra (plan v4 §4, §9).
 *
 * Po co on istnieje: krzywe z §4 są sekcją, którą „najłatwiej zepsuć
 * i najdrożej naprawić". Ręczne sprawdzanie, czy strefa 45 wypada po 12 h,
 * wymagałoby dwunastu godzin. Ten plik robi to w sekundę i **wypisuje bramki
 * jakości z v4 obok zmierzonych wartości**, więc regresja balansu jest widoczna
 * w diffie, a nie po tygodniu telemetrii.
 *
 * Model gracza: „gracz optymalny” — kupuje wszystko, na co go stać, co 5 s.
 * To górna granica tempa. Realny gracz jest wolniejszy, więc każdy próg
 * osiągnięty tutaj później niż zakłada dokument jest problemem na pewno.
 *
 * Uruchomienie:
 *   pnpm sim:idle
 *   SIM_HOURS=48 pnpm sim:idle
 *   SIM_STRICT=true pnpm sim:idle    # kod wyjścia ≠ 0 przy złamanej bramce
 */
import { format, idle } from "@ms/core";

const HOURS = Number(process.env.SIM_HOURS ?? 14);
const STRICT = process.env.SIM_STRICT === "true";
const STEP = 5;

/** Bramki z planu v4 — jedno miejsce, w którym siedzą oczekiwania dokumentu. */
const GATES = [
  { zone: 10, minHours: 0.4, maxHours: 2.0, label: "boss strefy 10 — pierwszy próg (faza B: 30 min – 2 h)" },
  { zone: 27, minHours: 1.5, maxHours: 5.0, label: "auto-atak — „możesz zamknąć kartę” (faza C: 2–5 h)" },
  { zone: 40, minHours: 8.0, maxHours: 16.0, label: "odblokowanie prestiżu (faza E: ~12 h)" },
] as const;

interface Row {
  hours: number;
  zone: number;
  gold: string;
  dps: string;
  clearSeconds: number;
  pp: number;
}

function simulate(): { rows: Row[]; reached: Map<number, number>; engine: idle.IdleEngine } {
  // Ziarno stałe — symulacja balansu musi dawać ten sam wynik między
  // uruchomieniami, inaczej diff raportu jest bezużyteczny.
  const engine = new idle.IdleEngine({ now: 0, seed: 0x1d1e5eed });
  const rows: Row[] = [];
  const reached = new Map<number, number>();
  const marks = new Set<number>();

  let t = 0;
  let nextRow = 0;

  while (t < HOURS * 3600) {
    const rates = engine.rates;

    // Zabójstwa i złoto z bieżącego tempa — dokładnie ta sama arytmetyka,
    // której używa marsz offline.
    idle.registerKills(engine.state, engine.config, rates.killsPerSecond * STEP, {
      m: rates.goldPerSecond.m * STEP,
      e: rates.goldPerSecond.e,
    });
    engine.invalidate();

    for (const def of engine.config.upgrades) {
      if (engine.state.deepestZoneEver < def.unlockZone) continue;
      const k = idle.maxAffordable(engine.state, engine.config, def.id);
      if (k > 0) {
        idle.buyUpgrade(engine.state, engine.config, def.id, k);
        engine.invalidate();
      }
    }
    engine.refreshAutomation();

    for (const gate of GATES) {
      if (engine.state.zone >= gate.zone && !marks.has(gate.zone)) {
        marks.add(gate.zone);
        reached.set(gate.zone, t / 3600);
      }
    }

    if (t >= nextRow) {
      rows.push({
        hours: t / 3600,
        zone: engine.state.zone,
        gold: format(engine.state.goldThisRun),
        dps: format(engine.rates.dps),
        clearSeconds: engine.rates.clearSeconds,
        pp: idle.prestigePoints(engine.state, engine.config),
      });
      nextRow += HOURS * 3600 <= 4 * 3600 ? 900 : 3600;
    }

    t += STEP;
  }

  return { rows, reached, engine };
}

function pad(s: string, n: number, right = false): string {
  return right ? s.padStart(n) : s.padEnd(n);
}

const { rows, reached, engine } = simulate();

console.log(`\nSymulacja progresji idle — ${HOURS} h gracza optymalnego\n`);
console.log(
  `${pad("czas", 8)}${pad("strefa", 8, true)}${pad("złoto biegu", 16, true)}${pad("DPS", 14, true)}${pad("czyszcz.", 11, true)}${pad("PP", 8, true)}`,
);
console.log("─".repeat(65));
for (const r of rows) {
  const clear = Number.isFinite(r.clearSeconds) ? `${r.clearSeconds.toFixed(0)} s` : "∞";
  console.log(
    `${pad(`${r.hours.toFixed(1)} h`, 8)}${pad(String(r.zone), 8, true)}${pad(r.gold, 16, true)}${pad(r.dps, 14, true)}${pad(clear, 11, true)}${pad(String(r.pp), 8, true)}`,
  );
}

// ── bramki ────────────────────────────────────────────────────────────────

console.log("\nBramki z planu v4:\n");
let broken = 0;
for (const gate of GATES) {
  const at = reached.get(gate.zone);
  // Bramka ma dwie strony: za wolno to ściana, za szybko to spalony content.
  const ok = at !== undefined && at >= gate.minHours && at <= gate.maxHours;
  if (!ok) broken += 1;
  const value = at === undefined ? "nieosiągnięta" : `${at.toFixed(2)} h`;
  const window = `${gate.minHours}–${gate.maxHours} h`;
  console.log(
    `  ${ok ? "✓" : "✗"} strefa ${pad(String(gate.zone), 4, true)} w ${pad(window, 10, true)}  →  ${pad(value, 14)}  ${gate.label}`,
  );
}

// ── warunek dobrego prestiżu (v4 §4.3) ────────────────────────────────────

const ratio = idle.estimateReturnRatio(engine.state, engine.config);
const pp = idle.prestigePoints(engine.state, engine.config);
const ratioOk = ratio >= 0.3 && ratio <= 0.4;
if (!ratioOk) broken += 1;

console.log("\nWarunek dobrego prestiżu (v4 §4.3: powrót w 30–40% czasu):\n");
console.log(`  ${ratioOk ? "✓" : "✗"} PP z pierwszego resetu: ${pp}`);
console.log(
  `  ${ratioOk ? "✓" : "✗"} szacowany powrót: ${(ratio * 100).toFixed(0)}% poprzedniego czasu`,
);
if (!ratioOk) {
  console.log(
    ratio > 0.4
      ? "     → za mało PP: gracz poczuje prestiż jako karę. Podnieś `prestige.k` albo obniż `prestige.t`."
      : "     → za dużo PP: resety stracą znaczenie. Obniż `prestige.k` albo podnieś `prestige.t`.",
  );
}

// ── okno czyszczenia strefy (v4 §4.2) ─────────────────────────────────────

const last = rows[rows.length - 1];
if (last) {
  const cfg = engine.config.zones;

  // Strefy bossów mają HP ×12 i MAJĄ blokować (v4 §3, faza B: „boss strefy 10
  // blokuje przejście, wymaga jednego upgrade'u"). Mierzenie progu ściany na
  // takiej strefie zgłaszałoby jako awarię coś, co jest zamierzonym progiem —
  // dlatego werdykt stawiamy na ostatniej ZWYKŁEJ strefie.
  const plain = [...rows].reverse().find((r) => !idle.isBossZone(r.zone, cfg));
  const boss = last.zone % cfg.bossEvery === 0;
  const measured = plain ?? last;

  const inWindow =
    measured.clearSeconds >= cfg.targetClearMin && measured.clearSeconds <= cfg.targetClearMax;
  const wall = measured.clearSeconds > cfg.stuckSeconds;

  console.log(`\nTempo na końcu symulacji (cel ${cfg.targetClearMin}–${cfg.targetClearMax} s):\n`);
  console.log(
    `  ${inWindow ? "✓" : wall ? "✗" : "~"} ${measured.clearSeconds.toFixed(0)} s na zwykłą strefę (strefa ${measured.zone})` +
      (wall ? `  → powyżej progu ściany (${cfg.stuckSeconds} s), gracz stoi` : ""),
  );
  if (boss) {
    console.log(
      `  ℹ strefa ${last.zone} to boss (HP ×${cfg.bossHpMult}) — ${last.clearSeconds.toFixed(0)} s to zamierzony próg, nie ściana`,
    );
  }
  if (wall) broken += 1;
}

console.log(
  broken === 0
    ? "\nWszystkie bramki spełnione.\n"
    : `\n${broken} bramek złamanych — krzywe wymagają strojenia (data/idle.json).\n`,
);

if (STRICT && broken > 0) process.exit(1);
