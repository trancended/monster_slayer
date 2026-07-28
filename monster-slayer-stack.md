# Monster Slayer — Stack technologiczny

**Wersja:** 1.0 · Dokument towarzyszący `monster-slayer-gdd.md` · Platforma: przeglądarka, dev na localhost

---

## 0. Zasada nadrzędna

**Pętla 60 Hz nigdy nie dotyka sieci.** Gra działa w 100% po stronie klienta, offline-first. Serwer jest cienki: zapisy, walidacja, telemetria, live-ops. Każda architektura, w której klatka czeka na odpowiedź serwera, jest w single playerze błędem.

---

## 1. Klient — rdzeń gry

| Element | Technologia | Dlaczego ta |
|---|---|---|
| Język | **TypeScript** (strict, `noUncheckedIndexedAccess`) | Systemy z GDD (afiksy, modyfikatory, stany) bez typów rozjadą się w 3 tygodnie |
| Renderer | **PixiJS v8** | Przepisany renderer z WebGPU jako równorzędnym backendem i Render Layers (kolejność rysowania niezależna od grafu sceny — kluczowe w izometrii). ~150 KB gzip, tree-shakeable |
| Pętla gry | **Własna**, fixed timestep 60 Hz (akumulator) + interpolacja renderu | I-frames uniku (0.10–0.42 s) muszą być identyczne przy 60 i 144 Hz |
| Architektura encji | **Własny ECS**, `Float32Array` na pozycje/HP/cooldowny | Zero alokacji w walce, lokalność cache |
| Kolizje | **Własny spatial hash grid** + testy koło↔koło i koło↔AABB | Top-down ARPG nie potrzebuje rigid-body. Silnik fizyki to +300 KB i utrata determinizmu |
| Pathfinding | **Flow field** na siatce nav, regenerowany przy zmianie komórki gracza | 24 wrogów × A* co klatkę zabije budżet 4 ms |
| RNG | Własny xorshift128+ z jawnym ziarnem, osobne strumienie loot/crit/AI | Powtarzalne bugi, replay z telemetrii |
| Animacje | Atlasy sprite'ów + własny animator sterowany JSON-em | Spine/DragonBones dopiero w v2 — licencja i pipeline nie są warte v1 |
| Audio | **Web Audio API** + cienki wrapper z busami (master/music/sfx/ui) | GDD wymaga duckingu −6 dB i osobnych suwaków. Howler ani `@pixi/sound` nie dadzą grafu gainów |
| HUD, menu, ekwipunek | **DOM overlay** — Svelte 5 lub Solid | Dostępność (skalowanie czcionek, czytniki ekranu, i18n) w DOM jest darmowa, w canvasie kosztuje tygodnie. Brak VDOM = brak konkurencji o budżet klatki |
| Liczby obrażeń, VFX, telegrafy | Canvas (Pixi), pooling | Muszą żyć w przestrzeni świata |
| Input | Własny mapper: `KeyboardEvent.code` + **Gamepad API** + Pointer Lock | Remapping i buforowanie 150 ms wymagają własnej warstwy |
| Zapis stanu | **IndexedDB** (`idb-keyval`) + sync do backendu | `localStorage` ma 5 MB, jest synchroniczny i blokuje wątek główny |
| Walidacja danych | **Zod** (schematy współdzielone z definicjami balansu) | Chroni przed uszkodzonym save'em i złym JSON-em z serwera |

**Alternatywa:** **Phaser 4 „Caladan"** (kwiecień 2026) — przepisany renderer, zachowane API, w komplecie scene manager, fizyka Arcade/Matter, tweeny, input, audio, tilemapy i particles. Szybciej dojdziesz do M1 kosztem większego bundla i mniejszej kontroli nad architekturą; przy własnym ECS i systemie staggera zacznie przeszkadzać około M4.

---

## 2. Backend — Elixir

