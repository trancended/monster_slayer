<script lang="ts">
  import { affixText, itemScore, itemsNeeded, FORGE_POWER, type Item } from "@ms/core";
  import { hud, RARITY_HEX } from "./state.svelte.ts";
  import type { Game } from "../game.ts";

  let { game }: { game: Game } = $props();

  const SLOTS: { id: string; label: string }[] = [
    { id: "weapon", label: "Broń" },
    { id: "helmet", label: "Hełm" },
    { id: "chest", label: "Napierśnik" },
    { id: "gloves", label: "Rękawice" },
    { id: "boots", label: "Buty" },
    { id: "belt", label: "Pas" },
    { id: "amulet", label: "Amulet" },
    { id: "ring1", label: "Pierścień I" },
    { id: "ring2", label: "Pierścień II" },
  ];

  const ATTRS = [
    { key: "strength", label: "Siła", desc: "+0.83% obrażeń fiz., +2 poise" },
    { key: "dexterity", label: "Zręczność", desc: "+0.6% szybkości ataku, +0.15% kryt" },
    { key: "vitality", label: "Wytrzymałość", desc: "+9 max HP, +3 stamina, +1.2 pancerza" },
    { key: "will", label: "Wola", desc: "+1.2% obr. żywiołowych, −0.4% cooldownów" },
  ] as const;

  /** Czy przedmiot leży na kowadle. */
  function picked(item: Item): boolean {
    return hud.forgePick.includes(item.id);
  }

  function comparison(item: Item): number {
    const equipped = hud.equipment[item.slot];
    if (!equipped) return 1;
    const diff = itemScore(item) - itemScore(equipped);
    return diff > 0.5 ? 1 : diff < -0.5 ? -1 : 0;
  }
</script>

<!--
  Kliknięcie w tło zamyka panel. To najczęstsze odruchowe wyjście z overlaya —
  bez tego gracz, który nie trafi w przycisk, ma wrażenie, że gra się zawiesiła.
-->
<div
  class="scrim"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) game.closeInventory();
  }}
