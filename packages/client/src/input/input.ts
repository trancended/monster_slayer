/**
 * Warstwa inputu (GDD §4).
 * Odczyt przez `KeyboardEvent.code` — fizyczna pozycja klawisza, więc
 * AZERTY i QWERTZ działają bez konfiguracji. Buforowanie 150 ms robi World.
 */
import type { PlayerIntent } from "@ms/core";

export type Action =
  | "moveUp"
  | "moveDown"
  | "moveLeft"
  | "moveRight"
  | "attack"
  | "heavy"
  | "dodge"
  | "sprint"
  | "potion"
  | "menu"
  | "inventory"
  | "highlightLoot";

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  moveUp: ["KeyW", "ArrowUp"],
  moveDown: ["KeyS", "ArrowDown"],
  moveLeft: ["KeyA", "ArrowLeft"],
  moveRight: ["KeyD", "ArrowRight"],
  // Trackpad MacBooka klika lewym bez problemu, ale prawy przycisk to
  // stuknięcie dwoma palcami — niewykonalne w środku walki. Dlatego oba ataki
  // mają pełnoprawne odpowiedniki klawiaturowe pod lewą ręką na WASD.
  attack: ["KeyJ", "KeyC"],
  heavy: ["KeyK", "KeyV"],
  dodge: ["Space"],
  sprint: ["ShiftLeft", "ShiftRight"],
  potion: ["Digit1"],
  // Esc w pełnym ekranie wychodzi z fullscreena, więc menu jest też pod Tab (GDD §4.2).
  menu: ["Escape", "Tab"],
  inventory: ["KeyI"],
  highlightLoot: ["AltLeft", "AltRight"],
};

/**
 * Klawisze przechwytywane przez przeglądarkę — nie wolno ich mapować.
 * Skróty z Ctrl/Cmd (Ctrl+W, Ctrl+T) są odsiewane osobno, sprawdzaniem
 * modyfikatorów w `keydown`, bo blokuje je kombinacja, a nie sam klawisz.
 */
export const FORBIDDEN_CODES = new Set([
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
]);

export interface InputCallbacks {
  onMenuToggle(): void;
  onInventoryToggle(): void;
  onGamepadDetected(): void;
}

export class InputManager {
  private down = new Set<string>();
  private bindings: Record<Action, string[]> = structuredClone(DEFAULT_BINDINGS);

  mouseX = 0;
  mouseY = 0;
  private mouseDown = false;
  private mousePressed = false;
  private rightPressed = false;
  private dodgePressed = false;
  private potionPressed = false;
  private keyAttackPressed = false;
  private keyHeavyPressed = false;

  gamepadIndex: number | null = null;
  highlightLoot = false;
  /** Ustawione, gdy gra ma zostać zapauzowana (utrata fokusu / zmiana karty). */
  focusLost = false;

  private listeners: (() => void)[] = [];

  constructor(
    private readonly canvasHost: HTMLElement,
    private readonly cb: InputCallbacks,
  ) {}

  setBindings(bindings: Record<Action, string[]>): void {
    this.bindings = bindings;
  }

  getBindings(): Record<Action, string[]> {
    return this.bindings;
  }

