/**
 * Nakładka 2D nad sceną 3D: liczby obrażeń i wskaźniki zagrożenia poza kadrem.
 *
 * Dlaczego nie w 3D: tekst w scenie wymaga albo `DynamicTexture` na billboardzie
 * (rozmyty, kosztowny — nowa tekstura na każdą liczbę), albo pakietu `@babylonjs/gui`
 * (kolejna zależność w bundlu, którego budżet i tak właśnie przekraczamy).
 *
 * Zwykły `<canvas>` z Canvas2D nad sceną daje **ostry tekst w rozdzielczości
 * ekranu**, zero zależności i pełną kontrolę nad pulą. Pozycję bierzemy
 * z rzutowania punktu świata na ekran (`Vector3.Project`), więc liczby nadal
 * trzymają się wroga, którego dotyczą.
 *
 * Ta sama nakładka rysuje strzałki zagrożenia — one też są elementem HUD-u
 * przypiętym do krawędzi kadru, a nie obiektem w świecie.
 */

export interface DamageNumber {
  active: boolean;
  /** Pozycja w świecie — rzutowana na ekran co klatkę. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  color: string;
  size: number;
  crit: boolean;
}

export interface ThreatArrow {
  x: number;
  y: number;
  angle: number;
}

const POOL = 64;

export class Overlay2d {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly numbers: DamageNumber[] = [];
  private readonly arrows: ThreatArrow[] = [];
  private dpr = 1;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.dataset.overlay = "numbers";
    this.canvas.style.position = "absolute";
    this.canvas.style.inset = "0";
    this.canvas.style.pointerEvents = "none";
    this.canvas.style.display = "block";

    /*
     * Nakładka ląduje w kontenerze UI, a nie w `#stage`, z dwóch powodów:
     *
     *  • w `#stage` byłby to **drugi** `<canvas>`, przez co selektor
     *    `#stage canvas` przestaje być jednoznaczny — a używają go wszystkie
     *    istniejące testy E2E;
     *  • jako pierwsze dziecko `#ui` rysuje się POD panelami HUD-u, więc
     *    liczby obrażeń nie przykrywają pasków ani menu.
     */
    const ui = document.getElementById("ui");
    if (ui) ui.insertBefore(this.canvas, ui.firstChild);
    else host.appendChild(this.canvas);

    const ctx = this.canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Brak kontekstu 2D dla nakładki");
    this.ctx = ctx;

    for (let i = 0; i < POOL; i++) {
      this.numbers.push({
        active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, text: "", color: "#fff", size: 17, crit: false,
      });
    }

    this.resize();
  }

  resize(): void {
    // Cap 2.0 jak w rendererze 3D (GDD §4.2) — powyżej koszt rośnie czterokrotnie,
    // a różnicy nie widać.
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  spawnNumber(value: number, x: number, y: number, z: number, crit: boolean, element: string): void {
    const slot = this.numbers.find((n) => !n.active);
    if (!slot) return;

    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.vx = (Math.random() - 0.5) * 34;
    slot.vy = -78 - Math.random() * 24;
    slot.maxLife = crit ? 0.95 : 0.75;
    slot.life = slot.maxLife;
    slot.crit = crit;
    slot.size = crit ? 25 : 17;

    const amount = Math.max(1, Math.round(value));
    slot.text = element === "heal" ? `+${amount}` : amount.toString();
    slot.color =
      element === "heal"
        ? "#5ce08a"
        : element === "blocked"
          ? "#8b93a3"
          : element === "fire"
            ? "#ff8a3d"
            : crit
              ? "#ffe066"
              : "#ffffff";
  }

  setArrows(arrows: readonly ThreatArrow[]): void {
    this.arrows.length = 0;
    for (const a of arrows) this.arrows.push(a);
  }

  /**
   * @param project rzutuje punkt świata na piksele ekranu; zwraca `null`,
   *                gdy punkt jest za kamerą
   */
  update(dt: number, project: (x: number, y: number, z: number) => { sx: number; sy: number } | null): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // ── liczby obrażeń ──────────────────────────────────────────────────────
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    for (const n of this.numbers) {
      if (!n.active) continue;
      n.life -= dt;
      if (n.life <= 0) {
        n.active = false;
        continue;
      }

      const p = project(n.x, n.y, n.z);
      if (!p) continue;

      n.vy += 210 * dt;
      const t = 1 - n.life / n.maxLife;
      const sx = p.sx + n.vx * t;
      const sy = p.sy + n.vy * t * 0.4;
      const alpha = t < 0.15 ? t / 0.15 : Math.min(1, n.life / (n.maxLife * 0.45));
      const scale = 1 + t * 0.12;

      ctx.globalAlpha = alpha;
      ctx.font = `${n.crit ? 900 : 700} ${Math.round(n.size * scale)}px ui-monospace, Menlo, monospace`;
      ctx.lineWidth = n.crit ? 5 : 4;
      ctx.strokeStyle = n.crit ? "#2a1a00" : "#000000";
      ctx.strokeText(n.text, sx, sy);
      ctx.fillStyle = n.color;
      ctx.fillText(n.text, sx, sy);
    }

    // ── strzałki zagrożenia ─────────────────────────────────────────────────
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#ff4d4d";
    for (const a of this.arrows) {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.angle);
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.lineTo(0, -11);
      ctx.lineTo(0, 11);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.globalAlpha = 1;
  }

  clear(): void {
    for (const n of this.numbers) n.active = false;
    this.arrows.length = 0;
  }

  dispose(): void {
    this.canvas.remove();
  }
}