>
  <div class="panel interactive" role="dialog" aria-modal="true" aria-label="Ekwipunek">
    <header>
      <h1>Ekwipunek</h1>
      <div class="mono muted">
        Poz. {hud.level} · {hud.gold} złota · {hud.inventory.length} przedmiotów
      </div>
      <button class="ghost close" onclick={() => game.closeInventory()}>
        Zamknij <span class="mono">I</span> / <span class="mono">Esc</span>
      </button>
    </header>
    <p class="hint-close muted">
      Gra jest wstrzymana. Wyjdziesz klawiszem <span class="mono">I</span>,
      <span class="mono">Esc</span>, <span class="mono">Tab</span> albo klikając poza panelem.
    </p>

    <div class="grid">
      <section class="attrs">
        <h2>Atrybuty {#if hud.attributePoints > 0}<em>+{hud.attributePoints} do rozdania</em>{/if}</h2>
        {#each ATTRS as a}
          <div class="attr">
            <div>
              <strong>{a.label}</strong>
              <span class="mono value">{hud.attributes[a.key]}</span>
              <small class="muted">{a.desc}</small>
            </div>
            <button
              disabled={hud.attributePoints <= 0}
              onclick={() => game.allocate(a.key)}
              aria-label={`Dodaj punkt do ${a.label}`}
            >+</button>
          </div>
        {/each}
        {#if hud.skillPoints > 0}
          <p class="muted small">
            Punkty umiejętności: {hud.skillPoints} — drzewko wchodzi w M6, punkty są zachowywane w zapisie.
          </p>
        {/if}
      </section>

      <section class="equipped">
        <h2>Założone</h2>
        {#each SLOTS as slot}
          {@const item = hud.equipment[slot.id]}
          <div class="slotrow">
            <span class="slotname muted">{slot.label}</span>
            {#if item}
              <button
                class="itembtn"
                style="--rarity:{RARITY_HEX[item.rarity]}"
                onclick={() => game.unequip(slot.id)}
                title="Zdejmij"
              >
                <span class="name">{item.name}</span>
                <span class="mono lvl">i{item.itemLevel}</span>
              </button>
            {:else}
              <span class="empty">— pusty —</span>
            {/if}
          </div>
        {/each}
      </section>

      <section class="bag">
        <div class="baghead">
          <h2>Plecak</h2>
          <button class="ghost small" onclick={() => game.sellAll(["common", "uncommon"])}>
            Sprzedaj zwykłe i niezwykłe
          </button>
        </div>

        <!--
          Kowal. Panel pojawia się dopiero po pierwszym rdzeniu z bossa — dopóki
          gracz nie ma z czego kuć, pusty warsztat byłby tylko szumem w kadrze.
        -->
        {#if hud.smithUnlocked}
          {@const q = hud.forgeQuote}
          <section class="smith" class:ready={q.ready}>
            <header class="smithhead">
              <h3>Kowal</h3>
              <span class="mono cores">Rdzenie: {hud.forgeCores}</span>
            </header>
            <div class="bar" aria-hidden="true">
              <i style="width:{Math.min(100, (q.power / q.target) * 100)}%"></i>
            </div>
            <div class="smithinfo mono">
              Moc {q.power} / {q.target} · na kowadle: {hud.forgePick.length}
            </div>
            {#if q.ready}
              <p class="smithnote ok">Gotowe — wyjdzie losowa legenda.</p>
            {:else}
              <p class="smithnote muted">
                {q.reason || `Odłóż przedmioty: ${itemsNeeded("common")} zwykłych albo ${itemsNeeded("epic")} epickich`}
              </p>
            {/if}
            <div class="smithbtns">
              <button
                class="primary"
                disabled={!q.ready}
                onclick={() => game.reforge()}
              >Przekuj w legendę</button>
              <button class="ghost small" onclick={() => game.autoPickForge()}>Wybierz zbędne</button>
              {#if hud.forgePick.length > 0}
                <button class="ghost small" onclick={() => game.clearForge()}>Zdejmij z kowadła</button>
              {/if}
            </div>
          </section>
        {/if}
        <div class="items">
          {#each hud.inventory as item (item.id)}
            {@const cmp = comparison(item)}
            <article
              class="item"
              class:picked={picked(item)}
              style="--rarity:{RARITY_HEX[item.rarity]}"
            >
              <header class="ihead">
                <span class="name">{item.name}</span>
                <span class="mono lvl">i{item.itemLevel}</span>
              </header>
              {#if item.minDamage > 0}
                <div class="stat mono">{item.minDamage}–{item.maxDamage} obrażeń</div>
              {/if}
              {#if item.armor > 0}
                <div class="stat mono">{item.armor} pancerza</div>
              {/if}
              {#each item.affixes as af}
                <div class="affix">{affixText(af)}</div>
              {/each}
              {#if item.legendaryText}
                <div class="legendary">{item.legendaryText}</div>
              {/if}
              <footer>
                <button onclick={() => game.equip(item)}>
                  Załóż
                  {#if cmp > 0}<span class="up">▲</span>{:else if cmp < 0}<span class="down">▼</span>{/if}
                </button>
                <button class="ghost" onclick={() => game.sell(item)}>Sprzedaj {item.sellValue}</button>
                {#if hud.smithUnlocked}
                  <button
                    class="ghost forge"
                    onclick={() => game.toggleForge(item)}
                    title="Moc przekucia: {FORGE_POWER[item.rarity]}"
                  >
                    {picked(item) ? "− z kowadła" : `+ na kowadło (${FORGE_POWER[item.rarity]})`}
                  </button>
                {/if}
              </footer>
            </article>
          {:else}
            <p class="muted">Plecak pusty. Łup wypada z wrogów — elity dają gwarantowany Rzadki+.</p>
          {/each}
        </div>
      </section>
    </div>
  </div>
</div>

<style>
  .scrim {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(6, 9, 14, 0.78);
    backdrop-filter: blur(4px);
    pointer-events: auto;
    padding: 20px;
  }
  .panel {
    width: min(1180px, 96vw);
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    padding: 20px 24px;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--edge);
  }
  header h1 {
    margin: 0;
    font-size: 1.4em;
  }
  header button {
    margin-left: auto;
  }
  .close {
    border-color: var(--accent);
  }
  .close .mono {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    padding: 0.05em 0.4em;
  }
  .hint-close {
    margin: 10px 0 0;
    font-size: 0.78em;
  }
  .hint-close .mono {
    color: var(--accent);
  }
  .grid {
    display: grid;
    grid-template-columns: 260px 300px 1fr;
    gap: 22px;
    overflow: hidden;
    padding-top: 14px;
  }
  @media (max-width: 1000px) {
    .grid { grid-template-columns: 1fr; overflow-y: auto; }
  }
  h2 {
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--muted);
    margin: 0 0 10px;
  }
  h2 em {
    color: var(--xp);
    font-style: normal;
  }
  .attr {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }
  .attr strong { display: inline-block; min-width: 8.5em; }
  .attr .value { color: var(--accent); margin-right: 8px; }
  .attr small { display: block; font-size: 0.75em; }
  .attr button { margin-left: auto; width: 2.2em; padding: 0.3em 0; }
  .attr button:disabled { opacity: 0.3; cursor: default; }

  .slotrow {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
    font-size: 0.85em;
  }
  .slotname { min-width: 7em; }
  .empty { color: rgba(255, 255, 255, 0.22); font-size: 0.9em; }
  .itembtn {
    flex: 1;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    border-left: 3px solid var(--rarity);
    text-align: left;
    padding: 0.4em 0.7em;
  }
  .name { color: var(--rarity); font-weight: 600; }
  .lvl { color: var(--muted); font-size: 0.85em; }

  .bag { display: flex; flex-direction: column; overflow: hidden; }
  .baghead { display: flex; align-items: center; gap: 12px; }
  .baghead button { margin-left: auto; font-size: 0.78em; padding: 0.35em 0.8em; }
  .items {
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 10px;
    padding-right: 6px;
  }
  .item {
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid var(--edge);
    border-left: 3px solid var(--rarity);
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 0.82em;
  }
  /* Przedmiot na kowadle musi być widoczny jednym spojrzeniem: przy dwudziestu
     odłożonych sztukach lista bez wyróżnienia jest nieczytelna. */
  .item.picked {
    background: rgba(255, 176, 61, 0.12);
    border-color: #ffb03d;
  }
  .item.picked .forge {
    color: #ffb03d;
  }

  /* ── kowal ─────────────────────────────────────────────────────────────── */
  .smith {
    margin: 0 0 10px;
    padding: 10px 12px;
    border: 1px solid var(--edge);
    border-left: 3px solid #ffb03d;
    border-radius: 8px;
    background: rgba(255, 176, 61, 0.06);
  }
  .smith.ready {
    background: rgba(255, 176, 61, 0.14);
    box-shadow: 0 0 0 1px rgba(255, 176, 61, 0.35);
  }
  .smithhead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    border: 0;
    padding: 0;
  }
  .smithhead h3 {
    margin: 0;
    font-size: 0.95em;
    letter-spacing: 0.04em;
  }
  .cores {
    color: #ffb03d;
  }
  .smith .bar {
    position: relative;
    height: 6px;
    margin: 8px 0 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }
  .smith .bar i {
    position: absolute;
    inset: 0 auto 0 0;
    background: linear-gradient(90deg, #ff8c1a, #ffd166);
  }
  .smithinfo {
    font-size: 0.8em;
    opacity: 0.85;
  }
  .smithnote {
    margin: 4px 0 8px;
    font-size: 0.8em;
  }
  .smithnote.ok {
    color: #ffd166;
  }
  .smithbtns {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  /* Zablokowany przycisk musi wyglądać na zablokowany. Bez tego „Przekuj"
     świecił pełnym kolorem także wtedy, gdy brakowało mocy — gracz klikał
     i nic się nie działo, co czyta się jak zepsuty interfejs, nie jak brak
     materiału. */
  .smithbtns button:disabled {
    opacity: 0.4;
    filter: saturate(0.35);
    cursor: not-allowed;
  }
  .ihead { display: flex; justify-content: space-between; gap: 8px; border: 0; padding: 0; }
  .stat { color: var(--text); margin-top: 4px; }
  .affix { color: #8fd0ff; margin-top: 2px; }
  .legendary { color: #ffb347; margin-top: 6px; font-style: italic; }
  .item footer { display: flex; gap: 6px; margin-top: 10px; }
  .item footer button { flex: 1; padding: 0.35em 0.5em; font-size: 0.95em; }
  .up { color: #4fd18b; }
  .down { color: #e0433d; }
  .small { font-size: 0.8em; }
</style>
