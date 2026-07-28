# Monster Slayer — środowisko lokalne (localhost)

Dokument towarzyszący `monster-slayer-gdd.md` (sekcja 18) i `monster-slayer-stack.md`.
Cel: **jedno polecenie podnosi klienta, backend i bazę.**

> **Stan implementacji (M0–M4).** Klient jest zaimplementowany i uruchamialny —
> `docker compose up` → <http://localhost:5173>. Backend Phoenix z sekcji 3–8 tego
> dokumentu **jeszcze nie powstał** (M3); klient ma po swojej stronie komplet
> integracji (kaskada balansu, kolejka telemetrii, sync zapisów, kanał
> `balance:live`) i działa w trybie offline. Sekcje 3–8 pozostają specyfikacją
> do zbudowania, nie opisem istniejącego kodu.

---

## 0. Wymagania wstępne

**Ścieżka dockerowa (zalecana) — wymaga wyłącznie Dockera:**

| Narzędzie | Wersja | Sprawdzenie |
|---|---|---|
| Docker + Compose | dowolna aktualna | `docker compose version` |

**Ścieżka natywna (do pracy nad kodem bez kontenera):**

| Narzędzie | Wersja | Sprawdzenie |
|---|---|---|
| Node | ≥ 22 | `node -v` |
| pnpm | ≥ 10 | `corepack enable pnpm && pnpm -v` |
| Elixir / OTP | 1.19 / 27 | `elixir -v` — tylko dla backendu (M3) |

Nie potrzebujesz certyfikatów TLS. Przeglądarki traktują `localhost` jako **secure context**, więc WebGPU, Gamepad API, Pointer Lock i Service Worker działają po HTTP.

---

## 1. Struktura repozytorium

```
monster_slayer/
├── data/                       # JEDYNE źródło prawdy dla balansu
│   ├── combat.json             #   gracz, combo, unik, hitstop, trudność
│   ├── enemies.json            #   roster, archetypy, percepcja, elity
│   ├── affixes.json            #   rzadkości, prefiksy, sufiksy, legendy, drop
│   └── progression.json        #   krzywa XP, atrybuty, skalowanie strefy
├── packages/
│   ├── core/                   # ECS, walka, AI, loot — czysty TS, zero DOM
│   ├── client/                 # Pixi v8 + Svelte 5 + Vite
│   └── sim/                    # symulator balansu (headless Node)
├── tests/                      # smoke E2E (Playwright)
├── docker/nginx.conf           # serwer statyków dla builda produkcyjnego
├── Dockerfile                  # cele: dev (Vite) i prod (nginx)
├── docker-compose.yml
├── playwright.config.ts
└── pnpm-workspace.yaml
```

Kluczowe: `packages/core` **nie importuje niczego z przeglądarki**. Dzięki temu ten sam kod walki napędza grę i symulator.

Granica jest egzekwowana konfiguracją, nie dobrą wolą: `packages/core/tsconfig.json`
ma `"lib": ["ES2022"]` i `"types": []`, więc każde sięgnięcie po `window`, `document`
czy `requestAnimationFrame` wywala `pnpm typecheck`. Z tego powodu sama pętla gry
(`requestAnimationFrame`) mieszka w `packages/client/src/loop.ts`, a w rdzeniu
zostają wyłącznie stałe kroku czasowego.

---

## 2. Baza danych

Baza jest potrzebna dopiero backendowi (M3), dlatego siedzi za profilem `backend` —
sama gra jest offline-first i jej nie wymaga.

```bash
docker compose --profile backend up -d db
docker compose --profile backend ps      # status healthcheck
```

Connection string dla dev: `postgres://postgres:postgres@localhost:5433/monster_slayer_dev`

---

## 3. Backend Phoenix — utworzenie

```bash
mix archive.install hex phx_new
mix phx.new server --app monster_slayer --binary-id --no-mailer
cd server
```

