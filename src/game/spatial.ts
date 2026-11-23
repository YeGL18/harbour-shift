import type { Coordinate } from './types';

const METRES_LAT = 111195;
const METRES_LON = 102980;
export const DEMAND_CELL_METRES = 900;

export function cellFor(point: Coordinate, cellMetres = DEMAND_CELL_METRES): { x: number; y: number; key: string } {
  const x = Math.floor(point.lon * METRES_LON / cellMetres);
  const y = Math.floor(point.lat * METRES_LAT / cellMetres);
  return { x, y, key: `${x}:${y}` };
}

export function flatDistanceM(a: Coordinate, b: Coordinate): number {
  return Math.hypot((b.lon - a.lon) * METRES_LON, (b.lat - a.lat) * METRES_LAT);
}

/** Linear build, local-cell queries. Entries remain shared immutable references. */
export class SpatialIndex<T extends Coordinate> {
  readonly cells = new Map<string, T[]>();
  constructor(readonly entries: readonly T[], readonly cellMetres = DEMAND_CELL_METRES) {
    for (const entry of entries) {
      const key = cellFor(entry, cellMetres).key;
      const cell = this.cells.get(key);
      if (cell) cell.push(entry); else this.cells.set(key, [entry]);
    }
  }

  nearby(point: Coordinate, radiusM: number, limit = Infinity): T[] {
    const cell = cellFor(point, this.cellMetres);
    const reach = Math.ceil(radiusM / this.cellMetres);
    const found: Array<{ entry: T; distance: number }> = [];
    for (let x = cell.x - reach; x <= cell.x + reach; x += 1) {
      for (let y = cell.y - reach; y <= cell.y + reach; y += 1) {
        for (const entry of this.cells.get(`${x}:${y}`) || []) {
          const distance = flatDistanceM(point, entry);
          if (distance <= radiusM) found.push({ entry, distance });
        }
      }
    }
    found.sort((a, b) => a.distance - b.distance);
    return found.slice(0, limit).map(item => item.entry);
  }

  nearest(point: Coordinate): T | undefined {
    for (const radius of [500, 1000, 2500, 5000, 15000, 80000]) {
      const nearest = this.nearby(point, radius, 1)[0];
      if (nearest) return nearest;
    }
    return undefined;
  }

  nearbyCells(point: Coordinate, radiusM: number): Array<{ key: string; entries: T[] }> {
    const cell = cellFor(point, this.cellMetres);
    const reach = Math.ceil(radiusM / this.cellMetres);
    const found: Array<{ key: string; entries: T[] }> = [];
    for (let x = cell.x - reach; x <= cell.x + reach; x += 1) {
      for (let y = cell.y - reach; y <= cell.y + reach; y += 1) {
        const key = `${x}:${y}`;
        const entries = this.cells.get(key);
        if (entries?.length) found.push({ key, entries });
      }
    }
    return found;
  }
}
