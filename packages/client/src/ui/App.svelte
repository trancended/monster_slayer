<script lang="ts">
  import { hud } from "./state.svelte.ts";
  import Hud from "./Hud.svelte";
  import Menu from "./Menu.svelte";
  import Inventory from "./Inventory.svelte";
  import Toasts from "./Toasts.svelte";
  import type { Game } from "../game.ts";

  let { game }: { game: Game } = $props();
</script>

{#if hud.screen === "playing" || hud.screen === "paused" || hud.screen === "dead"}
  <Hud />
{/if}

<Toasts />

{#if hud.screen === "inventory"}
  <Inventory {game} />
{/if}

<Menu {game} />
