/**
 * Scena 3D: kamera, światła, mgła, arena, post-processing.
 *
 * Cały „klimat" tej gry musi powstać **bez jednego pliku graficznego** — projekt
 * nie ma i nie będzie miał assetów (README §Budżet). W 2D robiły to kolory
 * i kształty; w 3D robi to światło. Konkretnie cztery rzeczy, w tej kolejności
 * ważności:
 *
 *  1. **Mgła wykładnicza** — daje głębię i odcina horyzont, więc arena wygląda
 *     na fragment większego świata, a nie na talerz zawieszony w próżni.
 *  2. **Cienie kropelkowe** — jedyna rzecz, która osadza postać na ziemi.
 *     Bez nich wszystko unosi się kilka centymetrów nad podłożem. Świadomie
 *     NIE używamy mapy cieni: postacie są instancjami współdzielącymi szablon,
 *     a mapa cieni pomija niewidoczny mesh źródłowy. Dysk pod postacią,
 *     przesunięty zgodnie z kierunkiem słońca, daje ten sam odczyt za ułamek
 *     kosztu i bez dodatkowego przebiegu renderowania.
 *  3. **Glow layer** — świecące akcenty sylwetek (emblemat gracza, oczy wrogów,
 *     jad pełzacza) zaczynają realnie oświetlać otoczenie.
 *  4. **Gradacja kolorów + winieta** — spina paletę i kieruje wzrok do środka.
 *
 * Kamera jest **ortograficzna pod kątem 3/4**, a nie perspektywiczna. To decyzja
 * rozgrywkowa, nie estetyczna: rzut równoległy zachowuje czytelność telegrafów
 * AoE (okrąg na ziemi jest zawsze tą samą elipsą, niezależnie od odległości od
 * środka kadru) i pozwala odwzorować sterowanie kursorem jeden do jednego.
 * Perspektywa psułaby oba, a zysk wizualny dawałaby znikomy przy tym kącie.
 */
import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Scene } from "@babylonjs/core/scene";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves";

import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import "@babylonjs/core/Materials/Textures/Loaders/index";

import { ARENA_RADIUS } from "@ms/core";
import { toColor3 } from "./bodies.ts";

/**
 * Dwa widoki. TPP jest domyślny; rzut 3/4 zostaje w Opcjach, bo lepiej czyta
 * pole walki przy dużych pakietach — perspektywa zza pleców zasłania to,
 * co dzieje się za postacią.
 */
export type CameraMode = "tpp" | "iso";

/**
 * Rzut 3/4 (ortograficzny). 35.264° to kąt izometrii prawdziwej (arctan(1/√2));
 * używamy nieco większego, bo przy 35° postacie zasłaniają się w gęstym pakiecie.
 */
const ISO_PITCH = (42 * Math.PI) / 180;
const ISO_YAW = (45 * Math.PI) / 180;
/** Ile metrów świata mieści się w połowie wysokości kadru. */
const CAMERA_HALF_HEIGHT = 9.2;

/**
 * TPP: kamera zza pleców, uniesiona i pochylona w dół.
 *
 * Kąt jest kompromisem. Niżej niż 22° i nie widać, co leży na ziemi (telegrafy
 * AoE stają się nieczytelne, a to one decydują o przeżyciu). Wyżej niż 30°
 * i przestaje to być TPP, a robi się kamera taktyczna.
 */
const TPP_PITCH = (26 * Math.PI) / 180;
/** Odległość kamery od postaci i jej uniesienie nad poziom gruntu. */
const TPP_DISTANCE = 7.6;
const TPP_HEIGHT = 1.35;
/** Punkt patrzenia jest nad głową postaci, nie w stopach. */
const TPP_LOOK_HEIGHT = 1.5;
const TPP_FOV = 0.95;

export const PALETTE = {
  fog: 0x080b12,
  ground: 0x151a25,
  groundInner: 0x1f2735,
  /** Rant świeci, ale nie oślepia — emisja jest tu przyciemniana w materiale. */
  rim: 0x2e6f8c,
  obstacle: 0x39435a,
  /** Słońce lekko ciepłe: kontra dla chłodnego wypełnienia, inaczej scena
   *  robi się jednolicie niebieska i traci głębię. */
  sun: 0xffe9cf,
  ambientSky: 0x38506f,
  ambientGround: 0x1a1420,
} as const;

