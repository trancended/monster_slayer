/**
 * Arena w 3D: podłoże, przeszkody i **widok na horyzoncie**.
 *
 * Rdzeń opisuje miejsce (`BiomeDef`, `Obstacle`) tak samo, jak opisuje stworzenia
 * (`EnemyDef.appearance`) — nazwami, nie bryłami: „lodowy, niebieski, kryształy,
 * lodowce na horyzoncie". Ten plik jest jedynym miejscem, które zamienia to
 * na geometrię. Nadal zero assetów: wszystko powstaje ze stożków, walców,
 * pudełek i kul (README §Budżet).
 *
 * Trzy rzeczy, na które trzeba tu uważać:
 *
 * 1. **Mgła zjada horyzont.** Mgła wykładnicza o gęstości ~0.03 wygasza wszystko
 *    powyżej ~50 m do koloru tła, więc góry w odległości 150 m byłyby czarną
 *    plamą. Dlatego cały horyzont ma `fogEnabled = false`, a perspektywę
 *    powietrzną robimy **ręcznie**: kolor każdej warstwy jest zmieszany z barwą
 *    zamglenia, a im dalej, tym mocniej świeci własnym kolorem (mniej cieniowania).
 *
 * 2. **Budżet klatki.** Panorama to kilkaset stożków, ale po scaleniu w jedną
 *    siatkę na warstwę wychodzi 8–10 wywołań rysowania na cały widok. Wszystko
 *    jest zamrożone: horyzont się nie rusza, więc silnik nie ma po co przeliczać
 *    jego macierzy co klatkę (aa/docs/08 §1).
 *
 * 3. **Przeszkody muszą być widoczne.** Do tej pory istniały wyłącznie
 *    w symulacji: zatrzymywały pociski i wrogów, ale **nic ich nie rysowało**.
 *    Gracz widział, że strzała ginie w powietrzu. Teraz każda ma bryłę.
 */
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import type { Scene } from "@babylonjs/core/scene";

import { ARENA_RADIUS, Rng, TAU, type ArenaLayout, type BiomeDef, type Obstacle } from "@ms/core";
import { toColor3 } from "./bodies.ts";

/** Promień kopuły nieba. Musi zmieścić się w `camera.maxZ` (patrz `scene.ts`). */
const SKY_RADIUS = 200;

/**
 * Barwa zamglenia rozjaśniona światłem biomu. Warstwy horyzontu mieszają się
 * **z nią**, a nie z samym `sky.haze`: cel mieszania musi być JAŚNIEJSZY od
 * podłoża, inaczej perspektywa powietrzna działa wstecz — dalekie góry wychodzą
 * ciemniejsze od areny i czytają się jak mur postawiony za rantem.
 */
export function hazeTarget(biome: BiomeDef): number {
  return mix(biome.sky.haze, biome.sun, 0.32);
}

/** Mieszanie barw w zapisie szesnastkowym — używa go też `scene.ts` do mgły. */
export { mix as mixHex };

/**
 * Trzy plany horyzontu. Dalsze są większe, żeby przy tej samej wysokości kątowej
 * niosły mniej szczegółu — tak samo działa perspektywa powietrzna w naturze.
 * `haze` to udział barwy zamglenia w kolorze warstwy.
 */
const HORIZON_LAYERS = [
  { near: 148, far: 176, scale: 1.15, haze: 0.78 },
  { near: 110, far: 142, scale: 1.0, haze: 0.56 },
  { near: 78, far: 106, scale: 0.85, haze: 0.32 },
] as const;

