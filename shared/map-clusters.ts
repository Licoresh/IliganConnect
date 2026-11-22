export const BARANGAY_TOTAL_ZOOM = 10.5;
export const INDIVIDUAL_REPORT_PIN_ZOOM = 14;
export const BARANGAY_GIS_CATEGORY_ZOOM = 12.5;

export type ClusterableReportPoint = {
  id?: string;
  latitude: number;
  longitude: number;
  categoryName?: string;
  color?: string;
};

export type CategoryReportCluster = {
  id: string;
  latitude: number;
  longitude: number;
  centerLatitude: number;
  centerLongitude: number;
  categoryName: string;
  color: string;
  count: number;
  pointIds: string[];
};

export type ReportPinGroup = {
  id: string;
  latitude: number;
  longitude: number;
  count: number;
  pointIds: string[];
  categories: Array<{ categoryName: string; color: string; count: number }>;
};

export type PositionedMapPoint = {
  id: string;
  longitude: number;
  latitude: number;
  offsetX: number;
  offsetY: number;
};

type ProjectedPoint = ClusterableReportPoint & { x: number; y: number; index: number };

export function mapZoomFromLongitudeDelta(longitudeDelta: number) {
  return Math.log2(360 / Math.max(0.0001, Number.isFinite(longitudeDelta) ? longitudeDelta : 0.12));
}

function project(longitude: number, latitude: number, scale: number) {
  const radians = Math.max(-85.05113, Math.min(85.05113, latitude)) * Math.PI / 180;
  return {
    x: (longitude + 180) / 360 * scale,
    y: (0.5 - Math.log((1 + Math.sin(radians)) / (1 - Math.sin(radians))) / (4 * Math.PI)) * scale,
  };
}

function unproject(x: number, y: number, scale: number) {
  return {
    longitude: x / scale * 360 - 180,
    latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * 180 / Math.PI,
  };
}

/** Return a map coordinate shifted by screen pixels at the supplied zoom. */
export function offsetMapCoordinate(longitude: number, latitude: number, offsetX: number, offsetY: number, zoom: number) {
  if (![longitude, latitude, offsetX, offsetY, zoom].every(Number.isFinite)) return { longitude, latitude };
  const scale = 256 * 2 ** Math.max(0, Math.min(zoom, 24));
  const origin = project(longitude, latitude, scale);
  return unproject(origin.x + offsetX, origin.y + offsetY, scale);
}