export interface SceneBundle {
  engine: AbstractEngine;
  scene: Scene;
  camera: TargetCamera;
  mode: CameraMode;
  shadows: ShadowGenerator;
  glow: GlowLayer;
  pipeline: DefaultRenderingPipeline;
  sun: DirectionalLight;
  arenaRim: Mesh;
  /**
   * Ustawia kadr. `yaw` jest używany wyłącznie w TPP — to kierunek, w którym
   * patrzy kamera (radiany, zgodnie z osią świata).
   */
  lookAtWorld(x: number, z: number, shakeX: number, shakeY: number, yaw: number): void;
  resize(): void;
}

/**
 * Silnik: **WebGL2 domyślnie**, WebGPU na żądanie (`?engine=webgpu`).
 *
 * Kolejność jest odwrotna niż podpowiada marketing WebGPU, i to jest świadome.
 * Ścieżki WebGPU **nie da się u nas zweryfikować automatycznie**: headless
 * Chromium jej nie ma, a z flagami wymuszającymi po prostu się wywala. Wysłanie
 * niesprawdzonej ścieżki jako domyślnej skończyło się dokładnie tak, jak
 * musiało — czarny ekran u użytkownika przy zielonych testach.
 *
 * WebGL2 jest przetestowany end-to-end (15/15 E2E, zrzuty na wszystkich progach
 * jakości) i na tym sprzęcie w zupełności wystarcza: scena ma kilkadziesiąt
 * siatek i jeden przebieg post-processingu.
 *
 * `?engine=webgpu` zostaje, żeby dało się tę ścieżkę zbadać bez przebudowy —
 * gdy okaże się sprawna na realnym sprzęcie, wystarczy zamienić domyślną.
 */
export async function createEngine(canvas: HTMLCanvasElement): Promise<AbstractEngine> {
  const wanted = new URLSearchParams(location.search).get("engine");

  if (wanted === "webgpu" && (await WebGPUEngine.IsSupportedAsync)) {
    try {
      const engine = new WebGPUEngine(canvas, {
        antialias: true,
        stencil: true,
        powerPreference: "high-performance",
      });
      await engine.initAsync();
      console.info("[render3d] silnik: WebGPU (wymuszony)");
      return engine;
    } catch (err) {
      console.warn("[render3d] WebGPU zawiódł, schodzę na WebGL2", err);
    }
  }

  const engine = new Engine(canvas, true, {
    stencil: true,
    powerPreference: "high-performance",
    // `preserveDrawingBuffer` jest wymagany, żeby dało się zrobić zrzut ekranu
    // z canvasu — testy diagnostyczne z tego korzystają.
    preserveDrawingBuffer: true,
  });
  console.info("[render3d] silnik: WebGL2");
  return engine;
}

/**
 * Trzy progi jakości. Pomiar w rasteryzacji programowej (headless, 1280×800):
 *
 *   pełny post-processing + glow ... 164 ms/klatkę
 *   bez post-processingu .......... 76 ms  (−88)
 *   bez glow ...................... 43 ms  (−33)
 *   bez cieni i mgły .............. 49 ms  (bez różnicy)
 *
 * Wniosek: kosztują wyłącznie **pełnoekranowe przebiegi**. Cienie i mgła są
 * praktycznie darmowe, więc `minimal` je zachowuje — to one niosą klimat,
 * a bloom jest dodatkiem.
 */
export type Quality = "high" | "low" | "minimal";

