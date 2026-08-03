/**
 * Cząstki 3D — krew, iskry, odłamki i plamy na ziemi.
 *
 * Implementacja na **thin instances**: jedna siatka, jeden materiał, jeden bufor
 * macierzy. Wszystkie krople na arenie kosztują **jedno wywołanie rysowania**,
 * niezależnie od tego, czy jest ich pięć czy trzysta.
 *
 * Dlaczego nie `ParticleSystem` Babylona: potrzebuję kolizji z podłożem, która
 * zamienia kroplę w trwałą plamę — a to jest logika po stronie CPU, której
 * wbudowany system nie wystawia. Poza tym mam już sprawdzony model z wersji 2D
 * (pula stała, przydział pierścieniowy, przepełnienie gubi cząstkę zamiast
 * alokować) i nie ma powodu go porzucać.
 *
 * Uwaga wydajnościowa przeniesiona z 2D: **bufor macierzy przepisujemy raz na
 * klatkę**, jednym `thinInstanceSetBuffer`. Aktualizowanie instancji pojedynczo
 * kosztowałoby tyle, ile kosztował `Graphics.clear()` w poprzedniej wersji.
 *
 * ## Dlaczego kubełki kolorów, a nie kolor per instancja
 *
 * Pierwsza wersja używała zarezerwowanego bufora `color` thin instances.
 * Efekt: cząstki renderowały się **na czarno** — geometria i macierze były
 * poprawne (zmierzone), bufor zawierał właściwe wartości (zmierzone), ale
 * atrybut koloru czytał w shaderze zera. Zamiast dalej walczyć z silnikiem,
 * dzielimy cząstki na **kubełki po kolorze**: jedna siatka i jeden materiał
 * na barwę. Paleta jest mała (krew, iskry, krytyk, barwa wroga), więc kosztuje
 * to kilka wywołań rysowania zamiast jednego — i działa.
 *
 * Konsekwencja: zanikanie nie może iść przez alfę per cząstka, bo materiał
 * jest wspólny. Zamiast tego cząstka **kurczy się do zera**. Przy wielkości
 * kilkunastu pikseli różnicy nie widać, a kod przestaje zależeć od niuansu
 * implementacji instancjonowania.
 */
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";

import { toColor3 } from "./bodies.ts";

export interface Burst3dOptions {
  /** Pozycja w świecie: `x`/`z` to płaszczyzna areny, `y` to wysokość. */
  x: number;
  z: number;
  y?: number;
  count: number;
  /** Kierunek główny w płaszczyźnie areny (radiany). */
  angle?: number;
  spread?: number;
  /** Prędkość pozioma, metry/s. */
  speed: number;
  speedVariance?: number;
  /** Prędkość pionowa, metry/s. */
  lift?: number;
  liftVariance?: number;
  color: number | readonly number[];
  size: number;
  sizeVariance?: number;
  life: number;
  lifeVariance?: number;
  gravity?: number;
  drag?: number;
  /** Cząstka zostawia plamę po zetknięciu z podłożem. */
  decal?: boolean;
  decalColor?: number;
  shrink?: boolean;
  /** Iskry są wydłużone wzdłuż wektora ruchu. */
  streak?: boolean;
}

interface Particle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  gravity: number;
  drag: number;
  decal: boolean;
  decalColor: number;
  shrink: boolean;
  streak: boolean;
  /** Barwa jako klucz kubełka — patrz nagłówek pliku. */
  hex: number;
}

/** Jedna siatka + macierze dla wszystkich cząstek o tej samej barwie. */
interface Bucket {
  mesh: Mesh;
  matrices: Float32Array;
  count: number;
}

interface Decal {
  active: boolean;
  x: number;
  z: number;
  size: number;
  rot: number;
  life: number;
  maxLife: number;
  alpha0: number;
  hex: number;
}

const CAPACITY = 320;
const DECAL_CAPACITY = 110;

export class Particles3d {
  private readonly pool: Particle[] = [];
  private readonly decals: Decal[] = [];
  private cursor = 0;
  private decalCursor = 0;

  private readonly scene: Scene;
  /** Kubełki cząstek i plam, kluczowane barwą. Tworzone leniwie. */
  private readonly buckets = new Map<number, Bucket>();
  private readonly decalBuckets = new Map<number, Bucket>();

  /** Bufory pomocnicze — zero alokacji w pętli aktualizacji. */
  private readonly tmpScale = new Vector3();
  private readonly tmpPos = new Vector3();
  private readonly tmpQuat = new Quaternion();
  private readonly tmpMat = new Matrix();

