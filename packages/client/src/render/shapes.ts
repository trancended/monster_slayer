/**
 * Elementy pomocnicze rysowane pod postacią. Same sylwetki postaci
 * są w `characters.ts`.
 */
import { Graphics } from "pixi.js";
import { ISO_H, ISO_W } from "./iso.ts";

export function makeShadow(radius: number): Graphics {
  const g = new Graphics();
  g.ellipse(0, 0, radius * ISO_W * 1.05, radius * ISO_H * 1.05).fill({
    color: 0x000000,
    alpha: 0.4,
  });
  return g;
}

/**
 * Wskaźnik kierunku na podłożu. Sylwetka odbija się tylko w poziomie,
 * więc bez tego nie widać, czy wróg jest zwrócony „w głąb" czy „na gracza" —
 * a od tego zależy odczyt telegrafu stożkowego.
 */
export function makeFacingMarker(radius: number): Graphics {
  const g = new Graphics();
  const r = radius * ISO_W * 0.9;
  g.poly([r * 0.9, 0, r * 0.3, r * 0.26, r * 0.3, -r * 0.26]).fill({
    color: 0xffffff,
    alpha: 0.5,
  });
  return g;
}
