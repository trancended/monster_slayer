<script lang="ts">
  import { hud } from "./state.svelte.ts";

  // Stamina znika po 3 s pełnego napełnienia (GDD §10.1).
  let staminaFullSince = $state(0);
  let now = $state(0);

  $effect(() => {
    const id = setInterval(() => (now = performance.now()), 200);
    return () => clearInterval(id);
  });

  $effect(() => {
    if (hud.stamina >= hud.maxStamina - 0.5) {
      if (staminaFullSince === 0) staminaFullSince = performance.now();
    } else {
      staminaFullSince = 0;
    }
  });

  const staminaVisible = $derived(
    staminaFullSince === 0 || now - staminaFullSince < 3000,
  );
  // HP ponad limit (overheal z zabójstw) rysujemy jako osobny, złoty segment
  // nad paskiem — inaczej pasek rozjeżdżałby się poza swoją ramkę.
  const hpPct = $derived(Math.min(100, (hud.hp / Math.max(1, hud.maxHp)) * 100));
  const overheal = $derived(Math.max(0, hud.hp - hud.maxHp));
  const overhealPct = $derived(Math.min(100, (overheal / Math.max(1, hud.maxHp)) * 100));
  const stamPct = $derived((hud.stamina / Math.max(1, hud.maxStamina)) * 100);
  const xpPct = $derived((hud.xp / Math.max(1, hud.xpToNext)) * 100);
  const lowHp = $derived(hud.hp > 0 && hpPct < 30);
</script>

