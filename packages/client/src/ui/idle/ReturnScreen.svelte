<script lang="ts">
  /**
   * Ekran powrotu (v4 §2.2) — „to jest miejsce, gdzie wygrywa się D7".
   *
   * Trzy rzeczy, które ten ekran MUSI robić, i każda jest tu zaimplementowana
   * dosłownie:
   *   1. Konkretne liczby — `14 302 zabitych`, nie „zebrano nagrody".
   *   2. Diagnoza blokady — dlaczego gracz utknął.
   *   3. Jedna sugerowana akcja — przycisk prowadzący do decyzji, nie do menu.
   *
   * Anty-wzorzec, którego tu NIE MA i nie będzie: „obejrzyj film ×2".
   * Dokument nazywa to wprost zabójcą filarów F1 i F5.
   */
  import { format, formatCount, formatDuration, type idle } from "@ms/core";

  let {
    report,
    notation = "short",
    onClaim,
    onSuggestion,
  }: {
    report: idle.OfflineReport;
    notation?: "short" | "scientific" | "engineering";
    onClaim: () => void;
    onSuggestion: (action: idle.SuggestedAction) => void;
  } = $props();

  const reduceMotion =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /**
   * Liczniki dobijają od zera. To jedyna animacja na tym ekranie i ma jedno
   * zadanie: zatrzymać wzrok na liczbie na tyle długo, żeby gracz ją przeczytał.
   */
  let progress = $state(reduceMotion ? 1 : 0);

  $effect(() => {
    if (reduceMotion) return;
    const start = performance.now();
    const DURATION = 700;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / DURATION);
      // easeOutCubic — szybko startuje, miękko siada.
      progress = 1 - Math.pow(1 - k, 3);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  });

  const kills = $derived(formatCount(Math.round(report.kills * progress)));
  const gold = $derived(format({ m: report.gold.m * progress, e: report.gold.e }, { notation }));
  const items = $derived(Math.round(report.items * progress));
  const zoneNow = $derived(
    Math.round(report.zoneFrom + (report.zoneTo - report.zoneFrom) * progress),
  );

  const away = $derived(formatDuration(report.awaySeconds));
  const advanced = $derived(report.zoneTo > report.zoneFrom);
  const d = $derived(report.diagnosis);

  let card: HTMLDivElement | null = $state(null);

  $effect(() => {
    card?.querySelector<HTMLButtonElement>("button.primary")?.focus();
  });

  function onKeydown(e: KeyboardEvent): void {
    // Enter i Escape robią to samo — ekran ma dokładnie jedno wyjście.
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      onClaim();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="idle-overlay interactive" role="dialog" aria-modal="true" aria-labelledby="ret-title">
  <div class="idle-card" bind:this={card}>
    <h1 id="ret-title">Nieobecność: {away}</h1>
    <p class="idle-sub">
      {#if report.capped}
        Zaliczono {formatDuration(report.creditedSeconds)} — tyle wynosi limit twojego konta.
      {:else}
        Postać walczyła dalej z efektywnością {Math.round(report.efficiency * 100)}%.
      {/if}
    </p>

    <ul class="idle-stats">
      <li class="idle-stat">
        <span class="icon" aria-hidden="true">⚔</span>
        <span class="label">Zabici</span>
        <span class="value mono">{kills}</span>
      </li>
      <li class="idle-stat">
        <span class="icon" aria-hidden="true">💰</span>
        <span class="label">Złoto</span>
        <span class="value gold mono">+{gold}</span>
      </li>
      <li class="idle-stat">
        <span class="icon" aria-hidden="true">📦</span>
        <span class="label">Przedmioty</span>
        <span class="value mono">
          {items}
          {#if report.rareItems > 0}<span class="muted">({report.rareItems} rzadkie)</span>{/if}
        </span>
      </li>
      <li class="idle-stat">
        <span class="icon" aria-hidden="true">📈</span>
        <span class="label">Najgłębsza strefa</span>
        <span class="value zone mono">
          {#if advanced}{report.zoneFrom} → {zoneNow}{:else}{report.zoneTo}{/if}
        </span>
      </li>
    </ul>

    {#if d.stuck}
      <!--
        Diagnoza blokady. Pokazywana wyłącznie przy prawdziwej ścianie —
        ostrzeżenie wyświetlane za każdym powrotem przestałoby cokolwiek znaczyć.
      -->
      <div class="idle-diagnosis" role="note">
        <div class="head">
          <span aria-hidden="true">⚠</span>
          <span>Utknąłeś na strefie {report.zoneTo}</span>
        </div>
        <p><strong>Powód:</strong> {d.text}</p>
        {#if d.suggestion}<p class="muted">{d.suggestion}</p>{/if}
        {#if d.action}
          <button onclick={() => d.action && onSuggestion(d.action)}>{d.action.label}</button>
        {/if}
      </div>
    {:else if d.text}
      <div class="idle-diagnosis calm" role="note">
        <div class="head">
          <span aria-hidden="true">✓</span>
          <span>{d.text}</span>
        </div>
        {#if d.suggestion}<p class="muted">{d.suggestion}</p>{/if}
      </div>
    {/if}

    <div class="idle-actions">
      <button class="primary" onclick={onClaim}>ODBIERZ</button>
    </div>

    {#if report.capped}
      <!--
        Informacja o limicie jest neutralna i bez wezwania do zakupu.
        Reklama „×2" albo przycisk sklepu w tym miejscu łamie F1 i F5 (v4 §2.2).
      -->
      <p class="idle-note">
        Limit offline twojego konta to {formatDuration(report.capSeconds)}. Czas ponad limit
        nie jest naliczany.
      </p>
    {/if}
  </div>
</div>
