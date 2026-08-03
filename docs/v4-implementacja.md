# v4 — stan implementacji

Dokument towarzyszący [`v4.md`](v4.md). Tamten mówi **co** budować, ten mówi
**co już stoi, gdzie to jest i co świadomie odbiega od planu**.

Warstwa idle jest dobudowana **obok** istniejącego action-RPG, nie zamiast niego.
Walka z GDD v3.0 pozostaje trybem aktywnym z v4 §5.1; warstwa idle dokłada nad
nią ekonomię, strefy, progresję meta i pętle retencyjne.

---

## 1. Mapa kodu

```
data/
  idle.json           ← krzywe, ulepszenia, strefy, offline, prestiż, kuźnia, automatyzacje
  idle-affixes.json   ← pula 18 afiksów + bazy przedmiotów + człony nazw
  uniques.json        ← 12 unikatów zmieniających zasady
  skilltree.json      ← 60 węzłów, 3 gałęzie, 6 keystone'ów
  prestige-tree.json  ← 20 węzłów za PP + 8 za Iskry (ascensja)
  challenges.json     ← 12 wyzwań

packages/core/src/
  core/bignum.ts      ← reprezentacja {m, e}, formatowanie, serializacja (§7.6)
  idle/
    types.ts          ← zamrożony kontrakt: IdleState, IdleBonuses, IdleItem, OfflineReport
    config.ts         ← schematy zod dla data/idle.json
    state.ts          ← tworzenie, serializacja, sanityzacja zapisu, monotonicGuard
    curves.ts         ← koszty C(n)=C₀·r^n, HP(z), złoto, afiksy (§4.1, §4.2, §4.6)
    upgrades.ts       ← kupno ×1/×10/max, efekty ulepszeń
    rates.ts          ← DPS, złoto/s, tempo — jedyne miejsce z wzorem na obrażenia
    zones.ts          ← postęp stref, awans, kamienie milowe
    offline.ts        ← marsz po strefach, raport powrotu (§4.5)
    diagnosis.ts      ← diagnoza blokady + jedna sugerowana akcja (§2.2)
    background.ts     ← tryb tła + walidacja statystyczna raportów (§5.1)
    items.ts          ← losowanie przedmiotów, jakość, bonusy z ekwipunku
    uniques.ts        ← unikaty i ich efekty
    forge.ts          ← ulepszanie, rerolle, rozbiórka, transfer moda (§5.3)
    filter.ts         ← filtr łupu, auto-rozbiórka, auto-ekwipunek (§3.1)
    skilltree.ts      ← alokacja, darmowy respec, keystone'y (§5.4)
    prestige.ts       ← PP, drzewko trwałe, ascensja (§4.3, §4.4)
    buildcode.ts      ← MS4: kodowanie/dekodowanie/„zastosuj co się da" (§5.8)
    bestiary.ts       ← kolekcjonerstwo jako mnożnik (§5.7)
    challenges.ts     ← runy z ograniczeniem + migawka stanu (§5.5)
    telemetry.ts      ← konstruktory zdarzeń z §9.2, bez sieci
    engine.ts         ← fasada: bonusy → tempo → strefa, jeden łańcuch dla gry i symulatora

packages/client/src/
  idle/controller.ts       ← spina silnik z pętlą, zapisem, tostami i telemetrią
  idle/store.svelte.ts     ← płaska migawka stanu dla Svelte (5 Hz)
  ui/idle/ReturnScreen.svelte    ← ekran powrotu (§2.2)
  ui/idle/IdlePanel.svelte       ← ulepszenia, strefa, automatyzacje, prestiż
  ui/idle/CharacterSheet.svelte  ← ekran postaci pod screenshot (§5.8)

packages/sim/src/idle.ts   ← symulator progresji z bramkami z v4 (pnpm sim:idle)
packages/core/test/        ← 60 testów jednostkowych (node --test)
tests/idle.spec.ts         ← 5 testów E2E warstwy idle
```

---

## 2. Co jest zaimplementowane

