/**
 * Renderer 3D (Babylon.js 9) — **zamiennik `render/renderer.ts` o identycznym API**.
 *
 * To jest zwrot z inwestycji w rozdzielenie warstw: `packages/core` (cała logika
 * gry, walka, AI, ekonomia idle) nie wie o istnieniu renderera, a `game.ts`
 * dotyka go wyłącznie przez ten kontrakt. Podmiana silnika graficznego z PixiJS
 * na Babylona to zmiana jednego importu.
 *
 * Odwzorowanie osi:  świat 2D `(x, y)` → scena 3D `(x, 0, y)`.
 * Płaszczyzna areny to XZ, wysokość to Y. Sygnatury metod zachowują nazwy z 2D
 * (`spawnHitFx(x, y, …)`), bo zmiana ich na `z` wymusiłaby dotknięcie `game.ts`
 * bez żadnego zysku.
 *
 * Klimat robi `scene.ts` (światło, mgła, cienie, post-processing). Ten plik
 * odpowiada za to, żeby stan symulacji trafił na ekran — i za to, żeby robił to
 * w stałym budżecie klatki.
 */
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Scene } from "@babylonjs/core/scene";

/**
 * Importy efektów ubocznych Babylona.
 *
 * Silnik jest agresywnie podzielony pod tree-shaking: metody takie jak
 * `createPickingRay`, `createInstance` czy `thinInstanceSetBuffer` są
 * **doklejane do prototypów** przez osobne moduły. Bez ich zaimportowania kod
 * kompiluje się bez zastrzeżeń i **rzuca dopiero w czasie działania**.
 *
 * Objaw jest przy tym mylący: wyjątek w `screenToWorldPoint` przerywał
 * `render()` przed `scene.render()`, więc scena była zbudowana poprawnie,
 * kamera ustawiona — a ekran czarny. Komunikat siedział w konsoli od pierwszej
 * klatki (aa/docs/06 §3: czytaj log, zanim zaczniesz zmieniać kod).
 */
import "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Meshes/instancedMesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";

import { ARENA_RADIUS, damp, EState, Flag, Kind, PState, type World } from "@ms/core";
import { Camera3d } from "./camera3d.ts";
import { Particles3d } from "./particles3d.ts";
import { Overlay2d, type ThreatArrow } from "./overlay2d.ts";
import {
  buildScene,
  createEngine,
  PALETTE,
  type CameraMode,
  type Quality,
  type SceneBundle,
} from "./scene.ts";
import {
  bodyHeight,
  getBodyTemplate,
  planFromAppearance,
  scaleForRadius,
  toColor3,
  type BodyPlan,
} from "./bodies.ts";

/**
 * Paleta efektów. Zielona krew jest decyzją z wersji 2D i zostaje: czyta się
 * na ciemnym tle lepiej niż czerwona i nie konkuruje z czerwienią krytyka
 * ani z czerwienią telegrafów.
 */
const FX = {
  blood: [0x6fe04a, 0x4fbf2f, 0x9bf06a],
  bloodDark: 0x1e4d12,
  crit: 0xff2d2d,
  critBright: 0xff8a6a,
  spark: [0xfff3c4, 0xffd166, 0xffffff],
  death: 0xffffff,
  telegraph: 0xff5544,
} as const;

const RARITY_COLORS: Record<string, number> = {
  common: 0x9aa3b2,
  uncommon: 0x44c94a,
  rare: 0x4290ff,
  epic: 0xb96bff,
  legendary: 0xff8c00,
};

interface EntityView {
  root: Mesh | InstancedMesh | TransformNode;
  kind: number;
  /** Materiał błysku trafienia — instancje dzielą materiał, więc tu trzymamy własny. */
  height: number;
  templateKey: string;
  hpBar: Mesh | null;
  hpFill: Mesh | null;
  /** Cień kropelkowy — dysk pod postacią, przesunięty zgodnie ze słońcem. */
  blob: Mesh | null;
  /** Tułów postaci — osobno od korzenia, bo w marszu unosi się nad nogami. */
  torso: InstancedMesh | null;
  legL: InstancedMesh | null;
  legR: InstancedMesh | null;
  /** Faza cyklu kroku (radiany), wytłumiona amplituda i jej skala dla gatunku. */
  phase: number;
  swing: number;
  swingScale: number;
}

interface Shockwave {
  mesh: Mesh;
  active: boolean;
  life: number;
  maxLife: number;
  radius: number;
}

interface SwingVfx {
  mesh: Mesh;
  active: boolean;
  life: number;
  maxLife: number;
  grow: boolean;
}

/** Jakość dobierana raz przy starcie — patrz `pickQuality`. */
export type { Quality, CameraMode };

export class Renderer3d {
  engine!: AbstractEngine;
  scene!: Scene;
  camera!: Camera3d;

  private bundle!: SceneBundle;
  private particles!: Particles3d;
  private overlay!: Overlay2d;
  private quality: Quality = "high";
  /** Widok: TPP (domyślny) albo rzut 3/4. Ustawiany przed `init`. */
  cameraMode: CameraMode = "tpp";

  private views = new Map<number, EntityView>();
  private seen = new Set<number>();
  /**
   * Telegrafy w trzech kształtach. Kształt niesie informację (GDD §10.3):
   * koło = AoE wokół wroga, stożek = zamach, prostokąt = szarża/pocisk.
   * Zwinięcie ich do jednego koła sprawiało, że szarża na 10 m wyglądała
   * jak gigantyczne AoE — czytelność ataku znikała.
   */
  private telegraphs: { circle: Mesh; cone: Mesh; line: Mesh }[] = [];
  private shockwaves: Shockwave[] = [];
  private swings: SwingVfx[] = [];
  private arrows: ThreatArrow[] = [];

  /** Rozgrzane ostrze gracza — bryła emisyjna doklejana do sylwetki. */
  private bladeMesh: Mesh | null = null;
  private bladeMat: StandardMaterial | null = null;
  private bladeGlow = 0;

  /** Współdzielony materiał cieni kropelkowych — jeden na całą scenę. */
  private blobMat: StandardMaterial | null = null;
  private readonly glowMats = new Map<string, StandardMaterial>();