  constructor(scene: Scene) {
    this.scene = scene;

    for (let i = 0; i < CAPACITY; i++) {
      this.pool.push({
        active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, size: 1, gravity: 0, drag: 1,
        decal: false, decalColor: 0xffffff, shrink: false, streak: false,
        hex: 0xffffff,
      });
    }
    for (let i = 0; i < DECAL_CAPACITY; i++) {
      this.decals.push({
        active: false, x: 0, z: 0, size: 1, rot: 0,
        life: 0, maxLife: 1, alpha0: 0.5, hex: 0xffffff,
      });
    }
  }

  /**
   * Kubełek dla barwy. Materiał jest **emisyjny**: cząstki mają świecić
   * własnym światłem, a nie zależeć od tego, czy akurat padło na nie słońce.
   */
  private bucket(map: Map<number, Bucket>, hex: number, decal: boolean): Bucket {
    const found = map.get(hex);
    if (found) return found;

    const c = toColor3(hex);
    const mat = new StandardMaterial(`pm_${decal ? "d" : "p"}_${hex}`, this.scene);
    mat.disableLighting = true;
    mat.diffuseColor = c;
    mat.emissiveColor = c.scale(decal ? 0.15 : 0.85);
    mat.specularColor = Color3.Black();
    if (decal) {
      mat.alpha = 0.5;
      mat.zOffset = -2;
    }

    const capacity = decal ? DECAL_CAPACITY : CAPACITY;
    const mesh = decal
      ? CreateDisc(`decals_${hex}`, { radius: 0.5, tessellation: 10 }, this.scene)
      : CreateBox(`particles_${hex}`, { size: 1 }, this.scene);
    if (decal) {
      mesh.rotation.x = Math.PI / 2;
      mesh.bakeCurrentTransformIntoVertices();
    }
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;

    const matrices = new Float32Array(capacity * 16);
    mesh.thinInstanceSetBuffer("matrix", matrices, 16, false);
    mesh.thinInstanceCount = 0;
    mesh.setEnabled(false);

    const b: Bucket = { mesh, matrices, count: 0 };
    map.set(hex, b);
    return b;
  }

  burst(o: Burst3dOptions): void {
    const spread = o.spread ?? Math.PI * 2;
    const baseAngle = o.angle ?? 0;
    const colors = Array.isArray(o.color) ? o.color : [o.color as number];

    for (let i = 0; i < o.count; i++) {
      const p = this.take();
      if (!p) return;

      const a = baseAngle + (Math.random() - 0.5) * spread;
      const speed = o.speed * (1 + (Math.random() - 0.5) * (o.speedVariance ?? 0.6));
      const lift = (o.lift ?? 0) * (1 + (Math.random() - 0.5) * (o.liftVariance ?? 0.7));

      p.x = o.x;
      p.z = o.z;
      p.y = o.y ?? 0.6;
      p.vx = Math.cos(a) * speed;
      p.vz = Math.sin(a) * speed;
      p.vy = lift;
      p.maxLife = o.life * (1 + (Math.random() - 0.5) * (o.lifeVariance ?? 0.4));
      p.life = p.maxLife;
      p.size = o.size * (1 + (Math.random() - 0.5) * (o.sizeVariance ?? 0.5));
      p.gravity = o.gravity ?? 0;
      p.drag = o.drag ?? 1;
      p.decal = o.decal ?? false;
      p.decalColor = o.decalColor ?? colors[0]!;
      p.shrink = o.shrink ?? false;
      p.streak = o.streak ?? false;
      p.hex = colors[(Math.random() * colors.length) | 0]!;
    }
  }

  /** Plama bez lecącej cząstki — np. kałuża pod zabitym wrogiem. */
  splat(x: number, z: number, size: number, hex: number, alpha = 0.55, life = 14): void {
    const d = this.takeDecal();
    if (!d) return;
    d.active = true;
    d.x = x;
    d.z = z;
    d.size = size * (0.75 + Math.random() * 0.5);
    d.rot = Math.random() * Math.PI;
    d.maxLife = life;
    d.life = life;
    d.alpha0 = alpha;
    d.hex = hex;
  }

