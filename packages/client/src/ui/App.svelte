<script lang="ts">
  import { hud, type Screen } from "./state.svelte.ts";
  import Hud from "./Hud.svelte";
  import Menu from "./Menu.svelte";
  import Inventory from "./Inventory.svelte";
  import Toasts from "./Toasts.svelte";
  import type { Game } from "../game.ts";

  let { game }: { game: Game } = $props();

  const KNOWN: Screen[] = ["start", "playing", "paused", "options", "inventory", "dead"];

  // Nieznany stan ekranu oznaczałby, że nie renderuje się ANI HUD, ani menu,
  // ani ekwipunek — gracz widziałby samą arenę bez żadnego interfejsu i nie
  // miałby jak z tego wyjść. Wracamy wtedy do gry zamiast zostawiać pustkę.
  $effect(() => {
    if (!KNOWN.includes(hud.screen)) {
      console.error("[ui] nieznany stan ekranu:", hud.screen, "— wracam do gry");
      hud.screen = "playing";
    }
  });

  const showHud = $derived(
    hud.screen === "playing" || hud.screen === "paused" || hud.screen === "dead",
  );
</script>

<!--
  Bez granicy błędu wyjątek w dowolnym panelu wygaszał całe poddrzewo po cichu:
  interfejs znikał, zostawała goła arena i nie było śladu, co się stało.
-->
<svelte:boundary onerror={(e: unknown) => console.error("[ui] błąd renderowania panelu", e)}>
  {#if showHud}
    <Hud />
  {/if}

  <Toasts />

  {#if hud.screen === "inventory"}
    <Inventory {game} />
  {/if}

  <Menu {game} />

  {#snippet failed(error: unknown, reset: () => void)}
    <div class="crash interactive">
      <div class="box">
        <h1>Panel interfejsu się wysypał</h1>
        <p>Gra działa dalej — to awaria warstwy UI, nie symulacji.</p>
        <pre>{String(error)}</pre>
        <div class="row">
          <button
            class="primary"
            onclick={() => {
              hud.screen = "playing";
              reset();
            }}>Wróć do gry</button
          >
          <button onclick={() => location.reload()}>Przeładuj stronę</button>
        </div>
      </div>
    </div>
  {/snippet}
</svelte:boundary>

<style>
  .crash {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(8, 6, 10, 0.9);
    pointer-events: auto;
    padding: 24px;
  }
  .box {
    max-width: 640px;
    background: var(--panel-solid);
    border: 1px solid #7a2f2f;
    border-radius: 14px;
    padding: 24px 28px;
  }
  h1 {
    margin: 0 0 8px;
    font-size: 1.3em;
  }
  p {
    color: var(--muted);
    margin: 0 0 12px;
  }
  pre {
    white-space: pre-wrap;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 8px;
    padding: 12px;
    font-size: 0.78em;
    color: #ff9c9c;
    max-height: 30vh;
    overflow: auto;
  }
  .row {
    display: flex;
    gap: 10px;
    margin-top: 14px;
  }
</style>
