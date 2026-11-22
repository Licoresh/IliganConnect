import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView, { Callout, Marker, Polygon, type Region } from "react-native-maps";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { aggregateReportCells, BARANGAY_TOTAL_ZOOM, clusterReportsByCategory, ILIGAN_MAP_BOUNDS, INDIVIDUAL_REPORT_PIN_ZOOM, mapZoomFromLongitudeDelta } from "@community/shared";
import { barangayAreaKm2, barangayCenter, barangayDensity, barangayDensityColor, barangayHeatColor, barangayMapKey, iliganBarangayBoundaries } from "../lib/barangay-map";
import { categoryDisplayName, categoryIconFor, categoryToneFor, statusToneFor, PhotoViewer, colors } from "./ui";
export { ILIGAN_MAP_BOUNDS };
export type MapStyle = "map" | "terrain" | "satellite";
export type MapBounds = typeof ILIGAN_MAP_BOUNDS;
const MAP_GESTURE_THRESHOLD = 12;
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
  pointLabel?: string;
  showPointCoordinates?: boolean;
  points?: Point[];
  onChoose?: (p: Point) => void;
  onPointPress?: (p: Point) => void;
  onOpenPointDetails?: (p: Point) => void;
  onClearPointSelection?: () => void;
  onDensityCellPress?: (count: number) => void;
  selectedCellCount?: number | null;
  onLocate?: () => void;
  locating?: boolean;
  userPoint?: Point;
  density?: boolean;
  showPoints?: boolean;
  selectedPointId?: string;
  reportPopupBehavior?: "default" | "hidden" | "draggable";
  height?: number;
  onExpand?: () => void;
  onGestureActiveChange?: (active: boolean) => void;
  onPageScroll?: (delta: number) => void;
  mapStyle?: MapStyle;
  onMapStyleChange?: (style: MapStyle) => void;
  mapStyleSelector?: "menu" | "tabs";
  initialRegion?: Region;
  onViewportChange?: (region: Region) => void;
  bounds?: MapBounds;
  zoomBehavior?: "issue-map" | "barangay-gis";
  showBarangayBoundaries?: boolean;
  barangayCounts?: Record<string, number>;
  onBarangayPress?: (name: string) => void;
  onMapBackgroundPress?: () => void;
  selectedBarangayName?: string;
  barangayMetric?: "count" | "density";
  summaryColor?: string;
};
const ReportPin = memo(function ReportPin({ selected, onPointPress, reportPopupBehavior = "default", ...p }: Point & { selected: boolean; onPointPress?: MapProps["onPointPress"]; reportPopupBehavior?: MapProps["reportPopupBehavior"] }) {
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
            {reportPopupBehavior !== "hidden" && <Callout tooltip onPress={() => onPointPress?.(p)}>
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
                <Pressable accessibilityRole="button" onPress={() => onPointPress?.(p)} style={{ minHeight: 48, marginTop: 10, borderRadius: 12, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}><Text style={{ color: colors.brand, fontSize: 12, fontWeight: "800" }}>View report details  ›</Text></Pressable>
                <Text style={{ color: "#82908c", fontSize: 10, marginTop: 6, textAlign: "center" }}>Approximate location for privacy</Text>
              </View>
            </Callout>}
          </Marker>);
});

