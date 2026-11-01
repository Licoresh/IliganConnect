export type MapPolygon = { coordinates: number[][][] };

function onSegment(
  point: [number, number],
  start: number[],
  end: number[],
) {
  const cross =
    (point[1] - start[1]) * (end[0] - start[0]) -
    (point[0] - start[0]) * (end[1] - start[1]);
  if (Math.abs(cross) > 1e-10) return false;
  return (
    point[0] >= Math.min(start[0], end[0]) - 1e-10 &&
    point[0] <= Math.max(start[0], end[0]) + 1e-10 &&
    point[1] >= Math.min(start[1], end[1]) - 1e-10 &&
    point[1] <= Math.max(start[1], end[1]) + 1e-10
  );
}

function inRing(point: [number, number], ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (onSegment(point, a, b)) return true;
    if (
      (b[1] > point[1]) !== (a[1] > point[1]) &&
      point[0] < ((a[0] - b[0]) * (point[1] - b[1])) / (a[1] - b[1]) + b[0]
    ) inside = !inside;
  }
  return inside;
}

/** GeoJSON Polygon containment in [longitude, latitude] order. */
export function pointInPolygon(
  point: [number, number],
  polygon: MapPolygon,
) {
  const [outer, ...holes] = polygon.coordinates;
  return !!outer && inRing(point, outer) && !holes.some((ring) => inRing(point, ring));
}