`--binary-id` (UUID) od razu, bo migracja z integerów po fakcie jest bolesna.
LiveView zostawiamy — jest potrzebny na `/admin`.

### 3.1 Zależności

```elixir
# server/mix.exs
defp deps do
  [
    # ... wygenerowane przez phx.new ...
    {:oban, "~> 2.19"},
    {:cors_plug, "~> 3.0"},
    {:file_system, "~> 1.0", only: :dev}
  ]
end

defp aliases do
  [
    setup: ["deps.get", "ecto.setup", "assets.setup", "assets.build"],
    "ecto.setup": ["ecto.create", "ecto.migrate", "run priv/repo/seeds.exs"],
    "ecto.reset": ["ecto.drop", "ecto.setup"]
  ]
end
```

```bash
mix setup
```

### 3.2 Konfiguracja dev

```elixir
# server/config/dev.exs
config :monster_slayer, MonsterSlayer.Repo,
  username: "postgres",
  password: "postgres",
  hostname: "localhost",
  port: 5433,
  database: "monster_slayer_dev",
  pool_size: 10

config :monster_slayer, MonsterSlayerWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4000],
  check_origin: ["//localhost:5173", "//localhost:4000"],
  debug_errors: true,
  code_reloader: true

# hot reload definicji balansu — tylko w dev
config :monster_slayer,
  data_dir: Path.expand("../../data", __DIR__),
  watch_data: true
```

```elixir
# server/config/config.exs
config :monster_slayer, Oban,
  repo: MonsterSlayer.Repo,
  queues: [telemetry: 20, reports: 2],
  plugins: [
    {Oban.Plugins.Pruner, max_age: 60 * 60 * 24 * 7},
    {Oban.Plugins.Cron, crontab: [{"0 3 * * *", MonsterSlayer.Analytics.NightlyReport}]}
  ]
```

### 3.3 Drzewo nadzoru

```elixir
# server/lib/monster_slayer/application.ex
children = [
  MonsterSlayerWeb.Telemetry,
  MonsterSlayer.Repo,
  {DNSCluster, query: Application.get_env(:monster_slayer, :dns_cluster_query) || :ignore},
  {Phoenix.PubSub, name: MonsterSlayer.PubSub},
  {Oban, Application.fetch_env!(:monster_slayer, Oban)},
  MonsterSlayer.Balance.Server,        # <-- ETS + watcher
  MonsterSlayerWeb.Endpoint
]
```

---

## 4. Schemat bazy

```bash
mix ecto.gen.migration create_core_tables
```

```elixir
# server/priv/repo/migrations/*_create_core_tables.exs
defmodule MonsterSlayer.Repo.Migrations.CreateCoreTables do
  use Ecto.Migration

  def change do
    create table(:players, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :device_token, :string, null: false
      add :nickname, :string
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:players, [:device_token])

    create table(:saves, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :player_id, references(:players, type: :binary_id, on_delete: :delete_all), null: false
      add :slot, :integer, null: false
      add :save_version, :integer, null: false
      add :payload, :map, null: false
      add :checksum, :string
      timestamps(type: :utc_datetime_usec)
    end

    create unique_index(:saves, [:player_id, :slot])

    create table(:events, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :player_id, references(:players, type: :binary_id, on_delete: :delete_all)
      add :session_id, :binary_id, null: false
      add :type, :string, null: false
      add :payload, :map, null: false, default: %{}
      add :occurred_at, :utc_datetime_usec, null: false
    end

    create index(:events, [:type, :occurred_at])
    create index(:events, [:session_id])
  end
end
```

```bash
mix ecto.migrate
```

---

## 5. BalanceServer — ETS + hot reload

Serce integracji dev. Trzyma definicje balansu w ETS, w `:dev` obserwuje katalog `data/` i przy zmianie rozgłasza nowy zestaw przez PubSub.

