<script lang="ts">
  /**
   * Ekran postaci (v4 §5.8 i filar F4).
   *
   * > „Ekran postaci ma być czymś, co gracz sam z siebie wkleja na Reddita.
   * >  To jest twój kanał marketingowy. Projektuj pod screenshot i pod kod builda."
   *
   * Konsekwencje projektowe wzięte dosłownie:
   *  • czytelny w 1200 px — siatka dwukolumnowa, DPS wielkim drukiem;
   *  • kod builda widoczny na każdym zrzucie, nie schowany w menu;
   *  • keystone'y wyeksponowane, bo to one definiują archetyp i o nich się pisze;
   *  • rzadkość niesiona kolorem ORAZ znakiem — zrzut czyta też daltonista.
   */
  import { format, type idle } from "@ms/core";
  import { RARITY_MARK, RARITY_NAME, SLOT_ORDER, SLOT_SHORT } from "./format.ts";

  let {
    // Nazwa `state` kolidowałaby z rune `$state` — Svelte 5 potraktowałby
    // `$state` w tym pliku jako subskrypcję store'a o tej nazwie.
    idleState,
    rates,
    bonuses,
    buildCode,
    keystones = [],
    onCopyCode,
    onApplyCode,
    onRespec,
    onClose,
  }: {
    idleState: idle.IdleState;
    rates: idle.IdleRates;
    bonuses: idle.IdleBonuses;
    buildCode: string;
    keystones?: string[];
    onCopyCode: () => void;
    onApplyCode: (code: string) => void;
    onRespec: () => void;
    onClose: () => void;
  } = $props();

  let pasted = $state("");
  let copied = $state(false);

  const notation = $derived(idleState.notation);
  const fmt = (v: Parameters<typeof format>[0]): string => format(v, { notation });

  const pct = (v: number): string => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

  /** `more` jest multiplikatywne — składamy je w jeden mnożnik do pokazania. */
  const moreMult = $derived(bonuses.moreDamage.reduce((acc, m) => acc * (1 + m), 1));

  function copy(): void {
    onCopyCode();
    copied = true;
    setTimeout(() => (copied = false), 1600);
  }

  function apply(): void {
    const code = pasted.trim();
    if (code === "") return;
    onApplyCode(code);
    pasted = "";
  }
</script>

