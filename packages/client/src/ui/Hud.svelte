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
  const hpPct = $derived((hud.hp / Math.max(1, hud.maxHp)) * 100);
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
      aria-valuemax={Math.round(hud.maxHp)}
    >
      <i style="width:{hpPct}%"></i>
    </div>
    <div class="hpnum mono">{Math.ceil(hud.hp)} / {Math.round(hud.maxHp)}</div>
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
  .hpnum {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 0.72em;
    text-shadow: 0 1px 3px #000;
    letter-spacing: 0.04em;
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
</style>
