<script lang="ts">
  import { hud } from "./state.svelte.ts";
  import type { Game } from "../game.ts";
  import { DEFAULT_SETTINGS } from "../save/save.ts";

  let { game }: { game: Game } = $props();

  const DIFFICULTIES = [
    { id: "story", label: "Opowieść", hint: "0.6× otrzymywanych obrażeń" },
    { id: "hunter", label: "Łowca", hint: "1.0× — balans referencyjny" },
    { id: "veteran", label: "Weteran", hint: "1.35× i agresywniejsze AI" },
    { id: "nightmare", label: "Koszmar", hint: "1.8× — dla wyćwiczonych" },
  ];

  function update<K extends keyof typeof hud.settings>(key: K, value: (typeof hud.settings)[K]) {
    game.applySettings({ ...hud.settings, [key]: value });
  }

  function updateAudio(key: keyof typeof hud.settings.audio, value: number) {
    game.applySettings({ ...hud.settings, audio: { ...hud.settings.audio, [key]: value } });
  }
</script>

{#if hud.screen === "start"}
  <div class="scrim">
    <div class="panel start interactive">
      <h1>Monster Slayer</h1>
      <p class="tag">Izometryczne action-RPG · greybox vertical slice</p>

      <button class="primary big" onclick={() => game.startGame()}>Graj</button>
      <p class="note">
        Kliknięcie odblokowuje dźwięk — przeglądarki blokują <code>AudioContext</code>
        do pierwszego gestu użytkownika.
      </p>

      <div class="controls">
        <h2>Sterowanie</h2>
        <dl>
          <dt>W A S D</dt><dd>Ruch</dd>
          <dt>Mysz / trackpad</dt><dd>Celowanie</dd>
          <dt>LPM <em>lub</em> J / C</dt><dd>Combo 3-ciosowe (przytrzymaj po ciosie → ładowanie)</dd>
          <dt>K / V <em>lub</em> PPM</dt><dd>Atak ciężki (ładowany 0.9 s)</dd>
          <dt>Spacja</dt><dd>Unik — i-frames 0.10–0.42 s</dd>
          <dt>Shift</dt><dd>Sprint</dd>
          <dt>1</dt><dd>Mikstura (leczy 45% HP w 1.5 s)</dd>
          <dt>I</dt><dd>Ekwipunek i atrybuty</dd>
          <dt>Esc / Tab</dt><dd>Menu</dd>
        </dl>
        <p class="trackpad">
          Na trackpadzie MacBooka stuknięcie dwoma palcami w trakcie walki jest
          niewygodne — <strong>K</strong> i <strong>V</strong> robią dokładnie to,
          co PPM, a <strong>J</strong> i <strong>C</strong> zastępują LPM.
        </p>
      </div>
    </div>
  </div>
{/if}

{#if hud.screen === "paused" || hud.screen === "options"}
  <div class="scrim">
    <div class="panel menu interactive">
      {#if hud.screen === "paused"}
        <h1>Pauza</h1>
        <div class="stack">
          <button class="primary" onclick={() => game.resume()}>Wróć do gry</button>
          <button onclick={() => (hud.screen = "options")}>Opcje i dostępność</button>
          <button onclick={() => game.toggleInventory()}>Ekwipunek</button>
        </div>
        <p class="note mono">
          Poziom {hud.level} · {hud.gold} złota · {hud.kills} zabójstw · encounter {hud.encounter}
        </p>
      {:else}
        <h1>Opcje</h1>

        <section>
          <h2>Poziom trudności</h2>
          <p class="hint">Modyfikuje obrażenia otrzymywane i agresję AI — nigdy HP przeciwników.</p>
          <div class="chips">
            {#each DIFFICULTIES as d}
              <button
                class:active={hud.settings.difficulty === d.id}
                onclick={() => update("difficulty", d.id)}
                title={d.hint}
              >{d.label}</button>
            {/each}
          </div>
        </section>

        <section>
          <h2>Dostępność</h2>
          <label>
            Wstrząs ekranu: <span class="mono">{Math.round(hud.settings.shakeIntensity * 100)}%</span>
            <input
              type="range" min="0" max="1" step="0.05"
              value={hud.settings.shakeIntensity}
              oninput={(e) => update("shakeIntensity", +e.currentTarget.value)}
            />
          </label>
          <label>
            Skala interfejsu: <span class="mono">{Math.round(hud.settings.uiScale * 100)}%</span>
            <input
              type="range" min="0.75" max="1.5" step="0.05"
              value={hud.settings.uiScale}
              oninput={(e) => update("uiScale", +e.currentTarget.value)}
            />
          </label>
          <label class="row">
            Tryb dla daltonistów
            <select
              value={hud.settings.colorblind}
              onchange={(e) => update("colorblind", e.currentTarget.value as never)}
            >
              <option value="none">Wyłączony</option>
              <option value="protanopia">Protanopia</option>
              <option value="deuteranopia">Deuteranopia</option>
              <option value="tritanopia">Tritanopia</option>
            </select>
          </label>
        </section>

        <section>
          <h2>Dźwięk</h2>
          {#each [["master", "Master"], ["music", "Muzyka"], ["sfx", "SFX"], ["ui", "Interfejs"]] as [key, label]}
            <label>
              {label}: <span class="mono">{Math.round(hud.settings.audio[key as "master"] * 100)}%</span>
              <input
                type="range" min="0" max="1" step="0.05"
                value={hud.settings.audio[key as "master"]}
                oninput={(e) => updateAudio(key as "master", +e.currentTarget.value)}
              />
            </label>
          {/each}
        </section>

        <section>
          <h2>Diagnostyka</h2>
          <label class="row">
            <input
              type="checkbox" checked={hud.settings.showFps}
              onchange={(e) => update("showFps", e.currentTarget.checked)}
            />
            Pokazuj FPS i czas symulacji
          </label>
          <label class="row">
            <input
              type="checkbox" checked={hud.settings.telemetryOptIn}
              onchange={(e) => update("telemetryOptIn", e.currentTarget.checked)}
            />
            Wysyłaj telemetrię do backendu (opt-in)
          </label>
        </section>

        <div class="stack">
          <button onclick={() => game.applySettings({ ...DEFAULT_SETTINGS })}>Przywróć domyślne</button>
          <button class="primary" onclick={() => (hud.screen = "paused")}>Wróć</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if hud.screen === "dead"}
  <div class="scrim dead">
    <div class="panel menu interactive">
      <h1>Poległeś</h1>
      <p class="hint">
        Utrata 10% złota. Wracasz na arenę z pełnym zdrowiem i kompletem mikstur.
      </p>
      <div class="stack">
        <button class="primary" onclick={() => game.restartAfterDeath()}>Wróć na arenę</button>
        <button onclick={() => (hud.screen = "options")}>Zmień trudność</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(6, 9, 14, 0.72);
    backdrop-filter: blur(4px);
    pointer-events: auto;
    overflow-y: auto;
    padding: 24px;
  }
  .scrim.dead {
    background: rgba(60, 6, 10, 0.6);
  }
  .panel {
    padding: 28px 32px;
    max-width: 620px;
    width: 100%;
  }
  .start {
    text-align: center;
  }
  h1 {
    margin: 0 0 6px;
    font-size: 2em;
    letter-spacing: 0.02em;
  }
  h2 {
    font-size: 0.95em;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--muted);
    margin: 0 0 8px;
  }
  .tag {
    color: var(--muted);
    margin: 0 0 22px;
  }
  .big {
    font-size: 1.25em;
    padding: 0.7em 2.6em;
  }
  .note {
    color: var(--muted);
    font-size: 0.8em;
    margin: 14px 0 0;
  }
  .hint {
    color: var(--muted);
    font-size: 0.85em;
    margin: 0 0 10px;
  }
  .controls {
    margin-top: 26px;
    text-align: left;
    border-top: 1px solid var(--edge);
    padding-top: 18px;
  }
  dl {
    display: grid;
    grid-template-columns: 8em 1fr;
    gap: 6px 14px;
    margin: 0;
    font-size: 0.87em;
  }
  dt {
    font-family: var(--mono);
    color: var(--accent);
  }
  dd {
    margin: 0;
    color: var(--muted);
  }
  dt em {
    color: var(--muted);
    font-style: normal;
    font-family: var(--font);
  }
  .trackpad {
    margin: 14px 0 0;
    font-size: 0.8em;
    color: var(--muted);
    line-height: 1.5;
  }
  .trackpad strong {
    color: var(--accent);
    font-family: var(--mono);
  }
  section {
    margin-bottom: 22px;
  }
  label {
    display: block;
    font-size: 0.87em;
    margin-bottom: 10px;
    color: var(--text);
  }
  label.row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  input[type="range"] {
    width: 100%;
    accent-color: var(--accent);
  }
  select {
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--edge);
    border-radius: 6px;
    padding: 0.35em 0.6em;
  }
  .chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .chips button.active {
    background: linear-gradient(180deg, #2f7fa8, #1d5a7c);
    border-color: #4fb6e0;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 8px;
  }
  code {
    font-family: var(--mono);
    background: rgba(255, 255, 255, 0.08);
    padding: 0.1em 0.35em;
    border-radius: 4px;
  }
</style>
