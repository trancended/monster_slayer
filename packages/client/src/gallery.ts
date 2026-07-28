/**
 * Galeria sylwetek (dev). Renderuje każdą postać w powiększeniu obok jej
 * nazwy z `data/enemies.json`, żeby dało się ocenić czytelność bez czekania,
 * aż dany wróg wpadnie do encounteru.
 */
import { Application, Container, Graphics, Text } from "pixi.js";
import { bundledBalance } from "@ms/core";
import { drawCharacter } from "./render/characters.ts";
import { makeShadow } from "./render/shapes.ts";

const COLS = 5;
const CELL_W = 240;
const CELL_H = 340;
/** Skala podglądu. Promienie zostają rzeczywiste, żeby było widać proporcje między wrogami. */
const ZOOM = 1.3;

async function main(): Promise<void> {
  const balance = bundledBalance();
  const entries: { id: string; name: string; color: number; radius: number }[] = [
    { id: "player", name: "Bohater (gracz)", color: 0x7fd8ff, radius: 0.42 },
    ...balance.enemies.roster.map((d) => ({
      id: d.id,
      name: d.name,
      color: d.color,
      radius: d.radius,
    })),
  ];

  const rows = Math.ceil(entries.length / COLS);
  const app = new Application();
  await app.init({
    background: 0x12161f,
    width: COLS * CELL_W,
    height: rows * CELL_H,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  document.getElementById("host")!.appendChild(app.canvas);

  entries.forEach((e, i) => {
    const cell = new Container();
    cell.x = (i % COLS) * CELL_W + CELL_W / 2;
    cell.y = Math.floor(i / COLS) * CELL_H + CELL_H - 80;

    const r = e.radius * ZOOM;
    cell.addChild(makeShadow(r));

    const body = new Graphics();
    drawCharacter(body, e.id, r, e.color);
    cell.addChild(body);

    const label = new Text({
      text: e.name,
      style: { fontFamily: "system-ui", fontSize: 15, fill: 0xe6ecf5, fontWeight: "600" },
    });
    label.anchor.set(0.5, 0);
    label.y = 26;
    cell.addChild(label);

    const sub = new Text({
      text: `${e.id} · r=${e.radius}`,
      style: { fontFamily: "monospace", fontSize: 11, fill: 0x93a0b5 },
    });
    sub.anchor.set(0.5, 0);
    sub.y = 48;
    cell.addChild(sub);

    app.stage.addChild(cell);
  });
}

void main();
