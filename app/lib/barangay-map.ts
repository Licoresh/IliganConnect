import boundaries from "../assets/iligan-barangays.json";

type Boundary = {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: { adm4_en: string; adm4_psgc: number; area_km2?: number };
};

export const iliganBarangayBoundaries = boundaries.features as Boundary[];
export const barangayMapKey = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function barangayAreaKm2(feature: Boundary) {
  if (feature.properties.area_km2 && feature.properties.area_km2 > 0) return feature.properties.area_km2;
  const radiusKm = 6371.0088;
  const ringArea = (ring: number[][]) => {
    let sum = 0;
    for (let index = 0; index < ring.length; index++) {
      const [longitudeA, latitudeA] = ring[index];
      const [longitudeB, latitudeB] = ring[(index + 1) % ring.length];
      const latitudeARadians = latitudeA * Math.PI / 180;
      const latitudeBRadians = latitudeB * Math.PI / 180;
      sum += (longitudeB - longitudeA) * Math.PI / 180 * (2 + Math.sin(latitudeARadians) + Math.sin(latitudeBRadians));
    }
    return Math.abs(sum * radiusKm ** 2 / 2);
  };
  return Math.max(0, feature.geometry.coordinates.reduce((area, ring, index) => area + (index === 0 ? ringArea(ring) : -ringArea(ring)), 0));
}

export function barangayHeatColor(count: number) {
  return count >= 11 ? "#ef4444" : count >= 6 ? "#f59e0b" : count >= 3 ? "#14b8a6" : count > 0 ? "#38bdf8" : "#cbd5e1";
}

export function barangayDensity(count: number, areaKm2: number) {
  return areaKm2 > 0 ? count / areaKm2 : 0;
}

export function barangayDensityColor(reportsPerKm2: number, maximum: number) {
  if (reportsPerKm2 <= 0 || maximum <= 0) return "#cbd5e1";
  const ratio = reportsPerKm2 / maximum;
  return ratio >= 0.75 ? "#ef4444" : ratio >= 0.5 ? "#f97316" : ratio >= 0.25 ? "#facc15" : "#34d399";
}
