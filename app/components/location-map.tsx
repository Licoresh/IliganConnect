import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import MapView, { Callout, Marker, Polygon, type Region } from "react-native-maps";
import { Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { aggregateReportCells, clusterMapPoints, ILIGAN_MAP_BOUNDS } from "@community/shared";
import { barangayAreaKm2, barangayDensity, barangayDensityColor, barangayHeatColor, barangayMapKey, iliganBarangayBoundaries } from "../lib/barangay-map";
import { categoryDisplayName, categoryIconFor, categoryToneFor, statusToneFor, PhotoViewer } from "./ui";
export { ILIGAN_MAP_BOUNDS };
export type MapStyle = "map" | "terrain" | "satellite";
export type MapBounds = typeof ILIGAN_MAP_BOUNDS;
const EMPTY_POINTS: Point[] = [];
export type Point = {
  id?: string;
  latitude: number;
  longitude: number;
  title?: string;
  subtitle?: string;
  createdAt?: string;
  photoUrl?: string;
  categoryName?: string;
  color?: string;
  statusLabel?: string;
  barangayName?: string;
};
export type MapProps = {
  point?: Point;
  points?: Point[];
  onChoose?: (p: Point) => void;
  onPointPress?: (p: Point) => void;
  onDensityCellPress?: (count: number) => void;
  selectedCellCount?: number | null;
  onLocate?: () => void;
  locating?: boolean;
  userPoint?: Point;
  density?: boolean;
  showPoints?: boolean;
  showClusterCounts?: boolean;
  selectedPointId?: string;
  height?: number;
  onExpand?: () => void;
  mapStyle?: MapStyle;
  onMapStyleChange?: (style: MapStyle) => void;
  initialRegion?: Region;
  onViewportChange?: (region: Region) => void;
  bounds?: MapBounds;
  showBarangayBoundaries?: boolean;
  barangayCounts?: Record<string, number>;
  onBarangayPress?: (name: string) => void;
  onMapBackgroundPress?: () => void;
  selectedBarangayName?: string;
  barangayMetric?: "count" | "density";
};
const ReportPin = memo(function ReportPin({ selected, onPointPress, ...p }: Point & { selected: boolean; onPointPress?: MapProps["onPointPress"] }) {
  const tone = categoryToneFor(p.categoryName || "");
  const pinColor = p.color || tone.foreground;
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    setTracking(true);
    const timer = setTimeout(() => setTracking(false), 350);
    return () => clearTimeout(timer);
  }, [p.color, p.categoryName, selected]);
  return (<Marker tracksViewChanges={tracking} coordinate={p} zIndex={selected ? 1003 : 1002} accessibilityLabel={`${p.categoryName ? categoryDisplayName(p.categoryName) : "Community report"}: ${p.title || "Reported issue"}`} onPress={() => onPointPress?.(p)}>
            <View style={{ width: 42, height: 46, alignItems: "center" }}>
              <View style={{ position: "absolute", top: 26, width: 11, height: 11, backgroundColor: pinColor, borderWidth: 1.5, borderColor: "white", transform: [{ rotate: "45deg" }] }} />
              {selected && <View style={{ position: "absolute", top: -3, width: 40, height: 40, borderRadius: 20, backgroundColor: `${pinColor}24` }} />}
              <View style={{ width: selected ? 36 : 33, height: selected ? 36 : 33, borderRadius: 19, backgroundColor: pinColor, borderWidth: 2.5, borderColor: "white", alignItems: "center", justifyContent: "center", shadowColor: "#10263f", shadowOpacity: 0.24, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 5 }}>
                <Ionicons name={categoryIconFor(p.categoryName || "")} size={16} color="white" />
              </View>
            </View>
            <Callout tooltip onPress={() => onPointPress?.(p)}>
              <View style={{ width: 276, borderRadius: 18, padding: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e0e9e6", shadowColor: "#173b3a", shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8 }}>
                <View style={{ flexDirection: "row", gap: 10, alignItems: "stretch" }}>
                  {p.photoUrl ? <PhotoViewer source={{ uri: p.photoUrl }} label={`${p.categoryName ? categoryDisplayName(p.categoryName) : "Community"} report photo`} style={{ width: 76, height: 94, borderRadius: 12, backgroundColor: "#eaf2f1" }} /> : <View style={{ width: 76, height: 94, borderRadius: 12, backgroundColor: categoryToneFor(p.categoryName || "").background, alignItems: "center", justifyContent: "center" }}><Ionicons name={categoryIconFor(p.categoryName || "")} size={31} color={categoryToneFor(p.categoryName || "").foreground} /></View>}
                  <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 }}><Text numberOfLines={1} style={{ flex: 1, color: p.color || "#08756b", fontSize: 10, fontWeight: "800" }}>{p.categoryName ? categoryDisplayName(p.categoryName) : "Community report"}</Text>{!!p.statusLabel && <Text numberOfLines={1} style={{ color: statusToneFor(p.statusLabel).foreground, backgroundColor: statusToneFor(p.statusLabel).background, fontSize: 9, fontWeight: "700", paddingHorizontal: 7, paddingVertical: 4, borderRadius: 12 }}>{p.statusLabel}</Text>}</View>
                    <Text numberOfLines={2} style={{ color: "#173b3a", fontSize: 14, fontWeight: "800", lineHeight: 18 }}>{p.title || "Reported issue"}</Text>
                    {!!p.barangayName && <Text numberOfLines={1} style={{ color: "#647571", fontSize: 11 }}>{p.barangayName} · approximate location</Text>}
                    {!!p.createdAt && <Text style={{ color: "#647571", fontSize: 11 }}>{new Date(p.createdAt).toLocaleDateString()}</Text>}
                  </View>
                </View>
                <Pressable accessibilityRole="button" onPress={() => onPointPress?.(p)} style={{ minHeight: 38, marginTop: 10, borderRadius: 12, backgroundColor: "#e5f6f2", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#08756b", fontSize: 12, fontWeight: "800" }}>View report details  ›</Text></Pressable>
                <Text style={{ color: "#82908c", fontSize: 10, marginTop: 6, textAlign: "center" }}>Approximate location for privacy</Text>
              </View>
            </Callout>
          </Marker>);
});

export default function LocationMap({
  point,
  points = EMPTY_POINTS,
  onChoose,
  onPointPress,
  onDensityCellPress,
  selectedCellCount,
  onLocate,
  locating = false,
  userPoint,
  density = false,
  showPoints = true,
  showClusterCounts = true,
  selectedPointId,
  height = 300,
  onExpand,
  mapStyle,
  onMapStyleChange,
  initialRegion,
  onViewportChange,
  bounds,
  showBarangayBoundaries = false,
  barangayCounts = {},
  onBarangayPress,
  onMapBackgroundPress,
  selectedBarangayName,
  barangayMetric = "density",
}: MapProps) {
  const map = useRef<MapView>(null);
  const lastBarangayTap = useRef(0);
  const [localBase, setLocalBase] = useState<MapStyle>("satellite"), [region, setRegion] = useState<Region>(initialRegion ?? { latitude: 8.228, longitude: 124.2452, latitudeDelta: 0.12, longitudeDelta: 0.12 }), [stylePickerOpen, setStylePickerOpen] = useState(false);
  const base = mapStyle ?? localBase;
  const nextBase: MapStyle = base === "map" ? "terrain" : base === "terrain" ? "satellite" : "map";
  const baseName = base === "map" ? "Map" : base === "terrain" ? "Terrain" : "Satellite";
  const choosePoint = (next: Point) => onChoose?.(next);
  const pointsKey = useMemo(() => points.map((p) => `${p.id}:${p.latitude}:${p.longitude}`).join("|"), [points]);
  const reportCells = useMemo(() => aggregateReportCells(points), [points]);
  const maxBarangayDensity = useMemo(() => Math.max(0, ...iliganBarangayBoundaries.map((item) => barangayDensity(barangayCounts[barangayMapKey(item.properties.adm4_en)] ?? 0, barangayAreaKm2(item)))), [barangayCounts]);
  const densityLayer = useMemo(() => density && reportCells.map((cell) => <Polygon
          key={`${cell.center.latitude}:${cell.center.longitude}`}
          coordinates={cell.bounds}
          strokeColor={`${cell.color}bb`}
          strokeWidth={1}
          fillColor={`${cell.color}58`}
          tappable
          onPress={() => onDensityCellPress?.(cell.count)}
        />), [density, reportCells, onDensityCellPress]);
  const barangayLayer = useMemo(() => showBarangayBoundaries && iliganBarangayBoundaries.map((feature) => {
    const name = feature.properties.adm4_en;
    const count = barangayCounts[barangayMapKey(name)] ?? 0;
    const density = barangayDensity(count, barangayAreaKm2(feature));
    return <Polygon
      key={feature.properties.adm4_psgc}
      coordinates={feature.geometry.coordinates[0].map(([longitude, latitude]) => ({ latitude, longitude }))}
      strokeColor={selectedBarangayName === name ? "#083f75" : count ? "#ffffff" : "#e2e8f0"}
      strokeWidth={selectedBarangayName === name ? 3 : count ? 1.5 : 0.8}
      fillColor={`${(barangayMetric === "density" ? barangayDensityColor(density, maxBarangayDensity) : barangayHeatColor(count))}${count ? "a8" : "35"}`}
      tappable
      onPress={() => { lastBarangayTap.current = Date.now(); onBarangayPress?.(name); }}
    />;
  }), [showBarangayBoundaries, barangayCounts, onBarangayPress, selectedBarangayName, barangayMetric, maxBarangayDensity]);
  const clusterDelta = showClusterCounts ? region.latitudeDelta : 0;
  const clusters = useMemo(() => showClusterCounts
    ? clusterMapPoints(points, Math.max(60, clusterDelta * 111_320 / 7))
    : [{ points, latitude: 0, longitude: 0 }], [points, clusterDelta, showClusterCounts]);
  const [trackMarkers, setTrackMarkers] = useState(true);
  useEffect(() => {
    // Custom marker snapshots need a short layout window, not continuous redraws.
    setTrackMarkers(true);
    const timer = setTimeout(() => setTrackMarkers(false), 500);
    return () => clearTimeout(timer);
  }, [clusters]);
  const zoom = (direction: 1 | -1) => map.current?.getCamera().then((camera) => {
    map.current?.animateCamera({ ...camera, zoom: Math.max(3, Math.min(20, (camera.zoom ?? 12) + direction)) }, { duration: 180 });
  });
  const center = () => {
    if (point) map.current?.animateToRegion({ ...point, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 250);
    else if (points.length === 1) map.current?.animateToRegion({ ...points[0], latitudeDelta: 0.035, longitudeDelta: 0.035 }, 250);
    else if (points.length > 1) map.current?.fitToCoordinates(points, { edgePadding: { top: 72, right: 64, bottom: 72, left: 64 }, animated: true });
  };
  useEffect(() => {
    if (bounds) map.current?.setMapBoundaries(bounds.northEast, bounds.southWest);
  }, [bounds]);
  useEffect(() => {
    if (!showBarangayBoundaries) return;
    const area = bounds ?? ILIGAN_MAP_BOUNDS;
    map.current?.animateToRegion({
      latitude: (area.northEast.latitude + area.southWest.latitude) / 2,
      longitude: (area.northEast.longitude + area.southWest.longitude) / 2,
      latitudeDelta: (area.northEast.latitude - area.southWest.latitude) * 1.18,
      longitudeDelta: (area.northEast.longitude - area.southWest.longitude) * 1.18,
    }, 360);
  }, [showBarangayBoundaries, bounds]);
  useEffect(() => {
    if (!point) return;
    map.current?.animateToRegion({ ...point, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 250);
  }, [point?.latitude, point?.longitude]);
  useEffect(() => {
    if (userPoint) map.current?.animateToRegion({ ...userPoint, latitudeDelta: 0.035, longitudeDelta: 0.035 }, 250);
  }, [userPoint?.latitude, userPoint?.longitude]);
  useEffect(() => {
    const selected = points.find((item) => item.id === selectedPointId);
    if (selected) map.current?.animateToRegion({ ...selected, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 250);
  }, [selectedPointId, pointsKey]);
  return (
    <View style={{ height, borderRadius: 18, overflow: "hidden", backgroundColor: "#e8f1ee", position: "relative" }}>
      <MapView
        ref={map}
        style={{ flex: 1 }}
        mapType={base === "terrain" ? "terrain" : base === "satellite" ? "satellite" : "standard"}
        pitchEnabled
        rotateEnabled
        initialRegion={point ? { ...point, latitudeDelta: 0.02, longitudeDelta: 0.02 } : initialRegion ?? { latitude: 8.228, longitude: 124.2452, latitudeDelta: 0.12, longitudeDelta: 0.12 }}
        onRegionChangeComplete={(next) => {
          // Panning is handled natively; only zoom changes affect clustering.
          setRegion((previous) => Math.abs(next.latitudeDelta / previous.latitudeDelta - 1) > 0.02 || Math.abs(next.longitudeDelta / previous.longitudeDelta - 1) > 0.02 ? next : previous);
          onViewportChange?.(next);
        }}
        onPress={(e) => {
          if (onChoose) choosePoint(e.nativeEvent.coordinate);
          else if (showBarangayBoundaries && Date.now() - lastBarangayTap.current > 160) onMapBackgroundPress?.();
        }}
      >
        {barangayLayer}
        {densityLayer}
        {point && (
          <Marker
            key={`${point.latitude}:${point.longitude}`}
            draggable={!!onChoose}
            coordinate={point}
            pinColor="#08756b"
            zIndex={1003}
            onDragEnd={(e) => choosePoint(e.nativeEvent.coordinate)}
          />
        )}
        {userPoint && <Marker coordinate={userPoint} title="Your current location" pinColor="#3976d2" zIndex={1004} />}
        {showPoints && showClusterCounts && clusters.filter((cluster) => cluster.points.length > 1).map((cluster) => <Marker
          tracksViewChanges={trackMarkers}
          key={`cluster-${cluster.points[0].id}`}
          coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }}
          onPress={() => region.latitudeDelta < 0.001 ? onPointPress?.(cluster.points[0]) : map.current?.animateToRegion({ latitude: cluster.latitude, longitude: cluster.longitude, latitudeDelta: Math.max(0.0004, region.latitudeDelta / 2), longitudeDelta: Math.max(0.0004, region.longitudeDelta / 2) }, 250)}
          zIndex={1001}
        ><View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: "#08756b", borderWidth: 3, borderColor: "white", alignItems: "center", justifyContent: "center", elevation: 5 }}><Text style={{ color: "white", fontSize: 14, fontWeight: "800" }}>{cluster.points.length}</Text></View></Marker>)}
        {showPoints && clusters.filter((cluster) => !showClusterCounts || cluster.points.length === 1).flatMap((cluster) => cluster.points).map((p, i) => (
          <ReportPin key={p.id || i} {...p} selected={p.id === selectedPointId} onPointPress={onPointPress} />
        ))}
      </MapView>
      <View style={{ position: "absolute", left: 10, top: 10, flexDirection: "row", alignItems: "center", gap: 2, borderRadius: 14, padding: 4, backgroundColor: "#ffffffed", elevation: 3 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Map style" accessibilityState={{ expanded: stylePickerOpen }} onPress={() => setStylePickerOpen(!stylePickerOpen)} style={{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 11, backgroundColor: "#e8f1ee" }}>
          <Ionicons name="layers-outline" size={16} color="#08756b" />
          <Text style={{ color: "#08756b", fontSize: 12, fontWeight: "800" }}>{baseName}</Text>
          <Ionicons name={stylePickerOpen ? "chevron-up" : "chevron-down"} size={13} color="#08756b" />
        </Pressable>
        {stylePickerOpen && (["map", "terrain", "satellite"] as const).map((value) => (
          <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: base === value }} onPress={() => { setLocalBase(value); onMapStyleChange?.(value); setStylePickerOpen(false); map.current?.animateCamera({ pitch: value === "terrain" ? 40 : 0 }, { duration: 300 }); }} style={{ minHeight: 40, paddingHorizontal: 9, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: base === value ? "#e8f1ee" : "transparent" }}>
            <Text style={{ color: base === value ? "#08756b" : "#34486b", fontSize: 11, fontWeight: base === value ? "800" : "600" }}>{value === "map" ? "Map" : value === "terrain" ? "Terrain" : "Satellite"}</Text>
          </Pressable>
        ))}
      </View>
      {density && <View pointerEvents="none" style={{ position: "absolute", left: 10, bottom: 10, width: 194, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 7, backgroundColor: "#ffffffed", elevation: 4 }}>
        {!points.length ? <Text style={{ color: "#526461", fontSize: 10, fontWeight: "700" }}>No matching reports</Text> : <>
        <Text style={{ color: "#173b3a", fontSize: 10, fontWeight: "800", marginBottom: 4 }}>Reports / 250 m cell</Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 4 }}>{[["#4e9ed0", "1"], ["#41ae76", "2–3"], ["#f5b840", "4–7"], ["#d64732", "8+"]].map(([color, text]) => <View key={text} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}><View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }} /><Text style={{ color: "#526461", fontSize: 9 }}>{text}</Text></View>)}</View>
        {selectedCellCount != null && <Text style={{ color: "#526461", fontSize: 9, marginTop: 3 }}>{selectedCellCount} reports here</Text>}
        </>}
      </View>}
      <View style={{ position: "absolute", right: 12, top: 12, gap: 8 }}>
        {([["add", () => zoom(1), "Zoom in"], ["remove", () => zoom(-1), "Zoom out"], [userPoint ? "locate" : "locate-outline", userPoint ? () => map.current?.animateToRegion({ ...userPoint, latitudeDelta: 0.035, longitudeDelta: 0.035 }, 250) : onLocate ?? center, userPoint ? "Recenter on my location" : "Find my location"], ["layers-outline", () => { setLocalBase(nextBase); onMapStyleChange?.(nextBase); }, `Change map layer to ${nextBase}`], ...(onExpand ? [["expand-outline", onExpand, "Expand map"] as const] : [])] as const).map(([icon, action, label]) => (
          <Pressable key={label} accessibilityRole="button" accessibilityLabel={label === "Find my location" && locating ? "Finding your location" : label} disabled={label === "Find my location" && locating} onPress={action} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: "white", elevation: 3 }}>
            <Ionicons name={icon} size={19} color="#173b3a" />
          </Pressable>
        ))}
      </View>
      {onChoose && <View pointerEvents="none" style={{ position: "absolute", left: 12, bottom: 12, backgroundColor: "white", borderRadius: 12, paddingHorizontal: 11, paddingVertical: 8 }}><Text style={{ color: "#173b3a", fontSize: 12, fontWeight: "600" }}>Tap map or drag pin to set location</Text></View>}
    </View>
  );
}
