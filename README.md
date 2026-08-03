# Monster Slayer

Przeglądarkowy hack'n'slash, w którym postać walczy dalej, kiedy zamkniesz kartę —
a wracasz po to, żeby podjąć decyzję o buildzie, nie żeby klikać.

Walka 3D w rzucie 3/4 wg `monster-slayer-gdd.md`, warstwa idle wg [`docs/v4.md`](docs/v4.md).
Silnik: **Babylon.js 9** (WebGPU z fallbackiem WebGL2), zero assetów graficznych.

**Status:** grywalny greybox — kamienie milowe **M0–M4** z GDD §13 plus **warstwa
idle z planu v4** (ekonomia, strefy, offline, prestiż, kuźnia, drzewko, kod builda).
Backend Phoenix (M3: sync zapisów, telemetria, `/admin`) jeszcze nie powstał — gra jest
offline-first i działa bez niego w całości.

Stan implementacji v4 co do sekcji: [`docs/v4-implementacja.md`](docs/v4-implementacja.md).
Szczegóły braków w warstwie walki: [Zakres](#zakres).

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
| `pnpm sim` | symulator balansu walki, headless, wypisuje tabelę TTK/DPS |
| `pnpm sim:idle` | symulator progresji idle + bramki z planu v4 |
| `pnpm test:unit` | testy jednostkowe rdzenia (`node --test`, bez zależności) |
| `pnpm typecheck` | `tsc` + `svelte-check` we wszystkich pakietach |
| `pnpm e2e` | smoke E2E w Playwright (wymaga działającego `:5173`) |
| `pnpm shot` | zrzut ekranu z walki do `tests/artifacts/combat.png` |
| `pnpm shot:idle` | zrzuty ekranów idle do `tests/artifacts/idle-*.png` |
| `pnpm shot:fx` | zrzuty efektów walki do `tests/artifacts/fx-*.png` |
| `pnpm shot:3d` | zrzuty sceny 3D (wymusza `?quality=high`) do `tests/artifacts/3d-*.png` |

---

## Sterowanie

| Akcja | Klawiatura + mysz | Pad (XInput) |
|---|---|---|
| Ruch | W / A / S / D | Lewa gałka |
| Celowanie | **kierunek ruchu** (domyślnie) lub kursor | Prawa gałka |
| Atak podstawowy (combo 3-ciosowe) | LPM **lub J / C** | RT |
| Atak ciężki (ładowany 0.9 s) | **K / V** lub PPM lub przytrzymanie LPM po ciosie | LT |
| Unik (i-frames 0.10–0.42 s) | Spacja | A |
| Sprint | Shift | LS |
| Mikstura | 1 | X |
| Ekwipunek i atrybuty | I | — |
| Panel idle — ulepszenia, strefa, prestiż | **G** | — |
| Combo zabójstw | licznik na górze ekranu, bez klawisza | — |
| Menu / pauza | Esc lub **Tab** | Menu |

> **Celowanie kierunkiem ruchu.** Domyślnie postać patrzy tam, gdzie idzie —
> na trackpadzie prowadzenie kursora i chodzenie naraz jest wyczerpujące.
> Stojąc w miejscu postać **sama zwraca się do najbliższego wroga** w promieniu
> 6 m; bez tego wróg za plecami wymagałby zrobienia kroku, żeby go dosięgnąć.
> Silnik celuje wyłącznie za obrót — decyzja o ataku, uniku i pozycji zostaje
> po stronie gracza. Klasyczne celowanie kursorem jest w Opcjach → Sterowanie.

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

## Oprawa 3D (Babylon.js 9)

Silnik graficzny to **Babylon.js 9**, domyślnie na **WebGL2**.
Wybór podyktowany jednym: klimat bez assetów bierze się ze światła, a Babylon
daje pełen zestaw (PBR, glow, bloom, DoF, gradacja kolorów, mgła) gotowy
i zestrojony, zamiast montowanego ręcznie.

> **Dlaczego nie WebGPU domyślnie.** Ścieżki WebGPU nie da się tu zweryfikować
> automatycznie: headless Chromium jej nie ma, a z flagami wymuszającymi
> się wywala. Wypuszczenie niesprawdzonej ścieżki jako domyślnej skończyło się
> czarnym ekranem u użytkownika przy zielonych testach. WebGL2 jest przetestowany
> end-to-end i na tej scenie w zupełności wystarcza. Do zbadania WebGPU służy
> `?engine=webgpu` — gdy okaże się sprawne na realnym sprzęcie, wystarczy
> zamienić domyślną.

**Kamera jest ortograficzna pod kątem 3/4**, nie perspektywiczna. To decyzja
rozgrywkowa, nie estetyczna: rzut równoległy zachowuje czytelność telegrafów AoE
(okrąg na ziemi jest zawsze tą samą elipsą, niezależnie od miejsca w kadrze)
i pozwala odwzorować sterowanie kursorem jeden do jednego. Round-trip
świat → ekran → świat jest dokładny co do zera.

**Postacie to prawdziwe bryły** (`render3d/bodies.ts`): tors, miednica, głowa,
barki, ramiona, nogi i broń, składane z pudełek, walców i kul. Proporcje idą
z budowy ciała (`slim` / `normal` / `heavy` / `hulking` / `crawler`), a głowa,
broń i akcenty z planu postaci — dodanie wroga to wpis w tablicy `PLANS`,
nie sesja w edytorze 3D.

Pierwsza wersja wytłaczała płaskie sylwetki 2D na 0.26 m i wyglądała **jak
piernik**: z boku postacie znikały, światło nie miało na czym pracować, a cień
był prostokątem. Bryły o realnej głębi rozwiązują wszystkie trzy naraz.

Każda postać jest **celowo asymetryczna** — broń uniesiona po prawej, tarcza
wysunięta w lewo, tors lekko pochylony. Symetryczna postać w rzucie 3/4 czyta
się jak manekin.

**Chód.** Postać scala się do **trzech** siatek — tułów i dwie nogi — bo
instancja Babylona dzieli geometrię ze źródłem i nie ma własnego wnętrza:
nogą w scalonej bryle nie da się ruszyć. Widok encji to węzeł z trzema
instancjami, nogi zamontowane na wysokości biodra (tam jest oś obrotu; przy
geometrii liczonej od podłoża noga obracałaby się wokół stopy i tonęła
w ziemi). Faza kroku rośnie z **przebytej drogi**, nie z czasu, więc długość
kroku jest stała i stopy nie jeżdżą po ziemi. Pełzacz przebiera sześcioma
odnóżami z ułamkiem amplitudy dwunoga. Koszt: trzy macierze na postać zamiast
jednej — wobec kosztu wypełniania pikseli to nic.

**Materiały trzyma cache, nie siatka.** Nic w ścieżce zwalniania encji nie
przekazuje `disposeMaterialAndTextures` — materiał ciała jest współdzielony
przez wszystkie instancje danego typu, a materiał cienia przez całą scenę.
Zwolnienie jednego wroga z tą flagą zabierało materiał wszystkim pozostałym:
cienie robiły się białe, wrogowie szaro-metalowi (aa/docs/10 §14).

**Klimat robią cztery rzeczy**, w tej kolejności ważności: mgła liniowa (głębia),
cienie kropelkowe (osadzenie na ziemi), warstwa poświaty (świecące akcenty
sylwetek) i gradacja kolorów z winietą.

### Trzy progi jakości

Dobierane automatycznie; wymuszenie przez `?quality=high|low|minimal`.

| Próg | Kiedy | Co odpada |
|---|---|---|
| `high` | ≥ 8 rdzeni i ≥ 8 GB | — |
| `low` | słabszy sprzęt | głębia ostrości, miękkie cienie, mniejsze jądra rozmycia |
| `minimal` | **wykryta rasteryzacja programowa** | cały post-processing i warstwa poświaty |

Progi `low` i `minimal` renderują też w **niższej rozdzielczości** (×1.25 i ×1.8)
i skalują obraz w górę. Koszt sceny jest liniowy w pikselach, więc daje to
ponad trzykrotną oszczędność — przy grafice bez tekstur strata ostrości jest
znacznie mniej dotkliwa niż spadek płynności.

Pomiar w rasteryzacji programowej (headless, 1280×800): pełny post-processing
**164 ms/klatkę**, bez niego **76 ms**, bez poświaty **43 ms**. Cienie i mgła są
praktycznie darmowe — kosztują wyłącznie pełnoekranowe przebiegi.

### Gdy ekran jest czarny

Renderer robi **samokontrolę dwie sekundy po starcie**: jeśli scena nie ma
aktywnych siatek albo kadr jest niemal czarny, wypisuje w konsoli silnik, próg
jakości, rozmiar canvasu i jasność kadru — oraz pokazuje panel na ekranie.
Czarny ekran przestał być niemy.

Zabezpieczenie regresyjne: `tests/render3d.spec.ts` sprawdza na **wszystkich
trzech progach jakości**, że w canvasie są niezerowe piksele. Żaden inny test
tego nie łapał — HUD, zapis, walka i warstwa idle działają niezależnie od
renderera, więc suita była zielona przy całkowicie czarnej scenie.

---

## Co jest zaimplementowane

**Walka (GDD §5)** — combo 3-ciosowe z oknami anulowania, atak ciężki ładowany,
unik z i-frames, stamina z opóźnioną regeneracją, poise i stagger, break bar bossa,
pełne formuły obrażeń z §5.4, hitstop (55/110/160 ms), slow-mo na zabójstwie,
trauma-based screen shake, camera kick, hit flash, poolowane liczby obrażeń.

**Przeciwnicy (GDD §7)** — 8 typów ręcznych w 6 archetypach (swarmer, ranged, bruiser,
caster, bomber, mini-boss), FSM `IDLE → PATROL → ALERT → CHASE → COMBAT ⇄ REPOSITION → STAGGERED`,
percepcja stożkiem 110°/14 m + słuch, **attack token system** (max 2 atakujących naraz),
separacja boidami, telegrafy kodowane kształtem, modyfikatory elit.

**Proceduralny bestiariusz** (`sim/enemygen.ts`) — ręczny roster kończy się po ośmiu
wpisach, a gra idle ma trwać setki encounterów. Każdy kolejny boss jest **inną walką**,
a każde zwycięstwo dokłada do puli dwa nowe typy sług.

Bestiariusz jest **czystą funkcją ziarna**: po przeładowaniu strony wychodzą te same
potwory, więc nic nie trzeba zapisywać poza licznikiem pokonanych bossów. `defIdx`
encji to indeks w tablicy definicji, więc tablica musi mieć ten sam kształt w każdej
sesji — dlatego wszystkie tiery powstają z góry, a dołożenie tieru nie przesuwa
wcześniejszych.

*Zestawy ataków* (7): szerokie cięcia seryjne, szarża, gęsty ostrzał, uderzenie
w ziemię, ciężka włócznia, szeroki zamach, szybkie pchnięcia. Rozdawane z **worka
losującego z zakazem powtórki wśród ostatnich czterech** — sam worek nie wystarcza,
bo na styku dwóch tasowań ten sam zestaw potrafi wypaść dwa razy pod rząd, a gracz
czyta to jako powtórzoną walkę.

*Atrybuty* (2–3 na bossa, najwyżej 1 na szeregowego): Dowódca (aura obrażeń),
Opoka (blok od przodu), Jadowity (kałuża), **Furia** (poniżej progu HP rosną
obrażenia i prędkość), **Cierniowy** (odbija część obrażeń, tylko w zwarciu),
**Przyzywacz** (dostawia sługi z krawędzi areny).

Żelazna zasada: **żadnych atrybutów na niby.** `GENERATED_TRAITS` wylicza wyłącznie
cechy, które symulacja naprawdę wykonuje, a test czyta źródła i sprawdza, że każda
ma miejsce odczytu. Bez tego łatwo o bossa opisanego jako „Furia", który w furię
nie wpada. Osobny zestaw testów (`test/traits.test.ts`) sprawdza **skutek** każdej
cechy — sam odczyt może przecież nic nie robić.

Pierwszy boss zostaje ręcznie strojonym Rycerzem Zgnilizny: pierwsze zderzenie
z mechaniką bossa ma być przewidywalne, dopiero potem robi się dziko.

**Progresja (GDD §6)** — krzywa `100 × n^1.35`, cztery atrybuty z efektami z §6.3,
punkty atrybutów i umiejętności, skalowanie strefy.

**Łup (GDD §8)** — 5 rzadkości, prefiksy i sufiksy skalowane item levelem, twarde capy,
4 legendy z działającymi unikalnymi modyfikatorami, ochrona przed pechem (pity 25→40),
ekwipunek z 9 slotami, sprzedaż, porównanie z założonym.

**Pętla sesyjna (GDD §9.2)** — encountery lekki → średni → ciężki, oddech co trzeci
(zasada 3/1), mini-boss co piąty, rosnący poziom strefy.

**Combo zabójstw** — seria z mnożnikiem nagród. Sześć tierów (Seria → Rzeź →
Masakra → Zagłada → Legenda → Nieśmiertelny), mnożnik od ×1.25 do ×5. Okno na
kolejne zabójstwo **kurczy się z każdym tierem** (4 s → 2 s), więc wysokie combo
jest nagrodą za tempo, a nie za długość sesji. Mnożnik dotyczy **złota i XP**
(także w warstwie idle) oraz — wolniej — szansy na łup; nie dotyka obrażeń, bo
combo ma nagradzać agresję, a nie zastępować build. Śmierć zrywa serię
natychmiast. Wszystko w `data/combat.json → killCombo`.

**Oprawa walki** — proceduralny system cząstek (`render3d/particles3d.ts`) na
thin instances, z wysokością niezależną od pozycji w świecie:

| Zdarzenie | Co widać |
|---|---|
| Trafienie | zielona krew tryskająca zgodnie z ciosem, iskry odbijające się przeciwnie, siła skalowana udziałem ciosu w HP celu |
| Trafienie krytyczne | **rozgrzane na czerwono ostrze** (opaque rdzeń + addytywna aura), czerwony łuk zamachu, pierścień uderzeniowy, krótka winieta |
| Śmierć wroga | rozbłysk, pierścień, chmura krwi, odłamki w kolorze wroga, trwała kałuża |
| Awans tieru combo | rozbłysk w kolorze tieru nad miejscem zabójstwa |

Krew opada z grawitacją i **zostawia plamy na arenie** — po encounterze widać,
gdzie się biło. Plamy blakną przez ~12 s, pula jest stała (110 sztuk).

---

## Warstwa idle (plan v4)

Nadbudowa nad walką, nie jej zamiennik. Walka z GDD to **tryb aktywny** z v4 §5.1;
warstwa idle dokłada nad nią ekonomię, strefy i pętle retencyjne w skalach od
5 sekund do 30 dni.

**Postęp offline (v4 §4.5)** — liczony **deterministycznie z różnicy timestampów**,
nigdy symulacją. Marsz przez strefy idzie w pętli po strefach, nie po klatkach:
powrót po tygodniu kosztuje tyle samo co powrót po minucie. Cap 8 h (24 h dla
Supportera), efektywność 0.55 (0.85). Zegar klienta nie może cofnąć postępu ani
wygenerować zysku — pilnuje tego `monotonicGuard`.

**Ekran powrotu** — najważniejszy ekran w grze (v4 §2.2). Robi dokładnie trzy rzeczy:
podaje konkretne liczby (`14 302 zabitych`, nie „zebrano nagrody"), **diagnozuje
powód blokady** i daje **jedną** sugerowaną akcję. Zero reklam i zero wezwań do
zakupu — dokument nazywa to wprost anty-wzorcem.

**Ekonomia** — siedem ulepszeń na krzywej `C(n) = C₀·r^n` z przyciskami ×1 i „kup max"
(odwrotność krzywej liczona logarytmicznie, żeby działała przy złocie rzędu 1e200).
HP stref: `HP(z) = HP₀·z^2.2·1.16^z`, boss co 10 stref z HP ×12.

**Prestiż i ascensja** — `PP = floor(20·√(złoto/T))`. Pierwiastek jest kluczowy:
każdy kolejny punkt kosztuje więcej postępu, ale żaden nie jest niemożliwy.
Drzewko trwałe (20 węzłów) plus warstwa 2 za Iskry (8 węzłów). Reset **nie**
kasuje ekwipunku, kodeksu unikatów ani bestiariusza.

**Drzewko umiejętności** — 60 węzłów, 3 gałęzie (Rzeź / Nawałnica / Chciwość),
6 keystone'ów zmieniających zasady. **Respec darmowy i natychmiastowy** — kara za
respec zabija eksperymentowanie, a eksperymentowanie jest tu głównym contentem.

**Przedmioty i kuźnia** — 9 slotów, 5 rzadkości, 18 afiksów skalowanych strefą dropu
(`base · (1 + 0.08·z) · roll`). Jakość rolla jest **widoczna dla gracza** i to ona
napędza reroll wartości — najlepszy sink w grze, bo 97% zawsze może być 98%.
12 unikatów, z których żaden nie jest zwykłym „+X% obrażeń": każdy zmienia regułę.

**Kod builda** — `MS4:` + własny LZSS + base64url, ~330 znaków dla pełnego builda.
Mieści się w komentarzu na Reddicie, widoczny na każdym zrzucie ekranu postaci.
„Zastosuj co się da" rozdaje punkty i zakłada **posiadane** przedmioty — nigdy nie
tworzy niczego z powietrza.

**Automatyzacje** — 8 pozycji odblokowywanych postępem, każda z nazwą tego, co
eliminuje. Nigdy nie automatyzują decyzji o buildzie (v4 §3.1).

**Wielkie liczby** — reprezentacja `{mantysa, wykładnik}`, polska skala długa
(`2.4 mln`, `1.24 bld`), przełączalna na notację naukową.

**Bramki balansu** — `pnpm sim:idle` symuluje 14 h gracza i sprawdza progi z v4:
boss strefy 10 po 0,50 h, auto-atak po 1,92 h, prestiż po 11,43 h, powrót po
prestiżu w 31% czasu (dokument wymaga 30–40%). `SIM_STRICT=true` zwraca kod
wyjścia ≠ 0 — nadaje się do CI.

---

## Świadome odstępstwa od GDD

Wszystkie siedzą w `data/combat.json`, więc powrót do wersji z dokumentu nie
wymaga dotykania kodu.

| Co | GDD | Tutaj | Pole |
|---|---|---|---|
| Bazowe HP gracza | 100 (§5.1) | **300** | `player.maxHp` |
| Regeneracja HP | brak, tylko mikstury i lifesteal (§5.1) | **1 HP/s** | `player.hpRegen` |
| Leczenie za zabójstwo | brak | **10% max HP celu, ponad limit** | `player.killHealPct`, `player.overhealCap` |
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

**Tylko zabójstwa dają overheal.** Dwa źródła leczenia mają celowo różne reguły:

| Źródło | Sufit |
|---|---|
| Zabicie wroga (`killHealPct`) | **ponad max HP**, do `overhealCap` × max HP (domyślnie **3×**) |
| Pasywna regeneracja (`hpRegen`) | dokładnie max HP |
| Mikstury, kradzież życia | dokładnie max HP |

`overhealCap = 1` znosi overheal, `0` zdejmuje limit całkowicie. Nadwyżka jest
w HUD złotym, kreskowanym segmentem po prawej stronie paska plus licznikiem
`+N`; awans na poziom dobija do pełna, ale **nie** zdejmuje nadwyżki.

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

**Audio (GDD §12)** — syntezowane proceduralnie, **zero plików dźwiękowych**.

Uderzenie składa się z **trzech warstw rozłożonych w czasie** — i to jest cała
różnica między „sygnalizacją" a walką:

| Warstwa | Czas | Co niesie |
|---|---|---|
| Transjent | 0–8 ms | trzask zetknięcia; jego brak sprawia, że cios jest miękki |
| Korpus | 8–120 ms | **masę** — 60 Hz to obuch, 400 Hz to sztylet |
| Ogon | do 600 ms | **materiał celu** |

Ogon zależy od tego, w co trafiłeś: ciało chlupie (wąskie pasmo nisko), kość
pęka sucho (dwa krótkie trzaski), pancerz dzwoni **niehartmonicznie** (tony
w proporcjach 1 : 2.37 : 3.81 — proporcje całkowite dałyby dzwonek, nie
uderzenie), jad syczy pasmem pełznącym w dół. Materiał ustala klient przy
`enemy:damaged`, bo rdzeń nie wie nic o warstwie audio.

Trzy rzeczy zamieniają dźwięki w **przestrzeń**:

- **Pogłos splotowy** z proceduralnie wygenerowaną odpowiedzią impulsową
  (1,1 s ogona plus cztery wczesne odbicia — bez nich pogłos brzmi jak mgła,
  a nie jak ściany w konkretnej odległości). Jeden konwolwer na całą grę,
  magistralą aux.
- **Panorama i tłumienie z odległości** — cios z lewej słychać z lewej,
  wybuch z 20 m jest 3,4× cichszy niż z metra.
- **Limiter na masterze** — przy dwudziestu wrogach mix bez niego przesterowuje.

Świst zamachu robi **przemiatanie filtra**, nie jego położenie: statyczne pasmo
brzmi jak szum, przemiatane — jak ostrze tnące powietrze. Wokalizacje wrogów to
detuneowane piły przez trzy formanty; trzy to minimum, przy którym ucho słyszy
gardło, a nie syntezator.

Zmierzona dynamika (`tests/audio.spec.ts`): zamachy 0.03–0.06, trafienia
0.14 → 0.28 (lekkie vs ciężkie), przełamanie 0.29, wybuch 0.40. Test pilnuje,
żeby żadne zdarzenie walki nie było ciche ani nie ocierało się o przesterowanie —
**audio, którego się nie mierzy, jest audio, którego się nie sprawdziło**.

**Zapis (GDD §11.5)** — IndexedDB z wersjonowaniem i backupem `.bak`, autosave co 8 s
oraz przy wyczyszczeniu encounteru, awansie i utracie widoczności karty.

---

## Zakres — czego jeszcze nie ma

| Element | Kamień milowy | Uwaga |
|---|---|---|
| Backend Phoenix (`/api`, `balance:live`, `/admin`, Oban, Postgres) | M3 | Klient ma gotowego klienta HTTP/WS i tryb offline; `docker compose --profile backend up db` podnosi samą bazę |
| **UI kuźni, drzewka, wyzwań, bestiariusza, filtru łupu** | v4 | Logika i dane stoją i są przetestowane — brakuje ekranów. Największy pozostały kawałek, szczegóły w `docs/v4-implementacja.md` |
| Hub, 4 strefy, pokoje z Tiled, boss finałowy | M5–M6 | Zamiast tego jedna arena z narastającymi encounterami |
| Animacje klatkowe, atlasy sprite'ów | M5 | Sylwetki są rysowane proceduralnie i nieanimowane — pozy statyczne, reakcje przez skalę, przechył i błysk |
| Sprzedawca, respec, reroll afiksów | M4–M5 | Sprzedaż przedmiotów działa |

---

## Architektura

```
data/                  ← jedyne źródło prawdy dla balansu
                         walka: combat, enemies, affixes, progression
                         idle:  idle, idle-affixes, uniques, skilltree, prestige-tree, challenges
packages/core/         ← ECS, walka, AI, loot, progresja + warstwa idle (src/idle/).
                         Czysty TS, ZERO API przeglądarki
packages/core/test/    ← testy jednostkowe (node --test, natywne stripowanie typów)
packages/client/       ← Babylon.js 9 (scena 3D) + Svelte 5 (HUD) + Web Audio + IndexedDB
  render3d/            ← renderer 3D: scena, siatki, cząstki, kamera
  render/characters.ts ← WSPÓLNE specyfikacje sylwetek (3D wytłacza, galeria rysuje płasko)
packages/sim/          ← headless symulatory balansu — walki i progresji idle
tests/                 ← E2E (Playwright), w tym warstwa idle
```

Warstwa idle jest **czysto funkcyjna**: `(state, config, …) → wynik`, mutacja tylko
w funkcjach, które mówią o tym nazwą. Dzięki temu każda formuła z v4 §4 jest
testowalna bez uruchamiania gry, a symulator progresji napędza **dokładnie ten sam**
kod co przeglądarka.

> **Uwaga dla `packages/core`:** żadnych parametrów-właściwości w konstruktorach
> (`constructor(private x)`). Nie przechodzą przez natywne stripowanie typów
> w Node, a na nim stoją symulatory i testy jednostkowe.

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

**Aktualny odczyt: 38 z 38 wierszy poza oknem** — wszystko ginie szybciej, niż zakłada
GDD §7.3. To wprost skutek skrócenia animacji ataku opisanego w „Świadomych
odstępstwach" (DPS gracza ~2.4×), a nie błąd: przywrócenie okien TTK oznacza
podniesienie HP przeciwników, czyli cofnięcie zmiany, o którą chodziło.

Obraz jest dodatkowo zawyżony — symulowany gracz nigdy nie robi uniku ani nie traci
czasu na repozycję, więc realne TTK jest wyższe. Strojenie krzywych to M7 (GDD §13).

> Warstwa idle ma **własny** symulator z własnymi bramkami: `pnpm sim:idle`.
> Ten tutaj mierzy wyłącznie walkę w trybie aktywnym.

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
| JS gzip | < 700 KB | **482 KB** (gra + Babylon.js 9) |
| Assety przed pierwszą areną | < 6 MB | **0 MB** — wszystko proceduralne |
| Alokacje w trakcie walki | 0 | typed arrays + free-lista encji, pooling liczb obrażeń, telegrafów, cząstek i plam |
| Jednocześni wrogowie | 24 (limit twardy) | egzekwowane w spawnerze |
| Cząstki naraz | 320 + 110 plam | thin instances: **jedno wywołanie rysowania** niezależnie od liczby |
| Wywołania rysowania | — | siatki postaci scalone i instancjonowane per typ |

> **Budżet podniesiony z 400 KB przy przejściu na 3D.** Babylon.js to pełny
> silnik, nie biblioteka renderująca — płacimy rozmiarem za gotowy
> post-processing, którego inaczej trzeba by napisać. Assety nadal ważą 0 MB,
> więc całość pobierania to jeden plik JS.

### Zasada, która kosztowała najwięcej

> **`Graphics` przerysowywany co klatkę odbudowuje bufory GPU.**

Warstwa efektów walki złamała tę zasadę trzy razy naraz — animowane tło areny
(sześć dużych wielokątów addytywnych), fale uderzeniowe i blask ostrza. Efekt:
**353 ms na klatkę**, 4 fps, gra przestawała reagować na input.

Naprawa polegała na tym samym chwycie w trzech miejscach: **narysuj raz,
potem animuj transformacją.**

| Element | Przed | Po |
|---|---|---|
| Tło areny | 6 wielokątów addytywnych + 3 pierścienie co klatkę | wypalone do jednej tekstury, jeden sprite |
| Fala uderzeniowa | `clear()` + 32-punktowa elipsa co klatkę | pierścień jednostkowy rysowany raz, animowany `scale`/`alpha` |
| Blask ostrza | 2 × `Graphics` przerysowywane przez 0.45 s po każdym krytyku | rysowany raz, wygaszany `alpha` |
| Cząstki | — | od początku pooling sprite'ów, nigdy `Graphics` |

Wynik: **353 ms → 27 ms na klatkę** (13×), 4 → 39 fps w rasteryzacji programowej
headless. Pomiar: `tests/` + profilowanie warstw przez `renderer.<layer>.visible`.

Rzut izometryczny jest **liniowy**, więc przesunięcie i skalowanie w przestrzeni
świata przekładają się 1:1 na transformację gotowej geometrii ekranowej — dlatego
ten chwyt w ogóle działa. Jedyny haczyk: `Graphics` rysowany we współrzędnych
bezwzględnych trzeba skalować wokół `pivot` ustawionego na punkt zaczepienia,
inaczej rośnie wokół środka sceny i odlatuje poza kadr.
