<script lang="ts">
  import { hud, RARITY_HEX } from "./state.svelte.ts";
</script>

<div class="toasts" role="log" aria-live="polite">
  {#each hud.toasts as t (t.id)}
    <div
      class="toast {t.kind}"
      style={t.rarity ? `--rarity:${RARITY_HEX[t.rarity]}` : ""}
    >
      {t.text}
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: absolute;
    right: 22px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-end;
    max-width: 320px;
  }
  .toast {
    background: rgba(10, 14, 22, 0.85);
    border: 1px solid var(--edge);
    border-left: 3px solid var(--rarity, var(--accent));
    border-radius: 7px;
    padding: 7px 12px;
    font-size: 0.82em;
    color: var(--rarity, var(--text));
    animation: slide 0.22s ease-out;
    text-shadow: 0 1px 4px #000;
  }
  .toast.level {
    border-left-color: var(--xp);
    color: var(--xp);
    font-weight: 700;
  }
  .toast.wave {
    border-left-color: #ff7a5c;
    color: #ffb3a1;
  }
  .toast.info {
    color: var(--muted);
  }
  @keyframes slide {
    from { opacity: 0; transform: translateX(18px); }
    to { opacity: 1; transform: translateX(0); }
  }
</style>