```elixir
# server/lib/monster_slayer/balance/server.ex
defmodule MonsterSlayer.Balance.Server do
  use GenServer
  require Logger

  @table :balance_cache
  @topic "balance:live"

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  def get, do: :ets.lookup_element(@table, :payload, 2)
  def etag, do: :ets.lookup_element(@table, :etag, 2)

  @impl true
  def init(_) do
    :ets.new(@table, [:named_table, :set, :protected, read_concurrency: true])
    load()

    if Application.get_env(:monster_slayer, :watch_data, false) do
      dir = Application.fetch_env!(:monster_slayer, :data_dir)
      {:ok, pid} = FileSystem.start_link(dirs: [dir])
      FileSystem.subscribe(pid)
      Logger.info("[balance] obserwuję #{dir}")
    end

    {:ok, %{}}
  end

  @impl true
  def handle_info({:file_event, _pid, {path, _events}}, state) do
    if String.ends_with?(path, ".json") do
      # debounce — edytory zapisują plik kilka razy pod rząd
      Process.send_after(self(), :reload, 120)
    end

    {:noreply, state}
  end

  def handle_info(:reload, state) do
    case load() do
      {:ok, etag} ->
        Phoenix.PubSub.broadcast(MonsterSlayer.PubSub, @topic, {:balance_updated, get(), etag})
        Logger.info("[balance] przeładowano, etag=#{etag}")

      {:error, reason} ->
        # Świadomie NIE nadpisujemy poprawnych danych błędnymi.
        Logger.error("[balance] błąd wczytywania, zostaje poprzedni zestaw: #{inspect(reason)}")
    end

    {:noreply, state}
  end

  def handle_info(_, state), do: {:noreply, state}

  defp load do
    dir = Application.fetch_env!(:monster_slayer, :data_dir)

    with {:ok, files} <- File.ls(dir),
         json_files = Enum.filter(files, &String.ends_with?(&1, ".json")),
         {:ok, payload} <- read_all(dir, json_files) do
      etag = payload |> :erlang.term_to_binary() |> :erlang.md5() |> Base.encode16(case: :lower)
      :ets.insert(@table, {:payload, payload})
      :ets.insert(@table, {:etag, etag})
      {:ok, etag}
    end
  end

  defp read_all(dir, files) do
    Enum.reduce_while(files, {:ok, %{}}, fn file, {:ok, acc} ->
      key = Path.rootname(file)

      case dir |> Path.join(file) |> File.read!() |> Jason.decode() do
        {:ok, data} -> {:cont, {:ok, Map.put(acc, key, data)}}
        {:error, err} -> {:halt, {:error, {file, err}}}
      end
    end)
  end
end
```

> **Miejsce na walidację schematu.** Zanim `:ets.insert` nadpisze dane, warto przepuścić je przez `NimbleOptions` albo własny walidator. Nie chcesz stracić 20 minut na debugowanie tego, że literówka w JSON-ie po cichu wyzerowała HP wszystkich wrogów.

---

## 6. Router i kontrolery

```elixir
# server/lib/monster_slayer_web/router.ex
pipeline :api do
  plug :accepts, ["json"]
end

scope "/api", MonsterSlayerWeb do
  pipe_through :api

  post "/session", SessionController, :create
  get  "/balance", BalanceController, :show
  get  "/saves/:slot", SaveController, :show
  put  "/saves/:slot", SaveController, :update
end

scope "/admin", MonsterSlayerWeb do
  pipe_through :browser
  live "/", DashboardLive, :index
end
```

### 6.1 Balans z ETagiem

```elixir
# server/lib/monster_slayer_web/controllers/balance_controller.ex
defmodule MonsterSlayerWeb.BalanceController do
  use MonsterSlayerWeb, :controller
  alias MonsterSlayer.Balance

  def show(conn, _params) do
    etag = Balance.Server.etag()

    if get_req_header(conn, "if-none-match") == [etag] do
      send_resp(conn, 304, "")
    else
      conn
      |> put_resp_header("etag", etag)
      |> put_resp_header("cache-control", "no-cache")
      |> json(%{etag: etag, data: Balance.Server.get()})
    end
  end
end
```