| Element | Technologia | Rola |
|---|---|---|
| Runtime | **Elixir 1.19+ / OTP 27** | |
| API | **Phoenix 1.8** (JSON, REST) | Sesja gościa, sync zapisów, walidacja postępu |
| Real-time | **Phoenix Channels** (WebSocket) | Batchowany ingest telemetrii, push balansu, ścieżka do co-opa w v2 |
| Persystencja | **Ecto + PostgreSQL** | Postgres, nie MariaDB — Oban i Ecto mają tam najlepszą ścieżkę |
| Zadania w tle | **Oban** | Agregacja telemetrii, nocny raport balansu, czyszczenie sesji |
| Cache | **ETS** (własny GenServer) / Cachex | Definicje balansu, leaderboardy, sesje |
| Panel admina + telemetria | **Phoenix LiveView** | Heatmapa śmierci per pomieszczenie, krzywa czasu do poziomu, wykorzystanie węzłów drzewka — na żywo w trakcie playtestu |
| Auth | Token urządzenia (gość) + opcjonalne konto przez magic link | Nikt nie zakłada konta, żeby kliknąć w grę na itch.io |
| **Live-ops** | Definicje balansu serwowane z `ETag`, klient cache'uje warunkowo | **Zabójcza funkcja tego stacku:** stroisz HP orka w produkcji bez redeployu klienta |
| Hot reload (dev) | `FileSystem` watcher + PubSub → kanał `balance:live` | Zmiana `/data/*.json` widoczna w grze w < 1 s, bez przeładowania strony |

---

## 3. Wspólne źródło prawdy dla balansu

```
/data/*.json          ← jedyne źródło prawdy (wrogowie, afiksy, umiejętności, krzywa XP)
   ├── → typy TS + schematy Zod   (generowane w CI)
   ├── → czytane przez Phoenix    (serwowane klientowi z wersją i ETagiem)
   ├── → wejście symulatora       (Node/Bun, headless)
   └── → walidacja w CI           (pipeline pada przy niespójności)
```

---

## 4. Symulator balansu

**W TypeScript, nie w Elixirze.** Symulator importuje *dokładnie ten sam* kod walki co gra i działa headless w Node/Bun (`worker_threads`, 10 000 walk). Osobna implementacja w drugim języku rozjedzie się z produkcją w ciągu kilku tygodni i będzie gorsza niż jej brak.

Elixir zostaje przy analizie **realnych danych z playtestów** — agregacja, percentyle, wykrywanie spike'ów trudności. Tam nic nie duplikuje.

Wynik symulacji: tabela TTK/DPS per poziom per build → artefakt CI + test regresji w Vitest (zmiana TTK > 15% wywala pipeline).

---

## 5. Assety i produkcja treści

| Element | Narzędzie |
|---|---|
| Sprity i animacje | **Aseprite** |
| Atlasy | free-tex-packer → format JSON Pixi (`--multipack`, POT) |
| Areny i tilemapy | **Tiled** (.tmx → JSON) + własny importer |
| Tekstury | WebP; opcjonalnie KTX2/Basis przy dużych atlasach |
| SFX | Reaper lub Audacity; źródła: Freesound, Sonniss GDC packs |
| Format audio | Opus w `.webm` + fallback `.m4a` dla Safari |
| Muzyka adaptacyjna | Osobne stemy (eksploracja / walka / boss), crossfade na `GainNode` |

---

## 6. Build, CI i infrastruktura

| Element | Technologia |
|---|---|
| Monorepo | **pnpm workspaces** (`client`, `core`, `sim`, `data`) + `server` (Elixir) |
| Bundler | **Vite** (+ `vite-plugin-pwa` dla trybu offline) |
| Lint + format | **Biome** (jedno narzędzie zamiast ESLint + Prettier) |
| Testy jednostkowe | **Vitest** |
| Smoke E2E | **Playwright** (start gry, wejście do strefy, zabicie wroga) |
| Profilowanie | Chrome DevTools Performance, `stats.js`, Spector.js, `rollup-plugin-visualizer` |
| CI/CD | **GitLab CI** — stage'e: `lint → test → sim-balance → build → deploy` |
| Hosting klienta | **Cloudflare Pages / R2 + CDN**, assety immutable z hashem w nazwie |
| Hosting backendu | Docker → Fly.io (świetne wsparcie BEAM i klastrowania) albo własny k8s |
| Baza | Managed Postgres (Neon / Fly Postgres); lokalnie Docker |
| Monitoring | **PromEx → Prometheus → Grafana** + Sentry dla błędów JS |

