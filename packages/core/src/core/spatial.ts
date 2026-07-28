/**
 * Własny spatial hash (GDD §11.3) — bez silnika fizyki.
 * Top-down ARPG nie potrzebuje rigid-body; Matter.js/Rapier to +300 KB
 * i utrata determinizmu.
 *
 * Zero alokacji w trakcie zapytań: bufor wyników jest reużywany.
 */
export class SpatialHash {
  private readonly cellSize: number;
  private readonly buckets = new Map<number, number[]>();
  private readonly queryBuffer: Int32Array;
  private queryCount = 0;

  constructor(cellSize = 2, capacity = 512) {
    this.cellSize = cellSize;
    this.queryBuffer = new Int32Array(capacity);
  }

  clear(): void {
    for (const bucket of this.buckets.values()) bucket.length = 0;
  }

  private key(cx: number, cy: number): number {
    // Pakowanie dwóch 16-bitowych współrzędnych komórki w jeden int.
    return ((cx + 32768) << 16) | (cy + 32768);
  }

  insert(id: number, x: number, y: number): void {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const k = this.key(cx, cy);
    let bucket = this.buckets.get(k);
    if (!bucket) {
      bucket = [];
      this.buckets.set(k, bucket);
    }
    bucket.push(id);
  }

  /**
   * Zwraca liczbę trafień; wyniki czytaj przez `results()`.
   * Bufor jest współdzielony — skonsumuj przed kolejnym zapytaniem.
   */
  query(x: number, y: number, radius: number): number {
    this.queryCount = 0;
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.buckets.get(this.key(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          if (this.queryCount >= this.queryBuffer.length) return this.queryCount;
          this.queryBuffer[this.queryCount++] = bucket[i] as number;
        }
      }
    }
    return this.queryCount;
  }

  results(): Int32Array {
    return this.queryBuffer;
  }
}