<div class="idle-overlay interactive" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
  <div class="sheet">
    <header class="sheet-head">
      <div class="sheet-title">
        <label class="muted" for="build-name" style="font-size:.75em;letter-spacing:.1em;text-transform:uppercase">
          Nazwa builda
        </label>
        <input
          id="build-name"
          bind:value={idleState.buildName}
          maxlength="24"
          aria-label="Nazwa builda"
        />
        <div class="sheet-tags" id="sheet-title">
          <span class="tag">Strefa {idleState.deepestZone}</span>
          <span class="tag">Rekord {idleState.deepestZoneEver}</span>
          <span class="tag">{idleState.prestige.points + idleState.prestige.spent} PP</span>
          {#if idleState.prestige.sparks > 0}<span class="tag">{idleState.prestige.sparks} Iskier</span>{/if}
          {#each keystones as k (k)}
            <span class="tag key">{k}</span>
          {/each}
        </div>
      </div>

      <div class="sheet-dps">
        <span class="n">{fmt(rates.dps)}</span>
        <span class="k">obrażeń / s</span>
      </div>
    </header>

    <div class="sheet-body">
      <section aria-labelledby="h-gear">
        <h2 id="h-gear">Ekwipunek</h2>
        <div class="slots">
          {#each SLOT_ORDER as slot (slot)}
            {@const item = idleState.equipment[slot]}
            <div class="slot" class:empty={!item} data-rarity={item?.rarity ?? "common"}>
              <div class="s-name">{SLOT_SHORT[slot]}</div>
              {#if item}
                <div class="s-item">
                  <span class="r-mark" title={RARITY_NAME[item.rarity]} aria-label={RARITY_NAME[item.rarity]}>
                    {RARITY_MARK[item.rarity]}
                  </span>{item.name}
                </div>
                <div class="s-meta">
                  {#if item.upgradeLevel > 0}+{item.upgradeLevel}{/if}
                  {#if item.rarity !== "unique"}
                    {Math.round(item.quality * 100)}%
                  {/if}
                  · s{item.zone}
                </div>
              {:else}
                <div class="s-item">pusty</div>
              {/if}
            </div>
          {/each}
        </div>
      </section>

      <section aria-labelledby="h-stats">
        <h2 id="h-stats">Statystyki</h2>
        <div class="kv">
          <div class="row"><span>Obrażenia / s</span><b>{fmt(rates.dps)}</b></div>
          <div class="row"><span>Obrażenia pakietowe / s</span><b>{fmt(rates.clearDps)}</b></div>
          <div class="row"><span>Złoto / s</span><b>{fmt(rates.goldPerSecond)}</b></div>
          <div class="row">
            <span>Czyszczenie strefy</span>
            <b>{Number.isFinite(rates.clearSeconds) ? `${rates.clearSeconds.toFixed(1)} s` : "—"}</b>
          </div>
          <div class="row"><span>Znajdźka</span><b>{pct(rates.magicFind - 1)}</b></div>
        </div>

        <h2 id="h-bonus">Bonusy</h2>
        <div class="kv" aria-labelledby="h-bonus">
          <div class="row"><span>Obrażenia bazowe</span><b>+{Math.round(bonuses.flatDamage)}</b></div>
          <div class="row"><span>Zwiększone obrażenia</span><b>{pct(bonuses.increasedDamage)}</b></div>
          <div class="row"><span>Mnożniki „więcej”</span><b>×{moreMult.toFixed(2)}</b></div>
          <div class="row"><span>Szybkość ataku</span><b>{pct(bonuses.attackSpeed)}</b></div>
          <div class="row"><span>Szansa na krytyk</span><b>{pct(bonuses.critChance)}</b></div>
          <div class="row"><span>Mnożnik krytyczny</span><b>{pct(bonuses.critMult)}</b></div>
          <div class="row"><span>Obrażenia obszarowe</span><b>{pct(bonuses.areaDamage)}</b></div>
          <div class="row"><span>Znaleźne złoto</span><b>{pct(bonuses.goldFind)}</b></div>
          <div class="row">
            <span>Offline</span>
            <b>{pct(bonuses.offlineEfficiency)} / +{bonuses.offlineCapHours.toFixed(1)} h</b>
          </div>
        </div>
      </section>
    </div>

    <!--
      Kod builda w rogu każdego zrzutu — to jest cały mechanizm wirusowy z §5.8.
      Nie chowamy go w menu, bo wtedy nie trafiłby na screenshot.
    -->
    <section aria-labelledby="h-code">
      <h2 id="h-code">Kod builda</h2>
      <div class="buildcode">
        <code title={buildCode}>{buildCode}</code>
        <button onclick={copy} aria-live="polite">{copied ? "Skopiowano ✓" : "Kopiuj kod"}</button>
      </div>
      <div class="buildcode" style="margin-top:.5em">
        <input
          bind:value={pasted}
          placeholder="Wklej cudzy kod (MS4:…)"
          aria-label="Wklej kod builda"
          onkeydown={(e) => e.key === "Enter" && apply()}
        />
        <button onclick={apply} disabled={pasted.trim() === ""}>Zastosuj co się da</button>
      </div>
      <p class="idle-note">
        „Zastosuj co się da” rozdaje punkty i zakłada <strong>posiadane</strong> przedmioty.
        Nigdy nie tworzy niczego z powietrza.
      </p>
    </section>

    <div class="idle-actions">
      <button onclick={onRespec}>Respec (darmowy)</button>
      <button class="primary" onclick={onClose}>Zamknij</button>
    </div>
  </div>
</div>