| Sekcja v4 | Stan | Uwagi |
|---|---|---|
| §2.2 Ekran powrotu | **gotowe** | Liczby, diagnoza, jedna akcja. Zero reklam — zgodnie z anty-wzorcem. |
| §3 Drabina odblokowań | **gotowe** | Progi w `data/idle.json`, zapowiedzi przez `zoneMilestones`. |
| §3.1 Automatyzacje | **8 z 8 zdefiniowanych, 4 działają** | `autoSalvage` i `autoEquip` mają logikę; `autoSkill`, `autoPrestige`, `autoExpedition` czekają na systemy, których dotyczą. |
| §4.1 Krzywe kosztów | **gotowe** | Łącznie z odwrotnością do „kup max". |
| §4.2 Skalowanie HP | **gotowe** | Wykładnicza z korektą wielomianową, bossowie co 10 stref. |
| §4.3 Prestiż | **gotowe** | `PP = floor(K·√(złoto/T))` liczone na `Big`. |
| §4.4 Ascensja | **gotowe** | Warstwa 2. Warstwa 3 (Transcendencja) świadomie nieobecna — rok 2. |
| §4.5 Offline | **gotowe** | Deterministyczne, marsz po strefach, anty-exploit zegara. |
| §4.6 Afiksy | **gotowe** | 18 afiksów, 5 rzadkości, jakość widoczna dla gracza. |
| §5.1 Tryb hybrydowy | **częściowo** | Aktywny i tło działają; walidacja statystyczna zaimplementowana, ale nie ma serwera, który by ją wołał. |
| §5.2 Sloty | **gotowe** | 9 slotów. Loadouty — nie. |
| §5.3 Kuźnia | **gotowa logika, brak UI** | Wszystkie pięć akcji z tabeli działa i jest przetestowane; panel kuźni nie powstał. |
| §5.4 Drzewko | **gotowa logika + dane, brak UI** | 60 węzłów, 6 keystone'ów, darmowy respec. Widok promienisty nie powstał. |
| §5.5 Wyzwania | **gotowa logika + dane, brak UI** | 12 wyzwań z migawką stanu. |
| §5.7 Bestiariusz | **gotowe** | 5 tierów, bonus uśredniony do DPS. |
| §5.8 Kod builda | **gotowe** | `MS4:` + LZSS + base64url, ~330 znaków dla pełnego builda. |
| §7.6 Wielkie liczby | **gotowe** | `{m, e}`, polska skala długa, 3 notacje. |
| §9.2 Telemetria | **gotowe** | Wszystkie 11 zdarzeń, z dławieniem `zone_stuck`. |

### Czego nie ma

- **Backend Phoenix** — bez zmian względem stanu sprzed v4. Warstwa idle jest
  offline-first; `validateProgressReport` i `FlagCounter` czekają gotowe na serwer.
- **UI kuźni, drzewka, wyzwań, bestiariusza, filtru łupu** — logika i dane stoją
  i są przetestowane, brakuje ekranów. To jest największy pozostały kawałek.
- **Sezony, ligi, monetyzacja** (§5.6, §6) — poza zakresem tej iteracji.
- **Loadouty** (§5.2) — `bonusLoadouts()` liczy zdobyte sloty, ale nie ma czego przełączać.

---

## 3. Odstępstwa od dokumentu — świadome

### 3.1 `damage.mult` 0.01 → 0.03

Tabela w §4.1 podaje `×1.01` na poziom. Przy tej wartości obrażenia rosną jak
`G^0.115`, a HP stref jak `1.16^z` — gracz zostaje w tyle wykładniczo i staje
na **strefie 21** niezależnie od tego, ile gra. Dokument sam nazywa te liczby
„wartościami startowymi do tuningu" i wymaga jednocześnie strefy ~45 po 12 h.
Te dwa wymagania nie mogą być spełnione naraz; wybrałem to drugie.

### 3.2 Krzywa złota

`goldExpBase` 1.13 → **1.16** (równa podstawie HP) i `goldPolyExponent` 1.6 →
**2.5**. Bez tego dochód rośnie wolniej niż koszty i cała progresja się zatyka.
Dokument nie podaje krzywej złota, więc to nie jest odstępstwo, tylko decyzja
w luce.

### 3.3 Progi automatyzacji przypisane do czasu, nie do numeru strefy

Dokument podaje odblokowania w godzinach (`Auto-atak ~2 h`). Przełożyłem je na
numery stref **mierząc symulatorem**, kiedy gracz optymalny tam dociera:

| Automatyzacja | Cel v4 | Strefa | Zmierzony czas |
|---|---|---|---|
| Auto-atak | ~2 h | 27 | 1,92 h |
| Auto-podnoszenie | ~3 h | 30 | ~3 h |
| Auto-rozbiórka | ~6 h | 35 | ~6 h |
| Auto-postęp strefy | ~8 h | 37 | ~8 h |
| Prestiż | ~12 h | 40 | 11,43 h |

Progi w `zones.ts` (`MILESTONES`) to **ręcznie utrzymywana kopia** tych wartości —
przy strojeniu trzeba ruszyć oba miejsca. Funkcja `zoneMilestones` nie ma dostępu
do konfiguracji, bo woła ją UI bez niej.