  update(dt: number): void {
    for (const b of this.buckets.values()) b.count = 0;
    for (const b of this.decalBuckets.values()) b.count = 0;

    for (const p of this.pool) {
      if (!p.active) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }

      p.vy -= p.gravity * dt;
      if (p.drag !== 1) {
        const k = Math.pow(p.drag, dt);
        p.vx *= k;
        p.vz *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      // Zetknięcie z podłożem: koniec lotu, ewentualnie plama. To jest różnica
      // między „efektem cząsteczkowym" a areną, po której widać, że się biło.
      if (p.y <= 0.02 && p.gravity > 0) {
        if (p.decal) this.splat(p.x, p.z, p.size * 2.4, p.decalColor, 0.42, 12);
        p.active = false;
        continue;
      }

      const t = p.life / p.maxLife;
      // Zanikanie przez kurczenie — materiał jest wspólny dla kubełka, więc
      // alfa per cząstka nie wchodzi w grę (patrz nagłówek pliku).
      const fade = t > 0.55 ? 1 : t / 0.55;
      const scale = (p.shrink ? p.size * (0.25 + t * 0.75) : p.size) * fade;

      if (p.streak) {
        const speed = Math.hypot(p.vx, p.vy, p.vz);
        this.tmpScale.set(scale * (1 + speed * 0.12), scale * 0.5, scale * 0.5);
        Quaternion.FromEulerAnglesToRef(0, -Math.atan2(p.vz, p.vx), 0, this.tmpQuat);
      } else {
        this.tmpScale.set(scale, scale, scale);
        this.tmpQuat.copyFromFloats(0, 0, 0, 1);
      }
      this.tmpPos.set(p.x, p.y, p.z);
      Matrix.ComposeToRef(this.tmpScale, this.tmpQuat, this.tmpPos, this.tmpMat);

      const b = this.bucket(this.buckets, p.hex, false);
      if (b.count < CAPACITY) {
        this.tmpMat.copyToArray(b.matrices, b.count * 16);
        b.count++;
      }
    }

    for (const b of this.buckets.values()) {
      b.mesh.thinInstanceCount = b.count;
      if (b.count > 0) b.mesh.thinInstanceBufferUpdated("matrix");
      b.mesh.setEnabled(b.count > 0);
    }

    // — plamy
    for (const d of this.decals) {
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.active = false;
        continue;
      }
      const t = d.life / d.maxLife;
      // Plamy też gasną skalą; w ostatniej trzeciej życia kurczą się do zera.
      const fade = t < 0.34 ? t / 0.34 : 1;
      this.tmpScale.set(d.size * fade, 1, d.size * 0.85 * fade);
      Quaternion.FromEulerAnglesToRef(0, d.rot, 0, this.tmpQuat);
      this.tmpPos.set(d.x, 0.035, d.z);
      Matrix.ComposeToRef(this.tmpScale, this.tmpQuat, this.tmpPos, this.tmpMat);

      const b = this.bucket(this.decalBuckets, d.hex, true);
      if (b.count < DECAL_CAPACITY) {
        this.tmpMat.copyToArray(b.matrices, b.count * 16);
        b.count++;
      }
    }

    for (const b of this.decalBuckets.values()) {
      b.mesh.thinInstanceCount = b.count;
      if (b.count > 0) b.mesh.thinInstanceBufferUpdated("matrix");
      b.mesh.setEnabled(b.count > 0);
    }
  }

  get activeCount(): number {
    let n = 0;
    for (const p of this.pool) if (p.active) n++;
    return n;
  }

  clear(): void {
    for (const p of this.pool) p.active = false;
    for (const d of this.decals) d.active = false;
    for (const b of this.buckets.values()) b.mesh.thinInstanceCount = 0;
    for (const b of this.decalBuckets.values()) b.mesh.thinInstanceCount = 0;
  }

  dispose(): void {
    for (const b of this.buckets.values()) b.mesh.dispose(false, true);
    for (const b of this.decalBuckets.values()) b.mesh.dispose(false, true);
    this.buckets.clear();
    this.decalBuckets.clear();
  }

  // ─────────────────────────────────────────────────────────── wewnętrzne

  /** Przydział pierścieniowy; pełna pula gubi cząstkę zamiast nadpisywać żywą. */
  private take(): Particle | null {
    const n = this.pool.length;
    for (let i = 0; i < n; i++) {
      const idx = (this.cursor + i) % n;
      const p = this.pool[idx]!;
      if (!p.active) {
        p.active = true;
        this.cursor = (idx + 1) % n;
        return p;
      }
    }
    return null;
  }

  /** Plamy wolno nadpisywać — nie poruszają się, więc nie migoczą. */
  private takeDecal(): Decal | null {
    const n = this.decals.length;
    for (let i = 0; i < n; i++) {
      const idx = (this.decalCursor + i) % n;
      const d = this.decals[idx]!;
      if (!d.active) {
        this.decalCursor = (idx + 1) % n;
        return d;
      }
    }
    const d = this.decals[this.decalCursor]!;
    this.decalCursor = (this.decalCursor + 1) % n;
    return d;
  }
}

export { Color4 };