function shade(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

function mix(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(((a >> 16) & 0xff) * (1 - k) + ((b >> 16) & 0xff) * k);
  const g = Math.round(((a >> 8) & 0xff) * (1 - k) + ((b >> 8) & 0xff) * k);
  const bl = Math.round((a & 0xff) * (1 - k) + (b & 0xff) * k);
  return (r << 16) | (g << 8) | bl;
}

/** Zestaw materiałów przeszkód. Jeden na biom, współdzielony przez wszystkie bryły. */
interface PropMats {
  base: StandardMaterial;
  dark: StandardMaterial;
  light: StandardMaterial;
  accent: StandardMaterial;
  foliage: StandardMaterial;
  bone: StandardMaterial;
}

/** Kontekst budowania bryły: dokładamy do `parts`, materiał wybieramy ręcznie. */
interface Build {
  scene: Scene;
  parts: Mesh[];
  mats: PropMats;
  rng: Rng;
}

export class Arena3d {
  /** Rant areny. Pulsuje w rendererze, więc jako jedyny element nie jest zamrożony. */
  readonly rim: Mesh;
  /** Kolor rantu bieżącego biomu — renderer pulsuje wokół tej wartości. */
  rimColor = 0x2e6f8c;

  private readonly scene: Scene;
  private readonly shadows: ShadowGenerator;

  private readonly outer: Mesh;
  private readonly plate: Mesh;
  private readonly inner: Mesh;
  private readonly outerMat: StandardMaterial;
  private readonly plateMat: StandardMaterial;
  private readonly innerMat: StandardMaterial;
  private readonly rimMat: StandardMaterial;

  private props: Mesh | null = null;
  private propMats: PropMats | null = null;
  private backdrop: TransformNode | null = null;
  private backdropMats: StandardMaterial[] = [];
  private biomeId = "";

  constructor(scene: Scene, shadows: ShadowGenerator) {
    this.scene = scene;
    this.shadows = shadows;
    const R = ARENA_RADIUS;

    // Wielki dysk poza areną — bez niego mgła urywa się na krawędzi i widać pustkę.
    this.outerMat = flatMat(scene, "groundMat", 0x151a25);
    this.outer = CreateGround("outer", { width: R * 9, height: R * 9, subdivisions: 1 }, scene);
    this.outer.material = this.outerMat;
    this.outer.position.y = -0.35;
    this.outer.receiveShadows = true;
    this.outer.freezeWorldMatrix();
    this.outer.isPickable = false;

    this.plateMat = flatMat(scene, "plateMat", 0x1f2735);
    this.plate = CreateCylinder("plate", { diameter: R * 2, height: 0.7, tessellation: 72 }, scene);
    this.plate.material = this.plateMat;
    this.plate.position.y = -0.35;
    this.plate.receiveShadows = true;
    this.plate.freezeWorldMatrix();
    this.plate.isPickable = false;

    this.innerMat = flatMat(scene, "innerMat", 0x27303f);
    this.inner = CreateCylinder("inner", { diameter: R * 1.1, height: 0.16, tessellation: 64 }, scene);
    this.inner.material = this.innerMat;
    this.inner.position.y = 0.01;
    this.inner.receiveShadows = true;
    this.inner.freezeWorldMatrix();
    this.inner.isPickable = false;

    // Rant: torus w kolorze emisyjnym, przemalowywany razem z biomem.
    this.rimMat = new StandardMaterial("rimMat", scene);
    this.rimMat.diffuseColor = Color3.Black();
    this.rimMat.emissiveColor = toColor3(this.rimColor).scale(0.55);
    this.rimMat.specularColor = Color3.Black();

    this.rim = CreateTorus("rim", { diameter: R * 2, thickness: 0.16, tessellation: 80 }, scene);
    this.rim.material = this.rimMat;
    this.rim.position.y = 0.06;
    this.rim.isPickable = false;
  }

  /**
   * Wstawia arenę: kolory i horyzont tylko przy zmianie biomu, przeszkody
   * za każdym razem — one zmieniają się co rundę.
   */
  setArena(layout: ArenaLayout): void {
    if (layout.biome.id !== this.biomeId) {
      this.biomeId = layout.biome.id;
      this.applyBiome(layout.biome, layout.seed);
    }
    this.buildProps(layout.obstacles, layout.biome, layout.seed);
  }

  dispose(): void {
    this.clearProps();
    this.clearBackdrop();
  }

  // ───────────────────────────────────────────────────────────── biom

  private applyBiome(biome: BiomeDef, seed: number): void {
    recolor(this.outerMat, biome.ground);
    recolor(this.plateMat, biome.groundInner);
    recolor(this.innerMat, shade(biome.groundInner, 1.22));

    this.rimColor = biome.rim;
    this.rimMat.emissiveColor = toColor3(biome.rim).scale(0.55);

    this.clearBackdrop();
    this.buildBackdrop(biome, seed);
  }

  // ──────────────────────────────────────────────────────── przeszkody

  private clearProps(): void {
    if (this.props) {
      this.shadows.removeShadowCaster(this.props);
      this.props.material?.dispose();
      this.props.dispose();
    }
    this.props = null;
    if (this.propMats) {
      for (const m of Object.values(this.propMats)) m.dispose();
      this.propMats = null;
    }
  }

  private buildProps(obstacles: readonly Obstacle[], biome: BiomeDef, seed: number): void {
    this.clearProps();
    if (obstacles.length === 0) return;

    const scene = this.scene;
    const mats: PropMats = {
      base: flatMat(scene, "propBase", biome.prop),
      dark: flatMat(scene, "propDark", shade(biome.prop, 0.6)),
      light: flatMat(scene, "propLight", shade(biome.prop, 1.3)),
      accent: glowMat(scene, "propAccent", biome.propAccent, 0.85),
      foliage: flatMat(scene, "propFoliage", mix(biome.prop, biome.propAccent, 0.45)),
      bone: flatMat(scene, "propBone", 0xd8d2be),
    };
    this.propMats = mats;

    const parts: Mesh[] = [];
    for (const o of obstacles) {
      // Wariant z ziarna przeszkody, nie z ziarna areny: przestawienie kamienia
      // nie ma zmieniać kształtu pozostałych.
      const ctx: Build = { scene, parts, mats, rng: new Rng(o.variant ^ seed) };
      buildProp(ctx, o);
    }
    if (parts.length === 0) return;

    // Scalenie z podziałem na materiały — jedna siatka, kilka podsiatek.
    const merged =
      parts.length === 1
        ? parts[0]!
        : (Mesh.MergeMeshes(parts, true, true, undefined, false, true) ?? parts[0]!);
    merged.name = "props";
    merged.isPickable = false;
    merged.receiveShadows = true;
    merged.freezeWorldMatrix();
    this.shadows.addShadowCaster(merged);
    this.props = merged;
  }

  // ─────────────────────────────────────────────────────────── horyzont

  private clearBackdrop(): void {
    this.backdrop?.dispose(false, false);
    this.backdrop = null;
    for (const m of this.backdropMats) m.dispose();
    this.backdropMats = [];
  }

  private buildBackdrop(biome: BiomeDef, seed: number): void {
    const scene = this.scene;
    const root = new TransformNode("backdrop", scene);
    this.backdrop = root;
    const rng = new Rng((seed ^ 0xb0dd1e5) >>> 0);

    this.buildSky(biome, root);
    this.buildCelestial(biome, root, rng);
    if (biome.sky.aurora) this.buildAurora(biome, root, rng);

    // Materiał „miękki": pył, mgła, opary. Jeden na cały horyzont — te elementy
    // i tak są półprzezroczyste, więc nie ma sensu mnożyć ich per warstwa.
    const soft = glowMat(scene, "bdSoft", biome.sky.haze, 0.7);
    soft.alpha = 0.16;
    soft.fogEnabled = false;
    this.backdropMats.push(soft);
    const softParts: Mesh[] = [];

    for (let i = 0; i < HORIZON_LAYERS.length; i++) {
      const layer = HORIZON_LAYERS[i]!;
      const tint = mix(biome.prop, hazeTarget(biome), layer.haze);
      const baseMat = flatMat(scene, `bdBase${i}`, tint);
      // Im dalej, tym mniej cieniowania: daleka warstwa świeci własnym kolorem,
      // bliska nadal łapie słońce i czyta się jako bryła.
      baseMat.emissiveColor = toColor3(tint).scale(layer.haze);
      baseMat.fogEnabled = false;
      const accentMat = glowMat(
        scene,
        `bdAcc${i}`,
        mix(biome.propAccent, hazeTarget(biome), layer.haze * 0.6),
        0.9,
      );
      accentMat.fogEnabled = false;
      // Trzeci materiał — jaśniejszy odcień warstwy. Wcześniej „inne" bryły
      // (drzewa w lesie, krawędzie lodu) brały materiał akcentu i świeciły
      // neonem na horyzoncie, przez co przyciągały wzrok mocniej niż arena.
      const altTint = mix(tint, hazeTarget(biome), 0.3);
      const altMat = flatMat(scene, `bdAlt${i}`, altTint);
      altMat.emissiveColor = toColor3(altTint).scale(layer.haze);
      altMat.fogEnabled = false;
      this.backdropMats.push(baseMat, accentMat, altMat);

      const base: Mesh[] = [];
      const glow: Mesh[] = [];
      const alt: Mesh[] = [];
      buildHorizon(biome.backdrop, {
        scene,
        rng,
        base,
        glow,
        alt,
        // Opary zbierają się ze wszystkich planów do jednej siatki: mają jeden
        // materiał, więc dzielenie ich na warstwy dałoby tylko więcej wywołań.
        soft: softParts,
        near: layer.near,
        far: layer.far,
        scale: layer.scale,
        biome,
      });

      attach(base, baseMat, root, `bdBaseMesh${i}`);
      attach(glow, accentMat, root, `bdGlowMesh${i}`);
      attach(alt, altMat, root, `bdAltMesh${i}`);
    }

    attach(softParts, soft, root, "bdSoftMesh");
  }

  /**
   * Kopuła nieba z gradientem na **kolorach wierzchołków** — bez tekstur i bez
   * własnego shadera. Płaski kolor tła czytał się jak pusta ściana; gradient od
   * zamglenia u horyzontu do ciemnego zenitu daje głębię za jedną siatkę.
   *
   * Kopuła stoi w środku świata, nie przy kamerze: arena ma 19 m promienia,
   * więc przy promieniu 200 m paralaksa jest niezauważalna, a nic nie może się
   * przez nią przebić.
   */
  private buildSky(biome: BiomeDef, root: TransformNode): void {
    const sky = CreateSphere("sky", { diameter: SKY_RADIUS * 2, segments: 20 }, this.scene);
    const positions = sky.getVerticesData(VertexBuffer.PositionKind);
    if (positions) {
      const zenith = shade(biome.fog, 0.8);
      const nadir = shade(biome.fog, 0.45);
      const colors = new Array<number>((positions.length / 3) * 4);
      for (let i = 0, c = 0; i < positions.length; i += 3, c += 4) {
        const t = positions[i + 1]! / SKY_RADIUS;
        // Kamera TPP patrzy w dół, więc nad horyzontem widać pas rzędu ośmiu
        // stopni (t ≈ 0.14). Przy stromym gradiencie cały ten pas wychodził
        // niemal czarny — rozciągamy go tak, żeby zenit zaczynał się wysoko.
        const hex =
          t >= 0
            ? mix(biome.sky.haze, zenith, Math.min(1, t / 0.9) ** 0.75)
            : mix(biome.sky.haze, nadir, Math.min(1, -t / 0.35));
        colors[c] = ((hex >> 16) & 0xff) / 255;
        colors[c + 1] = ((hex >> 8) & 0xff) / 255;
        colors[c + 2] = (hex & 0xff) / 255;
        colors[c + 3] = 1;
      }
      sky.setVerticesData(VertexBuffer.ColorKind, colors);
    }

    const mat = new StandardMaterial("skyMat", this.scene);
    mat.diffuseColor = Color3.White();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.fogEnabled = false;
    // Kopułę widzimy od środka, więc nie wolno odrzucać tylnych ścianek.
    mat.backFaceCulling = false;
    this.backdropMats.push(mat);

    sky.material = mat;
    sky.isPickable = false;
    sky.parent = root;
    sky.freezeWorldMatrix();
  }

  /** Słońce, księżyc albo pierścieniowa planeta — jedno źródło uwagi w kadrze. */
  private buildCelestial(biome: BiomeDef, root: TransformNode, rng: Rng): void {
    if (biome.sky.body === "none") return;

    const angle = rng.range(0, TAU);
    const dist = 168;
    // Nisko nad horyzontem — na tej wysokości tarcza wpada w widoczny pas nieba
    // i daje efekt zachodu. Ustawiona wyżej po prostu nie mieściła się w kadrze.
    const height = biome.sky.body === "sun" ? 20 : 30;
    const size = biome.sky.body === "moon" ? 16 : biome.sky.body === "ringed" ? 26 : 21;

    const mat = glowMat(this.scene, "skyBody", biome.sky.bodyColor, 1);
    mat.fogEnabled = false;
    this.backdropMats.push(mat);

    const disc = CreateDisc("skyBody", { radius: size, tessellation: 40 }, this.scene);
    disc.position.set(Math.cos(angle) * dist, height, Math.sin(angle) * dist);
    disc.material = mat;
    disc.isPickable = false;
    // Zwrócony do kamery zawsze — w TPP kadr obraca się razem z postacią.
    disc.billboardMode = TransformNode.BILLBOARDMODE_ALL;
    disc.parent = root;

    // Zaćmienie: ciemny dysk na tarczy zostawia świecącą obwódkę.
    if (biome.sky.body === "eclipse") {
      const coreMat = flatMat(this.scene, "skyBodyCore", shade(biome.fog, 0.6));
      coreMat.disableLighting = true;
      coreMat.fogEnabled = false;
      this.backdropMats.push(coreMat);
      const core = CreateDisc("skyBodyCore", { radius: size * 0.82, tessellation: 40 }, this.scene);
      core.position.copyFrom(disc.position);
      core.position.addInPlaceFromFloats(
        Math.cos(angle) * -0.6,
        0,
        Math.sin(angle) * -0.6,
      );
      core.material = coreMat;
      core.isPickable = false;
      core.billboardMode = TransformNode.BILLBOARDMODE_ALL;
      core.parent = root;
    }

    if (biome.sky.body === "ringed") {
      const ring = CreateTorus(
        "skyRing",
        { diameter: size * 3.4, thickness: size * 0.16, tessellation: 44 },
        this.scene,
      );
      ring.position.copyFrom(disc.position);
      ring.rotation.set(1.15, angle, 0.35);
      ring.material = mat;
      ring.isPickable = false;
      ring.parent = root;
      ring.freezeWorldMatrix();
    }
  }

  /** Wstęgi zorzy: kilka wygiętych plansz o niskim kryciu, ustawionych warstwowo. */
  private buildAurora(biome: BiomeDef, root: TransformNode, rng: Rng): void {
    const mat = glowMat(this.scene, "aurora", mix(biome.rim, biome.sky.haze, 0.3), 0.9);
    mat.alpha = 0.13;
    mat.fogEnabled = false;
    mat.backFaceCulling = false;
    this.backdropMats.push(mat);

    for (let i = 0; i < 5; i++) {
      const angle = rng.range(0, TAU);
      const dist = rng.range(120, 158);
      const band = CreatePlane(
        `aurora${i}`,
        { width: rng.range(48, 96), height: rng.range(26, 52) },
        this.scene,
      );
      band.position.set(Math.cos(angle) * dist, rng.range(14, 44), Math.sin(angle) * dist);
      band.rotation.set(rng.range(-0.3, 0.3), -angle + Math.PI / 2, rng.range(-0.4, 0.4));
      band.material = mat;
      band.isPickable = false;
      band.parent = root;
      band.freezeWorldMatrix();
    }
  }
}

// ────────────────────────────────────────────────────────────── materiały

function flatMat(scene: Scene, name: string, hex: number): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = toColor3(hex);
  m.specularColor = Color3.Black();
  return m;
}

