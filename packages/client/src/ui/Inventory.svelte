<script lang="ts">
  import { affixText, itemScore, type Item } from "@ms/core";
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

  function comparison(item: Item): number {
    const equipped = hud.equipment[item.slot];
    if (!equipped) return 1;
    const diff = itemScore(item) - itemScore(equipped);
    return diff > 0.5 ? 1 : diff < -0.5 ? -1 : 0;
  }
</script>

<div class="scrim">
  <div class="panel interactive">
    <header>
      <h1>Ekwipunek</h1>
      <div class="mono muted">
        Poz. {hud.level} · {hud.gold} złota · {hud.inventory.length} przedmiotów
      </div>
      <button class="ghost" onclick={() => game.toggleInventory()}>Zamknij (I)</button>
    </header>

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
        <div class="items">
          {#each hud.inventory as item (item.id)}
            {@const cmp = comparison(item)}
            <article class="item" style="--rarity:{RARITY_HEX[item.rarity]}">
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
