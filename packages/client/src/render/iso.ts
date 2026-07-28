/**
 * Rzut izometryczny 2:1 (GDD §1 — perspektywa izometryczna 3/4).
 * Logika żyje w jednostkach świata (metry); piksele istnieją wyłącznie tutaj.
 */
export const ISO_W = 52;
export const ISO_H = 26;

export function isoX(x: number, y: number): number {
  return (x - y) * ISO_W;
}

export function isoY(x: number, y: number): number {
  return (x + y) * ISO_H;
}

/** Odwrotność rzutu — potrzebna do celowania kursorem. */
export function screenToWorld(sx: number, sy: number, out: { x: number; y: number }): void {
  const a = sx / ISO_W;
  const b = sy / ISO_H;
  out.x = (a + b) * 0.5;
  out.y = (b - a) * 0.5;
}

/** Klucz sortowania w głąb — im dalej „w dół" rzutu, tym bliżej kamery. */
export function depth(x: number, y: number): number {
  return x + y;
}
