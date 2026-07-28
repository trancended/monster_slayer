# Monster Slayer — Dokument Projektowy Gry (GDD)

**Wersja:** 3.0 · **Status:** pre-produkcja · **Zakres:** gra przeglądarkowa (desktop), single-player · **Tryb deweloperski:** localhost

> Zmiany 2.0 → 3.0: platforma docelowa to przeglądarka (PixiJS v8 + TypeScript), backend w Elixir/Phoenix uruchamiany lokalnie. Przepisane sekcje 1, 4.2, 10.1, 11, 12, 13, 14, 15 oraz nowa sekcja 18 (środowisko lokalne).

> **Stan implementacji:** kamienie milowe **M0–M4** z §13 są zaimplementowane
> i grywalne — `docker compose up` → <http://localhost:5173>. Zaimplementowane:
> walka (§5), przeciwnicy i AI (§7), progresja (§6), łup i ekwipunek (§8),
> HUD i dostępność (§10), audio (§12), zapis (§11.5), symulator balansu (§14).
> Poza zakresem tej iteracji: backend Phoenix (M3 — sync, telemetria, `/admin`),
> drzewko umiejętności (M6), hub i strefy (M5–M6), assety graficzne (M5).
> Instrukcja uruchomienia: `README.md`, szczegóły środowiska: §18.

---

## 1. Streszczenie wykonawcze

**Monster Slayer** to izometryczne action-RPG z naciskiem na czytelną, reaktywną walkę i szybką pętlę progresji. Gracz eksploruje ręcznie projektowane strefy połączone hubem, wycina hordy potworów, zbiera losowo generowany ekwipunek i rozwija build poprzez atrybuty, drzewko umiejętności i afiksy przedmiotów.

| Parametr | Wartość |
|---|---|
| Gatunek | Action RPG / hack'n'slash z elementami skill-based combat |
| Perspektywa | Izometryczna 3/4 (kamera podążająca, lekki soft-lock) |
| Sesja docelowa | 20–40 min |
| Czas do napisów końcowych (v1.0) | 6–8 h |
| Platforma | **Przeglądarka** (WebGPU z fallbackiem WebGL2), desktop; mobile poza zakresem v1 |
| Klient | **TypeScript + PixiJS v8** + własny ECS (bez pełnego silnika) |
| Backend | **Elixir 1.19 / Phoenix 1.8** — zapisy, live-ops, telemetria |
| Dystrybucja | URL (itch.io / własny hosting), zero instalacji |
| Zespół | 1–3 osoby |
| Realistyczny czas do grywalnego demo | 16–18 tygodni part-time |

---

## 2. Filary projektowe

Każda decyzja projektowa musi dać się obronić przez co najmniej jeden filar. Jeżeli funkcja nie wspiera żadnego — wypada z zakresu.

1. **Walka jest czytelna, nie chaotyczna.** Gracz zawsze wie, kto go zaraz uderzy, dlaczego stracił HP i co mógł zrobić inaczej. Telegrafowanie ataków > liczba przeciwników na ekranie.
2. **Postęp jest widoczny co 3 minuty.** Poziom, przedmiot, punkt umiejętności, odblokowana zdolność — coś musi się wydarzyć w krótkim oknie czasowym.
3. **Ryzyko jest wyborem gracza.** Elitarne pakiety, opcjonalne areny i modyfikatory trudności dają lepszy łup — ale gracz sam decyduje, kiedy je podjąć.
4. **Game feel przed zawartością.** Lepiej mieć 4 świetnie działających przeciwników niż 20 miałkich. Hitstop, knockback, dźwięk i feedback są funkcjonalnością, nie „polerowaniem na koniec”.

**Antyfilary (czego świadomie nie robimy w v1.0):** multiplayer, otwarty świat, crafting, rozgałęzione dialogi, system frakcji, budowanie bazy.

---

## 3. Pętle rozgrywki

### 3.1 Pętla sekundowa (moment-to-moment)
`Pozycjonowanie → odczyt telegrafu wroga → unik / atak → potwierdzenie trafienia (hitstop + VFX + SFX) → zarządzanie staminą`

### 3.2 Pętla minutowa (encounter)
`Wejście do pokoju → ocena składu pakietu → priorytetyzacja celów → egzekucja → łup + XP → decyzja: iść dalej czy zrobić opcjonalną arenę`

### 3.3 Pętla sesyjna
`Hub (ekwipunek, sprzedawca, punkty umiejętności) → wybór strefy → 3–5 encounterów → mini-boss → boss strefy → powrót do hubu z łupem`

### 3.4 Pętla metagry
`Poziom postaci → punkty atrybutów + punkt umiejętności → mocniejszy build → wyższy tier strefy → lepsze afiksy → jeszcze mocniejszy build`

---

## 4. Sterowanie i input

| Akcja | Klawiatura + mysz | Pad (XInput) |
|---|---|---|
| Ruch | W / A / S / D | Lewa gałka |
| Celowanie / kierunek ataku | Pozycja kursora | Prawa gałka |
| Atak podstawowy (combo 3-hit) | LPM | RT |
| Atak ciężki (ładowany) | Przytrzymanie LPM | Przytrzymanie RT |
| Umiejętność 1–4 | Q / E / R / F | LB / RB / Y / B |
| Unik (dodge roll) | Spacja | A |
| Sprint | Shift (przytrzymanie) | LS |
| Mikstura zdrowia | 1 | X |
| Interakcja / podniesienie | Space (kontekstowo) / LPM na przedmiocie | A |
| Ekwipunek | I / Tab | Start |
| Podświetlenie łupu | Alt (przytrzymanie) | LS (tap) |
| Menu / pauza | Esc | Menu |

### 4.1 Jakość inputu (wymagania techniczne, nie „nice to have”)

- **Input buffering:** 150 ms — komenda wciśnięta pod koniec animacji wykonuje się natychmiast po jej zakończeniu.
- **Animation cancel:** unik przerywa dowolną animację ataku po 40% jej długości (attack commitment, ale bez frustracji).
- **Dead zone:** 0.18 radial, z rekalibracją w opcjach.
- **Pełny remapping** wszystkich akcji + obsługa układów AZERTY/QWERTZ.
- **Brak ukrytego opóźnienia:** input → pierwsza klatka reakcji ≤ 2 klatki (33 ms @60 FPS).
- Odczyt inputu przez `KeyboardEvent.code` (fizyczna pozycja klawisza), nie `key` — działa niezależnie od układu.