<!-- Winieta poniżej 30% HP (GDD §10.2) -->
{#if lowHp}
  <div class="vignette" aria-hidden="true"></div>
{/if}

{#if hud.bossName}
  <div class="boss" role="status">
    <div class="boss-name">{hud.bossName}</div>
    <div class="bar boss-hp">
      <i style="width:{(hud.bossHp / Math.max(1, hud.bossMaxHp)) * 100}%"></i>
      <span class="ticks" aria-hidden="true"></span>
    </div>
    {#if hud.bossBreakMax > 0}
      <div class="bar boss-break" class:broken={hud.bossBroken}>
        <i style="width:{(hud.bossBreak / Math.max(1, hud.bossBreakMax)) * 100}%"></i>
      </div>
    {/if}
  </div>
{/if}

<!--
  Licznik serii zabójstw. Siedzi w centrum-górze, bo to jedyny wskaźnik,
  który trzeba widzieć peryferyjnie w trakcie walki — spojrzenie w róg
  ekranu kosztuje serię. Kolor niesie tier, ale nazwa i mnożnik są wypisane,
  więc informacja nie zależy od rozróżniania barw (GDD §10.3).
-->
{#if hud.comboCount > 0}
  <div
    class="combo-meter"
    class:tiered={hud.comboTier >= 0}
    style="--tier:{hud.comboColor}"
    role="status"
    aria-label="Seria zabójstw: {hud.comboCount}, mnożnik {hud.comboMultiplier}"
  >
    <div class="c-count mono">
      {hud.comboCount}<span class="c-x">×</span>
    </div>
    <div class="c-info">
      {#if hud.comboTier >= 0}
        <div class="c-name">{hud.comboName}</div>
        <div class="c-mult mono">×{hud.comboMultiplier.toFixed(2).replace(/\.?0+$/, "")} nagród</div>
      {:else}
        <div class="c-name muted">Seria</div>
        <div class="c-mult mono muted">
          {#if hud.comboToNext !== null}jeszcze {hud.comboToNext}{/if}
        </div>
      {/if}
    </div>
    <div class="bar c-timer" aria-hidden="true">
      <i style="width:{Math.round(hud.comboFraction * 100)}%"></i>
    </div>
  </div>
{/if}

<div class="topright mono">
  <div class="gold">{hud.gold} <span class="muted">złota</span></div>
  <div class="muted">Zabójstwa: {hud.kills}</div>
  <div class="muted">
    Encounter {hud.encounter} · strefa {hud.zoneLevel}
    {#if hud.enemiesLeft > 0}· wrogów: {hud.enemiesLeft}{/if}
  </div>
  {#if hud.intermission > 0}
    <div class="breather">Oddech: {hud.intermission.toFixed(1)} s</div>
  {/if}
</div>

<div class="botleft">
  <div class="hpwrap">
    <div
      class="bar hp"
      role="meter"
      aria-label="Zdrowie"
      aria-valuenow={Math.round(hud.hp)}
      aria-valuemin="0"
      aria-valuemax={Math.round(Math.max(hud.maxHp, hud.hp))}
    >
      <i style="width:{hpPct}%"></i>
      {#if overheal > 0}
        <b class="over" style="width:{overhealPct}%"></b>
      {/if}
    </div>
    <div class="hpnum mono" class:overhealed={overheal > 0}>
      {Math.ceil(hud.hp)} / {Math.round(hud.maxHp)}
      {#if overheal >= 1}<span class="bonus">+{Math.floor(overheal)}</span>{/if}
    </div>
  </div>

  <div
    class="bar stam"
    class:hidden={!staminaVisible}
    role="meter"
    aria-label="Stamina"
    aria-valuenow={Math.round(hud.stamina)}
    aria-valuemin="0"
    aria-valuemax={Math.round(hud.maxStamina)}
  >
    <i style="width:{stamPct}%"></i>
  </div>

  <div class="potions" aria-label="Mikstury">
    {#each Array(hud.maxPotions) as _, i}
      <span class="potion" class:empty={i >= hud.potions}></span>
    {/each}
    <span class="key mono">1</span>
  </div>
</div>

<div class="botright">
  <div class="slot" class:ready={hud.dodgeReady}>
    <span class="mono">Spacja</span>
    <small>Unik</small>
  </div>
  <div class="slot heavy" style="--charge:{hud.heavyCharge * 100}%">
    <span class="mono">K / PPM</span>
    <small>Ciężki</small>
    {#if hud.heavyCharge > 0}
      <i class="charge" style="height:{hud.heavyCharge * 100}%"></i>
    {/if}
  </div>
  <div class="slot combo">
    <span class="mono">{hud.comboIndex + 1}/3</span>
    <small>Combo</small>
  </div>
</div>

<div
  class="xpbar"
  role="meter"
  aria-label="Doświadczenie"
  aria-valuenow={Math.round(hud.xp)}
  aria-valuemin="0"
  aria-valuemax={Math.round(hud.xpToNext)}
>
  <i style="width:{xpPct}%"></i>
  <span class="level mono">Poz. {hud.level}</span>
  {#if hud.attributePoints > 0}
    <span class="points">+{hud.attributePoints} pkt — otwórz ekwipunek (I)</span>
  {/if}
</div>

<div class="status mono">
  {#if hud.settings.showFps}
    <span>{hud.fps} FPS · sim {hud.simMs.toFixed(1)} ms</span>
  {/if}
  <span class:offline={!hud.online} class="net">
    {hud.online ? "online" : "offline"} · balans: {hud.balanceSource}
  </span>
  {#if hud.gamepad}<span>pad</span>{/if}
</div>

<style>
  .vignette {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(ellipse at center, transparent 45%, rgba(190, 20, 20, 0.42) 100%);
    animation: pulse 1.1s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.55; }
    50% { opacity: 1; }
  }

  .boss {
    position: absolute;
    top: 18px;
    left: 50%;
    transform: translateX(-50%);
    width: min(620px, 70vw);
    text-align: center;
  }
  .boss-name {
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 6px;
    text-shadow: 0 2px 8px #000;
  }
  .boss-hp {
    height: 14px;
  }
  .boss-hp > i {
    background: linear-gradient(180deg, #ff6a5e, #a11d18);
  }
  .boss-hp .ticks {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      90deg,
      transparent 0 calc(25% - 1px),
      rgba(0, 0, 0, 0.6) calc(25% - 1px) 25%
    );
  }
  .boss-break {
    height: 6px;
    margin-top: 4px;
  }
  .boss-break > i {
    background: linear-gradient(180deg, #ffd166, #b07d18);
  }
  .boss-break.broken > i {
    background: #fff;
    animation: pulse 0.35s linear infinite;
  }

  .topright {
    position: absolute;
    top: 16px;
    right: 18px;
    text-align: right;
    opacity: 0.78;
    font-size: 0.85em;
    line-height: 1.5;
  }
  .gold {
    font-size: 1.15em;
    color: var(--xp);
    font-weight: 700;
  }
  .breather {
    color: var(--stam);
  }

  .botleft {
    position: absolute;
    left: 22px;
    bottom: 34px;
    width: min(320px, 34vw);
  }
  .hpwrap {
    position: relative;
  }
  .hp {
    height: 20px;
  }
  .hp > i {
    background: linear-gradient(180deg, #ff5c55, var(--hp-dark));
  }
  .hp > .over {
    position: absolute;
    /* Kotwica po prawej: nadwyżka czyta się jako dokładka na pełnym pasku,
       a nie jako ubytek zdrowia. Ubywa od lewej krawędzi bloku. */
    inset: 0 0 0 auto;
    display: block;
    background: repeating-linear-gradient(
      135deg,
      #ffd166 0 6px,
      #e0a32e 6px 12px
    );
    box-shadow: 0 0 8px rgba(255, 209, 102, 0.6);
  }
  .hpnum {
    position: absolute;
    inset: 0;
    display: grid;
    grid-auto-flow: column;
    gap: 0.5em;
    place-content: center;
    place-items: center;
    font-size: 0.72em;
    text-shadow: 0 1px 3px #000;
    letter-spacing: 0.04em;
  }
  .hpnum.overhealed {
    font-weight: 700;
  }
  .hpnum .bonus {
    color: #ffd166;
    text-shadow: 0 1px 3px #000, 0 0 6px rgba(0, 0, 0, 0.9);
  }
  .stam {
    height: 7px;
    margin-top: 4px;
    transition: opacity 0.4s ease;
  }
  .stam > i {
    background: var(--stam);
  }
  .stam.hidden {
    opacity: 0;
  }
  .potions {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-top: 9px;
  }
  .potion {
    width: 15px;
    height: 21px;
    border-radius: 3px;
    background: linear-gradient(180deg, #ff6f86, #8d1f31);
    border: 1px solid rgba(255, 255, 255, 0.28);
  }
  .potion.empty {
    background: rgba(255, 255, 255, 0.07);
  }
  .key {
    font-size: 0.7em;
    opacity: 0.6;
    margin-left: 4px;
  }

  .botright {
    position: absolute;
    right: 22px;
    bottom: 34px;
    display: flex;
    gap: 10px;
  }
  .slot {
    position: relative;
    width: 64px;
    height: 64px;
    border-radius: 10px;
    background: rgba(10, 14, 22, 0.72);
    border: 1px solid var(--edge);
    display: grid;
    place-content: center;
    text-align: center;
    gap: 2px;
    overflow: hidden;
    font-size: 0.72em;
  }
  .slot small {
    color: var(--muted);
    font-size: 0.85em;
  }
  .slot .charge {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 100%;
    background: rgba(255, 224, 102, 0.32);
  }

  .xpbar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 6px;
    background: rgba(0, 0, 0, 0.6);
  }
  .xpbar > i {
    display: block;
    height: 100%;
    background: var(--xp);
    transition: width 0.25s ease;
  }
  .xpbar .level {
    position: absolute;
    left: 14px;
    bottom: 10px;
    font-size: 0.72em;
    opacity: 0.8;
  }
  .xpbar .points {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: 10px;
    font-size: 0.72em;
    color: var(--xp);
    font-weight: 700;
  }

  .status {
    position: absolute;
    top: 16px;
    left: 18px;
    font-size: 0.72em;
    opacity: 0.55;
    display: flex;
    gap: 12px;
  }
  .net.offline {
    color: #ffb84d;
  }

  /* ── licznik serii zabójstw ──────────────────────────────────────────── */

  .combo-meter {
    position: absolute;
    top: 4.5em;
    left: 50%;
    transform: translateX(-50%);
    display: grid;
    grid-template-columns: auto auto;
    grid-template-rows: auto auto;
    align-items: center;
    gap: 0 0.6em;
    padding: 0.45em 0.9em 0.5em;
    border-radius: 12px;
    background: rgba(10, 13, 20, 0.72);
    border: 1px solid var(--tier, #9aa3b2);
    box-shadow: 0 0 22px -6px var(--tier, transparent);
    pointer-events: none;
    min-width: 11em;
  }

  .c-count {
    grid-row: 1 / span 2;
    font-size: 2.1em;
    font-weight: 900;
    line-height: 1;
    color: var(--tier, var(--text));
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8);
  }

  .c-x {
    font-size: 0.5em;
    opacity: 0.65;
    margin-left: 0.1em;
  }

  .c-info {
    line-height: 1.2;
  }

  .c-name {
    font-weight: 700;
    font-size: 0.92em;
    color: var(--tier, var(--text));
    letter-spacing: 0.02em;
  }

  .c-mult {
    font-size: 0.76em;
    color: var(--muted);
  }

  .c-timer {
    grid-column: 1 / span 2;
    height: 3px;
    margin-top: 0.4em;
  }

  .c-timer > i {
    background: var(--tier, var(--accent));
    /* Zegar odlicza w dół — bez przejścia, bo skok wstecz przy zabójstwie
       ma być natychmiastowy i czytelny jako „seria przedłużona". */
    transition: none;
  }

  /* Wejście w tier: jednorazowy impuls. Powtarzalna animacja w tym miejscu
     przeszkadzałaby w czytaniu pola walki. */
  .combo-meter.tiered {
    animation: combo-pop 0.28s ease-out;
  }

  @keyframes combo-pop {
    0% {
      transform: translateX(-50%) scale(1);
    }
    45% {
      transform: translateX(-50%) scale(1.12);
    }
    100% {
      transform: translateX(-50%) scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .combo-meter.tiered {
      animation: none;
    }
  }
</style>
