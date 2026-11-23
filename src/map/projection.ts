import type { Coordinate } from '../game/types';

const METRES_PER_DEGREE = 111195;
const LONGITUDE_SCALE = METRES_PER_DEGREE * Math.cos(22.31 * Math.PI / 180);
export interface MapPoint { x: number; y: number }
/** Local metric projection, accurate enough for this compact Hong Kong extent. */
export function projectCoordinate(p: Coordinate): MapPoint {
  return { x: (p.lon - 114.17) * LONGITUDE_SCALE, y: -(p.lat - 22.31) * METRES_PER_DEGREE };
}
export function worldPath(points: number[][], close = false): string {
  if (!points.length) return '';
  return points.map(([lon, lat], i) => {
    const p = projectCoordinate({ lat, lon });
    return `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join('') + (close ? 'Z' : '');
}
export function coordinatePath(points: Coordinate[]): string {
  return worldPath(points.map(p => [p.lon, p.lat]));
}
