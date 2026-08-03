/**
 * Kamera podążająca z trauma-based screen shake (GDD §5.6) — wersja 3D.
 *
 * Różnica względem wersji 2D jest jedna, ale istotna: **wstrząs liczymy
 * w metrach świata, nie w pikselach ekranu.** W 2D kamera przesuwała warstwę
 * o piksele; tu przesuwa punkt, na który patrzy, więc amplitudę trzeba
 * przeliczyć przez skalę kamery ortograficznej. Bez tego wstrząs przy tej samej
 * liczbie z `data/combat.json` byłby albo niewidoczny, albo katastrofalny.
 *
 * API jest zgodne z `render/camera.ts`, żeby `game.ts` nie musiał wiedzieć,
 * który renderer jest aktywny.
 */
import { damp } from "@ms/core";

/**
 * Ile metrów świata przypada na piksel ekranu przy domyślnym kadrze.
 * `data/combat.json` podaje wstrząs i kick w pikselach (dziedzictwo wersji 2D),
 * więc tutaj je konwertujemy zamiast zmieniać dane i psuć strojenie.
 */
const METERS_PER_PIXEL = 0.034;

export class Camera3d {
  /** Punkt, na który patrzy kamera — we współrzędnych świata (metry). */
  x = 0;
  z = 0;

  private trauma = 0;
  private kickX = 0;
  private kickZ = 0;
  shakeX = 0;
  shakeZ = 0;

  /** Suwak dostępności: intensywność wstrząsu 0–100%, domyślnie 60% (GDD §10.3). */
  shakeIntensity = 0.6;

  /**
   * Kierunek patrzenia kamery w TPP (radiany). Podąża za postacią z tłumieniem —
   * natychmiastowe podążanie robiłoby z obrotu postaci szarpnięcie całym kadrem.
   */
  yaw = 0;

  private noiseSeed = Math.random() * 1000;

  private readonly decay: number;
  private readonly maxAmplitude: number;
  private readonly kickReturn: number;

  constructor(decay: number, maxAmplitudePx: number, kickReturn: number) {
    this.decay = decay;
    this.maxAmplitude = maxAmplitudePx * METERS_PER_PIXEL;
    this.kickReturn = kickReturn;
  }

  /**
   * @param dirX kierunek ciosu w świecie (oś X)
   * @param dirY kierunek ciosu w świecie (oś Z sceny — nazwa `dirY` pochodzi
   *             z API 2D i zostaje dla zgodności)
   */
  addTrauma(amount: number, dirX = 0, dirY = 0, kickPx = 0): void {
    this.trauma = Math.min(1, this.trauma + amount);
    if (kickPx > 0) {
      const kick = kickPx * METERS_PER_PIXEL;
      this.kickX += dirX * kick;
      this.kickZ += dirY * kick;
    }
  }

  follow(worldX: number, worldZ: number, dt: number, instant = false): void {
    if (instant) {
      this.x = worldX;
      this.z = worldZ;
    } else {
      this.x = damp(this.x, worldX, 9, dt);
      this.z = damp(this.z, worldZ, 9, dt);
    }
  }

  /**
   * Obrót kamery za kierunkiem postaci.
   *
   * Tłumienie jest **wolniejsze niż podążanie pozycją** (4 zamiast 9): kadr ma
   * doganiać obrót, a nie z nim skakać. Interpolujemy po najkrótszym łuku,
   * bo bez tego przejście przez ±π obracałoby kamerę naokoło.
   */
  followYaw(target: number, dt: number, instant = false): void {
    if (instant) {
      this.yaw = target;
      return;
    }
    let delta = target - this.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.yaw = damp(this.yaw, this.yaw + delta, 4, dt);
  }

  update(dt: number): void {
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - this.decay * dt);
      const amp = this.trauma * this.trauma * this.maxAmplitude * this.shakeIntensity;
      this.noiseSeed += dt * 37;
      this.shakeX = Math.sin(this.noiseSeed * 1.7) * amp;
      this.shakeZ = Math.cos(this.noiseSeed * 2.3) * amp * 0.6;
    } else {
      this.shakeX = 0;
      this.shakeZ = 0;
    }

    const k = Math.min(1, dt / this.kickReturn);
    this.kickX -= this.kickX * k;
    this.kickZ -= this.kickZ * k;
  }

  get offsetX(): number {
    return this.shakeX + this.kickX;
  }

  get offsetZ(): number {
    return this.shakeZ + this.kickZ;
  }
}
