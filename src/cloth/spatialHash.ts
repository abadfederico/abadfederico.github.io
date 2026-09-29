// Buckets and duplicate-query markers are reused across substeps.
export class SpatialHash {
  private cells = new Map<number, number[]>();
  private pool: number[][] = [];
  private used = 0;
  private stamps: Uint32Array;
  private stamp = 0;
  readonly candidates: number[] = [];

  constructor(private size: number, capacity: number) { this.stamps = new Uint32Array(capacity); }
  clear() { this.cells.clear(); this.used = 0; }
  private key(x: number, y: number, z: number) {
    return ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0;
  }
  insert(id: number, bounds: Float32Array, offset: number) {
    const s = this.size;
    for (let x = Math.floor(bounds[offset] / s); x <= Math.floor(bounds[offset + 3] / s); x++)
      for (let y = Math.floor(bounds[offset + 1] / s); y <= Math.floor(bounds[offset + 4] / s); y++)
        for (let z = Math.floor(bounds[offset + 2] / s); z <= Math.floor(bounds[offset + 5] / s); z++) {
          const key = this.key(x, y, z);
          let bucket = this.cells.get(key);
          if (!bucket) {
            bucket = this.pool[this.used] ?? (this.pool[this.used] = []);
            this.used++; bucket.length = 0; this.cells.set(key, bucket);
          }
          bucket.push(id);
        }
  }
  query(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
    this.candidates.length = 0;
    this.stamp = (this.stamp + 1) >>> 0;
    if (!this.stamp) { this.stamps.fill(0); this.stamp = 1; }
    const s = this.size;
    for (let x = Math.floor(minX / s); x <= Math.floor(maxX / s); x++)
      for (let y = Math.floor(minY / s); y <= Math.floor(maxY / s); y++)
        for (let z = Math.floor(minZ / s); z <= Math.floor(maxZ / s); z++) {
          const bucket = this.cells.get(this.key(x, y, z));
          if (!bucket) continue;
          for (const id of bucket) {
            if (this.stamps[id] === this.stamp) continue;
            this.stamps[id] = this.stamp; this.candidates.push(id);
          }
        }
    return this.candidates;
  }
}