export default function LocationMap({
  point,
  pointLabel,
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
  selectedPointId,
  reportPopupBehavior = "default",
  height = 300,
  onExpand,
  onGestureActiveChange,
  onPageScroll,
  mapStyle,
  onMapStyleChange,
  mapStyleSelector = "menu",
  initialRegion,
  onViewportChange,
  bounds,
  zoomBehavior = "barangay-gis",
  showBarangayBoundaries = false,
  barangayCounts = {},
  onBarangayPress,
  onMapBackgroundPress,
  selectedBarangayName,
  barangayMetric = "density",
  summaryColor = colors.brand,
}: MapProps) {
  const compactControls = useWindowDimensions().width <= 600;
  const map = useRef<MapView>(null);
  const lastBarangayTap = useRef(0);
  const gestureStart = useRef({ x: 0, y: 0 });
  const gestureLastY = useRef(0);
  const gestureAxis = useRef<"pending" | "page" | "map">("pending");
  const gestureLocked = useRef(false);
  const [pageScrollActive, setPageScrollActive] = useState(false);
  const pageScrollDelta = useRef(0);
  const pageScrollFrame = useRef<number | null>(null);
  const onPageScrollRef = useRef(onPageScroll);
  onPageScrollRef.current = onPageScroll;
  const defaultRegion: Region = { latitude: 8.228, longitude: 124.2452, latitudeDelta: 0.12, longitudeDelta: 0.12 };
  const currentRegion = useRef(initialRegion ?? defaultRegion);
  const [zoomLevel, setZoomLevel] = useState(() => mapZoomFromLongitudeDelta(currentRegion.current.longitudeDelta));
  const [localBase, setLocalBase] = useState<MapStyle>("satellite"), [stylePickerOpen, setStylePickerOpen] = useState(false);
  const [styleSelectorExpanded, setStyleSelectorExpanded] = useState(false);
  const base = mapStyle ?? localBase;
  const nextBase: MapStyle = base === "map" ? "terrain" : base === "terrain" ? "satellite" : "map";
  const baseName = base === "map" ? "Map" : base === "terrain" ? "Terrain" : "Satellite";
  const choosePoint = (next: Point) => onChoose?.(next);
  const flushPageScroll = () => {
    if (pageScrollFrame.current !== null) cancelAnimationFrame(pageScrollFrame.current);
    pageScrollFrame.current = null;
    const delta = pageScrollDelta.current;
    pageScrollDelta.current = 0;
    if (delta) onPageScrollRef.current?.(delta);
  };
  const queuePageScroll = (delta: number) => {
    pageScrollDelta.current += delta;
    if (pageScrollFrame.current === null) {
      pageScrollFrame.current = requestAnimationFrame(() => {
        pageScrollFrame.current = null;
        const nextDelta = pageScrollDelta.current;
        pageScrollDelta.current = 0;
        if (nextDelta) onPageScrollRef.current?.(nextDelta);
      });
    }
  };
  const lockMapGesture = () => {
    if (gestureLocked.current) return;
    gestureLocked.current = true;
    gestureAxis.current = "map";
    setPageScrollActive(false);
    onGestureActiveChange?.(true);
  };
  const startMapTouch = (event: { nativeEvent: { pageX: number; pageY: number; touches?: unknown[] } }) => {
    flushPageScroll();
    gestureLocked.current = false;
    gestureAxis.current = "pending";
    gestureStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
    gestureLastY.current = event.nativeEvent.pageY;
    setPageScrollActive(false);
    onGestureActiveChange?.(false);
    if ((event.nativeEvent.touches?.length ?? 0) > 1) lockMapGesture();
  };
  const moveMapTouch = (event: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (gestureAxis.current === "page") {
      queuePageScroll(gestureLastY.current - event.nativeEvent.pageY);
      gestureLastY.current = event.nativeEvent.pageY;
      return;
    }
    if (gestureAxis.current !== "pending") return;
    const dx = Math.abs(event.nativeEvent.pageX - gestureStart.current.x);
    const dy = Math.abs(event.nativeEvent.pageY - gestureStart.current.y);
    if (Math.max(dx, dy) < MAP_GESTURE_THRESHOLD) return;
    if (onPageScroll && dy > dx * 1.15) {
      gestureAxis.current = "page";
      setPageScrollActive(true);
      queuePageScroll(gestureLastY.current - event.nativeEvent.pageY);
      gestureLastY.current = event.nativeEvent.pageY;
      return;
    }
    if (dx > dy * 1.15) lockMapGesture();
    else if (onPageScroll) {
      gestureAxis.current = "page";
      setPageScrollActive(true);
      queuePageScroll(gestureLastY.current - event.nativeEvent.pageY);
      gestureLastY.current = event.nativeEvent.pageY;
    } else lockMapGesture();
  };
  const endMapTouch = (event?: { nativeEvent?: { touches?: unknown[] } }) => {
    if ((event?.nativeEvent?.touches?.length ?? 0) > 0) return;
    flushPageScroll();
    setPageScrollActive(false);
    if (gestureLocked.current) onGestureActiveChange?.(false);
    gestureLocked.current = false;
    gestureAxis.current = "pending";
  };
  const pointsKey = useMemo(() => points.map((p) => `${p.id}:${p.latitude}:${p.longitude}`).join("|"), [points]);
  const reportPoints = useMemo(() => points.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180), [points]);
  const categoryClusters = useMemo(() => zoomBehavior === "barangay-gis" ? clusterReportsByCategory(reportPoints, zoomLevel) : [], [reportPoints, zoomLevel, zoomBehavior]);
  const showBarangayTotals = zoomBehavior === "barangay-gis" && showPoints && !showBarangayBoundaries && zoomLevel <= BARANGAY_TOTAL_ZOOM;
  const barangayTotalMarkers = useMemo(() => showBarangayTotals ? iliganBarangayBoundaries.flatMap((feature) => {
    const count = barangayCounts[barangayMapKey(feature.properties.adm4_en)] ?? 0;
    const center = count ? barangayCenter(feature) : null;
    return center ? [{ ...center, name: feature.properties.adm4_en, count }] : [];
  }) : [], [showBarangayTotals, barangayCounts]);
  const reportCells = useMemo(() => aggregateReportCells(reportPoints), [reportPoints]);
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
  const zoom = (direction: 1 | -1) => map.current?.getCamera().then((camera) => {
    map.current?.animateCamera({ ...camera, zoom: Math.max(3, Math.min(20, (camera.zoom ?? 12) + direction)) }, { duration: 180 });
  });
  const center = () => {
    if (point) map.current?.animateToRegion({ ...point, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 250);
    else if (points.length === 1) map.current?.animateToRegion({ ...points[0], latitudeDelta: 0.035, longitudeDelta: 0.035 }, 250);
    else if (points.length > 1) map.current?.fitToCoordinates(points, { edgePadding: { top: 72, right: 64, bottom: 72, left: 64 }, animated: true });
  };
  const zoomInto = (latitude: number, longitude: number, factor: number) => {
    const current = currentRegion.current;
    map.current?.animateToRegion({ latitude, longitude,
      latitudeDelta: Math.max(0.002, current.latitudeDelta / factor),
      longitudeDelta: Math.max(0.002, current.longitudeDelta / factor),
    }, 320);
  };
  const focusPoint = useCallback((selected: Point) => {
    map.current?.animateToRegion({ ...selected, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 380);
    onPointPress?.(selected);
  }, [onPointPress]);
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
    if (selected) map.current?.animateToRegion({ ...selected, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 380);
  }, [selectedPointId, pointsKey]);
  return (
    <View style={{ height, borderRadius: 18, overflow: "hidden", backgroundColor: "#e8f1ee", position: "relative" }}>
      <MapView
        ref={map}
        style={{ flex: 1 }}
        scrollEnabled={!pageScrollActive}
        zoomEnabled
        pitchEnabled={false}
        rotateEnabled={false}
        onTouchStart={startMapTouch}
        onTouchMove={moveMapTouch}
        onTouchEnd={endMapTouch}
        onTouchCancel={endMapTouch}
        mapType={base === "terrain" ? "terrain" : base === "satellite" ? "satellite" : "standard"}
        initialRegion={point ? { ...point, latitudeDelta: 0.02, longitudeDelta: 0.02 } : currentRegion.current}
        onRegionChangeComplete={(region) => { currentRegion.current = region; setZoomLevel(mapZoomFromLongitudeDelta(region.longitudeDelta)); onViewportChange?.(region); }}
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
            pinColor={colors.brand}
            zIndex={1003}
            accessibilityLabel={pointLabel ? `Issue pin, ${pointLabel}` : "Issue location pin"}
            onDragEnd={(e) => choosePoint(e.nativeEvent.coordinate)}
          >
            {pointLabel && <View style={{ alignItems: "center" }}>
              <View style={{ maxWidth: 220, marginBottom: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: "#dce8e4", backgroundColor: "white", elevation: 4 }}><Text numberOfLines={1} style={{ color: colors.brandDark, fontSize: 11, fontWeight: "800" }}>{pointLabel}</Text></View>
              <View style={{ width: 34, height: 34, borderRadius: 18, borderWidth: 2.5, borderColor: "white", backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", elevation: 5 }}><Ionicons name="location" size={18} color="white" /></View>
              <View style={{ width: 10, height: 10, marginTop: -7, transform: [{ rotate: "45deg" }], backgroundColor: colors.brand, borderBottomRightRadius: 2 }} />
            </View>}
          </Marker>
        )}
        {userPoint && <Marker coordinate={userPoint} title="Your current location" pinColor="#3976d2" zIndex={1004} />}
        {showBarangayTotals && barangayTotalMarkers.map((item) => <Marker key={`barangay-total-${item.name}`} coordinate={item} zIndex={1001} accessibilityLabel={`${item.count} reports assigned to ${item.name}`} onPress={() => { onBarangayPress?.(item.name); zoomInto(item.latitude, item.longitude, 3); }}>
          <View style={{ minWidth: 36, height: 32, paddingHorizontal: 8, borderRadius: 16, borderWidth: 2, borderColor: "white", backgroundColor: summaryColor, alignItems: "center", justifyContent: "center", shadowColor: "#10263f", shadowOpacity: 0.22, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 }}><Text style={{ color: "white", fontSize: 11, fontWeight: "800" }}>{item.count.toLocaleString("en-PH")}</Text></View>
        </Marker>)}
        {showPoints && !showBarangayBoundaries && zoomBehavior === "barangay-gis" && zoomLevel < INDIVIDUAL_REPORT_PIN_ZOOM && categoryClusters.map((cluster) => <Marker key={cluster.id} coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }} zIndex={1002} accessibilityLabel={`${cluster.count} ${categoryDisplayName(cluster.categoryName)} reports`} onPress={() => zoomInto(cluster.centerLatitude, cluster.centerLongitude, 2)}>
          <View style={{ minWidth: 38, height: 38, paddingHorizontal: 5, borderRadius: 20, borderWidth: 2.5, borderColor: "white", backgroundColor: cluster.color, alignItems: "center", justifyContent: "center", shadowColor: "#10263f", shadowOpacity: 0.24, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 5 }}><Text style={{ color: "white", fontSize: cluster.count > 99 ? 10 : 12, fontWeight: "900" }}>{cluster.count.toLocaleString("en-PH")}</Text></View>
        </Marker>)}
        {showPoints && !showBarangayBoundaries && (zoomBehavior === "issue-map" || zoomLevel >= INDIVIDUAL_REPORT_PIN_ZOOM) && reportPoints.map((p, i) => (
          <ReportPin key={p.id || i} {...p} selected={p.id === selectedPointId} onPointPress={focusPoint} reportPopupBehavior={reportPopupBehavior} />
        ))}
      </MapView>
      {mapStyleSelector === "tabs" ? <View style={{ position: "absolute", left: 9, top: 9, flexDirection: "row", alignItems: "center", gap: 2, padding: 4, borderRadius: 23, backgroundColor: "#ffffffed", elevation: 3 }}>
        {styleSelectorExpanded ? <>
          {(["map", "terrain", "satellite"] as const).map((value) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: base === value }} onPress={() => { setLocalBase(value); onMapStyleChange?.(value); map.current?.animateCamera({ pitch: value === "terrain" ? 40 : 0 }, { duration: 300 }); }} style={{ minWidth: 57, minHeight: 38, paddingHorizontal: 8, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: base === value ? colors.brand : "transparent" }}><Text style={{ color: base === value ? "white" : "#34486b", fontSize: 10, fontWeight: base === value ? "800" : "600" }}>{value === "map" ? "Map" : value === "terrain" ? "Terrain" : "Satellite"}</Text></Pressable>)}
          <Pressable accessibilityRole="button" accessibilityLabel="Collapse map styles" accessibilityState={{ expanded: true }} onPress={() => setStyleSelectorExpanded(false)} style={{ width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19, backgroundColor: "white" }}><Ionicons name="chevron-back" size={18} color={colors.brandDark} /></Pressable>
        </> : <Pressable accessibilityRole="button" accessibilityLabel="Show map styles" accessibilityState={{ expanded: false }} onPress={() => setStyleSelectorExpanded(true)} style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "white" }}><Ionicons name="chevron-forward" size={19} color={colors.brandDark} /></Pressable>}
      </View> : <View style={{ position: "absolute", left: 10, top: 10, flexDirection: "row", alignItems: "center", gap: 2, borderRadius: 14, padding: 4, backgroundColor: "#ffffffed", elevation: 3 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={compactControls ? `${stylePickerOpen ? "Hide" : "Show"} map styles, current style ${baseName}` : "Map style"} accessibilityState={{ expanded: stylePickerOpen }} onPress={() => setStylePickerOpen(!stylePickerOpen)} style={compactControls ? { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: colors.brandSoft } : { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 11, backgroundColor: colors.brandSoft }}>
          {compactControls ? <Ionicons name={stylePickerOpen ? "chevron-back" : "chevron-forward"} size={19} color={colors.brand} /> : <><Ionicons name="layers-outline" size={16} color={colors.brand} /><Text style={{ color: "#08756b", fontSize: 12, fontWeight: "800" }}>{baseName}</Text><Ionicons name={stylePickerOpen ? "chevron-up" : "chevron-down"} size={13} color={colors.brand} /></>}
        </Pressable>
        {stylePickerOpen && (["map", "terrain", "satellite"] as const).map((value) => (
          <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: base === value }} onPress={() => { setLocalBase(value); onMapStyleChange?.(value); setStylePickerOpen(false); map.current?.animateCamera({ pitch: value === "terrain" ? 40 : 0 }, { duration: 300 }); }} style={{ minHeight: 48, paddingHorizontal: 9, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: base === value ? colors.brandSoft : "transparent" }}>
            <Text style={{ color: base === value ? "#08756b" : "#34486b", fontSize: 11, fontWeight: base === value ? "800" : "600" }}>{value === "map" ? "Map" : value === "terrain" ? "Terrain" : "Satellite"}</Text>
          </Pressable>
        ))}
      </View>}
      {density && <View pointerEvents="none" style={{ position: "absolute", left: 10, bottom: 10, width: 194, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 7, backgroundColor: "#ffffffed", elevation: 4 }}>
        {!points.length ? <Text style={{ color: "#526461", fontSize: 10, fontWeight: "700" }}>No matching reports</Text> : <>
        <Text style={{ color: "#173b3a", fontSize: 10, fontWeight: "800", marginBottom: 4 }}>Reports / 250 m cell</Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 4 }}>{[["#4e9ed0", "1"], ["#41ae76", "2–3"], ["#f5b840", "4–7"], ["#d64732", "8+"]].map(([color, text]) => <View key={text} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}><View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }} /><Text style={{ color: "#526461", fontSize: 9 }}>{text}</Text></View>)}</View>
        {selectedCellCount != null && <Text style={{ color: "#526461", fontSize: 9, marginTop: 3 }}>{selectedCellCount} reports here</Text>}
        </>}
      </View>}
      <View style={{ position: "absolute", right: mapStyleSelector === "tabs" ? 9 : 12, top: compactControls && mapStyleSelector === "tabs" && styleSelectorExpanded ? 56 : mapStyleSelector === "tabs" ? 9 : 12, width: compactControls ? 92 : undefined, flexDirection: compactControls ? "row" : "column", flexWrap: compactControls ? "wrap" : "nowrap", justifyContent: compactControls ? "space-between" : "flex-start", gap: compactControls ? 4 : mapStyleSelector === "tabs" ? 4 : 8 }}>
        {([["add", () => zoom(1), "Zoom in"], ["remove", () => zoom(-1), "Zoom out"], [userPoint ? "locate" : "locate-outline", userPoint ? () => map.current?.animateToRegion({ ...userPoint, latitudeDelta: 0.035, longitudeDelta: 0.035 }, 250) : onLocate ?? center, userPoint ? "Recenter on my location" : "Find my location"], ...(mapStyleSelector === "menu" ? [["layers-outline", () => { setLocalBase(nextBase); onMapStyleChange?.(nextBase); }, `Change map layer to ${nextBase}`] as const] : []), ...(onExpand ? [["expand-outline", onExpand, "Expand map"] as const] : [])] as const).map(([icon, action, label]) => (
          <Pressable key={label} accessibilityRole="button" accessibilityLabel={label === "Find my location" && locating ? "Finding your location" : label} disabled={label === "Find my location" && locating} onPress={action} style={{ width: compactControls ? 44 : mapStyleSelector === "tabs" ? 38 : 48, height: compactControls ? 44 : mapStyleSelector === "tabs" ? 38 : 48, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: "white", elevation: 3 }}>
            <Ionicons name={icon} size={19} color="#173b3a" />
          </Pressable>
        ))}
      </View>
      {onChoose && <View pointerEvents="none" style={{ position: "absolute", left: 12, bottom: 12, backgroundColor: "white", borderRadius: 12, paddingHorizontal: 11, paddingVertical: 8 }}><Text style={{ color: "#173b3a", fontSize: 12, fontWeight: "600" }}>Tap map or drag pin to set location</Text></View>}
    </View>
  );
}