function glowMat(scene: Scene, name: string, hex: number, emissive: number): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  const c = toColor3(hex);
  m.diffuseColor = c.scale(0.35);
  m.emissiveColor = c.scale(emissive);
  m.specularColor = Color3.Black();
  return m;
}

/** Przemalowanie materiału trzymanego przez zamrożoną siatkę. */
function recolor(mat: StandardMaterial, hex: number): void {
  mat.unfreeze();
  mat.diffuseColor = toColor3(hex);
  mat.freeze();
}

/** Scala bryły w jedną siatkę pod jednym materiałem i podwiesza pod korzeń. */
function attach(parts: Mesh[], mat: StandardMaterial, root: TransformNode, name: string): void {
  if (parts.length === 0) return;
  for (const p of parts) p.material = mat;
  const merged =
    parts.length === 1 ? parts[0]! : (Mesh.MergeMeshes(parts, true, true) ?? parts[0]!);
  merged.name = name;
  merged.material = mat;
  merged.isPickable = false;
  merged.parent = root;
  merged.freezeWorldMatrix();
}

// ─────────────────────────────────────────────────────── bryły przeszkód

function put(ctx: Build, mesh: Mesh, mat: StandardMaterial): Mesh {
  mesh.material = mat;
  ctx.parts.push(mesh);
  return mesh;
}

