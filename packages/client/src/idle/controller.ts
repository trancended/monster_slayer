/**
 * Kontroler warstwy idle po stronie klienta — spina `IdleEngine` (rdzeń)
 * z pętlą gry, zapisem i interfejsem.
 *
 * Podział ról jest tu twardy i celowy:
 *   • **rdzeń** liczy (czysty TS, testowalny, ten sam kod w symulatorze),
 *   • **kontroler** decyduje KIEDY liczyć i co z tym zrobić (DOM, zapis, tosty),
 *   • **komponenty** tylko rysują migawkę.
 *
 * Tryb hybrydowy z v4 §5.1 realizuje `document.hidden`: karta widoczna →
 * walka liczy się w ECS i tylko raportuje zabójstwa; karta w tle → formuła
 * zamknięta w rdzeniu. Brak sesji obsługuje `computeOffline` przy starcie.
 */
import { idle } from "@ms/core";
import { pushToast } from "../ui/state.svelte.ts";
import { recordEvent } from "../net/backend.ts";
import { idleHud, returnScreen, syncIdle } from "./store.svelte.ts";

/** Jak często przepisujemy migawkę do runes. 5 Hz wystarcza oku i DOM-owi. */
const SYNC_INTERVAL = 0.2;

/** Tick warstwy idle. Sekunda to naturalna jednostka dla gry, w której liczy się godziny. */
const IDLE_TICK = 1;

export class IdleController {
  readonly engine: idle.IdleEngine;

  private syncTimer = 0;
  private tickTimer = 0;
  private sessionStartedAt = 0;
  private readonly stuckThrottle = new idle.StuckThrottle();

  /** Raport czekający na kliknięcie ODBIERZ. Zapis wstrzymany do tego czasu. */
  private pendingReport: idle.OfflineReport | null = null;

  constructor(saved: unknown, now = Date.now()) {
    const state = saved === undefined || saved === null
      ? idle.createIdleState(now)
      : idle.deserializeIdleState(saved, now);
    this.engine = new idle.IdleEngine({ state, now, seed: (Math.random() * 0xffffffff) >>> 0 });
    this.sessionStartedAt = now;
  }

  /**
   * Start sesji: policz nieobecność, odblokuj to, co się należy, wystaw HUD.
   * Zwraca `true`, gdy jest co pokazać na ekranie powrotu.
   */
  begin(now = Date.now()): boolean {
    this.engine.refreshAutomation();

    const report = this.engine.offlineReport(now);
    if (report.worthShowing) {
      this.pendingReport = report;
      returnScreen.report = report;
    } else {
      // Krótka nieobecność nie zasługuje na ekran, ale zysk i tak się należy.
      idle.applyOffline(this.engine.state, this.engine.config, report, now);
      this.engine.invalidate();
    }

    recordEvent("idle_session_start", idle.sessionStart(this.engine.state, this.engine.rates).payload);
    this.sync();
    return this.pendingReport !== null;
  }

  /** Kliknięcie ODBIERZ. Idempotentne — przycisk da się kliknąć dwa razy. */
  claimOffline(now = Date.now()): void {
    const report = this.pendingReport;
    if (!report) return;

    const applied = idle.applyOffline(this.engine.state, this.engine.config, report, now);
    this.pendingReport = null;
    returnScreen.report = null;
    this.engine.invalidate();
    this.announceAutomation();
    this.sync();

    recordEvent("idle_offline_return", idle.offlineReturn(report, applied).payload);
  }

  get hasPendingReport(): boolean {
    return this.pendingReport !== null;
  }

  // ────────────────────────────────────────────────────────────────── pętla