### 6.2 Zapisy

```elixir
# server/lib/monster_slayer_web/controllers/save_controller.ex
defmodule MonsterSlayerWeb.SaveController do
  use MonsterSlayerWeb, :controller
  alias MonsterSlayer.Saves

  plug :require_player

  def show(conn, %{"slot" => slot}) do
    case Saves.get(conn.assigns.player, String.to_integer(slot)) do
      nil -> send_resp(conn, 404, "")
      save -> json(conn, %{payload: save.payload, save_version: save.save_version,
                           updated_at: save.updated_at})
    end
  end

  def update(conn, %{"slot" => slot, "payload" => payload, "save_version" => version}) do
    case Saves.upsert(conn.assigns.player, String.to_integer(slot), payload, version) do
      {:ok, save} ->
        json(conn, %{ok: true, updated_at: save.updated_at})

      {:error, :stale} ->
        # klient wysłał starszy zapis niż ten na serwerze
        conn |> put_status(409) |> json(%{error: "stale_save"})

      {:error, changeset} ->
        conn |> put_status(422) |> json(%{error: inspect(changeset.errors)})
    end
  end

  defp require_player(conn, _) do
    with ["Bearer " <> token] <- get_req_header(conn, "authorization"),
         %{} = player <- MonsterSlayer.Accounts.get_by_token(token) do
      assign(conn, :player, player)
    else
      _ -> conn |> put_status(401) |> json(%{error: "unauthorized"}) |> halt()
    end
  end
end
```

---

## 7. Kanały

```elixir
# server/lib/monster_slayer_web/channels/user_socket.ex
channel "telemetry:*", MonsterSlayerWeb.TelemetryChannel
channel "balance:*", MonsterSlayerWeb.BalanceChannel
```

### 7.1 Push balansu do gry

```elixir
# server/lib/monster_slayer_web/channels/balance_channel.ex
defmodule MonsterSlayerWeb.BalanceChannel do
  use MonsterSlayerWeb, :channel
  alias MonsterSlayer.Balance

  @impl true
  def join("balance:live", _params, socket) do
    Phoenix.PubSub.subscribe(MonsterSlayer.PubSub, "balance:live")
    {:ok, %{etag: Balance.Server.etag()}, socket}
  end

  @impl true
  def handle_info({:balance_updated, payload, etag}, socket) do
    push(socket, "updated", %{etag: etag, data: payload})
    {:noreply, socket}
  end
end
```

### 7.2 Ingest telemetrii

```elixir
# server/lib/monster_slayer_web/channels/telemetry_channel.ex
defmodule MonsterSlayerWeb.TelemetryChannel do
  use MonsterSlayerWeb, :channel

  @impl true
  def join("telemetry:" <> session_id, _params, socket) do
    {:ok, assign(socket, :session_id, session_id)}
  end

  @impl true
  def handle_in("batch", %{"events" => events}, socket) when is_list(events) do
    %{session_id: socket.assigns.session_id, player_id: socket.assigns[:player_id], events: events}
    |> MonsterSlayer.Analytics.IngestWorker.new()
    |> Oban.insert()

    # dashboard aktualizuje się natychmiast, nie czekając na zapis do bazy
    Phoenix.PubSub.broadcast(
      MonsterSlayer.PubSub,
      "dashboard:live",
      {:events, socket.assigns.session_id, events}
    )

    {:reply, {:ok, %{accepted: length(events)}}, socket}
  end
end
```

**Kontrakt klienta:** wysyłka co 5 sekund albo co 50 zdarzeń, w zależności co pierwsze. Nie wysyłamy zdarzenia na każde trafienie — przy 8 wrogach to setki wiadomości na sekundę.

---

## 8. Dashboard LiveView (szkielet)

