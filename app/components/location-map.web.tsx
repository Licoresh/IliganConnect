import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { MapProps, MapStyle } from "./location-map";
import * as maplibre from "maplibre-gl";
import { aggregateReportCells } from "@community/shared";
import { barangayAreaKm2, barangayDensity, barangayDensityColor, barangayHeatColor, barangayMapKey, iliganBarangayBoundaries } from "../lib/barangay-map";
import { categoryDisplayName, categoryIconFor, categoryToneFor, statusToneFor } from "./ui";
import "maplibre-gl/dist/maplibre-gl.css";
const EMPTY_POINTS: NonNullable<MapProps["points"]> = [];
export default function LocationMap({
  point,
  points = EMPTY_POINTS,
  onChoose,
  onPointPress,
  onDensityCellPress,
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
  const container = useRef<HTMLDivElement>(null),
    map = useRef<maplibre.Map | null>(null),
    choose = useRef(onChoose),
    pointPress = useRef(onPointPress),
    pointData = useRef(points),
    densityCellPress = useRef(onDensityCellPress),
    barangayPress = useRef(onBarangayPress),
    backgroundPress = useRef(onMapBackgroundPress),
    barangayView = useRef(showBarangayBoundaries),
    viewportChange = useRef(onViewportChange),
    hoverPopup = useRef<maplibre.Popup | null>(null),
    hoveredPointId = useRef<string>(""),
    hoveredFeatureId = useRef<string | number | undefined>(undefined),
    markers = useRef<maplibre.Marker[]>([]);
  choose.current = onChoose;
  pointPress.current = onPointPress;
  pointData.current = points;
  densityCellPress.current = onDensityCellPress;
  barangayPress.current = onBarangayPress;
  backgroundPress.current = onMapBackgroundPress;
  barangayView.current = showBarangayBoundaries;
  viewportChange.current = onViewportChange;
  const pointsKey = useMemo(() => points.map((p) => `${p.id}:${p.latitude}:${p.longitude}`).join("|"), [points]);
  const reportCells = useMemo(() => aggregateReportCells(points), [points]);
  const barangayCountsKey = useMemo(() => JSON.stringify([barangayCounts, selectedBarangayName, barangayMetric]), [barangayCounts, selectedBarangayName, barangayMetric]);
  const maxBarangayDensity = useMemo(() => Math.max(0, ...iliganBarangayBoundaries.map((item) => barangayDensity(barangayCounts[barangayMapKey(item.properties.adm4_en)] ?? 0, barangayAreaKm2(item)))), [barangayCounts]);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [localBase, setLocalBase] = useState<MapStyle>("satellite"),
    [stylePickerOpen, setStylePickerOpen] = useState(false);
  const base = mapStyle ?? localBase;
  const baseName = base === "map" ? "Map" : base === "terrain" ? "Terrain" : "Satellite";
  const chooseMapPoint = (latitude: number, longitude: number) => choose.current?.({ latitude, longitude });
  useEffect(() => {
    if (!container.current) return;
    maplibre.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    const m = new maplibre.Map({
      container: container.current,
      center: initialRegion ? [initialRegion.longitude, initialRegion.latitude] : [124.2452, 8.228],
      zoom: initialRegion ? Math.max(2, Math.min(18, Math.log2(360 / initialRegion.longitudeDelta))) : 11.2,
      maxBounds: bounds ? [[bounds.southWest.longitude, bounds.southWest.latitude], [bounds.northEast.longitude, bounds.northEast.latitude]] : undefined,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
          topo: {
            type: "raster",
            tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png", "https://b.tile.opentopomap.org/{z}/{x}/{y}.png", "https://c.tile.opentopomap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            maxzoom: 17,
            attribution: "Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)",
          },
          imagery: {
            type: "raster",
            tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            maxzoom: 19,
            attribution: "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community",
          },
          density: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          barangays: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          reports: { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterRadius: 48, clusterMaxZoom: 14 },
        },
        layers: [
          { id: "osm", type: "raster", source: "osm", layout: { visibility: base === "map" ? "visible" : "none" } },
          { id: "topo", type: "raster", source: "topo", layout: { visibility: base === "terrain" ? "visible" : "none" } },
          { id: "imagery", type: "raster", source: "imagery", layout: { visibility: base === "satellite" ? "visible" : "none" } },
          { id: "report-density", type: "fill", source: "density", layout: { visibility: "none" }, paint: {
            "fill-color": ["get", "color"], "fill-opacity": 0.4, "fill-outline-color": ["get", "color"],
          } },
          { id: "barangay-fill", type: "fill", source: "barangays", paint: { "fill-color": ["get", "fill"], "fill-opacity": 0.58, "fill-outline-color": "#ffffff" } },
          { id: "barangay-outline", type: "line", source: "barangays", paint: { "line-color": ["case", ["get", "selected"], "#083f75", "#ffffff"], "line-width": ["case", ["get", "selected"], 3, 1.25], "line-opacity": 0.92 } },
          { id: "report-cluster-halo", type: "circle", source: "reports", filter: ["has", "point_count"], layout: { visibility: "none" }, paint: { "circle-color": "#08756b", "circle-radius": ["step", ["get", "point_count"], 26, 10, 30, 25, 36], "circle-opacity": 0.18, "circle-blur": 0.35 } },
          { id: "report-clusters", type: "circle", source: "reports", filter: ["has", "point_count"], layout: { visibility: "none" }, paint: { "circle-color": ["step", ["get", "point_count"], "#0b8f84", 10, "#08756b", 25, "#075c55"], "circle-radius": ["step", ["get", "point_count"], 19, 10, 23, 25, 28], "circle-stroke-width": 3, "circle-stroke-color": "#fff" } },
          { id: "report-cluster-count", type: "symbol", source: "reports", filter: ["has", "point_count"], layout: { visibility: "none", "text-field": ["get", "point_count_abbreviated"], "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"], "text-size": 13, "text-allow-overlap": true }, paint: { "text-color": "#fff" } },
          { id: "report-point-halo", type: "circle", source: "reports", filter: ["!", ["has", "point_count"]], layout: { visibility: "none" }, paint: { "circle-color": ["get", "color"], "circle-radius": 12, "circle-opacity": 0.22, "circle-blur": 0.4 } },
          { id: "report-points", type: "circle", source: "reports", filter: ["!", ["has", "point_count"]], layout: { visibility: "none" }, paint: { "circle-color": ["get", "color"], "circle-radius": ["case", ["boolean", ["feature-state", "hover"], false], 9, 7], "circle-stroke-width": 2.5, "circle-stroke-color": "#fff" } },
        ],
      },
      maxPitch: 70,
    });
    map.current = m;
    m.on("load", () => setReady(true));
    m.on("click", (e) => {
      if (barangayView.current) {
        if (!m.queryRenderedFeatures(e.point, { layers: ["barangay-fill"] }).length) backgroundPress.current?.();
        return;
      }
      chooseMapPoint(e.lngLat.lat, e.lngLat.lng);
    });
    m.on("click", "report-density", (e) => {
      const count = Number(e.features?.[0]?.properties?.count);
      if (count) densityCellPress.current?.(count);
    });
    const reportForFeature = (feature?: maplibre.MapGeoJSONFeature) => {
      const id = String(feature?.properties?.id ?? "");
      return pointData.current.find((item) => item.id === id);
    };
    const reportCard = (p: NonNullable<MapProps["points"]>[number], interactive: boolean) => {
      const card = document.createElement("article");
      card.style.cssText = "display:grid;gap:6px;min-width:190px;max-width:260px;padding:12px 14px;border:1px solid #e0e9e6;border-radius:14px;background:#fff;color:#10263f;box-shadow:0 6px 18px #173b3a20;font-family:system-ui,sans-serif";
      const category = document.createElement("span");
      category.textContent = p.categoryName ? categoryDisplayName(p.categoryName) : "Community report";
      category.style.cssText = `color:${p.color || "#08756b"};font-size:10px;font-weight:800;letter-spacing:.04em`;
      const title = document.createElement("strong");
      title.textContent = p.title || "Reported issue";
      title.style.cssText = "color:#10263f;font-size:13px;line-height:17px";
      const meta = document.createElement("span");
      meta.textContent = [p.statusLabel, p.barangayName && `${p.barangayName} · approximate location`].filter(Boolean).join(" · ");
      meta.style.cssText = "color:#647571;font-size:11px;line-height:15px";
      card.append(category, title, meta);
      if (interactive) {
        const action = document.createElement("button");
        action.type = "button";
        action.textContent = "View report details";
        action.style.cssText = "min-height:36px;margin-top:3px;border:0;border-radius:10px;background:#e5f6f2;color:#08756b;font-size:11px;font-weight:800;cursor:pointer";
        action.addEventListener("click", (event) => { event.stopPropagation(); pointPress.current?.(p); hoverPopup.current?.remove(); hoverPopup.current = null; });
        card.append(action);
      }
      return card;
    };
    m.on("mouseenter", "report-points", () => { m.getCanvas().style.cursor = "pointer"; });
    m.on("mousemove", "report-points", (event) => {
      const feature = event.features?.[0], report = reportForFeature(feature);
      if (!feature || !report) return;
      const featureId = feature.id;
      if (featureId !== undefined && hoveredFeatureId.current !== featureId) {
        if (hoveredFeatureId.current !== undefined) m.setFeatureState({ source: "reports", id: hoveredFeatureId.current }, { hover: false });
        hoveredFeatureId.current = featureId;
        m.setFeatureState({ source: "reports", id: featureId }, { hover: true });
      }
      const id = String(report.id);
      if (hoveredPointId.current !== id) {
        hoverPopup.current?.remove();
        hoveredPointId.current = id;
        hoverPopup.current = new maplibre.Popup({ closeButton: false, closeOnClick: false, closeOnMove: false, offset: 12, maxWidth: "280px", className: "report-pin-popup" })
          .setDOMContent(reportCard(report, false)).addTo(m);
      }
      hoverPopup.current?.setLngLat(event.lngLat);
    });
    m.on("mouseleave", "report-points", () => {
      m.getCanvas().style.cursor = "";
      if (hoveredFeatureId.current !== undefined) m.setFeatureState({ source: "reports", id: hoveredFeatureId.current }, { hover: false });
      hoveredFeatureId.current = undefined;
      hoveredPointId.current = "";
      hoverPopup.current?.remove();
      hoverPopup.current = null;
    });
    m.on("click", "report-points", (event) => {
      const feature = event.features?.[0], report = reportForFeature(feature);
      if (!report) return;
      pointPress.current?.(report);
      hoverPopup.current?.remove();
      hoverPopup.current = new maplibre.Popup({ closeButton: true, closeOnClick: true, offset: 14, maxWidth: "290px", className: "report-pin-popup" })
        .setLngLat(event.lngLat).setDOMContent(reportCard(report, true)).addTo(m);
    });
    m.on("click", "barangay-fill", (e) => {
      const name = e.features?.[0]?.properties?.name;
      if (typeof name === "string") barangayPress.current?.(name);
    });
    m.on("click", "report-clusters", (e) => {
      const cluster = e.features?.[0], clusterId = Number(cluster?.properties?.cluster_id);
      if (!cluster || !Number.isFinite(clusterId)) return;
      (m.getSource("reports") as maplibre.GeoJSONSource).getClusterExpansionZoom(clusterId)
        .then((zoom) => m.easeTo({ center: (cluster.geometry as GeoJSON.Point).coordinates as [number, number], zoom, duration: 300 }));
    });
    m.on("moveend", () => {
      const bounds = m.getBounds(), center = m.getCenter();
      viewportChange.current?.({ latitude: center.lat, longitude: center.lng, latitudeDelta: bounds.getNorth() - bounds.getSouth(), longitudeDelta: bounds.getEast() - bounds.getWest() });
    });
    m.on("error", () =>
      setError(onChoose ? "Map tiles unavailable. Use current location or enter coordinates below." : "Map tiles unavailable. Try another base layer or switch to List view."),
    );
    return () => {
      hoverPopup.current?.remove();
      hoverPopup.current = null;
      markers.current.forEach((marker) => marker.remove());
      markers.current = [];
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ready || !map.current) return;
    const update = () => {
      const current = map.current;
      if (!current) return;
      if (!current.isStyleLoaded()) { current.once("idle", update); return; }
      for (const id of ["osm", "topo", "imagery"])
        current.setLayoutProperty(id, "visibility", id === (base === "map" ? "osm" : base === "terrain" ? "topo" : "imagery") ? "visible" : "none");
       current.setLayoutProperty("report-density", "visibility", density && points.length && !showBarangayBoundaries ? "visible" : "none");
      current.setLayoutProperty("barangay-fill", "visibility", showBarangayBoundaries ? "visible" : "none");
      current.setLayoutProperty("barangay-outline", "visibility", showBarangayBoundaries ? "visible" : "none");
       for (const id of ["report-clusters", "report-cluster-count", "report-cluster-halo"])
         current.setLayoutProperty(id, "visibility", showPoints && showClusterCounts && !showBarangayBoundaries ? "visible" : "none");
       for (const id of ["report-points", "report-point-halo"])
         current.setLayoutProperty(id, "visibility", showPoints && !showBarangayBoundaries ? "visible" : "none");
      current.easeTo({ pitch: base === "terrain" ? 45 : 0, duration: 350 });
    };
    update();
    return () => { map.current?.off("idle", update); };
  }, [base, density, ready, points.length, showPoints, showClusterCounts, showBarangayBoundaries]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const reports: GeoJSON.FeatureCollection<GeoJSON.Point> = { type: "FeatureCollection", features: points.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180).map((p) => ({
      type: "Feature", id: p.id, geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
      properties: { id: p.id, weight: 1, color: p.color || "#08756b" },
    })) };
    const cells: GeoJSON.FeatureCollection<GeoJSON.Polygon> = { type: "FeatureCollection", features: reportCells.map((cell) => ({
      type: "Feature", geometry: { type: "Polygon", coordinates: [
        [...cell.bounds.map(({ latitude, longitude }) => [longitude, latitude] as [number, number]), [cell.bounds[0].longitude, cell.bounds[0].latitude]],
      ] }, properties: { count: cell.count, color: cell.color },
    })) };
    (map.current.getSource("density") as maplibre.GeoJSONSource).setData(cells);
    (map.current.getSource("reports") as maplibre.GeoJSONSource).setData(reports);
  }, [ready, pointsKey]);
  useEffect(() => {
    if (!ready || !showBarangayBoundaries || !map.current) return;
    const area = bounds;
    if (area) map.current.fitBounds(
      [[area.southWest.longitude, area.southWest.latitude], [area.northEast.longitude, area.northEast.latitude]],
      { padding: 28, duration: 360 },
    );
  }, [ready, showBarangayBoundaries, bounds]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const features = iliganBarangayBoundaries.map((feature) => {
      const count = barangayCounts[barangayMapKey(feature.properties.adm4_en)] ?? 0;
      const perKm2 = barangayDensity(count, barangayAreaKm2(feature));
      return {
        type: "Feature" as const,
        id: feature.properties.adm4_psgc,
        geometry: feature.geometry,
        properties: { name: feature.properties.adm4_en, count, density: perKm2, fill: barangayMetric === "density" ? barangayDensityColor(perKm2, maxBarangayDensity) : barangayHeatColor(count), selected: feature.properties.adm4_en === selectedBarangayName },
      };
    });
    (map.current.getSource("barangays") as maplibre.GeoJSONSource).setData({ type: "FeatureCollection", features });
  }, [ready, barangayCountsKey]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const previous = new Map(markers.current.map((marker) => [marker.getElement().dataset.markerKey, marker]));
    markers.current = [...(point ? [point] : []), ...(userPoint ? [userPoint] : [])].map((p) => {
      const isUser = p === userPoint;
      const markerKey = isUser ? "user" : point ? "chosen" : p.id ?? `${p.latitude}:${p.longitude}`;
      const signature = JSON.stringify([p.latitude, p.longitude, p.title, p.subtitle, p.categoryName, p.color, p.createdAt, p.photoUrl, p.statusLabel, p.barangayName, !!onChoose]);
      const existing = previous.get(markerKey);
      previous.delete(markerKey);
      if (existing?.getElement().dataset.signature === signature) return existing;
      const reopenPopup = existing?.getPopup()?.isOpen();
      existing?.remove();
      const pin = document.createElement("button");
      pin.type = "button";
      pin.dataset.markerKey = markerKey;
      pin.dataset.signature = signature;
      pin.style.setProperty("--pin-color", isUser ? "#3976d2" : p.color || "#08756b");
      pin.className = `report-map-pin${isUser ? " report-map-pin--you" : p.id === selectedPointId ? " report-map-pin--selected" : ""}`;
      if (p.id) pin.dataset.reportId = p.id;
      pin.setAttribute("aria-label", isUser ? "Your current location" : onChoose ? "Issue location. Drag to move the pin." : `Open report: ${p.title || "Community report"}${p.categoryName ? `, ${categoryDisplayName(p.categoryName)}` : ""}`);
      pin.setAttribute("aria-haspopup", "dialog");
      const core = document.createElement("span");
      core.className = "report-map-pin__core";
      core.setAttribute("aria-hidden", "true");
      const iconName = isUser ? "locate" : categoryIconFor(p.categoryName || "");
      core.textContent = String.fromCodePoint(Number(Ionicons.glyphMap[iconName]));
      pin.append(core);
      if (!isUser) {
        const hover = document.createElement("span");
        hover.className = "report-map-pin__hover";
        const heading = document.createElement("strong");
        heading.textContent = p.title || "Community report";
        hover.append(heading);
        if (p.categoryName) {
          const category = document.createElement("span");
          category.textContent = categoryDisplayName(p.categoryName);
          category.style.color = p.color || "#08756b";
          hover.append(category);
        }
        if (p.subtitle) {
          const sub = document.createElement("span");
          sub.textContent = p.subtitle;
          hover.append(sub);
        }
        pin.append(hover);
        pin.addEventListener("click", () => pointPress.current?.(p));
      }
      const marker = new maplibre.Marker({ element: pin, anchor: "bottom", draggable: !!point && !!onChoose })
        .setLngLat([p.longitude, p.latitude])
        .addTo(map.current!);
      if (p.title || p === userPoint) {
        const popup = new maplibre.Popup({ closeButton: false, offset: 18, maxWidth: "280px", className: "report-pin-popup" });
        const card = document.createElement("article");
        card.className = "report-pin-card";
        card.style.cssText = "width:276px;box-sizing:border-box;padding:12px;border:1px solid #e0e9e6;border-radius:18px;background:#fff;color:#10263f;box-shadow:0 6px 18px #173b3a24;font-family:system-ui,sans-serif";
        const top = document.createElement("div");
        top.className = "report-pin-card__top";
        const eyebrow = document.createElement("span");
        eyebrow.textContent = isUser ? "YOUR LOCATION" : p.categoryName ? categoryDisplayName(p.categoryName) : "Community report";
        eyebrow.style.color = p.color || "#08756b";
        eyebrow.style.cssText += ";font-size:10px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
        const close = document.createElement("button");
        close.className = "report-pin-card__close";
        close.type = "button";
        close.setAttribute("aria-label", "Close report preview");
        close.textContent = "×";
        close.addEventListener("click", (event) => { event.stopPropagation(); popup.remove(); });
        top.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:9px";
        top.append(eyebrow);
        if (!isUser && p.statusLabel) {
          const status = document.createElement("span");
          const statusTone = statusToneFor(p.statusLabel);
          status.textContent = p.statusLabel;
          status.style.cssText = `flex:none;padding:4px 7px;border-radius:12px;background:${statusTone.background};color:${statusTone.foreground};font-size:9px;font-weight:700;white-space:nowrap`;
          top.append(status);
        }
        top.append(close);
        const title = document.createElement("strong");
        title.className = "report-pin-card__title";
        title.textContent = isUser ? "You are here" : p.title!;
        title.style.cssText = "display:block;color:#10263f;font-size:14px;line-height:18px;font-weight:800";
        const content = document.createElement("div");
        content.style.cssText = "display:flex;align-items:stretch;gap:10px;min-width:0";
        const details = document.createElement("div");
        details.style.cssText = "display:flex;flex:1;min-width:0;flex-direction:column;gap:6px";
        const tone = categoryToneFor(p.categoryName || "");
        const fallback = () => {
          const tile = document.createElement("div");
          tile.setAttribute("aria-label", `${p.categoryName ? categoryDisplayName(p.categoryName) : "Community report"} icon`);
          tile.style.cssText = `display:flex;flex:none;width:76px;height:94px;align-items:center;justify-content:center;border-radius:12px;background:${tone.background};color:${tone.foreground};font-size:31px;font-family:Ionicons,sans-serif`;
          tile.textContent = String.fromCodePoint(Number(Ionicons.glyphMap[categoryIconFor(p.categoryName || "")]));
          return tile;
        };
        if (!isUser && p.photoUrl) {
          const photoButton = document.createElement("button");
          photoButton.className = "report-pin-card__photo-button";
          photoButton.type = "button";
          photoButton.setAttribute("aria-label", "View report photo full screen");
          photoButton.style.cssText = "display:block;flex:none;width:76px;height:94px;padding:0;border:0;border-radius:12px;background:#eaf2f1;overflow:hidden;cursor:zoom-in";
          const photo = document.createElement("img");
          photo.className = "report-pin-card__photo";
          photo.src = p.photoUrl;
          photo.alt = `${p.categoryName ? categoryDisplayName(p.categoryName) : "Community"} report photo`;
          photo.loading = "lazy";
          photo.style.cssText = "display:block;width:100%;height:100%;object-fit:cover";
          photoButton.append(photo);
          photo.addEventListener("error", () => photoButton.replaceWith(fallback()), { once: true });
          photoButton.addEventListener("click", (event) => {
            event.stopPropagation();
            const viewer = document.createElement("div");
            viewer.className = "report-photo-lightbox";
            viewer.setAttribute("role", "dialog");
            viewer.setAttribute("aria-modal", "true");
            viewer.setAttribute("aria-label", photo.alt);
            const fullImage = document.createElement("img");
            fullImage.src = p.photoUrl!;
            fullImage.alt = photo.alt;
            const close = document.createElement("button");
            close.type = "button";
            close.className = "report-photo-lightbox__close";
            close.setAttribute("aria-label", "Close photo");
            close.textContent = "×";
            const dismiss = () => viewer.remove();
            close.addEventListener("click", dismiss);
            viewer.addEventListener("click", (e) => { if (e.target === viewer) dismiss(); });
            viewer.addEventListener("keydown", (e) => { if (e.key === "Escape") dismiss(); });
            viewer.append(fullImage, close);
            document.body.append(viewer);
            close.focus();
          });
          content.append(photoButton);
        } else {
          if (!isUser) content.append(fallback());
        }
        details.append(title);
        if (p.subtitle) {
          const subtitle = document.createElement("p");
          subtitle.className = "report-pin-card__subtitle";
          subtitle.textContent = p.barangayName ? `${p.barangayName} · approximate location` : p.subtitle;
          subtitle.style.cssText = "margin:0;color:#647571;font-size:11px;line-height:15px";
          details.append(subtitle);
        }
        if (!isUser && p.createdAt) {
          const date = document.createElement("p");
          date.className = "report-pin-card__subtitle";
          date.textContent = new Date(p.createdAt).toLocaleDateString();
          date.style.cssText = "margin:0;color:#647571;font-size:11px;line-height:15px";
          details.append(date);
        }
        content.append(details);
        card.append(top, content);
        if (!isUser) {
          const action = document.createElement("button");
          action.className = "report-pin-card__action";
          action.type = "button";
          action.textContent = "View report details";
          action.style.cssText = "width:100%;min-height:38px;margin-top:10px;border:0;border-radius:12px;background:#e5f6f2;color:#08756b;font-size:12px;font-weight:800;cursor:pointer";
          action.addEventListener("click", (event) => { event.stopPropagation(); pointPress.current?.(p); popup.remove(); });
          const note = document.createElement("p");
          note.className = "report-pin-card__note";
          note.textContent = "Approximate location · shown for privacy";
          note.style.cssText = "margin:6px 0 0;text-align:center;color:#82908c;font-size:10px";
          card.append(action, note);
        }
        popup.setDOMContent(card);
        marker.setPopup(popup);
        if (reopenPopup) popup.setLngLat([p.longitude, p.latitude]).addTo(map.current!);
      }
      marker.on("dragend", () => {
        const xy = marker.getLngLat();
        choose.current?.({ latitude: xy.lat, longitude: xy.lng });
        marker.setLngLat([p.longitude, p.latitude]);
      });
      return marker;
    });
    previous.forEach((marker) => marker.remove());
  }, [point?.latitude, point?.longitude, ready, userPoint?.latitude, userPoint?.longitude, !!onChoose]);
  useEffect(() => {
    markers.current.forEach((marker) => {
      const element = marker.getElement();
      if (element.dataset.reportId) element.classList.toggle("report-map-pin--selected", element.dataset.reportId === selectedPointId);
    });
  }, [selectedPointId]);
  useEffect(() => {
    if (!ready || !map.current) return;
    if (point) map.current.easeTo({ center: [point.longitude, point.latitude] });
    else if (userPoint) map.current.easeTo({ center: [userPoint.longitude, userPoint.latitude], zoom: 13 });
    else if (selectedPointId) {
      const selected = points.find((p) => p.id === selectedPointId);
      if (selected) map.current.easeTo({ center: [selected.longitude, selected.latitude], zoom: 14, duration: 250 });
    }
  }, [point?.latitude, point?.longitude, pointsKey, ready, userPoint?.latitude, userPoint?.longitude, selectedPointId]);
  return (
    <>
      <style>{`.report-photo-lightbox{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;background:#06111eee}.report-photo-lightbox img{max-width:100%;max-height:100%;object-fit:contain}.report-photo-lightbox__close{position:fixed;top:max(18px,env(safe-area-inset-top));right:18px;width:44px;height:44px;border:0;border-radius:50%;background:#fff;color:#10263f;font-size:30px;line-height:1;cursor:pointer}.report-photo-lightbox__close:focus-visible{outline:3px solid #f5b840;outline-offset:2px}.report-pin-card__photo-button{display:block;width:100%;padding:0;border:0;background:transparent;text-align:left;cursor:zoom-in}`}</style>
      <View>
      <div style={{ position: "relative" }}>
        <div ref={container} style={{ height, borderRadius: 16, overflow: "hidden" }} aria-label="Community location map" />
        <View style={{ position: "absolute", left: 10, top: 10, flexDirection: "row", alignItems: "center", gap: 2, borderRadius: 13, padding: 4, backgroundColor: "white", elevation: 3 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Map style" accessibilityState={{ expanded: stylePickerOpen }} onPress={() => setStylePickerOpen(!stylePickerOpen)} style={{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: "#e8f1ee" }}><Ionicons name="layers-outline" size={15} color="#08756b" /><Text style={{ color: "#08756b", fontSize: 11, fontWeight: "800" }}>{baseName}</Text><Ionicons name={stylePickerOpen ? "chevron-up" : "chevron-down"} size={12} color="#08756b" /></Pressable>
          {stylePickerOpen && (["map", "terrain", "satellite"] as const).map((value) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: base === value }} onPress={() => { setLocalBase(value); onMapStyleChange?.(value); setStylePickerOpen(false); }} style={{ minHeight: 40, paddingHorizontal: 9, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: base === value ? "#e8f1ee" : "white" }}><Text style={{ color: base === value ? "#08756b" : "#526461", fontSize: 10, fontWeight: "700" }}>{value === "map" ? "Map" : value === "terrain" ? "Terrain" : "Satellite"}</Text></Pressable>)}
        </View>
        {base !== "map" && <View pointerEvents="none" style={{ position: "absolute", left: 12, bottom: density ? 80 : 12, backgroundColor: "#ffffffeb", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 }}><Text style={{ color: "#526461", fontSize: 9 }}>{base === "terrain" ? "© OpenStreetMap · SRTM · OpenTopoMap (CC-BY-SA)" : "Source: Esri, Vantor, Earthstar Geographics, GIS User Community"}</Text></View>}
        {density && <View pointerEvents="none" style={{ position: "absolute", left: 10, bottom: 10, width: 194, maxWidth: "calc(100% - 20px)", borderRadius: 12, paddingHorizontal: 9, paddingVertical: 7, backgroundColor: "#ffffffed", boxShadow: "0 3px 12px #173b3a30" } as never}>
          {!points.length ? <Text style={{ color: "#526461", fontSize: 10, fontWeight: "700" }}>No matching reports</Text> : <>
            <Text style={{ color: "#173b3a", fontSize: 10, fontWeight: "800", marginBottom: 4 }}>Reports / 250 m cell</Text>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 4 }}>{[["#4e9ed0", "1"], ["#41ae76", "2–3"], ["#f5b840", "4–7"], ["#d64732", "8+"]].map(([color, label]) => <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}><View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }} /><Text style={{ color: "#18304f", fontSize: 9 }}>{label}</Text></View>)}</View>
            <Text style={{ color: "#647571", fontSize: 8, marginTop: 3 }}>Tap a square to view its count</Text>
          </>}
        </View>}
        <div style={{ position: "absolute", right: 12, top: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {[["Zoom in", "+", () => map.current?.zoomIn({ duration: 180 })], ["Zoom out", "−", () => map.current?.zoomOut({ duration: 180 })]].map(([label, icon, action]) => <button key={label as string} type="button" aria-label={label as string} onClick={action as () => void} style={{ width: 48, height: 48, border: 0, borderRadius: 14, background: "white", color: "#173b3a", boxShadow: "0 2px 10px #173b3a33", cursor: "pointer", fontSize: 22 }}>{icon as string}</button>)}
          <button type="button" aria-label={userPoint ? "Recenter on my location" : locating ? "Finding your location" : "Find my location"} disabled={locating} onClick={() => {
            if (userPoint) map.current?.easeTo({ center: [userPoint.longitude, userPoint.latitude], zoom: 13, duration: 250 });
            else onLocate?.();
          }} style={{ width: 48, height: 48, border: 0, borderRadius: 14, background: "white", color: "#173b3a", boxShadow: "0 2px 10px #173b3a33", cursor: "pointer", fontSize: 22 }}>◎</button>
          {onExpand && <button type="button" aria-label="Expand map" onClick={onExpand} style={{ width: 44, height: 44, border: 0, borderRadius: 12, background: "white", color: "#173b3a", boxShadow: "0 2px 10px #173b3a33", cursor: "pointer" }}>⛶</button>}
        </div>
      </div>
      {error && <Text>{error}</Text>}
      </View>
    </>
  );
}