### 3.4 Keystone `noCrit` — balans w danych, reguła w kodzie

`rates.ts` implementuje wyłącznie **zmianę zasady** (wyłączenie krytyka).
Rekompensata (`moreDamage: 2.5`) siedzi w `data/skilltree.json`. Pierwotnie była
w obu miejscach naraz i dawała podwójne naliczenie — mnożnik ×3,5 zamiast ×3,5
wychodził ×12,25.

### 3.5 Reguła ściany w marszu offline

Dokumentu to nie precyzuje. Przyjąłem: gdy wyczyszczenie strefy zajęłoby więcej
niż `stuckSeconds` (90 s), marsz się zatrzymuje, a reszta czasu idzie na
farmienie w miejscu. Bez tego gracz wraca rano do strefy 900, której nie umie
przejść — a wtedy najważniejszy ekran w grze staje się komunikatem o porażce.

### 3.6 „Utknąłeś" tylko przy prawdziwej ścianie

Cel czyszczenia to 25–40 s, próg ściany 90 s. Diagnoza pokazuje ostrzeżenie
dopiero powyżej **90 s**; między 40 a 90 s daje radę bez alarmu. Krzyczenie
„utknąłeś" przy 50 s to wilk, na którego gracz przestanie reagować akurat wtedy,
gdy naprawdę stanie.

---

## 4. Weryfikacja

```bash
pnpm test:unit     # 60 testów jednostkowych rdzenia
pnpm sim:idle      # symulacja progresji + bramki z v4
pnpm typecheck     # tsc + svelte-check
pnpm e2e           # E2E, w tym 5 testów warstwy idle
pnpm shot:idle     # zrzuty ekranów idle do tests/artifacts/
```

### Aktualny odczyt symulatora (14 h gracza optymalnego)

```
✓ strefa 10 w 0.4–2 h   → 0.50 h    boss strefy 10 — pierwszy próg (faza B)
✓ strefa 27 w 1.5–5 h   → 1.92 h    auto-atak — „możesz zamknąć kartę" (faza C)
✓ strefa 40 w 8–16 h    → 11.43 h   odblokowanie prestiżu (faza E)

✓ PP z pierwszego resetu: 112
✓ szacowany powrót: 31% poprzedniego czasu     (v4 §4.3 wymaga 30–40%)

~ 54 s na zwykłą strefę (strefa 39)            (cel 25–40 s)
ℹ strefa 40 to boss (HP ×12) — 118 s to zamierzony próg, nie ściana
```

Tempo 54 s przy celu 25–40 s to **stan pod koniec biegu, tuż przed pierwszym
prestiżem** — czyli dokładnie moment, w którym krzywa kosztów ma zacząć doganiać
gracza. Po prestiżu wraca w okno.

`SIM_STRICT=true pnpm sim:idle` zwraca kod wyjścia ≠ 0 przy złamanej bramce —
nadaje się do CI.

---

## 5. Kontrakt, którego nie wolno złamać po cichu

Te rzeczy są testowane i mają twarde uzasadnienie w dokumencie:

1. **`applyOffline` jest idempotentna.** Przycisk ODBIERZ da się kliknąć dwa
   razy szybciej, niż Svelte przerysuje ekran.
2. **`lastSeen` nie przesuwa się, dopóki raport nie zostanie odebrany.**
   Zamknięcie karty na ekranie powrotu nie może zjeść nagrody.
3. **Prestiż nie kasuje własności gracza** — ekwipunek, kodeks unikatów,
   bestiariusz i ukończone wyzwania przeżywają reset (v4 §12: wipe to
   jednorazowa, nieodwracalna strata zaufania).
4. **Unikat nigdy nie leci automatycznie** przez filtr łupu ani auto-ekwipunek.
5. **Respec jest darmowy** — w drzewku umiejętności i w drzewku prestiżu.
6. **Diagnoza nigdy nie sugeruje zablokowanego ulepszenia.** Rada, po której
   klika się i nic się nie dzieje, jest gorsza od braku rady.
7. **Klient raportuje fakty, nie wyniki.** „Zabiłem 40 wrogów w strefie 51",
   nigdy „mam teraz 1e12 złota" (v4 §7.3).
8. **Ekran powrotu nie zawiera wezwania do zakupu ani reklamy.** Łamie to
   filary F1 i F5 i jest w dokumencie nazwane wprost anty-wzorcem.
9. **Zero parametrów-właściwości w konstruktorach `packages/core`** — nie
   przechodzą przez natywne stripowanie typów w Node, na którym stoi symulator
   i testy jednostkowe.
