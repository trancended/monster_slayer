/**
 * Event bus (GDD §11.3). Systemy nie znają się nawzajem — telemetria,
 * audio i HUD podpinają się jako subskrybenci, nie jako wtrącenia w kod walki.
 */
import type { ItemRarityId } from "../domain/item.ts";

export interface GameEvents {
  "enemy:damaged": { entity: number; amount: number; crit: boolean; x: number; y: number; element: string };
  "enemy:staggered": { entity: number; x: number; y: number };
  "enemy:died": { entity: number; typeId: string; x: number; y: number; xp: number; elite: boolean };
  "player:damaged": { amount: number; hp: number; maxHp: number; source: string };
  "player:healed": { amount: number; hp: number };
  "player:died": { room: string };
  "player:dodged": { x: number; y: number; iframe: boolean };
  "player:attack": { combo: number; heavy: boolean };
  "player:staminaEmpty": Record<string, never>;
  "level:up": { level: number; attributePoints: number; skillPoints: number };
  "xp:gained": { amount: number; total: number; toNext: number };
  "item:dropped": { id: string; rarity: ItemRarityId; x: number; y: number };
  "item:picked": { id: string; rarity: ItemRarityId; name: string };
  "gold:gained": { amount: number; total: number };
  "potion:used": { remaining: number };
  "boss:spawned": { entity: number; name: string; hp: number; breakBar: number };
  "boss:broken": { entity: number; window: number };
  "boss:died": { entity: number; name: string };
  /** Wróg przekroczył próg furii — HUD i dźwięk mają to zapowiedzieć. */
  "enemy:enraged": { entity: number; name: string; x: number; y: number };
  /** Boss z cechą „Przyzywacz" dostawił sługi na krawędzi areny. */
  "enemy:summoned": { entity: number; count: number; x: number; y: number };
  /**
   * Pokonanie bossa dołożyło do puli nowe typy wrogów. `units` to ich nazwy
   * wraz z atrybutami — HUD ma czym pokazać, co gracz właśnie odblokował.
   */
  "bestiary:unlocked": {
    tier: number;
    units: { name: string; traits: string[] }[];
    nextBoss: string;
  };
  /** Seria zabójstw urosła. `tierUp` zapala się tylko przy awansie progu. */
  "combo:changed": {
    count: number;
    tier: number;
    name: string;
    multiplier: number;
    tierUp: boolean;
    x: number;
    y: number;
  };
  /** Okno się zamknęło albo gracz zginął. `count` to zerwana seria. */
  "combo:broken": { count: number; best: number };
  "wave:cleared": { wave: number; nextIn: number };
  "wave:started": { wave: number; enemies: number; elite: boolean };
  "hitstop": { seconds: number; slowMoScale: number; slowMoDuration: number };
  "shake": { trauma: number; dirX: number; dirY: number };
  "balance:reloaded": { source: string };
  "net:status": { online: boolean };
  "sfx": { name: string; x?: number; y?: number; pitch?: number };
}

type Handler<K extends keyof GameEvents> = (payload: GameEvents[K]) => void;

export class EventBus {
  private handlers = new Map<string, Set<(payload: unknown) => void>>();

  on<K extends keyof GameEvents>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event as string);
    if (!set) {
      set = new Set();
      this.handlers.set(event as string, set);
    }
    set.add(handler as (payload: unknown) => void);
    return () => set.delete(handler as (payload: unknown) => void);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(event as string);
    if (!set) return;
    for (const handler of set) handler(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const bus = new EventBus();