function cone(ctx: Build, d: number, h: number, tess: number, mat: StandardMaterial): Mesh {
  return put(
    ctx,
    CreateCylinder("p", { diameterTop: 0, diameterBottom: d, height: h, tessellation: tess }, ctx.scene),
    mat,
  );
}

/**
 * Bryła przeszkody. Promień kolizji `o.r` jest **wiążący dla podstawy**: gałęzie
 * i korony mogą go przekraczać, ale pień i kamień nie — inaczej gracz odbija się
 * od powietrza albo wchodzi w drzewo.
 */
function buildProp(ctx: Build, o: Obstacle): void {
  const { mats, rng } = ctx;
  switch (o.kind) {
    case "tree": {
      const trunkH = o.h * rng.range(0.42, 0.55);
      const trunk = CreateCylinder(
        "p",
        { diameterTop: o.r * 1.1, diameterBottom: o.r * 1.9, height: trunkH, tessellation: 7 },
        ctx.scene,
      );
      trunk.position.set(o.x, trunkH / 2 - 0.1, o.y);
      trunk.rotation.y = o.rot;
      put(ctx, trunk, mats.dark);

      // Korona z trzech stożków: jeden byłby choinką, trzy czytają się jak drzewo.
      const tiers = rng.int(3, 4);
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        const d = o.r * rng.range(4.4, 5.6) * (1 - t * 0.55);
        const h = o.h * rng.range(0.34, 0.46) * (1 - t * 0.3);
        const c = cone(ctx, d, h, 7, mats.foliage);
        c.position.set(
          o.x + rng.range(-0.18, 0.18),
          trunkH * 0.72 + t * o.h * 0.34 + h * 0.4,
          o.y + rng.range(-0.18, 0.18),
        );
        c.rotation.y = o.rot + i * 0.7;
      }
      break;
    }

    case "rock": {
      // Kula o ośmiu segmentach jest fasetowana — czyta się jak głaz, nie balon.
      const main = CreateSphere("p", { diameter: o.r * 2.1, segments: 6 }, ctx.scene);
      main.position.set(o.x, o.h * 0.34, o.y);
      main.scaling.set(1, Math.max(0.5, o.h / (o.r * 1.6)), rng.range(0.85, 1.15));
      main.rotation.set(rng.range(-0.2, 0.2), o.rot, rng.range(-0.2, 0.2));
      put(ctx, main, mats.base);

      const chips = rng.int(1, 2);
      for (let i = 0; i < chips; i++) {
        const a = o.rot + rng.range(0, TAU);
        const d = o.r * rng.range(0.6, 0.95);
        const chip = CreateSphere("p", { diameter: o.r * rng.range(0.6, 0.95), segments: 5 }, ctx.scene);
        chip.position.set(o.x + Math.cos(a) * d, o.h * rng.range(0.1, 0.2), o.y + Math.sin(a) * d);
        chip.rotation.y = a;
        put(ctx, chip, i === 0 ? mats.dark : mats.light);
      }
      break;
    }

    case "pillar": {
      const shaft = CreateCylinder(
        "p",
        { diameterTop: o.r * 1.7, diameterBottom: o.r * 2, height: o.h, tessellation: 8 },
        ctx.scene,
      );
      shaft.position.set(o.x, o.h / 2, o.y);
      shaft.rotation.y = o.rot;
      put(ctx, shaft, mats.base);

      const foot = CreateBox("p", { width: o.r * 2.5, height: 0.34, depth: o.r * 2.5 }, ctx.scene);
      foot.position.set(o.x, 0.17, o.y);
      foot.rotation.y = o.rot + 0.4;
      put(ctx, foot, mats.dark);

      // Kapitel bywa strzaskany — połowa filarów ma być ruiną, nie kolumnadą.
      if (rng.chance(0.55)) {
        const cap = CreateBox("p", { width: o.r * 2.3, height: 0.3, depth: o.r * 2.3 }, ctx.scene);
        cap.position.set(o.x, o.h - 0.15, o.y);
        cap.rotation.y = o.rot - 0.3;
        put(ctx, cap, mats.light);
      }

      // Świecąca opaska runiczna: filar staje się punktem orientacyjnym w mroku.
      const band = CreateCylinder(
        "p",
        { diameterTop: o.r * 1.85, diameterBottom: o.r * 1.9, height: 0.22, tessellation: 8 },
        ctx.scene,
      );
      band.position.set(o.x, o.h * rng.range(0.45, 0.72), o.y);
      band.rotation.y = o.rot;
      put(ctx, band, mats.accent);
      break;
    }

    case "crystal": {
      const shards = rng.int(3, 4);
      for (let i = 0; i < shards; i++) {
        const first = i === 0;
        const h = o.h * (first ? 1 : rng.range(0.4, 0.75));
        const d = o.r * (first ? 1.5 : rng.range(0.6, 1.0));
        const a = o.rot + (i / shards) * TAU;
        const off = first ? 0 : o.r * rng.range(0.5, 0.9);
        const shard = cone(ctx, d, h, 5, first ? mats.accent : mats.base);
        shard.position.set(o.x + Math.cos(a) * off, h / 2 - 0.15, o.y + Math.sin(a) * off);
        shard.rotation.set(Math.cos(a) * 0.22, a, Math.sin(a) * 0.22);
      }
      break;
    }

    case "stump": {
      const trunk = CreateCylinder(
        "p",
        { diameterTop: o.r * 1.9, diameterBottom: o.r * 2.1, height: o.h, tessellation: 9 },
        ctx.scene,
      );
      trunk.position.set(o.x, o.h / 2, o.y);
      trunk.rotation.y = o.rot;
      put(ctx, trunk, mats.dark);

      // Złamany rdzeń: stożek w środku pnia, żeby góra nie była płaskim krążkiem.
      const core = cone(ctx, o.r * 1.5, o.h * 0.5, 6, mats.base);
      core.position.set(o.x, o.h * 0.95, o.y);
      core.rotation.set(rng.range(-0.25, 0.25), o.rot, rng.range(-0.25, 0.25));

      const roots = rng.int(2, 3);
      for (let i = 0; i < roots; i++) {
        const a = o.rot + (i / roots) * TAU + rng.range(-0.3, 0.3);
        const root = CreateCylinder(
          "p",
          { diameterTop: 0.1, diameterBottom: o.r * 0.5, height: o.r * 1.6, tessellation: 5 },
          ctx.scene,
        );
        root.position.set(o.x + Math.cos(a) * o.r * 0.9, 0.12, o.y + Math.sin(a) * o.r * 0.9);
        root.rotation.set(Math.PI / 2 - 0.25, -a, 0);
        put(ctx, root, mats.dark);
      }
      break;
    }

    case "bones": {
      // Żebra: torus zakopany do połowy daje łuk bez własnej geometrii łuku.
      const ribs = rng.int(2, 3);
      for (let i = 0; i < ribs; i++) {
        const scale = 1 - i * rng.range(0.12, 0.2);
        const rib = CreateTorus(
          "p",
          { diameter: o.r * 2.2 * scale, thickness: 0.14, tessellation: 18 },
          ctx.scene,
        );
        rib.position.set(o.x + i * o.r * 0.42 - o.r * 0.2, o.h * 0.1, o.y + i * 0.14);
        rib.rotation.set(Math.PI / 2, o.rot + i * 0.12, 0);
        // Po obrocie o 90° wokół X wysokość łuku leży na lokalnej osi Z:
        // lokalne Y jest osią tuby torusa, więc skalowanie go pogrubiłoby żebro.
        rib.scaling.z = o.h / (o.r * 1.6);
        put(ctx, rib, mats.bone);
      }

      // Kieł wbity w ziemię — sylwetka rozpoznawalna także z boku.
      const tusk = CreateCylinder(
        "p",
        { diameterTop: 0.06, diameterBottom: o.r * 0.55, height: o.h * 1.1, tessellation: 6 },
        ctx.scene,
      );
      tusk.position.set(o.x + o.r * 0.5, o.h * 0.5, o.y - o.r * 0.4);
      tusk.rotation.set(0.3, o.rot, 0.25);
      put(ctx, tusk, mats.bone);
      break;
    }
  }
}

