/**
 * Warstwa prezentacji — PixiJS v8 (WebGPU z fallbackiem WebGL2).
 * W canvasie żyje wyłącznie to, co musi być w przestrzeni świata:
 * sprity, VFX, telegrafy AoE, liczby obrażeń i wskaźniki zagrożenia (GDD §10.1).
 * Paski, menu i ekwipunek są w DOM — dostępność jest tam darmowa.
 */
import { Application, Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { ARENA_RADIUS, EState, Flag, Kind, PState, type World } from "@ms/core";
import { Camera } from "./camera.ts";
import { depth, ISO_H, ISO_W, isoX, isoY } from "./iso.ts";
import { archetypeOf, makeBody, makeFacingMarker, makeShadow, type Archetype } from "./shapes.ts";

const COLORS = {
  ground: 0x0b0e14,
  groundAlt: 0x1e2634,
  grid: 0x35415a,
  arenaEdge: 0x53658c,
  obstacle: 0x39435a,
  player: 0x7fd8ff,
  pickupGold: 0xffc94a,
  pickupPotion: 0xff5f7a,
  telegraph: 0xff5544,
  telegraphSafe: 0xffaa33,
  hazard: 0x7bd44f,
  projectile: 0xffd8a8,
  decoy: 0x9fb8ff,
} as const;

const RARITY_COLORS: Record<string, number> = {
  common: 0x9aa3b2,
  uncommon: 0x44c94a,
  rare: 0x4290ff,
  epic: 0xb96bff,
  legendary: 0xff8c00,
};

interface EntityView {
  root: Container;
  body: Graphics;
  shadow: Graphics;
  facing: Graphics | null;
  hpBg: Sprite | null;
  hpFill: Sprite | null;
  outline: Graphics | null;
  baseTint: number;
  kind: number;
}

interface DamageNumber {
  text: Text;
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  scale: number;
}

interface SwingVfx {
  g: Graphics;
  active: boolean;
  life: number;
  maxLife: number;
}

export class Renderer {
  app!: Application;
  camera!: Camera;

  private worldRoot = new Container();
  private groundLayer = new Container();
  private decalLayer = new Container();
  private entityLayer = new Container();
  private vfxLayer = new Container();
  private numbersLayer = new Container();
  private screenLayer = new Container();

  private views = new Map<number, EntityView>();
  private seen = new Set<number>();
  private numbers: DamageNumber[] = [];
  private telegraphs: Graphics[] = [];
  private swings: SwingVfx[] = [];
  private threatArrows: Graphics[] = [];

  private numberStyle!: TextStyle;
  private critStyle!: TextStyle;

  async init(host: HTMLElement, feel: { shakeDecay: number; shakeMaxAmplitudePx: number; cameraKickReturn: number }): Promise<void> {
    this.app = new Application();
    await this.app.init({
      background: COLORS.ground,
      resizeTo: window,
      antialias: true,
      // Renderer skalowany do devicePixelRatio, cap 2.0 (GDD §4.2).
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: "webgpu",
      powerPreference: "high-performance",
    });
    host.appendChild(this.app.canvas);
    this.app.canvas.style.display = "block";
    this.app.canvas.style.touchAction = "none";

    // Prawy przycisk myszy blokowany na canvasie, ale nie na overlayu HUD.
    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    this.camera = new Camera(feel.shakeDecay, feel.shakeMaxAmplitudePx, feel.cameraKickReturn);

    this.entityLayer.sortableChildren = true;
    this.worldRoot.addChild(
      this.groundLayer,
      this.decalLayer,
      this.entityLayer,
      this.vfxLayer,
      this.numbersLayer,
    );
    this.app.stage.addChild(this.worldRoot, this.screenLayer);

    this.numberStyle = new TextStyle({
      fontFamily: "ui-monospace, Menlo, monospace",
      fontSize: 17,
      fontWeight: "700",
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 4 },
    });
    this.critStyle = new TextStyle({
      fontFamily: "ui-monospace, Menlo, monospace",
      fontSize: 24,
      fontWeight: "900",
      fill: 0xffe066,
      stroke: { color: 0x2a1a00, width: 5 },
    });

    for (let i = 0; i < 64; i++) {
      const text = new Text({ text: "", style: this.numberStyle });
      text.anchor.set(0.5);
      text.visible = false;
      this.numbersLayer.addChild(text);
      this.numbers.push({ text, active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, scale: 1 });
    }
    for (let i = 0; i < 24; i++) {
      const g = new Graphics();
      g.visible = false;
      this.decalLayer.addChild(g);
      this.telegraphs.push(g);
    }
    for (let i = 0; i < 12; i++) {
      const g = new Graphics();
      g.visible = false;
      this.vfxLayer.addChild(g);
      this.swings.push({ g, active: false, life: 0, maxLife: 0.18 });
    }
    for (let i = 0; i < 12; i++) {
      const g = new Graphics();
      g.poly([0, -11, 15, 0, 0, 11]).fill({ color: 0xff4d4d, alpha: 0.9 });
      g.visible = false;
      this.screenLayer.addChild(g);
      this.threatArrows.push(g);
    }

    this.drawGround();
  }

  destroy(): void {
    this.app?.destroy(true, { children: true });
  }

  // ───────────────────────────────────────────────────────────── teren

  private drawGround(): void {
    const g = new Graphics();
    const R = ARENA_RADIUS;

    // Podłoże areny jako romb rzutu izometrycznego.
    const pts: number[] = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const x = Math.cos(a) * R;
      const y = Math.sin(a) * R;
      pts.push(isoX(x, y), isoY(x, y));
    }
    g.poly(pts).fill({ color: COLORS.groundAlt, alpha: 1 });
    g.poly(pts).stroke({ width: 4, color: COLORS.arenaEdge, alpha: 0.9 });

    // Siatka nawigacyjna — czytelny odczyt dystansu bez tekstur.
    const step = 2;
    for (let v = -R; v <= R; v += step) {
      const half = Math.sqrt(Math.max(0, R * R - v * v));
      g.moveTo(isoX(v, -half), isoY(v, -half))
        .lineTo(isoX(v, half), isoY(v, half))
        .stroke({ width: 1, color: COLORS.grid, alpha: 0.55 });
      g.moveTo(isoX(-half, v), isoY(-half, v))
        .lineTo(isoX(half, v), isoY(half, v))
        .stroke({ width: 1, color: COLORS.grid, alpha: 0.55 });
    }
    this.groundLayer.addChild(g);
  }

  private obstaclesDrawn = false;

  private drawObstacles(world: World): void {
    if (this.obstaclesDrawn) return;
    this.obstaclesDrawn = true;
    for (const o of world.obstacles) {
      const c = new Container();
      const shadow = new Graphics();
      shadow.ellipse(0, 0, o.r * ISO_W * 1.1, o.r * ISO_H * 1.1).fill({ color: 0x000000, alpha: 0.45 });
      const h = o.r * ISO_W * 1.3;
      const body = new Graphics();
      body
        .poly([-o.r * ISO_W, 0, -o.r * ISO_W, -h, o.r * ISO_W, -h, o.r * ISO_W, 0])
        .fill({ color: COLORS.obstacle, alpha: 1 });
      body.ellipse(0, -h, o.r * ISO_W, o.r * ISO_H).fill({ color: 0x4a5771, alpha: 1 });
      c.addChild(shadow, body);
      c.x = isoX(o.x, o.y);
      c.y = isoY(o.x, o.y);
      c.zIndex = depth(o.x, o.y);
      this.entityLayer.addChild(c);
    }
  }

  // ────────────────────────────────────────────────────────── synchro

  sync(world: World, alpha: number, dt: number): void {
    const s = world.store;
    this.drawObstacles(world);

    const p = world.player;
    const px = s.prevX[p]! + (s.x[p]! - s.prevX[p]!) * alpha;
    const py = s.prevY[p]! + (s.y[p]! - s.prevY[p]!) * alpha;
    this.camera.follow(px, py, dt);
    this.camera.update(dt);

    const cx = this.app.screen.width * 0.5;
    const cy = this.app.screen.height * 0.5;
    this.worldRoot.x = Math.round(cx - this.camera.x + this.camera.offsetX);
    this.worldRoot.y = Math.round(cy - this.camera.y + this.camera.offsetY);

    this.seen.clear();
    for (let i = 0; i < s.count; i++) {
      if (!s.alive[i]) continue;
      const kind = s.kind[i]!;
      if (kind === Kind.None) continue;
      this.seen.add(i);
      const view = this.getView(world, i, kind);
      if (!view) continue;

      const x = s.prevX[i]! + (s.x[i]! - s.prevX[i]!) * alpha;
      const y = s.prevY[i]! + (s.y[i]! - s.prevY[i]!) * alpha;
      view.root.x = isoX(x, y);
      view.root.y = isoY(x, y);
      view.root.zIndex = depth(x, y);

      // Hit flash — biały, addytywny, 0.08 s (GDD §5.6).
      const flash = s.hitFlash[i]!;
      view.body.tint = flash > 0 ? 0xffffff : view.baseTint;
      view.body.alpha = flash > 0 ? 1 : 1;

      if (view.facing) view.facing.rotation = 0;
      if (view.facing) {
        const f = s.facing[i]!;
        view.facing.x = Math.cos(f) * ISO_W * 0.9 - Math.sin(f) * ISO_W * 0.9;
        view.facing.y = (Math.cos(f) + Math.sin(f)) * ISO_H * 0.9;
        view.facing.rotation = Math.atan2(
          (Math.cos(f) + Math.sin(f)) * ISO_H,
          (Math.cos(f) - Math.sin(f)) * ISO_W,
        );
      }

      if (kind === Kind.Enemy) this.updateEnemyView(world, i, view, alpha);
      else if (kind === Kind.Player) this.updatePlayerView(world, view);
      else if (kind === Kind.Pickup) {
        view.root.y += Math.sin(world.elapsed * 4 + i) * 3 - 8;
      } else if (kind === Kind.Hazard) {
        view.root.alpha = Math.min(1, s.lifetime[i]! / 1.5) * 0.75;
      } else if (kind === Kind.Decoy) {
        view.root.alpha = 0.45 + Math.sin(world.elapsed * 9) * 0.15;
      }
    }

    for (const [id, view] of this.views) {
      if (!this.seen.has(id)) {
        view.root.destroy({ children: true });
        this.views.delete(id);
      }
    }

    this.updateTelegraphs(world, alpha);
    this.updateNumbers(dt);
    this.updateSwings(dt);
    this.updateThreatArrows(world, px, py);
  }

  private getView(world: World, id: number, kind: number): EntityView | null {
    const existing = this.views.get(id);
    if (existing && existing.kind === kind) return existing;
    if (existing) {
      existing.root.destroy({ children: true });
      this.views.delete(id);
    }

    const s = world.store;
    const root = new Container();
    let body: Graphics;
    let shadow: Graphics;
    let facing: Graphics | null = null;
    let hpBg: Sprite | null = null;
    let hpFill: Sprite | null = null;
    let outline: Graphics | null = null;
    let baseTint = 0xffffff;

    if (kind === Kind.Player) {
      shadow = makeShadow(s.radius[id]!);
      body = makeBody("player", s.radius[id]!);
      facing = makeFacingMarker(s.radius[id]!);
      baseTint = COLORS.player;
      root.addChild(shadow, facing, body);
    } else if (kind === Kind.Enemy) {
      const def = world.enemyDefs[s.defIdx[id]!];
      const arch: Archetype = archetypeOf(def?.archetype ?? "swarmer");
      shadow = makeShadow(s.radius[id]!);
      body = makeBody(arch, s.radius[id]!);
      facing = makeFacingMarker(s.radius[id]!);
      baseTint = def?.color ?? 0xcccccc;

      hpBg = new Sprite(Texture.WHITE);
      hpBg.tint = 0x000000;
      hpBg.alpha = 0.6;
      const barW = Math.max(26, s.radius[id]! * ISO_W * 2.4);
      hpBg.width = barW;
      hpBg.height = 5;
      hpBg.anchor.set(0.5, 1);
      hpBg.y = -s.radius[id]! * ISO_W * 2.9 - 10;

      hpFill = new Sprite(Texture.WHITE);
      hpFill.tint = 0xe0433d;
      hpFill.width = barW - 2;
      hpFill.height = 3;
      hpFill.anchor.set(0, 1);
      hpFill.x = -(barW - 2) / 2;
      hpFill.y = hpBg.y - 1;

      root.addChild(shadow, facing, body, hpBg, hpFill);

      if (s.hasFlag(id, Flag.Elite) || s.hasFlag(id, Flag.Boss)) {
        outline = new Graphics();
        const r = s.radius[id]! * ISO_W * 1.25;
        outline
          .ellipse(0, 0, r, r * (ISO_H / ISO_W))
          .stroke({ width: 3, color: s.hasFlag(id, Flag.Boss) ? 0xff3b30 : 0xffc83d, alpha: 0.95 });
        root.addChildAt(outline, 1);
      }
    } else if (kind === Kind.Projectile) {
      shadow = makeShadow(s.radius[id]! * 0.6);
      body = new Graphics();
      const r = s.radius[id]! * ISO_W;
      body.ellipse(0, -12, r, r * 0.7).fill({ color: 0xffffff, alpha: 1 });
      baseTint = COLORS.projectile;
      root.addChild(shadow, body);
    } else if (kind === Kind.Pickup) {
      const payload = world.pickups.get(id);
      shadow = makeShadow(0.28);
      body = new Graphics();
      if (payload?.type === "gold") {
        body.circle(0, -10, 7).fill({ color: 0xffffff });
        baseTint = COLORS.pickupGold;
      } else if (payload?.type === "potion") {
        body.roundRect(-5, -20, 10, 16, 3).fill({ color: 0xffffff });
        baseTint = COLORS.pickupPotion;
      } else {
        body.poly([0, -24, 10, -12, 0, 0, -10, -12]).fill({ color: 0xffffff });
        baseTint = RARITY_COLORS[payload?.item?.rarity ?? "common"] ?? 0xffffff;
        // Wiązka światła przy dropie Epic/Legendary (GDD §10.2).
        if (payload?.item && (payload.item.rarity === "epic" || payload.item.rarity === "legendary")) {
          const beam = new Graphics();
          beam.rect(-7, -170, 14, 170).fill({ color: baseTint, alpha: 0.22 });
          root.addChild(beam);
        }
      }
      root.addChild(shadow, body);
    } else if (kind === Kind.Hazard) {
      shadow = new Graphics();
      body = new Graphics();
      const r = s.radius[id]!;
      body
        .ellipse(0, 0, r * ISO_W, r * ISO_H)
        .fill({ color: 0xffffff, alpha: 0.35 })
        .stroke({ width: 2, color: 0xffffff, alpha: 0.7 });
      baseTint = COLORS.hazard;
      root.addChild(body);
    } else if (kind === Kind.Decoy) {
      shadow = makeShadow(0.4);
      body = makeBody("player", 0.42);
      baseTint = COLORS.decoy;
      root.addChild(shadow, body);
    } else {
      return null;
    }

    body.tint = baseTint;
    const view: EntityView = { root, body, shadow, facing, hpBg, hpFill, outline, baseTint, kind };
    this.entityLayer.addChild(root);
    this.views.set(id, view);
    return view;
  }

  private updateEnemyView(world: World, id: number, view: EntityView, _alpha: number): void {
    const s = world.store;
    if (view.hpFill && view.hpBg) {
      const ratio = Math.max(0, s.hp[id]! / s.maxHp[id]!);
      const full = (view.hpBg.width as number) - 2;
      view.hpFill.width = full * ratio;
      view.hpFill.visible = ratio < 0.999;
      view.hpBg.visible = view.hpFill.visible;
    }
    // Stagger czytelny bez patrzenia na paski: przechylenie sylwetki.
    view.body.rotation = s.state[id] === EState.Staggered ? 0.22 : 0;
    view.root.alpha = s.breakWindow[id]! > 0 ? 0.75 + Math.sin(world.elapsed * 18) * 0.2 : 1;
  }

  private updatePlayerView(world: World, view: EntityView): void {
    const s = world.store;
    const p = world.player;
    const state = s.state[p]!;
    // I-frames widoczne wprost — gracz musi wiedzieć, dlaczego nie oberwał.
    if (world.playerInvulnerable) {
      view.body.alpha = 0.45;
      view.body.tint = 0xffffff;
    } else {
      view.body.alpha = 1;
      view.body.tint = s.hitFlash[p]! > 0 ? 0xffffff : view.baseTint;
    }
    view.root.visible = state !== PState.Dead || (world.elapsed * 6) % 2 < 1;
    view.body.rotation = state === PState.Dead ? 1.2 : state === PState.Hurt ? 0.18 : 0;
    if (state === PState.HeavyCharge) {
      const t = world.heavyChargeRatio;
      view.body.scale.set(1 + t * 0.12);
      view.body.tint = t >= 1 ? 0xffe066 : view.baseTint;
    } else {
      view.body.scale.set(1);
    }
  }

  // ─────────────────────────────────────────────────────── telegrafy

  /**
   * Telegrafy w przestrzeni świata. Kształt niesie informację (koło = AoE,
   * stożek = zamach, linia = szarża/pocisk) — nigdy sam kolor (GDD §10.3).
   */
  private updateTelegraphs(world: World, alpha: number): void {
    const s = world.store;
    let slot = 0;

    for (let i = 0; i < s.count && slot < this.telegraphs.length; i++) {
      if (!s.alive[i] || s.kind[i] !== Kind.Enemy) continue;
      if (s.state[i] !== EState.Telegraph) continue;
      const def = world.enemyDefs[s.defIdx[i]!];
      if (!def) continue;

      const g = this.telegraphs[slot++]!;
      g.visible = true;
      g.clear();

      const x = s.prevX[i]! + (s.x[i]! - s.prevX[i]!) * alpha;
      const y = s.prevY[i]! + (s.y[i]! - s.prevY[i]!) * alpha;
      const t = Math.min(1, s.stateTime[i]! / Math.max(0.001, s.stateDuration[i]!));
      const facing = s.facing[i]!;
      const color = COLORS.telegraph;

      if (def.attack.shape === "circle") {
        const r = def.attack.radiusMeters ?? def.attack.range;
        this.isoEllipse(g, x, y, r, { color, alpha: 0.16 }, { width: 2.5, alpha: 0.85 });
        this.isoEllipse(g, x, y, r * t, { color, alpha: 0.42 }, null);
      } else if (def.attack.shape === "cone") {
        const arc = ((def.attack.arcDeg ?? 100) * Math.PI) / 180;
        this.isoCone(g, x, y, facing, arc, def.attack.range, { color, alpha: 0.16 }, 0.85);
        this.isoCone(g, x, y, facing, arc, def.attack.range * t, { color, alpha: 0.4 }, 0);
      } else {
        const len = def.attack.chargeDistance ?? def.attack.range;
        const halfW = 0.55;
        this.isoQuad(g, x, y, facing, len, halfW, { color, alpha: 0.16 }, 0.85);
        this.isoQuad(g, x, y, facing, len * t, halfW, { color, alpha: 0.4 }, 0);
      }
    }

    for (; slot < this.telegraphs.length; slot++) {
      const g = this.telegraphs[slot]!;
      if (g.visible) {
        g.visible = false;
        g.clear();
      }
    }
  }

  private isoEllipse(
    g: Graphics,
    x: number,
    y: number,
    r: number,
    fill: { color: number; alpha: number },
    stroke: { width: number; alpha: number } | null,
  ): void {
    const pts: number[] = [];
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const wx = x + Math.cos(a) * r;
      const wy = y + Math.sin(a) * r;
      pts.push(isoX(wx, wy), isoY(wx, wy));
    }
    g.poly(pts).fill(fill);
    if (stroke) g.poly(pts).stroke({ width: stroke.width, color: fill.color, alpha: stroke.alpha });
  }

  private isoCone(
    g: Graphics,
    x: number,
    y: number,
    facing: number,
    arc: number,
    range: number,
    fill: { color: number; alpha: number },
    strokeAlpha: number,
  ): void {
    const pts: number[] = [isoX(x, y), isoY(x, y)];
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const a = facing - arc / 2 + (arc * i) / steps;
      const wx = x + Math.cos(a) * range;
      const wy = y + Math.sin(a) * range;
      pts.push(isoX(wx, wy), isoY(wx, wy));
    }
    g.poly(pts).fill(fill);
    if (strokeAlpha > 0) g.poly(pts).stroke({ width: 2.5, color: fill.color, alpha: strokeAlpha });
  }

  private isoQuad(
    g: Graphics,
    x: number,
    y: number,
    facing: number,
    len: number,
    halfW: number,
    fill: { color: number; alpha: number },
    strokeAlpha: number,
  ): void {
    const nx = Math.cos(facing);
    const ny = Math.sin(facing);
    const px = -ny * halfW;
    const py = nx * halfW;
    const corners: [number, number][] = [
      [x + px, y + py],
      [x + nx * len + px, y + ny * len + py],
      [x + nx * len - px, y + ny * len - py],
      [x - px, y - py],
    ];
    const pts: number[] = [];
    for (const [wx, wy] of corners) pts.push(isoX(wx, wy), isoY(wx, wy));
    g.poly(pts).fill(fill);
    if (strokeAlpha > 0) g.poly(pts).stroke({ width: 2.5, color: fill.color, alpha: strokeAlpha });
  }

  // ────────────────────────────────────────────────── liczby obrażeń

  /** Pooling + arc motion; kryty 1.4× większe, kolor wg typu (GDD §10.2). */
  spawnDamageNumber(value: number, x: number, y: number, crit: boolean, element: string): void {
    const slot = this.numbers.find((n) => !n.active);
    if (!slot) return;
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.vx = (Math.random() - 0.5) * 34;
    slot.vy = -78 - Math.random() * 24;
    slot.maxLife = crit ? 0.95 : 0.75;
    slot.life = slot.maxLife;
    slot.scale = crit ? 1.4 : 1;

    slot.text.text = Math.max(1, Math.round(value)).toString();
    slot.text.style = crit ? this.critStyle : this.numberStyle;
    slot.text.tint =
      element === "blocked"
        ? 0x8b93a3
        : element === "fire"
          ? 0xff8a3d
          : crit
            ? 0xffe066
            : 0xffffff;
    slot.text.visible = true;
    slot.text.scale.set(slot.scale);
  }

  private updateNumbers(dt: number): void {
    for (const n of this.numbers) {
      if (!n.active) continue;
      n.life -= dt;
      if (n.life <= 0) {
        n.active = false;
        n.text.visible = false;
        continue;
      }
      n.vy += 210 * dt;
      n.x += n.vx * dt * 0.02;
      const t = 1 - n.life / n.maxLife;
      n.text.x = isoX(n.x, n.y) + n.vx * t;
      n.text.y = isoY(n.x, n.y) - 46 + n.vy * t * 0.4;
      n.text.alpha = t < 0.15 ? t / 0.15 : Math.min(1, n.life / (n.maxLife * 0.45));
      n.text.scale.set(n.scale * (1 + (1 - n.life / n.maxLife) * 0.12));
    }
  }

  // ─────────────────────────────────────────────────────────── swing

  spawnSwing(x: number, y: number, facing: number, arc: number, range: number, heavy: boolean): void {
    const slot = this.swings.find((s) => !s.active);
    if (!slot) return;
    slot.active = true;
    slot.maxLife = heavy ? 0.26 : 0.16;
    slot.life = slot.maxLife;
    slot.g.visible = true;
    slot.g.clear();
    this.isoCone(
      slot.g,
      x,
      y,
      facing,
      arc,
      range,
      { color: heavy ? 0xffd166 : 0xffffff, alpha: 0.34 },
      0.9,
    );
  }

  private updateSwings(dt: number): void {
    for (const s of this.swings) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        s.g.visible = false;
        s.g.clear();
        continue;
      }
      s.g.alpha = s.life / s.maxLife;
    }
  }

  // ───────────────────────────────────── wskaźniki zagrożenia poza kadrem

  /** GDD §10.1: strzałki dla wrogów atakujących spoza kadru. */
  private updateThreatArrows(world: World, px: number, py: number): void {
    const s = world.store;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const margin = 40;
    let slot = 0;

    for (let i = 0; i < s.count && slot < this.threatArrows.length; i++) {
      if (!s.alive[i] || s.kind[i] !== Kind.Enemy) continue;
      const state = s.state[i]!;
      if (state !== EState.Telegraph && state !== EState.Attacking) continue;

      const sx = isoX(s.x[i]!, s.y[i]!) + this.worldRoot.x;
      const sy = isoY(s.x[i]!, s.y[i]!) + this.worldRoot.y;
      const outside = sx < 0 || sy < 0 || sx > w || sy > h;
      if (!outside) continue;

      const cx = isoX(px, py) + this.worldRoot.x;
      const cy = isoY(px, py) + this.worldRoot.y;
      const a = Math.atan2(sy - cy, sx - cx);
      // Rzut na prostokąt kadru, nie na elipsę — inaczej strzałki dla części
      // kątów lądują w środku ekranu zamiast przy krawędzi.
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const halfW = w / 2 - margin;
      const halfH = h / 2 - margin;
      const scale = Math.min(halfW / Math.max(Math.abs(dx), 1e-6), halfH / Math.max(Math.abs(dy), 1e-6));

      const arrow = this.threatArrows[slot++]!;
      arrow.visible = true;
      arrow.x = w / 2 + dx * scale;
      arrow.y = h / 2 + dy * scale;
      arrow.rotation = a;
    }
    for (; slot < this.threatArrows.length; slot++) this.threatArrows[slot]!.visible = false;
  }

  screenToWorldPoint(clientX: number, clientY: number, out: { x: number; y: number }): void {
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = clientX - rect.left - this.worldRoot.x;
    const sy = clientY - rect.top - this.worldRoot.y;
    const a = sx / ISO_W;
    const b = sy / ISO_H;
    out.x = (a + b) * 0.5;
    out.y = (b - a) * 0.5;
  }
}
