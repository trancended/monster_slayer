# Monster Slayer

Izometryczne action-RPG w przeglądarce. Implementacja zgodna z `monster-slayer-gdd.md`,
`monster-slayer-stack.md` i `monster-slayer-localhost.md`.

**Status:** grywalny greybox — kamienie milowe **M0–M4** z GDD §13.
Backend Phoenix (M3: sync zapisów, telemetria, `/admin`) jeszcze nie powstał — gra jest
offline-first i działa bez niego w całości. Szczegóły w [Zakres](#zakres).

---

## Uruchomienie — jedno polecenie

Host potrzebuje **wyłącznie Dockera**. Ani Node, ani pnpm, ani Elixir nie są wymagane.

```bash
docker compose up
```

Gra: **<http://localhost:5173>**

To wariant deweloperski: Vite z HMR, źródła zamontowane z hosta, więc zmiana w
`packages/` albo `data/` jest widoczna od razu.

### Wariant produkcyjny (statyki za nginx)

```bash
docker compose --profile prod up --build web
```

Gra: **<http://localhost:8080>**

### Zatrzymanie

```bash
docker compose down
```

---

## Uruchomienie bez Dockera

Wymagania: Node ≥ 22, pnpm ≥ 10 (`corepack enable pnpm`).

```bash
pnpm install
pnpm dev          # → http://localhost:5173
```

| Polecenie | Co robi |
|---|---|
| `pnpm dev` | Vite dev server z HMR |
| `pnpm build` | build produkcyjny do `packages/client/dist` |
| `pnpm preview` | podgląd builda na `:4173` |
| `pnpm sim` | symulator balansu, headless, wypisuje tabelę TTK/DPS |
| `pnpm typecheck` | `tsc` + `svelte-check` we wszystkich pakietach |
| `pnpm e2e` | smoke E2E w Playwright (wymaga działającego `:5173`) |
| `pnpm shot` | zrzut ekranu z walki do `tests/artifacts/combat.png` |

---

## Sterowanie

| Akcja | Klawiatura + mysz | Pad (XInput) |
|---|---|---|
| Ruch | W / A / S / D | Lewa gałka |
| Celowanie | Pozycja kursora | Prawa gałka |
| Atak podstawowy (combo 3-ciosowe) | LPM **lub J / C** | RT |
| Atak ciężki (ładowany 0.9 s) | **K / V** lub PPM lub przytrzymanie LPM po ciosie | LT |
| Unik (i-frames 0.10–0.42 s) | Spacja | A |
| Sprint | Shift | LS |
| Mikstura | 1 | X |
| Ekwipunek i atrybuty | I | — |
| Menu / pauza | Esc lub **Tab** | Menu |

> **Trackpad (MacBook).** Stuknięcie dwoma palcami w środku walki jest niewykonalne,
> więc oba ataki mają pełnoprawne odpowiedniki klawiaturowe pod lewą ręką na WASD:
> **J / C** zastępuje LPM, **K / V** zastępuje PPM. Przytrzymanie klawisza ataku
> ładuje cios ciężki tak samo jak przytrzymanie przycisku myszy.

> **Esc a fullscreen.** W trybie pełnoekranowym przeglądarka przechwytuje Esc, więc
> menu jest również pod Tab (GDD §4.2).

> **Dźwięk startuje po kliknięciu „Graj".** Przeglądarki blokują `AudioContext`
> do pierwszego gestu użytkownika — ekran startowy jest wymogiem technicznym,
> nie decyzją UX (GDD §12).

---

## Co jest zaimplementowane

**Walka (GDD §5)** — combo 3-ciosowe z oknami anulowania, atak ciężki ładowany,
unik z i-frames, stamina z opóźnioną regeneracją, poise i stagger, break bar bossa,
pełne formuły obrażeń z §5.4, hitstop (55/110/160 ms), slow-mo na zabójstwie,
trauma-based screen shake, camera kick, hit flash, poolowane liczby obrażeń.

**Przeciwnicy (GDD §7)** — 8 typów w 6 archetypach (swarmer, ranged, bruiser, caster,
bomber, mini-boss), FSM `IDLE → PATROL → ALERT → CHASE → COMBAT ⇄ REPOSITION → STAGGERED`,
percepcja stożkiem 110°/14 m + słuch, **attack token system** (max 2 atakujących naraz),
separacja boidami, telegrafy kodowane kształtem, modyfikatory elit.

**Progresja (GDD §6)** — krzywa `100 × n^1.35`, cztery atrybuty z efektami z §6.3,
punkty atrybutów i umiejętności, skalowanie strefy.

**Łup (GDD §8)** — 5 rzadkości, prefiksy i sufiksy skalowane item levelem, twarde capy,
4 legendy z działającymi unikalnymi modyfikatorami, ochrona przed pechem (pity 25→40),
ekwipunek z 9 slotami, sprzedaż, porównanie z założonym.

**Pętla sesyjna (GDD §9.2)** — encountery lekki → średni → ciężki, oddech co trzeci
(zasada 3/1), mini-boss co piąty, rosnący poziom strefy.

---

## Świadome odstępstwa od GDD

Wszystkie siedzą w `data/combat.json`, więc powrót do wersji z dokumentu nie
wymaga dotykania kodu.

| Co | GDD | Tutaj | Pole |
|---|---|---|---|
| Bazowe HP gracza | 100 (§5.1) | **300** | `player.maxHp` |
| Regeneracja HP | brak, tylko mikstury i lifesteal (§5.1) | **1 HP/s** | `player.hpRegen` |
| Leczenie za zabójstwo | brak | **10% max HP celu** | `player.killHealPct` |
| Czasy combo | 0.42 / 0.38 / 0.68 s (§5.2) | **0.30 / 0.27 / 0.46 s** | `combo[].duration` |
| Okno anulowania | 40 / 45 / 60% (§5.2) | **55 / 55 / 60%** | `combo[].cancelAt` |
| Atak ciężki | ładowanie 0.9 s, animacja 1.10 s | **0.7 s / 0.85 s** | `heavy.*` |
| Śmierć | respawn w hubie, arena od nowa (§5.1) | **arena zostaje, wraca sam gracz** | `player.respawnInvulnerable` |

**Atak „co klik".** Poza skróceniem animacji doszło *combo cancel*: gdy cios już
trafił i minęło okno `cancelAt`, kolejne kliknięcie natychmiast przechodzi do
następnego ciosu, zamiast czekać na koniec animacji. To jest różnica między
„atak co animację" a „atak co klik". Unik nadal przerywa atak wg reguły z §4.1.

**Leczenie za zabójstwo** skaluje się z twardością celu, więc mini-boss (1800 HP
bazowo) oddaje znacznie więcej niż goblin. Zwrot pokazuje się jako zielona
liczba nad postacią.

**Śmierć nie resetuje areny.** Encounter, wrogowie i ich nadgryzione HP zostają;
znikają tylko pociski i kałuże z poprzedniego życia, żeby gracz nie ginął od
czegoś, na co nie miał już wpływu. Odrodzenie daje 2.5 s nietykalności — bez
tego powrót w środek pakietu byłby pętlą śmierci. Kara za śmierć to nadal 10%
złota (§5.1).

> ⚠️ **Skutek dla balansu.** Szybszy atak podniósł DPS gracza ~2.4×, przez co
> wszystkie 38 wierszy tabeli TTK wypada poniżej okna docelowego z §7.3 —
> mini-boss ginie w ~24 s zamiast 45–70 s. To wprost wynika z zamówionej zmiany,
> nie z błędu. Przywrócenie okien TTK to podniesienie HP przeciwników
> (`data/enemies.json`) albo `progression.zoneScaling.hpPerLevel`; nie zrobiłem
> tego, bo cofałoby efekt, o który chodziło.

**Postacie** — każda encja ma własną sylwetkę rysowaną proceduralnie
(`render/characters.ts`): bohater z tarczą i mieczem, goblin z uszami i sztyletem,
goblin z oszczepem, szkielet z żebrami i tarczą, szkielet z łukiem, pełzacz
z odnóżami i workami jadu, ork z kłami i toporem, szaman w szacie z kosturem,
rycerz w rogatym hełmie z dwuręcznym mieczem. Postać odbija się w poziomie zgodnie
z kierunkiem patrzenia, a hit flash to nakładana addytywnie biała kopia sylwetki,
więc nie psuje palety. Paleta idzie z `color` w `data/enemies.json`, więc pozostaje
sterowana danymi. Podgląd wszystkich sylwetek: `pnpm gallery` (dev).

**Interfejs (GDD §10)** — HUD w DOM (Svelte 5), paski HP/stamina/XP, sloty mikstur,
pasek bossa z break barem, wskaźniki zagrożenia poza kadrem, winieta niskiego HP,
ekwipunek, pauza, opcje, cztery poziomy trudności.

**Dostępność (GDD §10.3)** — suwak wstrząsu ekranu, skalowanie UI 75–150%, tryby dla
daltonistów, telegrafy niosące informację kształtem a nie tylko kolorem, role ARIA,
`prefers-reduced-motion`.

**Audio (GDD §12)** — graf Web Audio z busami master/muzyka/SFX/UI, ducking −6 dB,
wariancja pitchu ±8%, unikalny dźwięk per telegraf, adaptacyjna muzyka
eksploracja → walka → boss. **SFX są syntezowane proceduralnie** — zero assetów
dźwiękowych, więc budżet startowy to 0 MB, a każdy telegraf ma rozpoznawalny dźwięk
już teraz, zanim powstanie bank próbek.

**Zapis (GDD §11.5)** — IndexedDB z wersjonowaniem i backupem `.bak`, autosave co 8 s
oraz przy wyczyszczeniu encounteru, awansie i utracie widoczności karty.

---

## Zakres — czego jeszcze nie ma

| Element | Kamień milowy | Uwaga |
|---|---|---|
| Backend Phoenix (`/api`, `balance:live`, `/admin`, Oban, Postgres) | M3 | Klient ma gotowego klienta HTTP/WS i tryb offline; `docker compose --profile backend up db` podnosi samą bazę |
| Drzewko umiejętności (3 gałęzie) | M6 | Punkty umiejętności są naliczane i zapisywane |
| Hub, 4 strefy, pokoje z Tiled, boss finałowy | M5–M6 | Zamiast tego jedna arena z narastającymi encounterami |
| Animacje klatkowe, atlasy sprite'ów | M5 | Sylwetki są rysowane proceduralnie i nieanimowane — pozy statyczne, reakcje przez skalę, przechył i błysk |
| Sprzedawca, respec, reroll afiksów | M4–M5 | Sprzedaż przedmiotów działa |

---

## Architektura

```
data/                  ← jedyne źródło prawdy dla balansu (combat, enemies, affixes, progression)
packages/core/         ← ECS, walka, AI, loot, progresja. Czysty TS, ZERO API przeglądarki
packages/client/       ← Pixi v8 (canvas) + Svelte 5 (HUD) + Web Audio + IndexedDB
packages/sim/          ← headless symulator balansu, importuje ten sam kod walki co gra
tests/                 ← smoke E2E (Playwright)
```

Granica `packages/core` jest twarda i pilnowana przez `tsconfig` (`lib: ES2022`, `types: []`):
rdzeń nie skompiluje się, jeśli ktoś sięgnie po `window`, `document` czy
`requestAnimationFrame`. Dzięki temu symulator balansu napędza **dokładnie ten sam**
kod walki co gra — bez tego rozjechałyby się w kilka tygodni (stack §4).

Pętla 60 Hz nigdy nie dotyka sieci (GDD §11.0). Balans ładuje się kaskadą
**serwer → cache IndexedDB → dane wbudowane w bundle**, więc gra startuje zawsze.

---

## Symulator balansu

```bash
pnpm sim                    # 40 prób na wiersz
SIM_TRIALS=200 pnpm sim     # dokładniej
SIM_STRICT=true pnpm sim    # kod wyjścia ≠ 0, gdy TTK poza oknem (do CI)
```

Wypisuje medianę TTK i DPS per przeciwnik per poziom, zestawioną z docelowymi oknami
z GDD §7.3. Model gracza to „przeciętny build": rozdane atrybuty i niepełny zestaw
przedmiotów Niezwykłych dwa poziomy za strefą.

**Aktualny odczyt (19 z 38 wierszy poza oknem):** mini-boss i bruisery mieszczą się
w celu, swarmery i castery giną o ~0.2–1.0 s za szybko. To zawyżony obraz — symulowany
gracz nigdy nie robi uniku ani nie traci czasu na repozycję, więc realne TTK jest wyższe.
Strojenie krzywych to M7 (GDD §13), a nie zadanie na tym etapie.

---

## Testy

```bash
docker compose up -d        # gra musi działać
pnpm e2e                    # 3 testy smoke
pnpm e2e:prod               # to samo przeciwko buildowi za nginx (:8080)
```

Testy sprawdzają rzeczy, które da się zepsuć po cichu: że pętla żyje, że wrogowie
naprawdę giną od inputu, że F5 nie gubi postępu i że gra startuje z odciętym backendem.

---

## Budżet przeglądarkowy (GDD §11.6)

| Metryka | Cel | Stan |
|---|---|---|
| JS gzip | < 400 KB | **211 KB** (63 KB gra + 148 KB Pixi) |
| Assety przed pierwszą areną | < 6 MB | **0 MB** — wszystko proceduralne |
| Alokacje w trakcie walki | 0 | typed arrays + free-lista encji, pooling liczb obrażeń i telegrafów |
| Jednocześni wrogowie | 24 (limit twardy) | egzekwowane w spawnerze |
