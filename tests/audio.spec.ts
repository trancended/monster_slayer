/**
 * Pomiar dźwięków walki.
 *
 * Audio bez weryfikacji to ten sam błąd co niesprawdzona ścieżka renderera:
 * kod się kompiluje, a użytkownik słyszy ciszę albo trzask. Odsłuchać nie mogę,
 * ale mogę **zmierzyć** — każde zdarzenie musi wyprodukować sygnał o sensownym
 * szczycie, bez przesterowania.
 *
 * Metoda: podpinamy analizator do wyjścia i próbkujemy szczyt przez okno czasu
 * po wyzwoleniu dźwięku.
 */
import { expect, test } from "@playwright/test";

/** Zdarzenia walki, które MUSZĄ być słyszalne. */
const COMBAT = [
  "swing1", "swing3", "heavySwing", "whiff", "enemySwing",
  "hit", "hitHeavy", "stagger", "break", "dodge",
  "charge", "charge_go", "playerHurt", "enemyDeath", "bossDeath",
  "explosion", "shoot", "alert",
  "telegraph_circle", "telegraph_cone", "telegraph_line",
];

test("dźwięki walki są słyszalne i nie przesterowują", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();
  await page.waitForFunction(() => (window as any).__ms?.audio !== undefined, { timeout: 60_000 });
  await page.waitForTimeout(1500);

  const wyniki = await page.evaluate(async (nazwy: string[]) => {
    const a = (window as any).__ms.audio;
    const ctx: AudioContext = (a as any).ctx;
    const bus = (a as any).bus;
    if (!ctx || !bus) return { blad: "brak kontekstu audio" };

    // Analizator wpięty równolegle do mastera — nie zmienia ścieżki sygnału.
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    bus.master.connect(an);
    const buf = new Float32Array(an.fftSize);

    const zmierz = async (nazwa: string) => {
      // Cisza przed pomiarem, żeby ogon poprzedniego dźwięku nie zliczył się
      // do następnego.
      await new Promise((r) => setTimeout(r, 420));
      a.play(nazwa, { x: 0, y: 0 });
      let peak = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 420) {
        an.getFloatTimeDomainData(buf);
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i]!);
          if (v > peak) peak = v;
        }
        await new Promise((r) => requestAnimationFrame(r));
      }
      return +peak.toFixed(4);
    };

    // Słuchacz w tym samym punkcie co źródła — mierzymy dźwięk, nie tłumienie.
    a.setListener(0, 0);

    const out: Record<string, number> = {};
    for (const n of nazwy) out[n] = await zmierz(n);

    // Uderzenia z materiałami — osobno, bo idą inną ścieżką (`hit`).
    for (const m of ["flesh", "bone", "metal", "toxic"]) {
      await new Promise((r) => setTimeout(r, 420));
      a.hit({ material: m, power: 1, crit: false, at: { x: 0, y: 0 } });
      let peak = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 420) {
        an.getFloatTimeDomainData(buf);
        for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]!); if (v > peak) peak = v; }
        await new Promise((r) => requestAnimationFrame(r));
      }
      out[`hit:${m}`] = +peak.toFixed(4);
    }

    return { out };
  }, COMBAT);

  expect(wyniki.blad, "kontekst audio musi istnieć").toBeUndefined();
  const poziomy = wyniki.out!;
  console.log("SZCZYTY:", JSON.stringify(poziomy, null, 1));

  const ciche = Object.entries(poziomy).filter(([, v]) => v < 0.01).map(([k]) => k);
  const glosne = Object.entries(poziomy).filter(([, v]) => v > 0.99).map(([k]) => k);

  expect(ciche, `dźwięki bez sygnału: ${ciche.join(", ")}`).toEqual([]);
  expect(glosne, `dźwięki na granicy przesterowania: ${glosne.join(", ")}`).toEqual([]);
});

test("tłumienie z odległości działa", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Graj" }).click();
  await page.waitForFunction(() => (window as any).__ms?.audio !== undefined, { timeout: 60_000 });
  await page.waitForTimeout(1200);

  const r = await page.evaluate(async () => {
    const a = (window as any).__ms.audio;
    const ctx: AudioContext = (a as any).ctx;
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    (a as any).bus.master.connect(an);
    const buf = new Float32Array(an.fftSize);
    a.setListener(0, 0);

    const przy = async (dist: number) => {
      await new Promise((res) => setTimeout(res, 400));
      a.play("explosion", { x: dist, y: 0 });
      let peak = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 400) {
        an.getFloatTimeDomainData(buf);
        for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]!); if (v > peak) peak = v; }
        await new Promise((res) => requestAnimationFrame(res));
      }
      return +peak.toFixed(4);
    };
    return { blisko: await przy(1), daleko: await przy(20) };
  });

  console.log("ODLEGŁOŚĆ:", JSON.stringify(r));
  expect(r.daleko, "dźwięk z 20 m musi być cichszy niż z 1 m").toBeLessThan(r.blisko * 0.7);
});