  /**
   * Wołane z pętli renderowania. `dt` w sekundach czasu rzeczywistego —
   * warstwa idle nie zna hitstopu ani slow-mo, bo jej zegar to zegar gracza,
   * a nie zegar walki.
   */
  update(dt: number, hidden: boolean, now = Date.now()): void {
    this.tickTimer += dt;
    if (this.tickTimer >= IDLE_TICK) {
      this.engine.tick(this.tickTimer, hidden ? "background" : "active", now);
      this.tickTimer = 0;
      this.checkStuck(now);
    }

    this.syncTimer += dt;
    if (this.syncTimer >= SYNC_INTERVAL) {
      this.syncTimer = 0;
      // W trakcie walki nikt nie patrzy na tabelę ulepszeń — nie budujemy jej.
      this.sync(this.panelVisible);
    }
  }

  /**
   * Zabójstwo zgłoszone przez ECS. Warstwa idle nie liczy tu obrażeń — dostaje
   * fakt i przelicza skutki ekonomiczne z własnych formuł. To jest dokładnie
   * zasada z v4 §7.3: klient wysyła „zabiłem 40 wrogów w strefie 51”,
   * a nie „mam teraz 1e12 złota”.
   */
  reportKill(enemyId: string, count = 1, comboMultiplier = 1): void {
    const e = this.engine;
    const gold = idle.goldPerKill(e.state.zone, e.config.zones);
    // Mnożnik serii zabójstw działa też na ekonomię idle — bez tego combo
    // opłacałoby się w warstwie walki i było niewidzialne w tej, która liczy
    // ulepszenia. Gracz nie odróżnia tych warstw i słusznie.
    const mult = Number.isFinite(comboMultiplier) && comboMultiplier > 0 ? comboMultiplier : 1;
    const scaled = { m: gold.m * count * mult, e: gold.e };

    idle.registerKills(e.state, e.config, count, scaled);
    e.reportKills(enemyId, count);
    e.invalidate();

    if (e.rng.chance(e.config.items.dropChancePerKill)) {
      const item = e.rollDrop();
      e.collect(item);
      if (item.rarity === "rare" || item.rarity === "epic" || item.rarity === "unique") {
        pushToast(idle.itemLabel(item), "loot");
      }
    }

    this.announceAutomation();
  }

  // ───────────────────────────────────────────────────────────────── akcje

  buyUpgrade(id: string, count: number | "max"): void {
    const result = idle.buyUpgrade(
      this.engine.state,
      this.engine.config,
      id as idle.UpgradeId,
      count,
    );
    if (result.ok) {
      this.engine.invalidate();
      // Pierwszy upgrade jest metryką krytyczną dla onboardingu (v4 §9.2).
      if (this.engine.state.totals.kills > 0 && !this.firstUpgradeSent) {
        this.firstUpgradeSent = true;
        const since = (Date.now() - this.sessionStartedAt) / 1000;
        recordEvent("idle_first_upgrade", idle.firstUpgrade(id, since).payload);
      }
    }
    pushToast(result.message, result.ok ? "info" : "wave");
    this.sync();
  }

  private firstUpgradeSent = false;

  toggleAutomation(id: string): void {
    const slot = this.engine.state.automation[id as idle.AutomationId];
    if (!slot || !slot.unlocked) return;
    slot.enabled = !slot.enabled;
    this.sync();
  }

  prestige(now = Date.now()): void {
    const e = this.engine;
    const since = (now - e.state.prestige.lastPrestigeAt) / 1000;
    const before = e.state.prestige.count;
    const result = idle.doPrestige(e.state, e.config, now);

    if (result.ok) {
      e.invalidate();
      e.refreshAutomation();
      recordEvent(
        "idle_prestige",
        idle.prestigeEvent(e.state, result.value?.gained ?? 0, since).payload,
      );
      pushToast(result.message, "level");
      if (before === 0) {
        pushToast("Drzewko trwałe czeka — wydaj PP, zanim ruszysz dalej", "info");
      }
    } else {
      pushToast(result.message, "wave");
    }
    this.sync();
  }

  respec(): void {
    const result = idle.respec(this.engine.state);
    this.engine.invalidate();
    pushToast(result.message, result.ok ? "info" : "wave");
    this.sync();
  }