// ─────────────────────────────────────────────────────────── horyzonty

interface Horizon {
  scene: Scene;
  rng: Rng;
  /** Bryły w kolorze warstwy. */
  base: Mesh[];
  /** Bryły świecące akcentem biomu: lawa w kraterze, okna hut, blask wysp. */
  glow: Mesh[];
  /** Bryły w jaśniejszym odcieniu warstwy: nasłonecznione zbocza, lód, drzewa. */
  alt: Mesh[];
  /** Bryły półprzezroczyste: pył, opary, mgła w dolinie. */
  soft: Mesh[];
  near: number;
  far: number;
  scale: number;
  biome: BiomeDef;
}

/** Punkt na pierścieniu horyzontu. */
function ring(h: Horizon): { x: number; z: number; a: number } {
  const a = h.rng.range(0, TAU);
  const d = h.rng.range(h.near, h.far);
  return { x: Math.cos(a) * d, z: Math.sin(a) * d, a };
}

function peak(h: Horizon, into: Mesh[], d: number, height: number, tess: number, x: number, z: number, y = -6): Mesh {
  const m = CreateCylinder(
    "h",
    { diameterTop: 0, diameterBottom: d, height, tessellation: tess },
    h.scene,
  );
  m.position.set(x, y + height / 2, z);
  m.rotation.y = h.rng.range(0, TAU);
  into.push(m);
  return m;
}