  attach(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      // Nie zabieramy przeglądarce Ctrl+W / Ctrl+T itd.
      if (e.ctrlKey || e.metaKey) return;
      if (e.code === "Tab") e.preventDefault();
      if (e.code === "Space") e.preventDefault();
      if (e.repeat) return;

      this.down.add(e.code);
      if (this.matches("menu", e.code)) this.cb.onMenuToggle();
      if (this.matches("inventory", e.code)) this.cb.onInventoryToggle();
      if (this.matches("dodge", e.code)) this.dodgePressed = true;
      if (this.matches("potion", e.code)) this.potionPressed = true;
      if (this.matches("attack", e.code)) this.keyAttackPressed = true;
      if (this.matches("heavy", e.code)) this.keyHeavyPressed = true;
      if (this.matches("highlightLoot", e.code)) this.highlightLoot = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      this.down.delete(e.code);
      if (this.matches("highlightLoot", e.code)) this.highlightLoot = false;
    };
    const onMouseMove = (e: MouseEvent) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        this.mouseDown = true;
        this.mousePressed = true;
      } else if (e.button === 2) {
        this.rightPressed = true;
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) this.mouseDown = false;
    };
    // Utrata fokusu → pauza. Bez tego akumulator wykona kilkaset ticków naraz.
    const onBlur = () => {
      this.focusLost = true;
      this.down.clear();
      this.mouseDown = false;
    };
    const onVisibility = () => {
      if (document.hidden) onBlur();
    };
    const onGamepad = () => this.cb.onGamepadDetected();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    this.canvasHost.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("gamepadconnected", onGamepad);

    this.listeners.push(
      () => window.removeEventListener("keydown", onKeyDown),
      () => window.removeEventListener("keyup", onKeyUp),
      () => window.removeEventListener("mousemove", onMouseMove),
      () => this.canvasHost.removeEventListener("mousedown", onMouseDown),
      () => window.removeEventListener("mouseup", onMouseUp),
      () => window.removeEventListener("blur", onBlur),
      () => document.removeEventListener("visibilitychange", onVisibility),
      () => window.removeEventListener("gamepadconnected", onGamepad),
    );
  }

  detach(): void {
    for (const off of this.listeners) off();
    this.listeners.length = 0;
  }

  /**
   * Zrzuca cały przytrzymany input. Wołane przy wejściu i wyjściu z overlayów:
   * bez tego klawisz albo przycisk myszy trzymany w chwili otwarcia ekwipunku
   * „przecieka" do gry po jego zamknięciu — postać sama rusza albo ładuje cios.
   */
  clearHeld(): void {
    this.down.clear();
    this.mouseDown = false;
    this.mousePressed = false;
    this.rightPressed = false;
    this.dodgePressed = false;
    this.potionPressed = false;
    this.keyAttackPressed = false;
    this.keyHeavyPressed = false;
    this.highlightLoot = false;
  }

  private matches(action: Action, code: string): boolean {
    return this.bindings[action].includes(code);
  }

  private isDown(action: Action): boolean {
    for (const code of this.bindings[action]) if (this.down.has(code)) return true;
    return false;
  }

  /**
   * Zapisuje intencję do struktury World. Kierunki są ekranowe i przeliczane
   * na osie świata — w izometrii „w górę" to (−1, −1).
   */
  writeIntent(intent: PlayerIntent, aimWorld: { x: number; y: number }): void {
    let sx = 0;
    let sy = 0;
    if (this.isDown("moveUp")) sy -= 1;
    if (this.isDown("moveDown")) sy += 1;
    if (this.isDown("moveLeft")) sx -= 1;
    if (this.isDown("moveRight")) sx += 1;

    let sprint = this.isDown("sprint");
    let dodge = this.dodgePressed;
    let potion = this.potionPressed;
    // Mysz i klawiatura są równorzędne — przytrzymanie klawisza ataku ładuje
    // cios ciężki dokładnie tak samo jak przytrzymanie LPM.
    let attackPressed = this.mousePressed || this.keyAttackPressed;
    let attackHeld = this.mouseDown || this.isDown("attack");
    let heavyPressed = this.rightPressed || this.keyHeavyPressed;

    const pad = this.readGamepad();
    if (pad) {
      if (Math.hypot(pad.lx, pad.ly) > 0.18) {
        sx = pad.lx;
        sy = pad.ly;
      }
      sprint ||= pad.sprint;
      dodge ||= pad.dodge;
      potion ||= pad.potion;
      attackPressed ||= pad.attackPressed;
      attackHeld ||= pad.attackHeld;
      heavyPressed ||= pad.heavyPressed;
      if (Math.hypot(pad.rx, pad.ry) > 0.25) {
        aimWorld.x += pad.rx * 4;
        aimWorld.y += pad.ry * 4;
      }
    }

    // Ekran → świat: W = (−1,−1), D = (+1,−1).
    intent.moveX = (sx + sy) * 0.7071;
    intent.moveY = (sy - sx) * 0.7071;
    intent.aimX = aimWorld.x;
    intent.aimY = aimWorld.y;
    intent.sprint = sprint;
    intent.dodgePressed = dodge;
    intent.potionPressed = potion;
    intent.attackPressed = attackPressed;
    intent.attackHeld = attackHeld;
    intent.heavyPressed = heavyPressed;

    this.mousePressed = false;
    this.rightPressed = false;
    this.dodgePressed = false;
    this.potionPressed = false;
    this.keyAttackPressed = false;
    this.keyHeavyPressed = false;
  }

  private padPrev = { attack: false, heavy: false, dodge: false, potion: false };

  /** Pad wykrywany dopiero po pierwszym naciśnięciu przycisku (wymóg przeglądarki). */
  private readGamepad() {
    const pads = navigator.getGamepads?.() ?? [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p?.connected) {
        pad = p;
        break;
      }
    }
    if (!pad) {
      this.gamepadIndex = null;
      return null;
    }
    this.gamepadIndex = pad.index;

    const DEAD = 0.18;
    const axis = (v: number | undefined) => {
      const value = v ?? 0;
      return Math.abs(value) < DEAD ? 0 : value;
    };
    const btn = (i: number) => pad.buttons[i]?.pressed === true;

    const attack = (pad.buttons[7]?.value ?? 0) > 0.4;
    const heavy = (pad.buttons[6]?.value ?? 0) > 0.6;
    const dodge = btn(0);
    const potion = btn(2);

    const out = {
      lx: axis(pad.axes[0]),
      ly: axis(pad.axes[1]),
      rx: axis(pad.axes[2]),
      ry: axis(pad.axes[3]),
      attackHeld: attack,
      attackPressed: attack && !this.padPrev.attack,
      heavyPressed: heavy && !this.padPrev.heavy,
      dodge: dodge && !this.padPrev.dodge,
      potion: potion && !this.padPrev.potion,
      sprint: btn(10),
    };
    this.padPrev = { attack, heavy, dodge, potion };
    return out;
  }
}