---

## 7. Budżet przeglądarkowy (twarde limity)

| Metryka | Cel |
|---|---|
| JS gzip | < 400 KB |
| Assety startowe (przed pierwszą areną) | < 6 MB |
| Time to interactive na 4G | < 4 s |
| Budżet klatki | 16.6 ms — symulacja ≤ 4 ms, render ≤ 6 ms, DOM ≤ 1 ms |
| Draw calls | ≤ 300 |
| Alokacje w trakcie walki | **0** |
| Sprzęt referencyjny | Zintegrowana grafika Intel Iris Xe @ 1080p, 60 FPS, Chrome i Firefox |

---

## 8. Czego świadomie nie brać

| Odrzucone | Powód |
|---|---|
| **Godot 4 → web export** | Web export Godota wciąż celuje wyłącznie w WebGL 2.0 (4.7 z czerwca 2026 dodał eksport wasm64 znoszący limit 4 GB). Ciężki bundle WASM, problemy z latencją audio i mobilnym Safari. Do desktopu świetny, do webu — kompromis bez przewagi |
| Matter.js / Rapier | Rigid-body niepotrzebne w top-down. Bundle + niedeterminizm |
| React do HUD | Rekoncyliacja VDOM przy każdym ticku HP konkuruje o budżet klatki |
| LiveView do renderowania gry | Diffing DOM przez WebSocket to nie jest 60 FPS. LiveView tylko do panelu admina |
| `localStorage` na zapisy | 5 MB, synchroniczny, blokuje wątek główny |
| Serwer autorytatywny w v1 | Latencja bez zysku — single player. Wchodzi przy leaderboardach lub co-opie |
| Elixir jako silnik klienta | Brak dostępu do GPU, koszt granicy NIF, brak pipeline'u assetów, zero historii shipowania gier na BEAM |

---

## 9. Podsumowanie: co w czym

```
PRZEGLĄDARKA
  ├─ Canvas (PixiJS v8) ...... świat, sprity, VFX, liczby obrażeń
  ├─ DOM (Svelte 5) .......... HUD, menu, ekwipunek, drzewko, opcje, a11y
  ├─ TypeScript ECS .......... symulacja 60 Hz, walka, AI, loot
  ├─ Web Audio ............... miks, busy, ducking, muzyka adaptacyjna
  └─ IndexedDB ............... zapis offline-first
            │  HTTP (rzadko) + WebSocket (telemetria batch, balance:live)
            ▼
ELIXIR / PHOENIX
  ├─ REST API ................ sesja, sync zapisów, walidacja postępu
  ├─ BalanceServer (ETS) ..... live-ops, hot reload w dev
  ├─ Channels ................ ingest telemetrii, przyszły co-op
  ├─ Oban .................... agregacje nocne, raporty
  ├─ LiveView /admin ......... dashboard playtestów
  └─ Ecto + Postgres ......... konta, zapisy, telemetria, leaderboardy

NODE / BUN (offline, w CI)
  └─ Symulator balansu ....... ten sam kod walki, 10k walk, tabela TTK/DPS
```

---

## 10. Konsekwencja dla planu produkcji

Brak edytora scen oznacza, że wszystko projektujesz kodem — ale w M1 to zaleta, nie wada. Greybox w Pixi to prostokąty rysowane proceduralnie, więc iteracja nad game feelem jest szybsza niż w pełnym silniku. Edytor wchodzi dopiero od M2 w postaci Tiled + własny importer JSON; **własnego edytora nie budujemy nigdy.**