export function buildScene(engine: AbstractEngine, quality: Quality, mode: CameraMode = "tpp"): SceneBundle {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(...toColor3(PALETTE.fog).asArray(), 1);
  scene.ambientColor = toColor3(PALETTE.ambientGround);

  /*
   * Odłączamy wejście Babylona — gra ma własną warstwę (`input/input.ts`)
   * i własny raycast do celowania, więc pickowanie silnika jest zbędne.
   *
   * To nie jest optymalizacja, tylko **naprawa błędu**: scena Babylona
   * nasłuchuje `pointerdown` i woła na nim `preventDefault()`, a to zgodnie
   * ze specyfikacją Pointer Events tłumi zgodnościowe zdarzenia myszy
   * (`mousedown`, `mouseup`, `click`). `InputManager` słucha `mousedown`,
   * więc atak przestawał działać całkowicie: gracz biegał, obrywał i nie
   * potrafił nikogo uderzyć. Objaw wyglądał na zepsutą walkę, a przyczyna
   * siedziała w warstwie prezentacji.
   */
  scene.detachControl();

  /*
   * Mgła: **liniowa**, nie wykładnicza.
   *
   * Przy kamerze ORTOGRAFICZNEJ cała geometria leży mniej więcej w tej samej
   * odległości od kamery (tu ~60 j.), bo rzut równoległy nie zmienia rozmiaru
   * wraz z głębią. Mgła wykładnicza liczona od kamery przyciemniała więc scenę
   * RÓWNOMIERNIE — zamiast dawać głębię, po prostu gasiła obraz.
   *
   * Zakres liniowy rozpięty wokół odległości kamery (60 ± promień areny) daje
   * to, o co chodzi: bliższa krawędź areny czysta, dalsza tonie w mroku.
   */
  scene.fogColor = toColor3(PALETTE.fog);
  if (mode === "tpp") {
    // Perspektywa daje realne odległości od kamery, więc mgła wykładnicza
    // działa tak, jak powinna — i jest tańsza w strojeniu niż zakres liniowy.
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.038;
  } else {
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogStart = 52;
    scene.fogEnd = 96;
  }

  // ── kamera ────────────────────────────────────────────────────────────────
  const camera = new TargetCamera("cam", Vector3.Zero(), scene);
  scene.activeCamera = camera;

  if (mode === "iso") {
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    camera.minZ = -80;
    camera.maxZ = 220;
  } else {
    camera.mode = Camera.PERSPECTIVE_CAMERA;
    camera.fov = TPP_FOV;
    camera.minZ = 0.35;
    camera.maxZ = 180;
  }

  // Kierunek patrzenia rzutu 3/4 — kamera stoi „nad i z boku", stały kąt.
  const isoDir = new Vector3(
    Math.cos(ISO_PITCH) * Math.sin(ISO_YAW),
    -Math.sin(ISO_PITCH),
    Math.cos(ISO_PITCH) * Math.cos(ISO_YAW),
  );
  const camOffset = isoDir.scale(-60);

  // ── światła ───────────────────────────────────────────────────────────────
  // Półkuliste daje wypełnienie (niebo/ziemia), kierunkowe rzuca cienie.
  const ambient = new HemisphericLight("amb", new Vector3(0, 1, 0), scene);
  ambient.diffuse = toColor3(PALETTE.ambientSky);
  ambient.groundColor = toColor3(PALETTE.ambientGround);
  ambient.intensity = 0.28;

  const sun = new DirectionalLight("sun", new Vector3(-0.55, -1, 0.42), scene);
  sun.position = new Vector3(24, 46, -20);
  sun.diffuse = toColor3(PALETTE.sun);
  // 2.1 prześwietlało podłoże: ciemny materiał 0x1f2735 wychodził jasnoniebieski.
  // Klimat robi kontrast, nie moc światła.
  sun.intensity = 1.15;
  sun.shadowMinZ = 8;
  sun.shadowMaxZ = 110;

  const shadowSize = quality === "high" ? 2048 : quality === "low" ? 1024 : 512;
  const shadows = new ShadowGenerator(shadowSize, sun);
  // Cienie miękkie na wysokiej jakości, twarde na niskiej — różnica w koszcie
  // jest znaczna, a na słabym sprzęcie ostry cień i tak wygląda lepiej niż
  // pływająca klatka.
  if (quality === "high") {
    shadows.useBlurExponentialShadowMap = true;
    shadows.blurKernel = 24;
  } else {
    shadows.usePercentageCloserFiltering = false;
  }
  shadows.darkness = 0.42;
  shadows.bias = 0.0015;
  shadows.normalBias = 0.02;

  // ── arena ─────────────────────────────────────────────────────────────────
  const arenaRim = buildArena(scene, shadows);

  // ── warstwa poświaty ──────────────────────────────────────────────────────
  // To ona sprawia, że emblemat gracza i oczy wrogów rozjaśniają otoczenie.
  // Na progu `minimal` znika: kosztuje 33 ms/klatkę pełnoekranowego rozmycia,
  // a materiały emisyjne i tak zostają jasne, więc akcenty pozostają widoczne.
  const glow = new GlowLayer("glow", scene, {
    mainTextureSamples: quality === "high" ? 2 : 1,
    blurKernelSize: quality === "high" ? 40 : 20,
  });
  if (quality === "minimal") glow.isEnabled = false;
  // 0.9 zamieniało każdy akcent w białą plamę — poświata ma podkreślać,
  // a nie zastępować sylwetkę.
  glow.intensity = quality === "high" ? 0.32 : 0.22;

  // ── post-processing ───────────────────────────────────────────────────────
  // Najdroższy element sceny (88 ms/klatkę w rasteryzacji programowej).
  // Na `minimal` pipeline w ogóle nie powstaje — dołączenie go i wyłączenie
  // efektów nadal kosztowałoby przebieg kopiujący kadr.
  const pipeline = new DefaultRenderingPipeline("post", true, scene, quality === "minimal" ? [] : [camera]);
  pipeline.samples = quality === "high" ? 4 : 1;
  pipeline.fxaaEnabled = quality === "low";

  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.82;
  pipeline.bloomWeight = quality === "high" ? 0.22 : 0.14;
  pipeline.bloomKernel = quality === "high" ? 48 : 24;
  pipeline.bloomScale = 0.5;

  // Winieta + gradacja: chłodne cienie, ciepłe światła. Bez tego paleta rozjeżdża
  // się na neutralną szarość, gdy nałoży się mgłę na szare podłoże.
  pipeline.imageProcessingEnabled = true;
  const ip = pipeline.imageProcessing;
  ip.vignetteEnabled = true;
  ip.vignetteWeight = 1.8;
  ip.vignetteStretch = 0.4;
  ip.vignetteColor = new Color4(0.02, 0.03, 0.06, 0);
  ip.contrast = 1.1;
  ip.exposure = 1.08;
  ip.toneMappingEnabled = true;

  const curves = new ColorCurves();
  curves.globalSaturation = 94;
  curves.shadowsHue = 220;
  curves.shadowsDensity = 16;
  curves.highlightsHue = 34;
  curves.highlightsDensity = 10;
  ip.colorCurves = curves;
  ip.colorCurvesEnabled = true;

  // Głębia ostrości tylko na wysokiej jakości: rozmycie tła podkreśla, że
  // arena jest fragmentem większego świata. Na słabym sprzęcie to pierwszy
  // efekt do wycięcia — kosztuje najwięcej, a niesie najmniej informacji.
  if (quality === "high") {
    pipeline.depthOfFieldEnabled = true;
    pipeline.depthOfField.focalLength = 190;
    pipeline.depthOfField.fStop = 5.2;
    pipeline.depthOfField.focusDistance = 42_000;
  }

  const bundle: SceneBundle = {
    engine,
    scene,
    camera,
    mode,
    shadows,
    glow,
    pipeline,
    sun,
    arenaRim,
    lookAtWorld(x, z, shakeX, shakeY, yaw) {
      if (mode === "tpp") {
        // Kamera siedzi na łuku za postacią: cofnięta o `TPP_DISTANCE`
        // w kierunku przeciwnym do patrzenia i uniesiona zgodnie z pochyleniem.
        const back = Math.cos(TPP_PITCH) * TPP_DISTANCE;
        const up = Math.sin(TPP_PITCH) * TPP_DISTANCE + TPP_HEIGHT;
        camera.position.set(
          x + shakeX - Math.cos(yaw) * back,
          up,
          z + shakeY - Math.sin(yaw) * back,
        );
        // Patrzymy nieco PRZED postać, a nie na nią — dzięki temu gracz widzi
        // więcej tego, na co idzie, niż tego, co zostawia za sobą.
        camera.setTarget(
          new Vector3(x + shakeX + Math.cos(yaw) * 2.2, TPP_LOOK_HEIGHT, z + shakeY + Math.sin(yaw) * 2.2),
        );
        sun.position.set(x + 24, 46, z - 20);
        return;
      }

      const target = new Vector3(x + shakeX, 0, z + shakeY);
      camera.position.copyFrom(target).addInPlace(camOffset);
      camera.setTarget(target);
      // Słońce podąża za graczem, żeby mapa cieni nie musiała pokrywać całej
      // areny — mniejszy obszar to ostrzejszy cień przy tej samej rozdzielczości.
      sun.position.set(x + 24, 46, z - 20);
    },
    resize() {
      if (mode === "tpp") return; // perspektywa skaluje się sama z proporcji kadru
      const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
      camera.orthoTop = CAMERA_HALF_HEIGHT;
      camera.orthoBottom = -CAMERA_HALF_HEIGHT;
      camera.orthoLeft = -CAMERA_HALF_HEIGHT * aspect;
      camera.orthoRight = CAMERA_HALF_HEIGHT * aspect;
    },
  };

  bundle.resize();
  return bundle;
}