  buildCode(now = Date.now()): string {
    return idle.encodeBuild(this.engine.state, this.engine.rates, now);
  }

  copyBuildCode(now = Date.now()): void {
    const code = this.buildCode(now);
    void navigator.clipboard?.writeText(code).catch(() => {
      /* schowek bywa zablokowany — kod i tak jest widoczny na ekranie */
    });
    recordEvent("idle_build_code_copied", idle.buildCodeCopied(this.engine.state, code.length).payload);
    pushToast("Kod builda skopiowany", "info");
  }

  applyBuildCode(code: string): void {
    const payload = idle.decodeBuild(code);
    if (!payload) {
      pushToast("Nieprawidłowy kod builda", "wave");
      return;
    }
    const result = idle.applyBuild(this.engine.state, payload);
    this.engine.invalidate();
    if (result.ok && result.value) {
      recordEvent(
        "idle_build_code_applied",
        idle.buildCodeApplied(result.value.itemsMatched, result.value.itemsMissing, result.value.skills)
          .payload,
      );
    }
    pushToast(result.message, result.ok ? "info" : "wave");
    this.sync();
  }

  /** Wykonanie sugerowanej akcji z ekranu powrotu — jedno kliknięcie, jedna decyzja. */
  followSuggestion(action: idle.SuggestedAction): void {
    if (action.kind === "upgrade") this.buyUpgrade(action.id, "max");
    else if (action.kind === "prestige") this.prestige();
  }

  // ────────────────────────────────────────────────────────────────── zapis

  serialize(): Record<string, unknown> {
    this.engine.state.lastSeen = Date.now();
    return idle.serializeIdleState(this.engine.state);
  }

  /**
   * Zapis przy wyjściu. Gdy raport czeka na odebranie, **nie** przesuwamy
   * `lastSeen` — inaczej zamknięcie karty na ekranie powrotu zjadłoby nagrodę.
   */
  serializeForExit(): Record<string, unknown> {
    if (this.pendingReport) return idle.serializeIdleState(this.engine.state);
    return this.serialize();
  }

  // ────────────────────────────────────────────────────────── wewnętrzne

  /**
   * `full` przelicza tabele ulepszeń i automatyzacji. Domyślnie tak, bo akcje
   * gracza zawsze zmieniają to, co widzi; pętla tła woła wersję lekką.
   */
  private sync(full = true): void {
    syncIdle(this.engine, full);
  }

  /** Czy jakiś panel idle jest na ekranie — decyduje o koszcie migawki. */
  private panelVisible = false;

  setPanelVisible(visible: boolean): void {
    this.panelVisible = visible;
    if (visible) this.sync(true);
  }

  private checkStuck(now: number): void {
    const clear = this.engine.rates.clearSeconds;
    if (!idle.shouldEmitZoneStuck(this.engine.state, this.engine.config, clear)) return;
    if (!this.stuckThrottle.shouldEmit(this.engine.state, this.engine.config, clear, now)) return;

    recordEvent(
      "idle_zone_stuck",
      idle.zoneStuck(this.engine.state, 1, clear, this.engine.diagnosis.reason).payload,
    );
  }

  /** Nowa automatyzacja zasługuje na komunikat — to nagroda, nie zmiana ustawień. */
  private announceAutomation(): void {
    const unlocked = this.engine.refreshAutomation();
    for (const id of unlocked) {
      const def = this.engine.config.automation.find((a) => a.id === id);
      if (!def) continue;
      pushToast(`Odblokowano: ${def.name} — koniec z „${def.eliminates}”`, "level");
      if (id === "autoAttack") {
        pushToast("Możesz zamknąć kartę. Postać walczy dalej.", "level");
        recordEvent(
          "idle_unlocked",
          idle.idleUnlocked(this.engine.state, (Date.now() - this.sessionStartedAt) / 1000).payload,
        );
      }
    }
    if (unlocked.length > 0) this.sync();
  }
}

export { idleHud, returnScreen };