### 4.2 Specyfika przeglądarki

| Zagadnienie | Rozwiązanie |
|---|---|
| Klawisze przechwytywane przez przeglądarkę | Zakaz mapowania Ctrl+W/T/N, Ctrl+Shift+*, F1–F12. Domyślny bind menu: **Esc** (kolizja z fullscreenem — patrz niżej) |
| Esc a Fullscreen API | W trybie pełnoekranowym Esc wychodzi z fullscreena, nie otwiera menu. Menu również pod **Tab**; wyjście z fullscreena traktowane jako pauza |
| Pointer Lock | Włączany tylko w trybie sterowania relatywnego; domyślnie kursor swobodny (celowanie pozycją myszy) |
| Prawy przycisk myszy | `contextmenu.preventDefault()` na canvasie, ale **nie** na overlayu HUD |
| Utrata fokusu / zmiana karty | `visibilitychange` i `blur` → automatyczna pauza + wyciszenie. Bez tego akumulator czasu wykona kilkaset ticków naraz po powrocie |
| Gamepad API | Pad wykrywany dopiero po pierwszym naciśnięciu przycisku (wymóg przeglądarki) — wyświetl podpowiedź |
| Zoom przeglądarki / DPR | Renderer skalowany do `devicePixelRatio`, cap 2.0; logika w jednostkach świata, nigdy w pikselach |
| Kontekst bezpieczny | WebGPU, Gamepad API i Pointer Lock wymagają HTTPS **lub localhost** — dev nie potrzebuje certyfikatów |

---

## 5. System walki

### 5.1 Zasoby gracza

| Zasób | Wartość bazowa | Regeneracja | Uwagi |
|---|---|---|---|
| HP | 100 | brak (tylko mikstury / lifesteal) | Śmierć = respawn w hubie, utrata 10% złota |
| Stamina | 100 | 22/s po 0.6 s zwłoki | Unik: 25, sprint: 12/s, atak ciężki: 20 |
| Mikstury | 3 sloty | Uzupełniane w hubie / z rzadkiego dropu | Leczy 45% max HP w 1.5 s (nie natychmiast) |
| Poise (odporność na stagger) | 30 | 5/s | Chroni przed przerwaniem ataku |

### 5.2 Combo i timing

| Cios | Mnożnik obrażeń | Czas animacji | Okno anulowania | Uwagi |
|---|---|---|---|---|
| 1 | 100% | 0.42 s | 40% | Szybkie wejście |
| 2 | 115% | 0.38 s | 45% | Najszybszy |
| 3 | 165% | 0.68 s | 60% | +40 poise damage, knockback |
| Ciężki (ładowany 0.9 s) | 260% | 1.10 s | 30% | Gwarantowany stagger, przebija blok |

**Okno kontynuacji combo:** 0.45 s od końca poprzedniego ciosu. Po jego upływie licznik resetuje się do ciosu 1.

### 5.3 Unik (dodge roll)

- Czas trwania: **0.60 s**, dystans 3.2 m.
- **Klatki nietykalności (i-frames): 0.10 s → 0.42 s** (środkowe 32 klatki @60 FPS).
- Recovery 0.18 s — nie da się spamować uników bez ryzyka.
- Cooldown wewnętrzny: 0.25 s.

### 5.4 Formuły obrażeń

```
obrażenia_bazowe = (broń_min..broń_max) × mnożnik_umiejętności

obrażenia_po_atrybutach = obrażenia_bazowe × (1 + SIŁA/120) × (1 + Σ afiksy_%dmg)

redukcja_pancerza = pancerz / (pancerz + 60 + 12 × poziom_atakującego)     // cap 75%

trafienie_krytyczne = random() < szansa_kryt        // bazowo 5%, cap 60%
mnożnik_kryt = 1.5 + Σ afiksy_kryt_dmg              // bazowo 150%

obrażenia_końcowe = obrażenia_po_atrybutach
                  × (1 - redukcja_pancerza)
                  × (trafienie_krytyczne ? mnożnik_kryt : 1)
                  × mnożnik_żywiołu(typ_ataku, odporności_celu)
                  × random(0.95, 1.05)              // wariancja anty-monotonia
```

**Odporności żywiołowe:** wartość w procentach, zakres −50% (podatność) do +75% (odporność), addytywne, cap twardy.

### 5.5 Stagger i poise

Każdy atak ma wartość *poise damage*. Kiedy skumulowany poise damage przekroczy pulę poise celu, cel wpada w stagger (0.7 s bezbronności) i pula resetuje się z 20% overflow. Bossowie mają pulę „break bar", której złamanie daje 8 s okna z modyfikatorem +50% otrzymywanych obrażeń.

### 5.6 Game feel — checklist obowiązkowy

| Efekt | Parametr |
|---|---|
| Hitstop (trafienie zwykłe) | 55 ms |
| Hitstop (krytyk / ciężki) | 110 ms |
| Hitstop (zabójstwo) | 160 ms + slow-mo 0.35× na 0.2 s |
| Hit flash celu | biały, 0.08 s, addytywny |
| Screen shake | trauma-based, amplituda 0.15–0.5, decay 1.8/s |
| Camera kick | 4 px w kierunku ataku, powrót 0.12 s |
| Knockback | skalowany masą celu, 0.1–1.2 m |
| Liczby obrażeń | pooling, arc motion, kolor wg typu, kryty 1.4× większe |
| Freeze na zgonie bossa | 0.8 s + zoom + wyciszenie muzyki |

---

## 6. Progresja postaci

### 6.1 Krzywa poziomów

Zamiast sztywnej tabeli — formuła (łatwiejsza do strojenia i skalowania do poziomu 40):

```
XP_do_następnego(n) = round(100 × n^1.35)
```