```elixir
# server/lib/monster_slayer_web/live/dashboard_live.ex
defmodule MonsterSlayerWeb.DashboardLive do
  use MonsterSlayerWeb, :live_view

  @impl true
  def mount(_params, _session, socket) do
    if connected?(socket) do
      Phoenix.PubSub.subscribe(MonsterSlayer.PubSub, "dashboard:live")
    end

    {:ok, assign(socket, deaths: %{}, kills: 0, recent: [])}
  end

  @impl true
  def handle_info({:events, _session, events}, socket) do
    {:noreply,
     socket
     |> update(:kills, &(&1 + Enum.count(events, fn e -> e["type"] == "enemy_died" end)))
     |> update(:deaths, fn acc ->
       events
       |> Enum.filter(&(&1["type"] == "player_died"))
       |> Enum.reduce(acc, fn e, a -> Map.update(a, e["payload"]["room"], 1, &(&1 + 1)) end)
     end)
     |> update(:recent, &(Enum.take(events ++ &1, 50)))}
  end
end
```

To wystarczy na M3. Heatmapa pomieszczeń i krzywe z sekcji 14 GDD dochodzą w M5, gdy jest już co mierzyć.

---

## 9. Klient — spięcie z backendem

### 9.1 Proxy zamiast CORS

```ts
// packages/client/vite.config.ts
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
      "/socket": { target: "ws://localhost:4000", ws: true },
    },
  },
  build: { target: "es2022" },
});
```

Wszystko leci z jednego originu, więc **CORS w ogóle nie występuje** — zero preflightów w dev. `cors_plug` zostaje w projekcie tylko na wypadek hostowania klienta pod inną domeną.

### 9.2 Wczytanie balansu z fallbackiem offline

```ts
// packages/client/src/net/balance.ts
import { get, set } from "idb-keyval";
import { BalanceSchema } from "@ms/core/schema";

export async function loadBalance() {
  const cached = await get("balance");

  try {
    const res = await fetch("/api/balance", {
      headers: cached?.etag ? { "If-None-Match": cached.etag } : {},
    });

    if (res.status === 304 && cached) return BalanceSchema.parse(cached.data);

    const body = await res.json();
    const data = BalanceSchema.parse(body.data);
    await set("balance", { etag: body.etag, data });
    return data;
  } catch {
    // Backend leży — gra i tak musi wystartować.
    if (cached) return BalanceSchema.parse(cached.data);
    return BalanceSchema.parse(await import("@ms/data/bundled.json"));
  }
}
```

Trzy poziomy: serwer → cache IndexedDB → dane wbudowane w bundle. Gra uruchamia się zawsze.

### 9.3 Hot reload w trakcie gry

```ts
// packages/client/src/net/socket.ts
import { Socket } from "phoenix";
import { bus } from "@ms/core/bus";

export function connectDevChannels() {
  const socket = new Socket("/socket", {});
  socket.connect();

  socket.channel("balance:live").join()
    .receive("ok", () => console.info("[balance] live"));

  socket.channel("balance:live").on("updated", ({ data }) => {
    bus.emit("balance:reloaded", data);   // systemy czytają nowe wartości od następnego ticku
  });
}
```

Ważne: systemy walki **nie trzymają skopiowanych wartości w polach**. Czytają je z aktualnego obiektu balansu przy każdym ticku albo przy wejściu w stan. Inaczej hot reload nic nie zmieni dla już zespawnowanych wrogów.

---

## 10. Jedno polecenie

Wszystko żyje w obrazie — host nie potrzebuje ani Node'a, ani pnpm, ani Elixira.

```bash
docker compose up            # gra na http://localhost:5173, HMR działa
docker compose down          # koniec
```

Źródła (`packages/`, `data/`) są zamontowane bind-mountem, więc zmiana w kodzie albo
w balansie jest widoczna od razu. `node_modules` z obrazu są chronione anonimowymi
wolumenami — bez tego katalogi z hosta przykryłyby binaria esbuild/rollup.

### Build produkcyjny

```bash
docker compose --profile prod up --build web    # http://localhost:8080
```