  private host!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private hitFlashDuration = 0.08;
  private elapsed = 0;

  // ────────────────────────────────────────────────────────────── start

  async init(
    host: HTMLElement,
    feel: {
      shakeDecay: number;
      shakeMaxAmplitudePx: number;
      cameraKickReturn: number;
      hitFlashDuration: number;
    },
  ): Promise<void> {
    this.host = host;
    this.hitFlashDuration = feel.hitFlashDuration;
    this.quality = pickQuality();

    this.canvas = document.createElement("canvas");
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.touchAction = "none";
    this.canvas.style.outline = "none";
    host.appendChild(this.canvas);
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    this.engine = await createEngine(this.canvas);

    /*
     * Renderowanie w niższej rozdzielczości na słabym sprzęcie.
     *
     * Koszt sceny jest liniowy w pikselach (patrz profil w `scene.ts`), więc
     * współczynnik 1.8 tnie go ponad trzykrotnie. Przy stylizowanej grafice
     * bez tekstur strata ostrości jest znacznie mniej dotkliwa niż spadek
     * płynności — a to jest różnica między „gra chodzi" a „gra się zacina".
     *
     * `getHardwareScalingLevel()` jest już uwzględniony w rzutowaniu punktów
     * na ekran (`projectPoint`), więc liczby obrażeń trzymają się celów.
     */
    if (this.quality === "minimal") this.engine.setHardwareScalingLevel(1.8);
    else if (this.quality === "low") this.engine.setHardwareScalingLevel(1.25);

    this.bundle = buildScene(this.engine, this.quality, this.cameraMode);
    this.scene = this.bundle.scene;

    this.camera = new Camera3d(feel.shakeDecay, feel.shakeMaxAmplitudePx, feel.cameraKickReturn);
    this.particles = new Particles3d(this.scene);
    this.overlay = new Overlay2d(host);

    this.buildPools();

    window.addEventListener("resize", this.onResize);
    this.onResize();

    // Samokontrola po dwóch sekundach — patrz `selfCheck`.
    setTimeout(() => this.selfCheck(), 2000);
  }

  /**
   * Jednorazowa kontrola: czy scena naprawdę coś narysowała.
   *
   * Czarny ekran przy działającym HUD-zie jest **niemy** — pętla gry żyje,
   * liczby obrażeń lecą, konsola milczy, a gracz nie ma pojęcia, co zgłosić.
   * Ta funkcja zamienia go w konkretny komunikat: jaki silnik, jaki próg
   * jakości, ile siatek aktywnych, jaka jasność kadru.
   *
   * Sprawdzenie jest **jednorazowe i po dwóch sekundach**, bo odczyt pikseli
   * z GPU wymusza synchronizację potoku — w pętli byłby nie do przyjęcia,
   * raz na sesję kosztuje tyle, co jedna klatka.
   */
  private selfCheck(): void {
    try {
      const active = this.scene.getActiveMeshes().length;
      const brightness = this.sampleBrightness();
      const info = {
        silnik: this.engine.constructor.name,
        jakosc: this.quality,
        canvas: `${this.canvas.width}×${this.canvas.height}`,
        aktywneSiatki: active,
        jasnoscKadru: brightness,
      };

      // Kadr niemal czarny ORAZ brak aktywnych siatek = scena nic nie rysuje.
      // Sam ciemny kadr to za mało: gra jest z założenia mroczna.
      if (active > 0 && brightness > 1.5) return;

      console.error(
        "[render3d] scena nic nie narysowała.",
        info,
        "\nSpróbuj innego progu jakości: ?quality=low albo ?quality=minimal",
      );
      this.showFailurePanel(info);
    } catch (err) {
      console.warn("[render3d] samokontrola nieudana", err);
    }
  }