| Poziom | XP do następnego | XP skumulowane | Szacowany czas |
|---:|---:|---:|---|
| 1 | 100 | 0 | — |
| 2 | 255 | 100 | 4 min |
| 3 | 434 | 355 | 5 min |
| 5 | 854 | 1 349 | 7 min |
| 10 | 2 239 | 8 026 | 11 min |
| 15 | 3 843 | 22 630 | 15 min |
| 20 | 5 634 | 46 100 | 18 min |
| 30 | 9 665 | 122 800 | 25 min |

**Cel projektowy:** poziomy 1–10 w ~60 min (nauka systemów), 10–20 w ~2.5 h, 20–30 w ~4 h.

### 6.2 Nagroda za poziom

Każdy poziom:
- **+3 punkty atrybutów** do rozdania,
- **+1 punkt umiejętności** (co poziom do 20, potem co drugi),
- automatycznie: +4 max HP, +1.5% obrażeń bazowych (żeby poziom „coś dawał" nawet bez wydania punktów).

Co 5 poziomów: **odblokowanie slotu umiejętności lub pasywnej**.

### 6.3 Atrybuty

| Atrybut | Efekt na punkt |
|---|---|
| **Siła** | +0.83% obrażeń fizycznych, +2 poise |
| **Zręczność** | +0.6% szybkości ataku, +0.15% szansy kryt, +0.3% szybkości ruchu (cap +25%) |
| **Wytrzymałość** | +9 max HP, +3 max stamina, +1.2 pancerza |
| **Wola** | +1.2% obrażeń żywiołowych, +2% skuteczności mikstur, −0.4% cooldownów (cap −40%) |

### 6.4 Drzewko umiejętności

Trzy gałęzie, wspólna pula punktów — **respec dostępny w hubie za złoto** (koszt rośnie: 100 × 1.5^liczba_respeców).

| Gałąź | Fantazja | Przykładowe węzły |
|---|---|---|
| **Berserker** | Bliski dystans, wysokie ryzyko | *Krwawa Furia* (+35% obrażeń poniżej 40% HP), *Wir* (AoE, koszt staminy), *Nieustępliwość* (+50 poise), *Żniwo* (zabójstwo leczy 4% max HP) |
| **Łowca** | Mobilność, dystans, kryty | *Podwójny unik*, *Salwa* (3 pociski stożkiem), *Znak Łowcy* (cel otrzymuje +20% obrażeń), *Egzekucja* (+100% kryt na celach < 25% HP) |
| **Mistyk** | Żywioły, kontrola, obszar | *Kula Ognia*, *Lodowa Nowa* (spowolnienie 50% / 3 s), *Łańcuch Błyskawic* (skacze na 4 cele), *Bariera* (tarcza 25% max HP / 6 s) |

**Zasada:** żaden węzeł nie jest czystym „+5% obrażeń". Minimum 60% węzłów zmienia sposób gry, nie tylko liczby.

---

## 7. Przeciwnicy

### 7.1 Archetypy (projekt behawioralny, nie tylko statystyki)

| Archetyp | Rola w encounterze | Zachowanie |
|---|---|---|
| **Swarmer** | Presja, wymuszenie ruchu | Szybki, słaby, atakuje w grupach 4–8, otacza |
| **Bruiser** | Kotwica pakietu | Wolny, wysoki poise, potężny telegrafowany atak |
| **Ranged** | Karanie za stanie w miejscu | Utrzymuje dystans, kite'uje, pociski do uniknięcia |
| **Caster/Support** | Cel priorytetowy | Buffuje/leczy sojuszników, stawia strefy |
| **Bomber** | Wymuszenie repozycji | Szarżuje i eksploduje po 1.2 s (widoczny wskaźnik) |
| **Boss** | Test opanowania systemów | Wielofazowy, unikalny moveset |

### 7.2 Roster v1.0

| Nazwa | Archetyp | HP | Obrażenia | Poise | Pancerz | XP | Kluczowa mechanika |
|---|---|---:|---:|---:|---:|---:|---|
| Goblin Zwiadowca | Swarmer | 45 | 7 | 10 | 0 | 20 | Skok w tył po trafieniu |
| Goblin Miotacz | Ranged | 38 | 9 | 8 | 0 | 24 | Rzut oszczepem, telegraf 0.8 s |
| Szkielet Wojownik | Bruiser (lekki) | 85 | 13 | 35 | 12 | 38 | Blokuje frontalnie — obejść lub złamać ciężkim |
| Szkielet Łucznik | Ranged | 60 | 15 | 15 | 5 | 42 | Strzał snajperski, 1.4 s naprowadzania |
| Ork Berserker | Bruiser | 160 | 22 | 60 | 20 | 75 | Szarża 6 m, po niej 1.1 s recovery |
| Ork Szaman | Caster | 110 | 14 | 25 | 10 | 85 | Aura +25% obrażeń sojusznikom w 8 m |
| Pełzacz Zarazy | Bomber | 55 | 30 (AoE) | 5 | 0 | 45 | Eksplozja, zostawia kałużę trucizny 8 s |
| **Rycerz Zgnilizny** (mini-boss) | Bruiser+ | 700 | 28 | 140 | 35 | 300 | 4-ciosowe combo, break bar |
| **Smok Popiołów** (boss) | Boss | 3 200 | 45–90 | ∞ (break bar 400) | 30 | 1 500 | 3 fazy, patrz 7.4 |

### 7.3 Skalowanie do poziomu strefy

```
HP(lvl)        = HP_bazowe × (1 + 0.19 × (lvl − 1))
obrażenia(lvl) = dmg_bazowe × (1 + 0.13 × (lvl − 1))
XP(lvl)        = XP_bazowe × (1 + 0.22 × (lvl − 1))
```

**Docelowe TTK (time-to-kill) przy build zgodnym z poziomem:**
- Swarmer: 1.5–2.5 s · Bruiser: 5–8 s · Elita: 12–18 s · Mini-boss: 45–70 s · Boss: 120–180 s

### 7.4 Boss: Smok Popiołów — projekt faz

| Faza | Próg HP | Moveset | Okno gracza |
|---|---|---|---|
| I | 100–65% | Uderzenie ogonem (telegraf 1.0 s), oddech stożkowy (1.4 s), tupnięcie AoE | Po oddechu: 2.0 s |
| II | 65–30% | + Lot i bombardowanie (3 markery), przyzwanie 4 Pełzaczy | Po lądowaniu: 2.5 s |
| III | 30–0% | + Nova ognia (arena), przyspieszone animacje (0.85×), ślad ognia | Tylko po novie: 1.8 s |

**Zasada projektowa:** każdy atak bossa ma czytelny telegraf ≥ 0.7 s i możliwy do wykonania unik. Brak niemożliwych do przewidzenia obrażeń.

### 7.5 Modyfikatory elit

Pakiety elitarne (losowo, 15% szans na encounter) dostają 1–3 afiksy: *Płonący*, *Opancerzony* (+80% pancerza), *Regenerujący* (3% HP/s poza walką), *Roztrzaskujący* (podwójny poise damage), *Przywoływacz*, *Chyży* (+40% ruchu), *Tarcza żywiołów*.
**Nagroda:** ×2.5 XP, gwarantowany drop rzadkości Rzadki+.

### 7.6 Architektura AI

Skończony automat stanów + drzewo decyzyjne dla wyboru ataku:

```
IDLE → PATROL → ALERT (dźwięk/wzrok) → CHASE → COMBAT ⇄ REPOSITION → STAGGERED → DEATH
```

- **Percepcja:** stożek widzenia 110° / 14 m + promień słuchu 8 m (walka podnosi do 18 m).
- **Attack token system:** maksymalnie 2 przeciwników jednocześnie ma „token ataku". Reszta krąży. To jedyny sposób, by walka z 8 wrogami była czytelna.
- **Personal space:** separacja przez boids, żeby wrogowie nie zlewali się w jedną bryłę.
- **Anti-frustration:** wróg poza kamerą nie może zadać obrażeń bez dźwiękowego ostrzeżenia.

---

## 8. Ekwipunek i łup

### 8.1 Sloty

Broń · Broń dodatkowa (swap na klawisz) · Hełm · Napierśnik · Rękawice · Buty · Pas · Amulet · 2× Pierścień

### 8.2 Rzadkości

| Rzadkość | Kolor | Waga dropu | Afiksy | Uwagi |
|---|---|---:|---:|---|
| Zwykły | szary | 58% | 0 | Waluta na sprzedaż |
| Niezwykły | zielony | 26% | 1–2 | |
| Rzadki | niebieski | 11% | 3 | |
| Epicki | fioletowy | 4% | 4 | 1 afiks z puli prefiksów mocy |
| Legendarny | pomarańczowy | 1% | 4 + **unikalny modyfikator** | Zmienia sposób gry, nie tylko liczby |

### 8.3 Pula afiksów (wyciąg)

**Prefiksy:** +X–Y obrażeń fizycznych · +X% obrażeń · +X obrażeń żywiołowych · +X% szybkości ataku
**Sufiksy:** +X max HP · +X pancerza · +X% szansy kryt · +X% obrażeń kryt · +X% kradzieży życia (cap 8%) · +X% szybkości ruchu (cap 15% na przedmiot) · −X% cooldownów · +X odporności na żywioł

Wartości afiksów skalują się z *item level* = poziom strefy ±2.

### 8.4 Przykładowe legendy

| Nazwa | Slot | Unikalny modyfikator |
|---|---|---|
| Kieł Pożogi | Broń | Trzeci cios combo podpala cel na 4 s (12% obrażeń/s) |
| Pancerz Ostatniego Tchu | Napierśnik | Raz na 90 s przeżywasz śmiertelny cios z 1 HP i stajesz się nietykalny na 2 s |
| Buty Widma | Buty | Unik pozostawia iluzję, która przyciąga wrogów na 3 s |
| Sygnet Chciwości | Pierścień | +50% złota, ale −20% max HP |

### 8.5 Tabele dropu

```
na_zabicie:
  złoto:      100% (ilość skalowana poziomem × mnożnik strefy)
  przedmiot:  swarmer 4% | bruiser 12% | ranged 8% | elita 100% (min. Rzadki)
  mikstura:   6%
  materiał:   18%
mini-boss:    3 przedmioty (min. 1 Epicki)
boss:         5 przedmiotów (gwarantowany Legendarny przy pierwszym zabiciu)
```

**Ochrona przed pechem (pity):** licznik zabójstw bez dropu przedmiotu; po 25 zabiciach szansa rośnie liniowo do 100% przy 40.

### 8.6 Ekonomia — źródła i ujścia złota

| Źródło | | Ujście |
|---|---|---|
| Drop z przeciwników | → | Sprzedawca (ekwipunek na poziomie strefy) |
| Sprzedaż niepotrzebnych itemów | → | Reroll pojedynczego afiksu (koszt rośnie z każdą próbą) |
| Skrzynie w strefach | → | Respec drzewka umiejętności |
| Nagrody za bossy | → | Uzupełnianie mikstur, ulepszanie slotów |
| | | Kara za śmierć (10% posiadanego złota) |

**Cel:** inflacja złota powinna być ujemna od 15. poziomu — gracz zawsze ma na co wydawać.

---

## 9. Świat i struktura poziomów

### 9.1 Struktura

```
HUB (Obóz Łowców)
 ├── Strefa 1: Zgniłe Rozlewisko      (poziom 1–7)   — Gobliny
 ├── Strefa 2: Katakumby Zapomnianych (poziom 6–13)  — Nieumarli
 ├── Strefa 3: Wyżyna Kłów            (poziom 12–20) — Orkowie
 └── Strefa 4: Krater Popiołów        (poziom 19–25) — Boss finałowy
```

Każda strefa: **5–7 pomieszczeń ręcznie zaprojektowanych + 2 losowo wybierane z puli 6** — hybryda kontroli autorskiej i regrywalności.

### 9.2 Rytm strefy (encounter pacing)

```
Wejście (spokój, 20 s) → Encounter lekki → Eksploracja/skrzynia →
Encounter średni → Punkt kontrolny → Encounter ciężki (elita) →
Sekret opcjonalny → Arena mini-bossa → Nagroda → Boss strefy
```

**Zasada 3/1:** po trzech encounterach musi nastąpić minimum 30 s ciszy. Bez oddechu adrenalina spada w monotonię.

### 9.3 Zasady projektowania aren

- Minimum jedna przeszkoda pozwalająca zerwać linię wzroku wrogom dystansowym.
- Brak ślepych zaułków bez wyjścia (poza celowymi pułapkami z sygnalizacją).
- Arena bossa: promień ≥ 18 m, brak zaczepów kolizji, czytelne podłoże dla telegrafów AoE.
- Punkty kontrolne co ≤ 4 minuty rozgrywki.

---

## 10. Interfejs i UX

### 10.1 HUD

| Element | Pozycja | Uwagi |
|---|---|---|
| Pasek HP + stamina | Lewy dolny róg | Stamina znika po 3 s pełnego napełnienia |
| Sloty mikstur | Przy pasku HP | Widoczna liczba ładunków |
| Pasek XP + poziom | Dolna krawędź, pełna szerokość | Cienki, 6 px, animacja przyrostu |
| Sloty umiejętności + cooldowny | Prawy dolny róg | Radialny cooldown + błysk gotowości |
| Złoto, licznik zabójstw, streak | Prawy górny róg | Zanika przy braku aktywności |
| Pasek HP bossa + break bar | Górna krawędź, wyśrodkowany | Widoczne fazy jako podziałki |
| Celownik | Środek | Zmienia kształt w zasięgu trafienia |
| Wskaźniki zagrożenia poza ekranem | Krawędzie | Strzałki dla wrogów atakujących spoza kadru |

**Zasada:** HUD jest przezroczysty w 70% i wygasza się poza walką. Ekran należy do gry, nie do interfejsu.

**Podział implementacyjny (istotny dla stacku przeglądarkowego):**

| Warstwa | Technologia | Co tu trafia |
|---|---|---|
| Canvas (PixiJS) | WebGPU/WebGL | Świat, sprity, VFX, telegrafy AoE, liczby obrażeń, wskaźniki zagrożenia poza ekranem |
| DOM overlay | Svelte 5 (`pointer-events: none` poza interaktywnymi elementami) | Paski HP/staminy/XP, sloty umiejętności, ekwipunek, drzewko, menu, opcje |

Powód rozdziału: dostępność z 10.3 (skalowanie czcionek, kontrast systemowy, nawigacja klawiaturą, czytniki ekranu) jest w DOM darmowa, a w canvasie kosztuje tygodnie. Liczby obrażeń zostają w canvasie, bo muszą żyć w przestrzeni świata i podlegać poolingowi.

### 10.2 Feedback dla gracza

- Liczby obrażeń: białe (zwykłe), żółte (kryt), kolorowane wg żywiołu, szare (zredukowane pancerzem).
- Winieta czerwona pulsująca poniżej 30% HP + przytłumienie dźwięku + spowolnione bicie serca.
- Pełnoekranowy błysk i dedykowany stinger przy awansie na poziom.
- Wiązka światła i dźwięk rzadkości przy dropie Epic/Legendary.

### 10.3 Dostępność (wymóg, nie opcja)

- Pełny remapping klawiszy i pada.
- Suwaki: intensywność wstrząsu ekranu (0–100%, domyślnie 60), flash, motion blur.
- Tryby dla daltonistów (protanopia/deuteranopia/tritanopia) — telegrafy nigdy nie polegają wyłącznie na kolorze, zawsze też na kształcie.
- Skalowanie UI 75–150%, minimalny rozmiar czcionki 16 px.
- Poziomy trudności: Opowieść / Łowca / Weteran / Koszmar (modyfikują obrażenia otrzymywane 0.6× / 1.0× / 1.35× / 1.8× oraz agresję AI, **nie** HP przeciwników — worki na ciosy to zła trudność).
- Napisy do wszystkich dźwięków istotnych dla rozgrywki.

---

## 11. Architektura techniczna

### 11.0 Zasada nadrzędna

**Pętla 60 Hz nigdy nie dotyka sieci.** Gra jest w pełni klientowa i offline-first. Backend obsługuje zapisy, definicje balansu, telemetrię i live-ops. Żadna klatka nie czeka na odpowiedź serwera — w single playerze to byłby błąd projektowy, nie optymalizacja do zrobienia później.

### 11.1 Podział systemu

```
PRZEGLĄDARKA (localhost:5173 w dev)
  ├─ Canvas — PixiJS v8 ........ świat, sprity, VFX, telegrafy, liczby obrażeń
  ├─ DOM overlay — Svelte 5 .... HUD, ekwipunek, drzewko, menu, opcje, a11y
  ├─ Rdzeń TS (własny ECS) ..... symulacja 60 Hz, walka, AI, loot, progresja
  ├─ Web Audio ................. busy, ducking, muzyka adaptacyjna
  └─ IndexedDB ................. zapis offline-first
            │  HTTP (rzadko) + WebSocket (telemetria batch, hot reload balansu)
            ▼
BACKEND — Elixir / Phoenix (localhost:4000 w dev)
  ├─ REST API .................. sesja, sync zapisów, walidacja postępu
  ├─ BalanceServer (ETS) ....... definicje balansu + hot reload w dev
  ├─ Channels .................. ingest telemetrii, push nowego balansu
  ├─ Oban ...................... agregacje, raporty balansu
  ├─ LiveView /admin ........... dashboard playtestów
  └─ Ecto + PostgreSQL ......... gracze, zapisy, zdarzenia

NODE / BUN (offline, w CI)
  └─ Symulator balansu ......... ten sam kod walki co gra, 10k walk → tabela TTK/DPS
```

### 11.2 Warstwy klienta

```
┌─ Presentation ──── PixiJS renderer, Svelte HUD, Web Audio, kamera
├─ Systems ───────── Combat, Loot, Progression, Spawner, AI, Save, Telemetry
├─ Domain ────────── Entity, Stats, StatusEffect, Item, Ability
├─ Data ──────────── /data/*.json + typy generowane + schematy Zod
└─ Core ──────────── EventBus, ObjectPool, FixedLoop, SpatialHash, RNG
```

### 11.3 Kluczowe decyzje

| Decyzja | Uzasadnienie |
|---|---|
| **ECS z kompozycją**, gorące dane w `Float32Array` (pozycje, HP, cooldowny) | Lokalność cache i zero alokacji w pętli. Gracz i wróg dzielą te same systemy |
| **Fixed timestep 60 Hz** (akumulator) + interpolacja renderu | I-frames uniku (0.10–0.42 s) muszą być identyczne przy 60, 120 i 144 Hz odświeżania |
| **Deterministyczny RNG** (xorshift128+ z jawnym ziarnem), osobne strumienie dla loot/crit/AI | Powtarzalne bugi i możliwość replaya z telemetrii |
| **Własny spatial hash** zamiast silnika fizyki | Top-down ARPG nie potrzebuje rigid-body. Matter.js/Rapier to +300 KB i utrata determinizmu |
| **Flow field** na siatce nav zamiast A* per wróg | 24 wrogów × A* co klatkę nie zmieści się w budżecie 4 ms |
| **Data-driven balans** — `/data/*.json` jako jedyne źródło prawdy | Generuje typy TS, czyta go Phoenix i symulator. Hot reload w dev bez przeładowania strony |
| **Event bus** (`enemy_died`, `level_up`, `item_dropped`) | Systemy nie znają się nawzajem; telemetria podpina się jako subskrybent, nie jako wtrącenia w kod walki |
| **Object pooling** dla wrogów, pocisków, liczb obrażeń, VFX | Brak spike'ów GC — w przeglądarce GC jest poza twoją kontrolą, więc jedyną obroną jest nie alokować |
| **Warstwy kolizji rozdzielone:** świat / gracz / wróg / hitbox gracza / hitbox wroga / pocisk / interakcja | Uniknięcie 90% błędów walki na starcie |
| **Web Worker dla pathfindingu** (od M2, jeśli profiler pokaże potrzebę) | Flow field da się przeliczać poza wątkiem głównym; reszta symulacji zostaje na main thread |

### 11.4 System statystyk (modyfikatory)

```
wartość_końcowa = (baza + Σ flat) × (1 + Σ increased_%) × Π (1 + more_%)
```

Trzy typy modyfikatorów, jasno rozdzielone. `more` jest rzadkie i multiplikatywne — to sprawia, że legendy i kluczowe węzły drzewka są odczuwalne, a `increased` pozwala na kontrolowany stacking.

### 11.5 Zapis stanu

| Warstwa | Mechanizm |
|---|---|
| Lokalnie (źródło prawdy) | **IndexedDB**, klucz `save:slot_N`, wersjonowany polem `save_version` z migracjami |
| Backup | Poprzedni zapis pod `save:slot_N.bak` przed każdym nadpisaniem |
| Sync | `PUT /api/saves/:slot` przy autosave; przy konflikcie wygrywa nowszy `updated_at`, starszy ląduje jako `.conflict` |
| Tryb offline | Gra działa w całości bez backendu. Brak sieci → kolejka sync w IndexedDB, wysyłka przy powrocie |
| Autosave | Wejście do hubu, pokonanie bossa, każdy punkt kontrolny |
| Zakres | Postać, ekwipunek, drzewko, postęp stref, statystyki sesji, ustawienia, ziarno RNG |

**Nie używamy `localStorage`:** limit 5 MB, API synchroniczne, blokuje wątek główny w trakcie klatki.

### 11.6 Budżet przeglądarkowy

Sprzęt referencyjny: laptop z Intel Iris Xe, 1080p, Chrome i Firefox.

| Zasób | Budżet |
|---|---|
| Czas klatki | 16.6 ms — symulacja ≤ 4 ms, render ≤ 6 ms, DOM/HUD ≤ 1 ms |
| JS gzip (bundle startowy) | < 400 KB |
| Assety przed pierwszą areną | < 6 MB |
| Time to interactive (4G) | < 4 s |
| Jednocześni wrogowie | 24 (limit twardy w spawnerze) |
| Aktywne pociski | 120 |
| Draw calls | ≤ 300 (agresywne batchowanie z atlasów) |
| Alokacje w trakcie walki | **0** |

### 11.7 Backend — kontrakt API

| Endpoint | Metoda | Rola |
|---|---|---|
| `/api/session` | POST | Token urządzenia → gracz (gość, bez rejestracji) |
| `/api/balance` | GET | Definicje balansu + `ETag`; klient cache'uje i pyta warunkowo |
| `/api/saves/:slot` | GET / PUT | Sync zapisu, walidacja `save_version` |
| `/socket` → `telemetry:session` | WS | Batchowany ingest zdarzeń (raz na 5 s lub 50 zdarzeń) |
| `/socket` → `balance:live` | WS | Push nowych definicji balansu (dev: przy zapisie pliku, prod: przy deployu danych) |
| `/admin` | LiveView | Dashboard playtestów (sekcja 14) |

**Model zaufania w v1:** klient jest autorytatywny, serwer robi tylko sanity check (tempo XP, tempo złota, spójność wersji). To gra jednoosobowa — oszustwo nikogo nie krzywdzi. Serwerowe rolowanie łupu wchodzi dopiero razem z leaderboardami.

## 12. Audio

| Kategoria | Wymagania |
|---|---|
| Muzyka | Warstwowa i adaptacyjna: eksploracja → walka → walka intensywna → boss. Crossfade 1.5 s |
| SFX walki | Osobne warstwy: zamach, trafienie w ciało/zbroję/tarczę, chybienie. Wariancja pitch ±8% |
| Telegrafy | **Każdy telegraf ma unikalny dźwięk** — gracz może reagować bez patrzenia na wroga |
| UI | Level-up stinger, drop rzadkości (osobny dźwięk per tier), niskie HP |
| Ducking | Ważne dźwięki (telegraf bossa, niskie HP) przytłumiają miks o −6 dB |
| Miks | Osobne suwaki: master, muzyka, SFX, UI, dialogi — jako `GainNode` w grafie Web Audio |
| **Polityka autoplay** | Przeglądarka blokuje `AudioContext` do pierwszego gestu użytkownika. Ekran startowy z przyciskiem „Graj" jest **wymogiem technicznym**, nie decyzją UX — dopiero jego kliknięcie robi `ctx.resume()` |
| Dekodowanie | Cały bank SFX dekodowany do `AudioBuffer` w preloaderze. `decodeAudioData` w trakcie walki powoduje zacięcie |
| Format | Opus w `.webm` (główny) + `.m4a` jako fallback dla Safari |

---

## 13. Plan produkcji

Kolejność ustalona wg **ryzyka**, nie wg łatwości. Najpierw budujemy to, co może zabić projekt.

### M0 — Fundament i środowisko lokalne (tydzień 1)
Monorepo (pnpm workspaces), Vite + TS + PixiJS, fixed loop 60 Hz z interpolacją, kontroler postaci, kamera, greybox arena rysowana proceduralnie. Równolegle: `mix phx.new`, docker-compose z Postgresem, proxy Vite → Phoenix. Pełny opis w sekcji 18.
**DoD:** `pnpm dev` podnosi klienta i backend jednym poleceniem; postać porusza się płynnie, kamera bez jitteru, stabilne 60 FPS przy pustej arenie.

### M1 — Combat Core Gym (tygodnie 2–4) ⚠️ *najwyższe ryzyko*
Combo, unik z i-frames, stamina, hitboxy, hitstop, screen shake, damage numbers, jeden manekin treningowy. Hot reload `/data/combat.json` przez kanał `balance:live` — zmieniasz okno i-frames w edytorze i widzisz efekt bez przeładowania strony.
**DoD:** walka z manekinem jest satysfakcjonująca *przed* dodaniem jakiejkolwiek zawartości. Jeśli nie jest — wracamy tu i iterujemy. To brama, nie kamień milowy.

### M2 — Przeciwnicy i AI (tygodnie 5–6)
FSM, percepcja, attack token system, separacja, stagger, 3 archetypy, śmierć + drop.
**DoD:** walka 1 vs 6 jest czytelna i wygrywalna umiejętnością.

### M3 — Progresja i persystencja (tygodnie 7–8)
XP, poziomy, atrybuty, statystyki data-driven, HUD w Svelte, zapis do IndexedDB + sync do Phoeniksa, ingest telemetrii, pierwsza wersja dashboardu LiveView.
**DoD:** pełna pętla „zabij → XP → poziom → mocniejszy" działa, przeżywa `F5`, a na `localhost:4000/admin` widać zdarzenia z sesji na żywo.

### M4 — Łup i ekwipunek (tygodnie 9–10)
Generator przedmiotów, afiksy, rzadkości, ekwipunek, UI, sprzedawca, złoto.
**DoD:** dwa różne buildy są realnie odczuwalnie inne.

### M5 — Vertical slice (tygodnie 11–13)
Jedna kompletna strefa + mini-boss + boss, hub, menu główne, pierwszy przebieg audio.
**DoD:** 30 minut rozgrywki, które można pokazać obcej osobie bez tłumaczenia.

### M6 — Zawartość (tygodnie 14–16)
Pozostałe strefy, pełny roster, drzewko umiejętności, legendarne przedmioty, modyfikatory elit.

### M7 — Polish i balans (tygodnie 17–18)
Telemetria, playtesty z 5+ osobami, strojenie krzywych, dostępność, optymalizacja, bugfixing.
**DoD:** demo publikowalne.

---

## 14. Telemetria i balansowanie

Zbieramy lokalnie (opt-in) i analizujemy po playtestach:

- TTK per typ przeciwnika per poziom gracza — wykrywa worki na ciosy i papierowych wrogów.
- Liczba śmierci per pomieszczenie — wykrywa spike'i trudności.
- Rozkład DPS graczy per poziom — wykrywa buildy zepsute i martwe.
- Czas do każdego poziomu — weryfikacja krzywej XP.
- Wykorzystanie umiejętności — węzeł używany przez < 5% graczy jest zepsuty i wymaga przeprojektowania.
- % uników wykonanych w oknie i-frames — mierzy czytelność telegrafów.

**Metoda strojenia:** budżet DPS zamiast intuicji. Dla każdego poziomu wyliczamy oczekiwany DPS gracza w buildzie „przeciętnym" i z niego wyprowadzamy HP przeciwników pod docelowe TTK.

**Jak to działa technicznie w tym stacku:**

| Etap | Gdzie |
|---|---|
| Symulacja 10 000 walk na tych samych modułach walki co gra | Node/Bun headless, `worker_threads`, w CI jako stage `sim-balance` |
| Wynik jako tabela TTK/DPS per poziom per build | Artefakt GitLab CI + test regresji w Vitest (próg: zmiana TTK > 15% wywala pipeline) |
| Ingest realnych zdarzeń z playtestów | Phoenix Channel → Oban → Postgres |
| Agregacja i percentyle | Oban worker, nocny job |
| Podgląd na żywo | LiveView `/admin` — heatmapa śmierci, krzywa czasu do poziomu, wykorzystanie węzłów drzewka |
| Korekta | Zmiana `/data/*.json` → push kanałem `balance:live` → efekt bez redeployu klienta |

**Uwaga projektowa:** symulator musi importować *dokładnie ten sam* kod walki co gra. Osobna implementacja w innym języku rozjedzie się z produkcją w ciągu kilku tygodni i będzie gorsza niż jej brak.

---

## 15. Ryzyka i plan awaryjny

| Ryzyko | Prawdopodobieństwo | Wpływ | Mitygacja |
|---|---|---|---|
| Walka nie „czuje się" dobrze mimo iteracji | Średnie | **Krytyczny** | M1 jest bramą — nie idziemy dalej bez akceptacji. Budżet 2 dodatkowych tygodni na iterację |
| Scope creep (multiplayer, crafting, otwarty świat) | Wysokie | Wysoki | Sekcja antyfilarów jest wiążąca. Pomysły trafiają do backlogu „v2", nie do zakresu |
| Chaos wizualny przy 8+ wrogach | Średnie | Wysoki | Attack token system, limit spawnów, outline'y wrogów w trybie kontrastu |
| Wypalenie przy produkcji zawartości (M6) | Wysokie | Średni | Modularne, data-driven definicje — nowy wróg to plik danych + 1 zachowanie, nie nowa klasa |
| Balans rozjeżdża się po dodaniu legend | Wysokie | Średni | Twarde capy na kradzież życia, kryt, szybkość ruchu i redukcję cooldownów |
| Assety graficzne blokują postęp | Średnie | Średni | Greybox przez cały M1–M4. Sztuka wchodzi dopiero w M5 |
| Brak edytora scen — projektowanie aren kodem jest wolne | Wysokie | Średni | Tiled jako edytor map od M2 + własny importer JSON. Nie budujemy własnego edytora |
| Rozjazd `/data` między klientem, backendem i symulatorem | Średnie | Wysoki | Jedno źródło prawdy w repo, generowanie typów TS i walidacja schematów jako stage CI |
| Zacięcia GC w przeglądarce | Średnie | Wysoki | Pooling + typed arrays od M1, nie „później". Profil pamięci w DevTools jako stały punkt DoD każdego milestone'u |
| Bundle rośnie ponad budżet | Średnie | Średni | `rollup-plugin-visualizer` w CI, twardy limit 400 KB gzip jako failing test |
| Backend staje się blokerem rozwoju gry | Niskie | Wysoki | Klient działa w pełni bez backendu (offline-first). Phoenix można wyłączyć i gra nadal się uruchamia |

---

## 16. Definicja sukcesu v1.0

- [ ] Gracz testowy przechodzi pierwsze 10 minut bez tłumaczenia sterowania.
- [ ] Mediana czasu do porzucenia rozgrywki > 35 min w playteście.
- [ ] Co najmniej 3 realnie różne, wykonalne buildy do poziomu 25.
- [ ] Stabilne 60 FPS przy 20 wrogach na ekranie, na laptopie z grafiką zintegrowaną, w Chrome **i** Firefoksie.
- [ ] Bundle startowy < 400 KB gzip, time to interactive < 4 s.
- [ ] Gra uruchamia się i działa z wyłączonym backendem (tryb offline).
- [ ] Zero crashy w 10 pełnych przebiegach.
- [ ] Boss finałowy pokonany przez playtesterów w 3–6 próbach (nie 1, nie 20).

---

## 17. Backlog v2 (świadomie poza zakresem)

Co-op 2–4 graczy · Tryb nieskończony z rosnącą trudnością · Crafting i ulepszanie przedmiotów · Sezonowe modyfikatory · Klasy postaci zamiast jednego uniwersalnego bohatera · Proceduralne lochy · Tryb New Game+ · Steam Workshop dla modów

---

---

## 18. Środowisko lokalne (localhost)

Cel: **jedno polecenie podnosi cały stack**. Szczegółowa instrukcja krok po kroku, wraz z kodem, znajduje się w osobnym dokumencie `monster-slayer-localhost.md`; skrócona instrukcja uruchomienia w `README.md`.

### 18.1 Porty i procesy

| Proces | Port | Uruchomienie | Stan |
|---|---|---|---|
| **Gra (Vite dev server, HMR)** | `5173` | `docker compose up` | **działa** |
| Gra (build produkcyjny za nginx) | `8080` | `docker compose --profile prod up --build web` | **działa** |
| Backend (Phoenix) | `4000` | `mix phx.server` | M3 |
| Dashboard LiveView | `4000/admin` | — | M3 |
| PostgreSQL (Docker) | `5433` → 5432 | `docker compose --profile backend up -d db` | **działa** |
| Symulator balansu | — | `pnpm sim` (headless, bez serwera) | **działa** |
| Smoke E2E | — | `pnpm e2e` (Playwright) | **działa** |

Port Postgresa celowo przesunięty na `5433`, żeby nie kolidował z lokalną instancją.

Docelowo cały stack podnosi jedno `docker compose up`. Dziś to polecenie podnosi grę,
a baza i backend siedzą za profilami — klient jest offline-first (§11.0), więc
uruchamianie Postgresa dla samej gry byłoby kosztem bez zysku.

### 18.2 Dlaczego proxy zamiast CORS

Vite proxuje `/api` i `/socket` na `localhost:4000`. Z punktu widzenia przeglądarki wszystko leci z jednego originu, więc **CORS w ogóle nie występuje** — w dev nie ma preflightów, w produkcji klient i API i tak stoją za jedną domeną. `cors_plug` zostaje w projekcie tylko jako furtka na wypadek hostowania klienta na osobnej domenie.

### 18.3 Kontekst bezpieczny bez certyfikatów

`localhost` jest traktowany przez przeglądarki jako secure context, więc **WebGPU, Gamepad API, Pointer Lock i Service Worker działają bez HTTPS**. Nie konfigurujemy lokalnego TLS-a — to zbędna komplikacja.

### 18.4 Hot reload balansu — pętla iteracji z M1

```
edytujesz /data/combat.json
   → FileSystem watcher w Phoeniksie (tylko :dev)
   → walidacja schematu; błąd = log, stary balans zostaje w ETS
   → Phoenix.PubSub → kanał balance:live
   → klient podmienia definicje i emituje balance:reloaded
   → systemy czytają nowe wartości od następnego ticku
```

Bez przeładowania strony, bez utraty stanu areny. To jest realny powód, dla którego backend w Elixirze zarabia na siebie już w drugim tygodniu projektu.

### 18.5 Definicja gotowości środowiska

- [x] `docker compose up` → gra na `localhost:5173`, bez żadnych zależności na hoście.
- [x] `F5` nie gubi postępu (IndexedDB).
- [x] Brak backendu nie zatrzymuje gry — pojawia się tylko informacja o trybie offline.
- [x] `pnpm sim` generuje tabelę TTK bez uruchamiania przeglądarki.
- [ ] Zapis `/data/combat.json` zmienia zachowanie walki w < 1 s bez przeładowania. *(wymaga kanału `balance:live` — M3)*
- [ ] `localhost:4000/admin` pokazuje zdarzenia z trwającej sesji. *(M3)*

---

*Dokument żywy. Każda zmiana balansu powinna być odnotowana w changelogu wraz z uzasadnieniem opartym na danych z playtestów.*
