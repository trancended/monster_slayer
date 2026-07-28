import { mount } from "svelte";
import "./ui/styles.css";
import App from "./ui/App.svelte";
import { game } from "./game.ts";

const stage = document.getElementById("stage");
const ui = document.getElementById("ui");

if (!stage || !ui) {
  throw new Error("Brak kontenerów #stage / #ui w index.html");
}

async function boot(): Promise<void> {
  try {
    await game.boot(stage!);
    mount(App, { target: ui!, props: { game } });

    // Uchwyt diagnostyczny tylko w dev — pozwala testom i konsoli zajrzeć
    // w stan symulacji bez zgadywania po pikselach.
    if (import.meta.env.DEV) {
      (window as unknown as { __ms: unknown }).__ms = game;
    }
  } catch (err) {
    console.error("[boot] start nieudany", err);
    ui!.innerHTML = `
      <div style="position:absolute;inset:0;display:grid;place-items:center;padding:32px;
                  font-family:system-ui;color:#e6ecf5;background:#0d1016;pointer-events:auto">
        <div style="max-width:640px">
          <h1 style="margin:0 0 12px">Nie udało się uruchomić gry</h1>
          <p style="color:#93a0b5">
            Sprawdź, czy przeglądarka wspiera WebGL2 lub WebGPU. Szczegóły w konsoli.
          </p>
          <pre style="white-space:pre-wrap;background:#12161f;padding:14px;border-radius:8px;
                      font-size:13px;color:#ff9c9c">${String(err)}</pre>
        </div>
      </div>`;
  }
}

void boot();

// Ostatnia szansa na zapis. `visibilitychange` jest wiarygodniejszy niż
// `pagehide` — odpala też przy przełączeniu karty, kiedy jest jeszcze czas
// na dokończenie transakcji IndexedDB.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) void game.save();
});
window.addEventListener("pagehide", () => void game.save());
