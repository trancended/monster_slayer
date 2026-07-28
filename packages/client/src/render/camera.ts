/**
 * Kamera podążająca z trauma-based screen shake (GDD §5.6).
 * Amplituda 0.15–0.5, decay 1.8/s, plus camera kick 4 px w kierunku ataku.
 */
import { damp } from "@ms/core";
import { isoX, isoY } from "./iso.ts";

export class Camera {
  x = 0;
  y = 0;
  private trauma = 0;
  private kickX = 0;
  private kickY = 0;
  shakeX = 0;
  shakeY = 0;
  /** Suwak dostępności: intensywność wstrząsu 0–100%, domyślnie 60% (GDD §10.3). */
  shakeIntensity = 0.6;

  private noiseSeed = Math.random() * 1000;

  constructor(
    private readonly decay: number,
    private readonly maxAmplitude: number,
    private readonly kickReturn: number,
  ) {}

  addTrauma(amount: number, dirX = 0, dirY = 0, kickPx = 0): void {
    this.trauma = Math.min(1, this.trauma + amount);
    if (kickPx > 0) {
      this.kickX += isoX(dirX, dirY) === 0 && isoY(dirX, dirY) === 0 ? 0 : (dirX - dirY) * kickPx;
      this.kickY += (dirX + dirY) * kickPx * 0.5;
    }
  }

  follow(worldX: number, worldY: number, dt: number, instant = false): void {
    const tx = isoX(worldX, worldY);
    const ty = isoY(worldX, worldY);
    if (instant) {
      this.x = tx;
      this.y = ty;
    } else {
      this.x = damp(this.x, tx, 9, dt);
      this.y = damp(this.y, ty, 9, dt);
    }
  }

  update(dt: number): void {
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - this.decay * dt);
      const amp = this.trauma * this.trauma * this.maxAmplitude * this.shakeIntensity;
      this.noiseSeed += dt * 37;
      this.shakeX = Math.sin(this.noiseSeed * 1.7) * amp;
      this.shakeY = Math.cos(this.noiseSeed * 2.3) * amp * 0.6;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }

    const k = Math.min(1, dt / this.kickReturn);
    this.kickX -= this.kickX * k;
    this.kickY -= this.kickY * k;
  }

  get offsetX(): number {
    return this.shakeX + this.kickX;
  }

  get offsetY(): number {
    return this.shakeY + this.kickY;
  }
}