/** Move nearby map labels apart in screen space while retaining their source locations. */
export function separateNearbyMapPoints(
  points: Array<{ id: string; longitude: number; latitude: number }>,
  zoom: number,
  minWidth = 48,
  minHeight = 28,
): PositionedMapPoint[] {
  if (!Number.isFinite(zoom) || !points.length) return [];
  const scale = 256 * 2 ** Math.max(0, Math.min(zoom, 24));
  const projected = points
    .filter((point) => Number.isFinite(point.longitude) && Number.isFinite(point.latitude) && Math.abs(point.longitude) <= 180 && Math.abs(point.latitude) <= 90)
    .map((point) => {
      const location = project(point.longitude, point.latitude, scale);
      return { ...point, ...location, sourceX: location.x, sourceY: location.y };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  for (let pass = 0; pass < 36; pass++) {
    let moved = false;
    for (let left = 0; left < projected.length; left++) for (let right = left + 1; right < projected.length; right++) {
      const a = projected[left], b = projected[right];
      const dx = b.x - a.x, dy = b.y - a.y;
      const overlapX = minWidth - Math.abs(dx), overlapY = minHeight - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) continue;
      const directionX = dx ? Math.sign(dx) : (left + right) % 2 ? 1 : -1;
      const directionY = dy ? Math.sign(dy) : (left + right) % 2 ? 1 : -1;
      if (overlapX < overlapY) {
        const push = (overlapX + 1) / 2;
        a.x -= directionX * push; b.x += directionX * push;
      } else {
        const push = (overlapY + 1) / 2;
        a.y -= directionY * push; b.y += directionY * push;
      }
      moved = true;
    }
    if (!moved) break;
  }

  return projected.map((point) => ({
    id: point.id,
    ...unproject(point.x, point.y, scale),
    offsetX: point.x - point.sourceX,
    offsetY: point.y - point.sourceY,
  }));
}

function categoryKey(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Screen-space grouping shared by the staff map and resident web/native maps. */
export function clusterReportsByCategory(points: ClusterableReportPoint[], zoom: number, radius = 54, minZoom = BARANGAY_TOTAL_ZOOM): CategoryReportCluster[] {
  if (zoom <= minZoom || zoom >= INDIVIDUAL_REPORT_PIN_ZOOM || !points.length) return [];
  const scale = 256 * 2 ** zoom;
  const projected: ProjectedPoint[] = points.flatMap((point, index) => {
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) return [];
    return [{ ...point, ...project(point.longitude, point.latitude, scale), index }];
  });
  const parents = Int32Array.from(projected, (_, index) => index);
  const rootOf = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) { const next = parents[index]; parents[index] = root; index = next; }
    return root;
  };
  const buckets = new Map<string, number[]>();
  for (let index = 0; index < projected.length; index++) {
    const point = projected[index];
    const cellX = Math.floor(point.x / radius), cellY = Math.floor(point.y / radius);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const neighbor of buckets.get(`${cellX + dx}:${cellY + dy}`) ?? []) {
        const other = projected[neighbor];
        if ((point.x - other.x) ** 2 + (point.y - other.y) ** 2 <= radius ** 2) {
          const a = rootOf(index), b = rootOf(neighbor);
          if (a !== b) parents[b] = a;
        }
      }
    }
    const key = `${cellX}:${cellY}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(index);
    else buckets.set(key, [index]);
  }

  const groups = new Map<number, ProjectedPoint[]>();
  projected.forEach((point, index) => {
    const root = rootOf(index);
    const group = groups.get(root);
    if (group) group.push(point);
    else groups.set(root, [point]);
  });
  const clusters: CategoryReportCluster[] = [];
  let groupNumber = 0;
  for (const members of groups.values()) {
    const centerX = members.reduce((sum, point) => sum + point.x, 0) / members.length;
    const centerY = members.reduce((sum, point) => sum + point.y, 0) / members.length;
    const center = unproject(centerX, centerY, scale);
    const categories = new Map<string, { name: string; color: string; count: number; pointIds: string[] }>();
    for (const point of members) {
      const name = point.categoryName?.trim() || "Other reports";
      const key = categoryKey(name) || "other reports";
      const current = categories.get(key) ?? { name, color: point.color || "#08756b", count: 0, pointIds: [] };
      current.count++;
      if (point.id) current.pointIds.push(point.id);
      categories.set(key, current);
    }
    const categoryRows = [...categories.entries()].sort(([a], [b]) => a.localeCompare(b));
    const columns = Math.min(categoryRows.length, 3);
    const rows = Math.ceil(categoryRows.length / columns);
    categoryRows.forEach(([key, category], index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const itemsInRow = Math.min(columns, categoryRows.length - row * columns);
      const offsetX = (column - (itemsInRow - 1) / 2) * 44;
      const offsetY = (row - (rows - 1) / 2) * 44;
      const position = unproject(centerX + offsetX, centerY + offsetY, scale);
      clusters.push({
        id: `category-cluster-${groupNumber}-${key}`,
        latitude: position.latitude,
        longitude: position.longitude,
        centerLatitude: center.latitude,
        centerLongitude: center.longitude,
        categoryName: category.name,
        color: category.color,
        count: category.count,
        pointIds: category.pointIds,
      });
    });
    groupNumber++;
  }
  return clusters;
}

/** Group nearby reports at their true geographic cluster center without spreading their pins apart. */
export function clusterReportPinGroups(points: ClusterableReportPoint[], zoom: number, radius = 54, minZoom = BARANGAY_TOTAL_ZOOM): ReportPinGroup[] {
  const groups = new Map<string, ReportPinGroup>();
  for (const cluster of clusterReportsByCategory(points, zoom, radius, minZoom)) {
    const separator = cluster.id.lastIndexOf("-");
    const id = cluster.id.slice(0, separator);
    const group = groups.get(id) ?? {
      id,
      latitude: cluster.centerLatitude,
      longitude: cluster.centerLongitude,
      count: 0,
      pointIds: [],
      categories: [],
    };
    group.count += cluster.count;
    group.pointIds.push(...cluster.pointIds);
    group.categories.push({ categoryName: cluster.categoryName, color: cluster.color, count: cluster.count });
    groups.set(id, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    categories: group.categories.sort((a, b) => b.count - a.count || a.categoryName.localeCompare(b.categoryName)),
  }));
}
