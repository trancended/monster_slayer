<script lang="ts">
  /**
   * Panel warstwy idle: ulepszenia, postęp strefy, automatyzacje, prestiż.
   *
   * To jest ekran, na którym gracz podejmuje decyzję — a decyzja, nie klikanie,
   * jest wartością sesji (filar F2). Stąd trzy zasady układu:
   *  • koszt i „ile poziomów” widoczne NA przycisku, bez najeżdżania myszą;
   *  • zablokowane pozycje są widoczne z progiem odblokowania (v4 §3:
   *    „zapowiadaj każde odblokowanie zanim będzie dostępne”);
   *  • automatyzacja pokazana jako nagroda z nazwą tego, co eliminuje.
   */
  import { idleHud, count } from "../../idle/store.svelte.ts";

  let {
    onBuy,
    onToggleAutomation,
    onPrestige,
    onOpenSheet,
    onClose,
  }: {
    onBuy: (id: string, count: number | "max") => void;
    onToggleAutomation: (id: string) => void;
    onPrestige: () => void;
    onOpenSheet: () => void;
    onClose: () => void;
  } = $props();

  const clearLabel = $derived(
    Number.isFinite(idleHud.clearSeconds) ? `${idleHud.clearSeconds.toFixed(0)} s` : "—",
  );
</script>

<div class="idle-overlay interactive" role="dialog" aria-modal="true" aria-labelledby="idle-title">
  <div class="idle-panel">
    <div class="idle-card" style="width:100%">
      <header style="display:flex;justify-content:space-between;align-items:baseline;gap:1em">
        <h1 id="idle-title">
          Strefa {idleHud.zone}
          {#if idleHud.isBoss}<span style="color:var(--danger)"> — boss</span>{/if}
        </h1>
        <span class="mono muted">{idleHud.gold} złota · {idleHud.goldPerSecond}/s</span>
      </header>

      <div class="bar zone-bar" class:boss={idleHud.isBoss} role="progressbar"
        aria-valuemin="0" aria-valuemax={idleHud.zoneKillsRequired} aria-valuenow={idleHud.zoneKills}
        aria-label="Postęp strefy">
        <i style="width:{Math.round(idleHud.zoneProgress * 100)}%"></i>
      </div>
      <p class="idle-sub" style="margin-top:.5em">
        {count(idleHud.zoneKills)} / {count(idleHud.zoneKillsRequired)} zabitych ·
        czyszczenie {clearLabel} ·
        DPS {idleHud.dps} (pakiet {idleHud.clearDps})
        {#if idleHud.nextMilestone}
          <br /><span class="muted">Następne odblokowanie: {idleHud.nextMilestone.label} — strefa {idleHud.nextMilestone.unlocksAt}</span>
        {/if}
      </p>

      {#if idleHud.diagnosisStuck}
        <div class="idle-diagnosis" role="note">
          <div class="head"><span aria-hidden="true">⚠</span><span>{idleHud.diagnosisText}</span></div>
          <p class="muted">{idleHud.diagnosisSuggestion}</p>
        </div>
      {/if}
    </div>

    <div class="idle-card" style="width:100%">
      <h2>Ulepszenia</h2>
      <div class="idle-stats">
        {#each idleHud.upgrades as u (u.id)}
          <div class="upgrade" class:locked={!u.unlocked}>
            <div>
              <div class="u-name">{u.name} <span class="muted mono">×{u.level}</span></div>
              <div class="u-desc">
                {#if u.unlocked}{u.desc}{:else}Odblokowanie: strefa {u.unlockZone}{/if}
              </div>
            </div>
            <button disabled={!u.affordable1} onclick={() => onBuy(u.id, 1)}>
              Kup ×1<span class="c">{u.cost1}</span>
            </button>
            <button
              disabled={!u.unlocked || u.maxLevels < 1}
              onclick={() => onBuy(u.id, "max")}
              title="Kupuje tyle poziomów, ile pozwala złoto"
            >
              Kup max<span class="c">{u.maxLevels > 0 ? `+${u.maxLevels}` : "—"}</span>
            </button>
          </div>
        {/each}
      </div>
    </div>

    <div class="idle-card" style="width:100%">
      <h2>Automatyzacje</h2>
      <p class="idle-sub" style="margin-bottom:.7em">
        Każda automatyzacja to nagroda — zabiera klikanie, nie decyzję o buildzie.
      </p>
      <div class="idle-stats">
        {#each idleHud.automation as a (a.id)}
          <div class="upgrade" class:locked={!a.unlocked}>
            <div>
              <div class="u-name">{a.name}</div>
              <div class="u-desc">
                {#if a.unlocked}{a.desc}{:else}Odblokowanie: {a.unlockLabel}{/if}
              </div>
            </div>
            <div></div>
            <button disabled={!a.unlocked} onclick={() => onToggleAutomation(a.id)}>
              {a.unlocked ? (a.enabled ? "Włączona" : "Wyłączona") : "Zablokowana"}
            </button>
          </div>
        {/each}
      </div>
    </div>

    <div class="idle-card" style="width:100%">
      <h2>Prestiż</h2>
      {#if idleHud.prestigeUnlocked}
        <p class="idle-sub">
          Reset da <strong>{count(idleHud.prestigeGain)} PP</strong>.
          Masz {count(idleHud.prestigePoints)} PP, prestiży: {idleHud.prestigeCount}.
          {#if idleHud.sparks > 0} Iskry: {idleHud.sparks}.{/if}
        </p>
        <div class="idle-actions" style="margin-top:.6em">
          <button onclick={onPrestige} disabled={idleHud.prestigeGain < 1}>
            Prestiż — reset za {count(idleHud.prestigeGain)} PP
          </button>
        </div>
      {:else}
        <p class="idle-sub">
          Odblokowanie na strefie 45. Rekord: {idleHud.deepestZone}.
        </p>
      {/if}
    </div>

    <div class="idle-actions">
      <button onclick={onOpenSheet}>Ekran postaci</button>
      <button class="primary" onclick={onClose}>Wróć do gry</button>
    </div>
  </div>
</div>
