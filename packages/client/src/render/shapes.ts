/**
 * Greybox — kształty rysowane proceduralnie (stack §10).
 * Wszystko jest białe; kolor wchodzi przez `tint`, dzięki czemu hit flash
 * to jedna linijka (`tint = 0xffffff`), a nie przerysowanie geometrii.
 */
import { Graphics } from "pixi.js";
import { ISO_H, ISO_W } from "./iso.ts";

export type Archetype =
  | "player"
  | "swarmer"
  | "ranged"
  | "bruiser"
  | "caster"
  | "bomber"
  | "miniboss";

/** Wysokość bryły w pikselach dla promienia w metrach. */
function bodyHeight(radius: number): number {
  return radius * ISO_W * 2.6;
}

export function makeShadow(radius: number): Graphics {
  const g = new Graphics();
  g.ellipse(0, 0, radius * ISO_W * 1.05, radius * ISO_H * 1.05).fill({
    color: 0x000000,
    alpha: 0.38,
  });
  return g;
}

export function makeBody(archetype: Archetype, radius: number): Graphics {
  const g = new Graphics();
  const w = radius * ISO_W * 1.7;
  const h = bodyHeight(radius);

  switch (archetype) {
    case "player": {
      // Sylwetka z wyraźnym „ramieniem" — czytelna także w tłumie.
      g.poly([0, -h, w * 0.72, -h * 0.55, w * 0.5, 0, -w * 0.5, 0, -w * 0.72, -h * 0.55]).fill({
        color: 0xffffff,
        alpha: 1,
      });
      g.poly([0, -h, w * 0.36, -h * 0.72, 0, -h * 0.5, -w * 0.36, -h * 0.72]).fill({
        color: 0xffffff,
        alpha: 0.45,
      });
      break;
    }
    case "swarmer": {
      g.poly([0, -h, w * 0.8, 0, -w * 0.8, 0]).fill({ color: 0xffffff, alpha: 1 });
      break;
    }
    case "ranged": {
      g.roundRect(-w * 0.6, -h, w * 1.2, h, 3).fill({ color: 0xffffff, alpha: 1 });
      g.moveTo(-w * 0.9, -h * 0.55)
        .lineTo(w * 0.9, -h * 0.55)
        .stroke({ width: 3, color: 0xffffff, alpha: 0.5 });
      break;
    }
    case "bruiser": {
      g.poly([
        0, -h,
        w, -h * 0.62,
        w * 0.8, 0,
        -w * 0.8, 0,
        -w, -h * 0.62,
      ]).fill({ color: 0xffffff, alpha: 1 });
      g.rect(-w * 0.85, -h * 0.62, w * 1.7, h * 0.14).fill({ color: 0xffffff, alpha: 0.4 });
      break;
    }
    case "caster": {
      g.poly([0, -h, w * 0.7, -h * 0.5, 0, 0, -w * 0.7, -h * 0.5]).fill({
        color: 0xffffff,
        alpha: 1,
      });
      g.circle(0, -h * 1.12, w * 0.28).fill({ color: 0xffffff, alpha: 0.75 });
      break;
    }
    case "bomber": {
      g.circle(0, -h * 0.52, h * 0.52).fill({ color: 0xffffff, alpha: 1 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.moveTo(Math.cos(a) * h * 0.5, -h * 0.52 + Math.sin(a) * h * 0.5)
          .lineTo(Math.cos(a) * h * 0.75, -h * 0.52 + Math.sin(a) * h * 0.75)
          .stroke({ width: 3, color: 0xffffff, alpha: 0.7 });
      }
      break;
    }
    case "miniboss": {
      g.poly([
        0, -h * 1.1,
        w * 1.05, -h * 0.7,
        w * 0.85, 0,
        -w * 0.85, 0,
        -w * 1.05, -h * 0.7,
      ]).fill({ color: 0xffffff, alpha: 1 });
      g.poly([0, -h * 1.42, w * 0.3, -h * 1.05, -w * 0.3, -h * 1.05]).fill({
        color: 0xffffff,
        alpha: 0.8,
      });
      break;
    }
  }
  return g;
}

/** Wskaźnik kierunku patrzenia — bez niego telegraf stożkowy jest nieczytelny. */
export function makeFacingMarker(radius: number): Graphics {
  const g = new Graphics();
  const r = radius * ISO_W * 1.15;
  g.poly([r, 0, r * 0.45, r * 0.28, r * 0.45, -r * 0.28]).fill({ color: 0xffffff, alpha: 0.85 });
  return g;
}

export function archetypeOf(id: string): Archetype {
  switch (id) {
    case "swarmer":
    case "ranged":
    case "bruiser":
    case "caster":
    case "bomber":
    case "miniboss":
      return id;
    default:
      return "swarmer";
  }
}