Ten sam `Dockerfile`, cel `prod`: statyki za nginx, zero Node'a w runtime.

### Baza i backend (M3)

```bash
docker compose --profile backend up -d db
```

### Bez Dockera

```bash
corepack enable pnpm
pnpm install
pnpm dev
```

| Adres | Co | Stan |
|---|---|---|
| `http://localhost:5173` | Gra (dev, HMR) | działa |
| `http://localhost:8080` | Gra (build produkcyjny) | działa |
| `http://localhost:4000/admin` | Dashboard playtestów | M3 |
| `http://localhost:4000/dev/dashboard` | Phoenix LiveDashboard | M3 |
| `postgres://localhost:5433` | Baza | profil `backend` |

### Pozostałe polecenia

| Polecenie | Co robi |
|---|---|
| `pnpm sim` | tabela TTK/DPS, headless, bez przeglądarki |
| `pnpm typecheck` | `tsc` w `core`/`sim` + `svelte-check` w kliencie |
| `pnpm e2e` | smoke E2E przeciwko `:5173` |
| `pnpm e2e:prod` | to samo przeciwko buildowi za nginx |
| `pnpm shot` | zrzut z walki do `tests/artifacts/combat.png` |

---

## 11. Definicja gotowości środowiska

- [x] `docker compose up` podnosi grę jednym poleceniem, bez zależności na hoście.
- [x] `F5` nie gubi postępu (IndexedDB) — pokryte testem `F5 nie gubi postępu`.
- [x] Brak backendu **nie** zatrzymuje gry — HUD pokazuje `offline · balans: bundled`,
      pokryte testem `gra działa z wyłączonym backendem`.
- [x] `pnpm sim` generuje tabelę TTK bez uruchamiania przeglądarki.
- [x] Build produkcyjny startuje i przechodzi te same testy (`pnpm e2e:prod`).
- [ ] Zapis `data/combat.json` zmienia zachowanie walki w < 1 s, bez przeładowania strony.
      *Klient ma gotowego odbiorcę kanału `balance:live`; brakuje nadawcy (M3).*
- [ ] Błędny JSON w `data/` loguje błąd i **nie** psuje działającej sesji.
      *Walidacja Zod po stronie klienta odrzuca zły push; watcher w Phoeniksie to M3.*
- [ ] `localhost:4000/admin` pokazuje zdarzenia z trwającej sesji. *(M3)*

> Uwaga do hot reloadu w wariancie dockerowym: `data/` jest zamontowane, a Vite ma
> włączony polling (`VITE_USE_POLLING=true`), bo bind-mount nie emituje natywnych
> zdarzeń FS. Zmiana w `data/*.json` przeładowuje stronę przez HMR. Podmiana bez
> przeładowania i bez utraty stanu areny wymaga kanału `balance:live` z M3.

---

## 12. Typowe problemy

| Objaw | Przyczyna | Rozwiązanie |
|---|---|---|
| WebSocket nie łączy się z Vite | Brak `ws: true` w proxy | Uzupełnić konfigurację proxy |
| Phoenix odrzuca połączenie kanału | `check_origin` nie zna `localhost:5173` | Dodać do listy w `config/dev.exs` |
| Brak dźwięku do pierwszego kliknięcia | Polityka autoplay przeglądarki | To jest poprawne zachowanie — ekran startowy z przyciskiem robi `ctx.resume()` |
| Gra „przyspiesza" po powrocie z innej karty | Akumulator nadrobił kilkaset ticków | Pauza na `visibilitychange` + cap na maksymalną liczbę ticków w jednej klatce (np. 5) |
| Watcher nie reaguje na zmiany | `data_dir` wskazuje na złą ścieżkę | Sprawdzić log `[balance] obserwuję …` przy starcie |
| `mix ecto.create` nie widzi bazy | Docker jeszcze się podnosi lub port zajęty | `docker compose ps`, sprawdzić healthcheck i port 5433 |