/**
 * Arena. Trzy warstwy geometrii zamiast tekstury: płyta, wewnętrzny podest
 * i świecący rant. Wszystko statyczne i zamrożone — podłoże nie zmienia się
 * przez całą sesję, więc nie ma powodu, żeby silnik co klatkę liczył jego macierz.
 */
function buildArena(scene: Scene, shadows: ShadowGenerator): Mesh {
  const R = ARENA_RADIUS;

  const groundMat = new StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = toColor3(PALETTE.ground);
  groundMat.specularColor = Color3.Black();
  groundMat.freeze();

  // Wielki dysk poza areną — bez niego mgła urywa się na krawędzi i widać pustkę.
  const outer = CreateGround("outer", { width: R * 9, height: R * 9, subdivisions: 1 }, scene);
  outer.material = groundMat;
  outer.position.y = -0.35;
  outer.receiveShadows = true;
  outer.freezeWorldMatrix();
  outer.isPickable = false;

  const plateMat = new StandardMaterial("plateMat", scene);
  plateMat.diffuseColor = toColor3(PALETTE.groundInner);
  plateMat.specularColor = Color3.Black();
  plateMat.freeze();

  const plate = CreateCylinder("plate", { diameter: R * 2, height: 0.7, tessellation: 72 }, scene);
  plate.material = plateMat;
  plate.position.y = -0.35;
  plate.receiveShadows = true;
  plate.freezeWorldMatrix();
  plate.isPickable = false;

  const innerMat = new StandardMaterial("innerMat", scene);
  innerMat.diffuseColor = toColor3(PALETTE.groundInner).scale(1.22);
  innerMat.specularColor = Color3.Black();
  innerMat.freeze();

  const inner = CreateCylinder("inner", { diameter: R * 1.1, height: 0.16, tessellation: 64 }, scene);
  inner.material = innerMat;
  inner.position.y = 0.01;
  inner.receiveShadows = true;
  inner.freezeWorldMatrix();
  inner.isPickable = false;

  // Rant: torus w kolorze emisyjnym. Pulsuje w `sync`, więc jako jedyny
  // element areny nie jest zamrożony.
  const rimMat = new StandardMaterial("rimMat", scene);
  rimMat.diffuseColor = Color3.Black();
  rimMat.emissiveColor = toColor3(PALETTE.rim).scale(0.55);
  rimMat.specularColor = Color3.Black();

  const rim = CreateTorus("rim", { diameter: R * 2, thickness: 0.16, tessellation: 80 }, scene);
  rim.material = rimMat;
  rim.position.y = 0.06;
  rim.isPickable = false;

  shadows.getShadowMap()?.renderList?.push();
  return rim;
}