  /** Średnia jasność środka kadru, 0–255. `-1` gdy nie da się odczytać. */
  private sampleBrightness(): number {
    const probe = document.createElement("canvas");
    probe.width = 32;
    probe.height = 24;
    const ctx = probe.getContext("2d");
    if (!ctx) return -1;
    try {
      ctx.drawImage(this.canvas, 0, 0, 32, 24);
      const data = ctx.getImageData(0, 0, 32, 24).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i]! + data[i + 1]! + data[i + 2]!;
      return Math.round((sum / (data.length / 4) / 3) * 10) / 10;
    } catch {
      // `preserveDrawingBuffer: false` albo canvas splamiony — brak odczytu.
      return -1;
    }
  }

  /**
   * Widoczny panel awarii. Gracz nie otwiera konsoli — a bez informacji
   * z jego strony diagnoza czarnego ekranu to zgadywanie.
   */
  private showFailurePanel(info: Record<string, unknown>): void {
    const box = document.createElement("div");
    box.setAttribute("data-render-failure", "1");
    box.style.cssText = [
      "position:fixed", "left:50%", "top:16px", "transform:translateX(-50%)",
      "z-index:9999", "max-width:min(560px,92vw)", "pointer-events:auto",
      "background:#12161f", "border:1px solid #7a2f2f", "border-radius:12px",
      "padding:14px 18px", "color:#e6ecf5", "font:13px/1.5 system-ui,sans-serif",
      "box-shadow:0 20px 50px rgba(0,0,0,.6)",
    ].join(";");
    box.innerHTML =
      `<strong style="color:#ff9c9c">Scena 3D nic nie narysowała</strong>` +
      `<div style="margin:.5em 0;color:#93a0b5">Gra działa — problem dotyczy warstwy graficznej.</div>` +
      `<pre style="margin:.5em 0;font-size:12px;background:#0b0e14;padding:8px;border-radius:6px;overflow:auto">` +
      Object.entries(info).map(([k, v]) => `${k}: ${String(v)}`).join("\n") +
      `</pre><div style="color:#93a0b5">Spróbuj: <code>?quality=low</code> albo <code>?quality=minimal</code></div>`;
    document.body.appendChild(box);
  }

  private onResize = (): void => {
    this.engine.resize();
    this.bundle.resize();
    this.overlay.resize();
  };

  private buildPools(): void {
    // — telegrafy: dyski leżące na ziemi; kształt niesie informację (GDD §10.3),
    //   więc stożek i linia mają własne bryły, a nie tylko inny kolor.
    for (let i = 0; i < 14; i++) {
      const mat = new StandardMaterial(`tg${i}`, this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = toColor3(FX.telegraph);
      mat.alpha = 0.35;
      mat.backFaceCulling = false;
      mat.zOffset = -4;

      const mk = (mesh: Mesh): Mesh => {
        mesh.rotation.x = Math.PI / 2;
        mesh.material = mat;
        mesh.isPickable = false;
        mesh.setEnabled(false);
        return mesh;
      };

      this.telegraphs.push({
        circle: mk(CreateDisc(`tgc${i}`, { radius: 1, tessellation: 36 }, this.scene)),
        // Wycinek 0.28 obrotu ≈ 100° — typowy łuk zamachu wroga.
        cone: mk(CreateDisc(`tgn${i}`, { radius: 1, tessellation: 28, arc: 0.28 }, this.scene)),
        line: mk(CreatePlane(`tgl${i}`, { width: 1, height: 1 }, this.scene)),
      });
    }

    // — fale uderzeniowe: torus o promieniu 1, animowany wyłącznie skalą.
    //   Ta sama zasada, co po naprawie wydajności w 2D: narysuj raz, animuj
    //   transformacją (patrz aa/docs/08 §1).
    for (let i = 0; i < 10; i++) {
      const mat = new StandardMaterial(`sw${i}`, this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = Color3.White();
      mat.alpha = 0.9;

      const mesh = CreateTorus(`swm${i}`, { diameter: 2, thickness: 0.09, tessellation: 44 }, this.scene);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.shockwaves.push({ mesh, active: false, life: 0, maxLife: 0.4, radius: 1 });
    }

    // — ślad zamachu: płaski wycinek nad ziemią
    for (let i = 0; i < 12; i++) {
      const mat = new StandardMaterial(`sg${i}`, this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = Color3.White();
      mat.alpha = 0.4;
      mat.backFaceCulling = false;
      mat.zOffset = -3;

      const mesh = CreateDisc(`sgm${i}`, { radius: 1, tessellation: 24, arc: 0.4 }, this.scene);
      mesh.rotation.x = Math.PI / 2;
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.swings.push({ mesh, active: false, life: 0, maxLife: 0.18, grow: false });
    }
  }

  destroy(): void {
    window.removeEventListener("resize", this.onResize);
    this.particles?.dispose();
    this.overlay?.dispose();
    this.scene?.dispose();
    this.engine?.dispose();
    this.canvas?.remove();
  }

  // ───────────────────────────────────────────────────────── synchronizacja

  sync(world: World, alpha: number, dt: number): void {
    const s = world.store;
    this.elapsed = world.elapsed;

    const p = world.player;
    const px = s.prevX[p]! + (s.x[p]! - s.prevX[p]!) * alpha;
    const py = s.prevY[p]! + (s.y[p]! - s.prevY[p]!) * alpha;

    this.camera.follow(px, py, dt);
    // Kamera TPP obraca się za postacią; w rzucie 3/4 kąt jest stały i `yaw`
    // jest ignorowany przez `lookAtWorld`.
    this.camera.followYaw(s.facing[p]!, dt);
    this.camera.update(dt);
    this.bundle.lookAtWorld(
      this.camera.x,
      this.camera.z,
      this.camera.offsetX,
      this.camera.offsetZ,
      this.camera.yaw,
    );

    this.syncEntities(world, alpha, dt);
    this.syncTelegraphs(world, alpha);
    this.updateShockwaves(dt);
    this.updateSwings(dt);
    this.updateBlade(world, dt);
    this.particles.update(dt);
    this.syncArrows(world, px, py);

    // Rant areny oddycha — dwa okresy, żeby puls nie był metronomem.
    const rimMat = this.bundle.arenaRim.material as StandardMaterial | null;
    if (rimMat) {
      const k = 0.5 + Math.sin(this.elapsed * 1.1) * 0.16 + Math.sin(this.elapsed * 2.7) * 0.08;
      rimMat.emissiveColor = toColor3(PALETTE.rim).scale(k);
    }

    this.overlay.update(dt, this.projectPoint);
    this.scene.render();
  }

  /** Rzut punktu świata na piksele ekranu — dla nakładki 2D. */
  private projectPoint = (x: number, y: number, z: number): { sx: number; sy: number } | null => {
    const v = Vector3.Project(
      new Vector3(x, y, z),
      Matrix.Identity(),
      this.scene.getTransformMatrix(),
      this.bundle.camera.viewport.toGlobal(
        this.engine.getRenderWidth(),
        this.engine.getRenderHeight(),
      ),
    );
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
    const dpr = this.engine.getHardwareScalingLevel();
    return { sx: v.x * dpr, sy: v.y * dpr };
  };

  private syncEntities(world: World, alpha: number, dt: number): void {
    const s = world.store;
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
      const root = view.root;

      root.position.set(x, 0, y);
      if (view.blob) {
        // Przesunięcie zgodne z kierunkiem słońca (−0.55, −1, 0.42) rzutowanym
        // na płaszczyznę areny — cień pada w tę samą stronę co w rzeczywistości.
        view.blob.position.set(x + 0.34, 0.09, y - 0.26);
      }
      // Sylwetka obraca się wokół pionu w stronę patrzenia, a nogi chodzą
      // w rytmie faktycznej prędkości — reszta ekspresji nadal idzie przez
      // skalę, przechył i błysk (README §Postacie).
      root.rotation.y = -s.facing[i]! + Math.PI / 2;
      if (view.legL) this.animateLegs(view, s.vx[i]!, s.vy[i]!, dt);

      if (kind === Kind.Enemy) this.syncEnemy(world, i, view);
      else if (kind === Kind.Player) this.syncPlayer(world, view);
      else if (kind === Kind.Pickup) {
        root.position.y = 0.5 + Math.sin(this.elapsed * 4 + i) * 0.12;
        root.rotation.y += this.elapsed * 0.8;
      } else if (kind === Kind.Hazard) {
        root.position.y = 0.04;
      }
    }

    for (const [id, view] of this.views) {
      if (this.seen.has(id)) continue;
      this.releaseView(view);
      this.views.delete(id);
    }
  }

  private getView(world: World, id: number, kind: number): EntityView | null {
    const existing = this.views.get(id);
    if (existing && existing.kind === kind) return existing;
    if (existing) {
      // Identyfikatory wracają do puli: id zabitego wroga bywa zaraz id sztabki
      // złota. Zwalniamy **cały** widok — sam korzeń zostawiał osierocony cień,
      // który leżał na arenie do końca sesji.
      this.releaseView(existing);
      this.views.delete(id);
    }

    const s = world.store;
    const radius = s.radius[id]! || 0.42;
    let root: Mesh | InstancedMesh | TransformNode;
    let hpBar: Mesh | null = null;
    let hpFill: Mesh | null = null;
    let blob: Mesh | null = null;
    let torso: InstancedMesh | null = null;
    let legL: InstancedMesh | null = null;
    let legR: InstancedMesh | null = null;
    let swingScale = 1;
    let plan: BodyPlan | undefined;
    let templateKey = "";
    let bodyId = "player";

    if (kind === Kind.Player || kind === Kind.Enemy) {
      const charId = kind === Kind.Player ? "player" : (world.enemyDefs[s.defIdx[id]!]?.id ?? "player");
      const tint =
        kind === Kind.Player ? 0x7fd8ff : (world.enemyDefs[s.defIdx[id]!]?.color ?? 0xcccccc);
      templateKey = `${charId}|${tint}`;

      bodyId = charId;
      // Potwory proceduralne przynoszą własny opis wyglądu; ręczny roster
      // korzysta z tablicy `PLANS` po stronie klienta.
      const look = world.enemyDefs[s.defIdx[id]!]?.appearance;
      plan = look ? planFromAppearance(look) : undefined;
      const rig = this.makeRig(charId, tint, `e${id}`, plan);
      root = rig.root;
      torso = rig.torso;
      legL = rig.legL;
      legR = rig.legR;
      swingScale = rig.swingScale;
      root.scaling.setAll(scaleForRadius(radius));
      blob = this.makeBlobShadow(id, radius);

      if (kind === Kind.Enemy) {
        const height = bodyHeight(charId, radius, plan);
        hpBar = this.makeHpBar(id, radius, height, false);
        hpFill = this.makeHpBar(id, radius, height, true);
        if (s.hasFlag(id, Flag.Elite) || s.hasFlag(id, Flag.Boss)) {
          const ring = CreateTorus(`ring${id}`, { diameter: radius * 2.6, thickness: 0.07, tessellation: 28 }, this.scene);
          ring.material = this.glowMat(s.hasFlag(id, Flag.Boss) ? 0xff3b30 : 0xffc83d);
          ring.parent = root;
          ring.position.y = 0.06;
          ring.isPickable = false;
        }
      }
    } else if (kind === Kind.Projectile) {
      const bolt = CreateCylinder(`pr${id}`, { diameter: radius * 1.6, height: radius * 1.6, tessellation: 8 }, this.scene);
      bolt.material = this.glowMat(0xffd8a8);
      bolt.position.y = 0.8;
      bolt.isPickable = false;
      root = bolt;
    } else if (kind === Kind.Pickup) {
      const payload = world.pickups.get(id);
      const hex =
        payload?.type === "gold"
          ? 0xffc94a
          : payload?.type === "potion"
            ? 0xff5f7a
            : (RARITY_COLORS[payload?.item?.rarity ?? "common"] ?? 0xffffff);

      const shard = CreateCylinder(`pk${id}`, { diameterTop: 0, diameterBottom: 0.36, height: 0.5, tessellation: 4 }, this.scene);
      shard.material = this.glowMat(hex);
      shard.isPickable = false;
      root = shard;

      // Słup światła nad rzadkim łupem (GDD §10.2) — w 3D czyta się dużo
      // mocniej niż płaski pasek w 2D.
      if (payload?.item && (payload.item.rarity === "epic" || payload.item.rarity === "legendary")) {
        const beam = CreatePlane(`bm${id}`, { width: 0.5, height: 7 }, this.scene);
        beam.material = this.glowMat(hex, 0.2, true);
        beam.parent = shard;
        beam.position.y = 3.4;
        beam.billboardMode = Mesh.BILLBOARDMODE_Y;
        beam.isPickable = false;
      }
    } else if (kind === Kind.Hazard) {
      const pool = CreateDisc(`hz${id}`, { radius, tessellation: 24 }, this.scene);
      pool.rotation.x = Math.PI / 2;
      pool.material = this.glowMat(0x7bd44f, 0.5);
      pool.isPickable = false;
      root = pool;
    } else if (kind === Kind.Decoy) {
      const rig = this.makeRig("player", 0x9fb8ff, `dc${id}`);
      root = rig.root;
      torso = rig.torso;
      legL = rig.legL;
      legR = rig.legR;
      swingScale = rig.swingScale;
      root.scaling.setAll(scaleForRadius(radius));
      blob = this.makeBlobShadow(id, radius);
    } else {
      return null;
    }

    const view: EntityView = {
      root,
      kind,
      height: bodyHeight(bodyId, radius, plan),
      templateKey,
      hpBar,
      hpFill,
      blob,
      torso,
      legL,
      legR,
      // Losowa faza startowa: bez niej cały pakiet wrogów maszeruje w idealnym
      // unisono i wygląda jak defilada, nie jak wataha.
      phase: Math.random() * Math.PI * 2,
      swing: 0,
      swingScale,
    };
    this.views.set(id, view);
    return view;
  }

  /**
   * Postać jako węzeł z trzema instancjami: tułów plus dwie nogi zamontowane
   * na wysokości biodra. Korzeń jest `TransformNode`, więc pozycja, obrót
   * i skala z `syncEntities` dalej sterują całością — animacja nóg dokłada
   * tylko lokalny obrót, którego skala korzenia nie psuje.
   */
  private makeRig(charId: string, tint: number, name: string, plan?: BodyPlan): {
    root: TransformNode;
    torso: InstancedMesh;
    legL: InstancedMesh | null;
    legR: InstancedMesh | null;
    swingScale: number;
  } {
    const t = getBodyTemplate(this.scene, charId, tint, plan);
    const root = new TransformNode(name, this.scene);

    const torso = t.body.createInstance(`${name}t`);
    torso.parent = root;
    torso.isPickable = false;

    const mount = (src: Mesh | null, suffix: string): InstancedMesh | null => {
      if (!src) return null;
      const leg = src.createInstance(`${name}${suffix}`);
      leg.parent = root;
      leg.position.y = t.hipY;
      leg.isPickable = false;
      return leg;
    };

    return {
      root,
      torso,
      legL: mount(t.legL, "l"),
      legR: mount(t.legR, "r"),
      swingScale: t.swingScale,
    };
  }

  /**
   * Animacja marszu. Faza rośnie z **przebytą drogą**, nie z czasem — dzięki
   * temu długość kroku jest stała i nogi nie ślizgają się po ziemi przy zmianie
   * prędkości. Amplituda dochodzi do zera z tłumieniem, więc zatrzymanie
   * wygasza krok zamiast ucinać go w połowie wymachu.
   */
  private animateLegs(view: EntityView, vx: number, vz: number, dt: number): void {
    if (!view.legL || !view.legR) return;

    const speed = Math.hypot(vx, vz);
    view.phase += speed * dt * 3.6;
    // Sufit 0.42 rad to ~24° na nogę. Wyżej sylwetka robi wypady zamiast kroków —
    // chód człowieka wychyla udo o mniej więcej tyle i oko to wychwytuje.
    view.swing = damp(view.swing, Math.min(0.42, speed * 0.14) * view.swingScale, 9, dt);

    const swing = Math.sin(view.phase) * view.swing;
    view.legL.rotation.x = swing;
    view.legR.rotation.x = -swing;
    // Tułów unosi się dwa razy na cykl — w chwilach, gdy nogi są złączone.
    if (view.torso) view.torso.position.y = Math.abs(Math.cos(view.phase)) * view.swing * 0.08;
  }

  /**
   * Zwolnienie widoku. Nigdzie nie przekazujemy `disposeMaterialAndTextures`:
   * każdy materiał tutaj jest współdzielony — przez szablon ciała, przez
   * wszystkie cienie, przez wszystkie paski HP. Kasowanie go razem z jedną
   * siatką zabierało go pozostałym, które spadały na domyślny biały materiał
   * Babylona (stąd białe cienie i „metalowi" wrogowie po pierwszej śmierci).
   */
  private releaseView(view: EntityView): void {
    view.hpBar?.dispose();
    view.hpFill?.dispose();
    view.blob?.dispose();
    view.root.dispose();
  }

  /**
   * Cień kropelkowy. Jeden materiał na całą scenę, dysk o promieniu 1 skalowany
   * do rozmiaru postaci — koszt jest pomijalny, a efekt osadzenia na ziemi
   * dokładnie taki, jakiego oczekuje oko przy kamerze 3/4.
   */
  /**
   * Materiał świecący, współdzielony per (kolor, alfa). Wcześniej każdy pocisk,
   * łup i pasek HP tworzył własny — a że widok zwalniał materiał razem z siatką,
   * wystarczyła jedna śmierć, żeby zabrać go innym. Wspólny cache zamyka tę
   * furtkę: nic w `releaseView` nie kasuje już materiałów.
   */
  private glowMat(hex: number, alpha = 1, twoSided = false): StandardMaterial {
    const key = `${hex}|${alpha}|${twoSided}`;
    const cached = this.glowMats.get(key);
    if (cached) return cached;

    const m = new StandardMaterial(`glow_${key}`, this.scene);
    m.disableLighting = true;
    // `disableLighting` zwraca `emissive + diffuse`, a domyślny diffuse jest
    // biały — bez wyzerowania każdy kolor jechałby w stronę bieli.
    m.diffuseColor = Color3.Black();
    m.emissiveColor = toColor3(hex);
    if (alpha < 1) m.alpha = alpha;
    if (twoSided) m.backFaceCulling = false;
    m.freeze();
    this.glowMats.set(key, m);
    return m;
  }

  private makeBlobShadow(id: number, radius: number): Mesh {
    if (!this.blobMat) {
      this.blobMat = new StandardMaterial("blobmat", this.scene);
      this.blobMat.disableLighting = true;
      // `disableLighting` podstawia za oświetlenie jedynkę, więc wynik to
      // `diffuseColor`. Domyślny diffuse jest BIAŁY — bez tej linii cienie
      // wychodziły jasnymi plamami. Ten sam błąd co przy cząstkach.
      this.blobMat.diffuseColor = Color3.Black();
      this.blobMat.emissiveColor = Color3.Black();
      this.blobMat.alpha = 0.55;
      this.blobMat.zOffset = -2;
      this.blobMat.freeze();
    }
    const mesh = CreateDisc(`blob${id}`, { radius: 1, tessellation: 16 }, this.scene);
    mesh.rotation.x = Math.PI / 2;
    mesh.material = this.blobMat;
    mesh.isPickable = false;
    mesh.scaling.set(radius * 1.5, 1, radius * 1.15);
    return mesh;
  }

  private makeHpBar(id: number, radius: number, height: number, fill: boolean): Mesh {
    const w = Math.max(0.7, radius * 2.4);
    const mesh = CreatePlane(`hp${fill ? "f" : "b"}${id}`, { width: w, height: 0.11 }, this.scene);
    mesh.material = fill ? this.glowMat(0xe0433d) : this.glowMat(0x000000, 0.65);
    // Billboard: pasek zawsze zwrócony do kamery, niezależnie od obrotu postaci.
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.position.y = height + 0.35;
    mesh.isPickable = false;
    mesh.renderingGroupId = 1;
    return mesh;
  }

  private syncEnemy(world: World, id: number, view: EntityView): void {
    const s = world.store;
    const root = view.root;

    if (view.hpBar && view.hpFill) {
      const ratio = Math.max(0, s.hp[id]! / s.maxHp[id]!);
      const visible = ratio < 0.999;
      view.hpBar.setEnabled(visible);
      view.hpFill.setEnabled(visible);
      if (visible) {
        view.hpBar.position.set(root.position.x, view.height + 0.35, root.position.z);
        view.hpFill.position.copyFrom(view.hpBar.position);
        view.hpFill.position.y += 0.001;
        // Skalujemy w osi X i przesuwamy o połowę ubytku, żeby pasek kurczył
        // się od prawej, a nie do środka.
        const w = (view.hpBar.scaling.x = 1);
        view.hpFill.scaling.x = ratio;
        view.hpFill.position.x -= 0;
        void w;
      }
    }

    // Stagger czytelny bez patrzenia na paski: przechył sylwetki.
    root.rotation.z = s.state[id] === EState.Staggered ? 0.24 : 0;

    // Okno przełamania: pulsowanie skalą zamiast alfy — instancje dzielą
    // materiał z szablonem, więc zmiana alfy dotknęłaby wszystkich wrogów typu.
    const breaking = s.breakWindow[id]! > 0;
    const flash = s.hitFlash[id]! > 0 ? 1 + (s.hitFlash[id]! / this.hitFlashDuration) * 0.12 : 1;
    const pulse = breaking ? 1 + Math.sin(this.elapsed * 18) * 0.06 : 1;
    root.scaling.setAll(scaleForRadius(s.radius[id]! || 0.42) * flash * pulse);
  }

  private syncPlayer(world: World, view: EntityView): void {
    const s = world.store;
    const p = world.player;
    const state = s.state[p]!;
    const root = view.root;

    root.setEnabled(state !== PState.Dead || (this.elapsed * 6) % 2 < 1);
    root.rotation.z = state === PState.Dead ? 1.3 : state === PState.Hurt ? 0.2 : 0;

    const base = scaleForRadius(s.radius[p]! || 0.42);
    if (state === PState.HeavyCharge) {
      root.scaling.setAll(base * (1 + world.heavyChargeRatio * 0.14));
    } else {
      root.scaling.setAll(base);
    }
  }

  // ───────────────────────────────────────────────────────────── telegrafy

  /**
   * Telegrafy w przestrzeni świata. Kształt niesie informację (koło = AoE,
   * stożek = zamach, linia = szarża) — nigdy sam kolor (GDD §10.3).
   * W 3D leżą na ziemi, więc odczyt zasięgu jest jednoznaczny.
   */
  private syncTelegraphs(world: World, alpha: number): void {
    const s = world.store;
    let slot = 0;

    for (let i = 0; i < s.count && slot < this.telegraphs.length; i++) {
      if (!s.alive[i] || s.kind[i] !== Kind.Enemy) continue;
      if (s.state[i] !== EState.Telegraph) continue;
      const def = world.enemyDefs[s.defIdx[i]!];
      if (!def) continue;

      const set = this.telegraphs[slot++]!;
      const x = s.prevX[i]! + (s.x[i]! - s.prevX[i]!) * alpha;
      const y = s.prevY[i]! + (s.y[i]! - s.prevY[i]!) * alpha;
      const t = Math.min(1, s.stateTime[i]! / Math.max(0.001, s.stateDuration[i]!));
      const facing = s.facing[i]!;
      const shape = def.attack.shape;

      set.circle.setEnabled(shape === "circle");
      set.cone.setEnabled(shape === "cone");
      set.line.setEnabled(shape === "line");

      // Wypełnienie rośnie z czasem ładowania — gracz odczytuje, ile ma na unik.
      const grow = 0.25 + t * 0.75;

      if (shape === "circle") {
        const r = def.attack.radiusMeters ?? def.attack.range;
        set.circle.position.set(x, 0.05, y);
        set.circle.scaling.set(r * grow, 1, r * grow);
      } else if (shape === "cone") {
        const r = def.attack.range;
        set.cone.position.set(x, 0.05, y);
        // Dysk z wycinkiem startuje od kąta 0 — obracamy o pół łuku, żeby
        // środek wycinka pokrył się z kierunkiem patrzenia wroga.
        set.cone.rotation.y = -facing - 0.28 * Math.PI + Math.PI / 2;
        set.cone.scaling.set(r * grow, 1, r * grow);
      } else {
        const len = def.attack.chargeDistance ?? def.attack.range;
        // Prostokąt kotwiczony w środku, więc przesuwamy go o pół długości
        // w kierunku szarży — pas ma zaczynać się na wrogu, nie otaczać go.
        const half = (len * grow) / 2;
        set.line.position.set(x + Math.cos(facing) * half, 0.05, y + Math.sin(facing) * half);
        set.line.rotation.y = -facing;
        set.line.scaling.set(len * grow, 1.1, 1);
      }

      const mat = set.circle.material as StandardMaterial;
      mat.alpha = 0.18 + t * 0.26;
    }

    for (; slot < this.telegraphs.length; slot++) {
      const set = this.telegraphs[slot]!;
      set.circle.setEnabled(false);
      set.cone.setEnabled(false);
      set.line.setEnabled(false);
    }
  }

  // ──────────────────────────────────────────────────────────── efekty

  /**
   * Ślad zamachu. Krytyk dostaje czerwoną, rosnącą wersję — ma być rozpoznawalny
   * kątem oka, bez czytania liczby obrażeń.
   */
  spawnSwing(
    x: number,
    y: number,
    facing: number,
    arc: number,
    range: number,
    heavy: boolean,
    crit = false,
  ): void {
    const slot = this.swings.find((s) => !s.active);
    if (!slot) return;

    slot.active = true;
    slot.maxLife = crit ? 0.32 : heavy ? 0.26 : 0.16;
    slot.life = slot.maxLife;
    slot.grow = crit;

    const mat = slot.mesh.material as StandardMaterial;
    mat.emissiveColor = toColor3(crit ? FX.crit : heavy ? 0xffd166 : 0xffffff);
    mat.alpha = crit ? 0.55 : 0.4;

    slot.mesh.setEnabled(true);
    slot.mesh.position.set(x, 0.12, y);
    // Dysk z wycinkiem `arc` startuje od kąta 0, więc obracamy go o pół łuku,
    // żeby środek wycinka pokrył się z kierunkiem patrzenia.
    slot.mesh.rotation.y = -facing - (arc * Math.PI) / 2 + Math.PI / 2;
    slot.mesh.scaling.setAll(range);
  }

  private updateSwings(dt: number): void {
    for (const s of this.swings) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        s.mesh.setEnabled(false);
        continue;
      }
      const t = s.life / s.maxLife;
      const mat = s.mesh.material as StandardMaterial;
      mat.alpha = t * (s.grow ? 0.55 : 0.4);
      if (s.grow) s.mesh.scaling.scaleInPlace(1 + dt * 0.6);
    }
  }

  /**
   * Trafienie wroga: zielona krew zgodnie z ciosem, iskry przeciwnie.
   * `power` (0–1.5) skaluje ilość i zasięg — dobicie ma wyglądać mocniej
   * niż draśnięcie.
   */
  spawnHitFx(x: number, y: number, angle: number, crit: boolean, power = 0.5): void {
    const p = Math.max(0.15, Math.min(1.5, power));

    this.particles.burst({
      x, z: y, y: 1.0,
      count: Math.round((crit ? 16 : 9) * p),
      angle, spread: crit ? 1.5 : 1.1,
      speed: (crit ? 6.5 : 4.4) * p, speedVariance: 0.9,
      lift: 4.4 * p, liftVariance: 0.8,
      color: FX.blood,
      size: crit ? 0.16 : 0.12,
      life: 0.8, gravity: 14, drag: 0.35,
      decal: true, decalColor: FX.bloodDark,
    });

    this.particles.burst({
      x, z: y, y: 1.15,
      count: Math.round(5 * p),
      spread: Math.PI * 2, speed: 1.3,
      lift: 1.6, color: FX.blood,
      size: 0.2, life: 0.4, gravity: 3, drag: 0.2, shrink: true,
    });

    this.particles.burst({
      x, z: y, y: 1.05,
      count: crit ? 12 : 6,
      angle: angle + Math.PI, spread: 1.4,
      speed: 7.5, lift: 5.2,
      color: crit ? [FX.crit, FX.critBright, 0xffffff] : FX.spark,
      size: 0.07, life: 0.3, gravity: 18, drag: 0.25,
      streak: true, shrink: true,
    });

    if (crit) {
      this.shockwave(x, y, 2.1, FX.crit, 0.34);
      this.bladeGlow = 1;
    }
  }

  /** Śmierć wroga — wyraźnie mocniejsza od trafienia, bo to nagroda. */
  spawnDeathFx(x: number, y: number, tint: number, big = false): void {
    const scale = big ? 1.8 : 1;
    this.shockwave(x, y, 2.6 * scale, FX.death, 0.42);
    this.particles.splat(x, y, 1.1 * scale, FX.bloodDark, 0.36, 16);

    this.particles.burst({
      x, z: y, y: 0.9,
      count: Math.round(22 * scale), spread: Math.PI * 2,
      speed: 5.2 * scale, lift: 6.4,
      color: FX.blood, size: 0.14, life: 0.9,
      gravity: 15, drag: 0.35, decal: true, decalColor: FX.bloodDark,
    });

    this.particles.burst({
      x, z: y, y: 1.1,
      count: Math.round(12 * scale), spread: Math.PI * 2,
      speed: 4.2 * scale, lift: 7,
      color: tint, size: 0.1, life: 0.75,
      gravity: 17, drag: 0.4, shrink: true,
    });
  }

  /** Rozbłysk przy awansie tieru combo — w kolorze tieru, nad graczem. */
  spawnComboBurst(x: number, y: number, color: number): void {
    this.shockwave(x, y, 1.8, color, 0.36);
    this.particles.burst({
      x, z: y, y: 1.8,
      count: 18, spread: Math.PI * 2,
      speed: 4, lift: 4.6, color,
      size: 0.11, life: 0.6, gravity: 9, drag: 0.4, shrink: true,
    });
  }

  private shockwave(x: number, y: number, radius: number, color: number, life: number): void {
    const slot = this.shockwaves.find((s) => !s.active);
    if (!slot) return;
    slot.active = true;
    slot.life = life;
    slot.maxLife = life;
    slot.radius = radius;
    (slot.mesh.material as StandardMaterial).emissiveColor = toColor3(color);
    slot.mesh.setEnabled(true);
    slot.mesh.position.set(x, 0.12, y);
    slot.mesh.scaling.setAll(0.05);
  }

  private updateShockwaves(dt: number): void {
    for (const s of this.shockwaves) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        s.mesh.setEnabled(false);
        continue;
      }
      const t = 1 - s.life / s.maxLife;
      // easeOutQuad — pierścień wystrzeliwuje i zwalnia.
      const r = s.radius * (1 - (1 - t) * (1 - t));
      s.mesh.scaling.setAll(Math.max(0.05, r * 0.5));
      (s.mesh.material as StandardMaterial).alpha = 0.9 * (1 - t);
    }
  }

  /**
   * Rozgrzane ostrze po krytyku. W 2D była to nakładka rysowana na sylwetce;
   * w 3D jest to bryła emisyjna doklejona do postaci — świeci naprawdę,
   * bo `GlowLayer` ją rozmywa i rozjaśnia otoczenie.
   */
  private updateBlade(world: World, dt: number): void {
    if (this.bladeGlow <= 0) {
      this.bladeMesh?.setEnabled(false);
      return;
    }
    this.bladeGlow = Math.max(0, this.bladeGlow - dt / 0.45);

    if (!this.bladeMesh) {
      this.bladeMesh = CreatePlane("blade", { width: 0.24, height: 1.5 }, this.scene);
      this.bladeMat = new StandardMaterial("blademat", this.scene);
      this.bladeMat.disableLighting = true;
      this.bladeMat.emissiveColor = toColor3(FX.crit);
      this.bladeMat.backFaceCulling = false;
      this.bladeMesh.material = this.bladeMat;
      this.bladeMesh.isPickable = false;
      this.bladeMesh.billboardMode = Mesh.BILLBOARDMODE_Y;
    }

    const s = world.store;
    const p = world.player;
    const intensity = Math.pow(this.bladeGlow, 0.6);
    const face = s.facing[p]!;

    this.bladeMesh.setEnabled(true);
    // Ostrze uniesione po prawej stronie postaci, zgodnie z sylwetką z 2D.
    this.bladeMesh.position.set(
      s.x[p]! + Math.cos(face) * 0.55,
      1.5,
      s.y[p]! + Math.sin(face) * 0.55,
    );
    this.bladeMesh.rotation.z = 0.7;
    if (this.bladeMat) this.bladeMat.alpha = intensity;
  }

  // ────────────────────────────────────────────────── liczby i wskaźniki

  spawnDamageNumber(value: number, x: number, y: number, crit: boolean, element: string): void {
    // 1.6 m nad ziemią — mniej więcej na wysokości tułowia, więc liczba nie
    // przykrywa sylwetki ani nie odkleja się od celu.
    this.overlay.spawnNumber(value, x, 1.6, y, crit, element);
  }

  /** GDD §10.1: strzałki dla wrogów atakujących spoza kadru. */
  private syncArrows(world: World, px: number, py: number): void {
    const s = world.store;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const margin = 40;
    this.arrows.length = 0;

    for (let i = 0; i < s.count && this.arrows.length < 12; i++) {
      if (!s.alive[i] || s.kind[i] !== Kind.Enemy) continue;
      const state = s.state[i]!;
      if (state !== EState.Telegraph && state !== EState.Attacking) continue;

      const proj = this.projectPoint(s.x[i]!, 1, s.y[i]!);
      if (!proj) continue;
      const sx = proj.sx / (window.devicePixelRatio > 0 ? 1 : 1);
      const sy = proj.sy;
      if (sx >= 0 && sy >= 0 && sx <= w && sy <= h) continue;

      const self = this.projectPoint(px, 1, py);
      const cx = self ? self.sx : w / 2;
      const cy = self ? self.sy : h / 2;
      const a = Math.atan2(sy - cy, sx - cx);
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const halfW = w / 2 - margin;
      const halfH = h / 2 - margin;
      const scale = Math.min(
        halfW / Math.max(Math.abs(dx), 1e-6),
        halfH / Math.max(Math.abs(dy), 1e-6),
      );
      this.arrows.push({ x: w / 2 + dx * scale, y: h / 2 + dy * scale, angle: a });
    }

    this.overlay.setArrows(this.arrows);
  }

  /**
   * Odwzorowanie kursora na punkt areny — celowanie.
   *
   * W 2D była to odwrotność rzutu izometrycznego; w 3D jest to przecięcie
   * promienia z płaszczyzną `y = 0`. Kamera ortograficzna sprawia, że wynik
   * jest dokładny na całym ekranie, bez zniekształceń przy krawędziach.
   */
  screenToWorldPoint(clientX: number, clientY: number, out: { x: number; y: number }): void {
    const rect = this.canvas.getBoundingClientRect();
    const ray = this.scene.createPickingRay(
      clientX - rect.left,
      clientY - rect.top,
      Matrix.Identity(),
      this.bundle.camera,
    );
    // Promień przecina płaszczyznę areny; przy patrzeniu w górę (co przy tej
    // kamerze nie powinno się zdarzyć) zostawiamy poprzedni cel.
    if (Math.abs(ray.direction.y) < 1e-5) return;
    const t = -ray.origin.y / ray.direction.y;
    if (t < 0) return;
    out.x = ray.origin.x + ray.direction.x * t;
    out.y = ray.origin.z + ray.direction.z * t;
  }

  // ─────────────────────────────────────────────────────────── diagnostyka

  get activeParticles(): number {
    return this.particles.activeCount;
  }

  get qualityLevel(): Quality {
    return this.quality;
  }

  /** Kierunek patrzenia kamery — warstwa wejścia przelicza z niego WASD. */
  get viewYaw(): number {
    return this.bundle.mode === "tpp" ? this.camera.yaw : Number.NaN;
  }

  get drawCalls(): number {
    return this.scene.getActiveMeshes().length;
  }
}