function slab(h: Horizon, into: Mesh[], w: number, height: number, depth: number, x: number, z: number, tilt: number): Mesh {
  const m = CreateBox("h", { width: w, height, depth }, h.scene);
  m.position.set(x, height / 2 - 5, z);
  m.rotation.set(0, Math.atan2(x, z) + h.rng.range(-0.4, 0.4), tilt);
  into.push(m);
  return m;
}

function blob(h: Horizon, into: Mesh[], d: number, flat: number, x: number, z: number): Mesh {
  const m = CreateSphere("h", { diameter: d, segments: 7 }, h.scene);
  m.scaling.set(1, flat, h.rng.range(0.8, 1.2));
  m.position.set(x, -d * flat * 0.22, z);
  m.rotation.y = h.rng.range(0, TAU);
  into.push(m);
  return m;
}

/** Kilkanaście–kilkadziesiąt bryłek na warstwę; wszystko i tak scali się w jedną siatkę. */
function buildHorizon(kind: BiomeDef["backdrop"], h: Horizon): void {
  const s = h.scale;

  switch (kind) {
    case "peaks": {
      const count = h.rng.int(9, 13);
      for (let i = 0; i < count; i++) {
        const p = ring(h);
        const height = h.rng.range(26, 54) * s;
        const d = h.rng.range(26, 46) * s;
        peak(h, h.base, d, height, 5, p.x, p.z);
        // Czapa śniegu: druga, mała bryła na szczycie. To ona sprzedaje skalę.
        if (h.rng.chance(0.6)) {
          peak(h, h.alt, d * 0.34, height * 0.2, 5, p.x, p.z, height * 0.72 - 6);
        }
      }
      for (let i = 0; i < 3; i++) {
        const p = ring(h);
        blob(h, h.soft, h.rng.range(70, 120) * s, 0.16, p.x, p.z);
      }
      break;
    }

    case "forest": {
      // Grzbiet w tle plus gęsty drzewostan — pojedyncze stożki nie dają lasu.
      const ridges = h.rng.int(4, 6);
      for (let i = 0; i < ridges; i++) {
        const p = ring(h);
        blob(h, h.base, h.rng.range(60, 110) * s, h.rng.range(0.34, 0.52), p.x, p.z);
      }
      const trees = h.rng.int(26, 40);
      for (let i = 0; i < trees; i++) {
        const p = ring(h);
        const height = h.rng.range(12, 26) * s;
        peak(h, i % 3 === 0 ? h.alt : h.base, h.rng.range(5, 10) * s, height, 6, p.x, p.z);
      }
      for (let i = 0; i < 2; i++) {
        const p = ring(h);
        blob(h, h.soft, h.rng.range(80, 130) * s, 0.12, p.x, p.z);
      }
      break;
    }

    case "spires": {
      const count = h.rng.int(8, 13);
      for (let i = 0; i < count; i++) {
        const p = ring(h);
        const height = h.rng.range(26, 54) * s;
        const d = h.rng.range(7, 15) * s;
        const tower = CreateCylinder(
          "h",
          { diameterTop: d * 0.7, diameterBottom: d, height, tessellation: 6 },
          h.scene,
        );
        tower.position.set(p.x, height / 2 - 3, p.z);
        tower.rotation.y = p.a;
        h.base.push(tower);
        // Kominy świecą u wylotu — sylweta kuźni bez jednego piksela tekstury.
        peak(h, h.glow, d * 0.8, height * 0.12, 6, p.x, p.z, height - 4);
        if (h.rng.chance(0.5)) {
          const gantry = CreateBox(
            "h",
            { width: d * 2.6, height: h.rng.range(2, 4) * s, depth: d * 0.5 },
            h.scene,
          );
          gantry.position.set(p.x, height * h.rng.range(0.4, 0.75), p.z);
          gantry.rotation.y = p.a + 0.6;
          h.base.push(gantry);
        }
      }
      for (let i = 0; i < 4; i++) {
        const p = ring(h);
        blob(h, h.soft, h.rng.range(50, 90) * s, 0.2, p.x, p.z);
      }
      break;
    }

    case "dunes": {
      const count = h.rng.int(10, 16);
      for (let i = 0; i < count; i++) {
        const p = ring(h);
        blob(h, h.base, h.rng.range(50, 96) * s, h.rng.range(0.3, 0.46), p.x, p.z);
      }
      for (let i = 0; i < 3; i++) {
        const p = ring(h);
        blob(h, h.soft, h.rng.range(90, 150) * s, 0.1, p.x, p.z);
      }
      break;
    }

    case "glacier": {
      const count = h.rng.int(8, 12);
      for (let i = 0; i < count; i++) {
        const p = ring(h);
        const height = h.rng.range(16, 34) * s;
        slab(h, h.base, h.rng.range(16, 34) * s, height, h.rng.range(10, 22) * s, p.x, p.z, h.rng.range(-0.24, 0.24));
        // Lodowa krawędź łapie światło — bez niej bryły są jednolitą ścianą.
        slab(h, h.alt, h.rng.range(3, 6) * s, height * 0.9, 1.4 * s, p.x, p.z, h.rng.range(-0.24, 0.24));
      }
      break;
    }

    case "ruins": {
      const count = h.rng.int(10, 16);
      for (let i = 0; i < count; i++) {
        const p = ring(h);
        const height = h.rng.range(12, 34) * s;
        const col = CreateCylinder(
          "h",
          { diameterTop: h.rng.range(4, 8) * s, diameterBottom: h.rng.range(5, 9) * s, height, tessellation: 7 },
          h.scene,
        );
        col.position.set(p.x, height / 2 - 3, p.z);
        col.rotation.set(h.rng.range(-0.12, 0.12), p.a, h.rng.range(-0.1, 0.1));
        h.base.push(col);
      }
      const arches = h.rng.int(2, 4);
      for (let i = 0; i < arches; i++) {
        const p = ring(h);
        const d = h.rng.range(26, 46) * s;
        const arch = CreateTorus("h", { diameter: d, thickness: d * 0.08, tessellation: 16 }, h.scene);
        arch.position.set(p.x, -d * 0.12, p.z);
        arch.rotation.set(Math.PI / 2, p.a, 0);
        h.base.push(arch);
      }
      for (let i = 0; i < 3; i++) {
        const p = ring(h);
        blob(h, h.soft, h.rng.range(60, 110) * s, 0.14, p.x, p.z);
      }
      break;
    }

    case "void": {
      // Wyspy: stożki wierzchołkiem w dół, zawieszone na różnych wysokościach.
      const count = h.rng.int(7, 11);
      for (let i = 0; i < count; i++) {
        const p = ring(h);
        const d = h.rng.range(20, 44) * s;
        const height = d * h.rng.range(0.5, 0.9);
        const island = CreateCylinder(
          "h",
          { diameterTop: d, diameterBottom: 0, height, tessellation: 7 },
          h.scene,
        );
        island.position.set(p.x, h.rng.range(6, 62), p.z);
        island.rotation.y = p.a;
        h.base.push(island);
        // Świecąca warstwa na wierzchu — wyspa ma być widoczna na czarnym tle.
        const cap = CreateCylinder(
          "h",
          { diameterTop: d, diameterBottom: d * 0.94, height: 1.2 * s, tessellation: 7 },
          h.scene,
        );
        cap.position.set(island.position.x, island.position.y + height / 2, island.position.z);
        cap.rotation.y = p.a;
        h.glow.push(cap);
      }
      break;
    }

    case "volcano": {
      // Jeden dominujący stożek na warstwę plus mniejsze w tle. Krater świeci.
      const p = ring(h);
      const height = h.rng.range(32, 50) * s;
      const d = h.rng.range(46, 74) * s;
      peak(h, h.base, d, height, 7, p.x, p.z);
      peak(h, h.glow, d * 0.2, height * 0.1, 7, p.x, p.z, height * 0.78 - 3);
      const others = h.rng.int(4, 7);
      for (let i = 0; i < others; i++) {
        const q = ring(h);
        peak(h, h.base, h.rng.range(18, 34) * s, h.rng.range(14, 30) * s, 6, q.x, q.z);
      }
      // Pióropusz pyłu nad kraterem — kolumna kul o niskim kryciu.
      for (let i = 0; i < 5; i++) {
        const puff = CreateSphere("h", { diameter: h.rng.range(20, 40) * s, segments: 6 }, h.scene);
        puff.position.set(
          p.x + h.rng.range(-10, 10),
          height * (0.85 + i * 0.22),
          p.z + h.rng.range(-10, 10),
        );
        h.soft.push(puff);
      }
      break;
    }

    case "marsh": {
      const count = h.rng.int(12, 20);
      for (let i = 0; i < count; i++) {
        const p = ring(h);
        const height = h.rng.range(14, 30) * s;
        const trunk = CreateCylinder(
          "h",
          { diameterTop: 0.6 * s, diameterBottom: h.rng.range(2.4, 4.6) * s, height, tessellation: 5 },
          h.scene,
        );
        trunk.position.set(p.x, height / 2 - 3, p.z);
        trunk.rotation.set(h.rng.range(-0.16, 0.16), p.a, h.rng.range(-0.16, 0.16));
        h.base.push(trunk);
        // Dwie martwe gałęzie: bez nich to tylko tyczka.
        for (let b = 0; b < 2; b++) {
          const branch = CreateCylinder(
            "h",
            { diameterTop: 0.2 * s, diameterBottom: 1.1 * s, height: height * 0.42, tessellation: 4 },
            h.scene,
          );
          branch.position.set(p.x, height * h.rng.range(0.55, 0.85) - 3, p.z);
          branch.rotation.set(h.rng.range(0.7, 1.2), p.a + b * 2.2, h.rng.range(-0.5, 0.5));
          h.base.push(branch);
        }
      }
      for (let i = 0; i < 5; i++) {
        const p = ring(h);
        blob(h, h.soft, h.rng.range(60, 120) * s, 0.08, p.x, p.z);
      }
      break;
    }

    case "steppe": {
      const hills = h.rng.int(9, 14);
      for (let i = 0; i < hills; i++) {
        const p = ring(h);
        blob(h, h.base, h.rng.range(56, 110) * s, h.rng.range(0.26, 0.4), p.x, p.z);
      }
      const trees = h.rng.int(5, 9);
      for (let i = 0; i < trees; i++) {
        const p = ring(h);
        peak(h, h.alt, h.rng.range(8, 16) * s, h.rng.range(14, 24) * s, 6, p.x, p.z);
      }
      for (let i = 0; i < 2; i++) {
        const p = ring(h);
        blob(h, h.soft, h.rng.range(100, 160) * s, 0.09, p.x, p.z);
      }
      break;
    }
  }
}
