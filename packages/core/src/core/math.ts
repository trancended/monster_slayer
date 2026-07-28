export const TAU = Math.PI * 2;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wygładzanie niezależne od kroku czasu — do kamery i celowania. */
export function damp(a: number, b: number, lambda: number, dt: number): number {
  return lerp(a, b, 1 - Math.exp(-lambda * dt));
}

export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDiff(a, b) * t;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt(dist2(ax, ay, bx, by));
}

/** Czy punkt leży w stożku o wierzchołku (ox,oy), kierunku `facing` i kącie `arcRad`. */
export function inCone(
  ox: number,
  oy: number,
  facing: number,
  arcRad: number,
  range: number,
  px: number,
  py: number,
  targetRadius: number,
): boolean {
  const dx = px - ox;
  const dy = py - oy;
  const d2 = dx * dx + dy * dy;
  const reach = range + targetRadius;
  if (d2 > reach * reach) return false;
  if (d2 < 1e-6) return true;
  const a = Math.atan2(dy, dx);
  return Math.abs(angleDiff(facing, a)) <= arcRad * 0.5;
}