/**
 * Dobór jakości. Post-processing i miękkie cienie są tu najdroższe, a gra ma
 * działać na Chromebooku z 2020 (README §Budżet) — więc na słabym sprzęcie
 * schodzimy z nich, zamiast dawać płynność 20 fps i „ładnie".
 *
 * Kolejność sprawdzeń ma znaczenie: **rasteryzacja programowa najpierw**.
 * Headless Chromium (nasze E2E) i maszyny bez sterownika GPU raportują 8+
 * rdzeni i dużo pamięci, więc sama heurystyka sprzętowa wybierała „high"
 * i scena schodziła do 4 fps — bot w testach nie zdążał wykonać akcji
 * i testy padały jak przy zepsutej mechanice (aa/docs/09 §11).
 */
function pickQuality(): Quality {
  // Wymuszenie przez `?quality=high|low|minimal`. Potrzebne z dwóch powodów:
  // gracz na mocnej maszynie może chcieć zejść niżej dla płynności, a zrzuty
  // ekranu w testach muszą pokazywać oprawę, którą zobaczy użytkownik z GPU —
  // headless zawsze wykryłby rasteryzację programową i pokazał wersję ubogą.
  const forced = new URLSearchParams(location.search).get("quality");
  if (forced === "high" || forced === "low" || forced === "minimal") return forced;

  if (isSoftwareRenderer()) return "minimal";
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 4;
  return cores >= 8 && memory >= 8 ? "high" : "low";
}

/**
 * Czy GPU jest emulowane. `WEBGL_debug_renderer_info` bywa zablokowane ze
 * względów prywatności — wtedy zgadujemy „nie" i polegamy na heurystyce
 * sprzętowej, bo fałszywe zejście na niską jakość jest gorsze niż jego brak.
 */
function isSoftwareRenderer(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return true;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const raw = ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    const name = raw.toLowerCase();
    return (
      name.includes("swiftshader") ||
      name.includes("llvmpipe") ||
      name.includes("software") ||
      name.includes("softwarerasterizer")
    );
  } catch {
    return false;
  }
}

export { Color4 };
