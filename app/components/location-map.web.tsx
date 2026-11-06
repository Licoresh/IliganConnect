import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { MapProps, MapStyle } from "./location-map";
import * as maplibre from "maplibre-gl";
import { aggregateReportCells } from "@community/shared";
import { barangayAreaKm2, barangayDensity, barangayDensityColor, barangayHeatColor, barangayMapKey, iliganBarangayBoundaries } from "../lib/barangay-map";
import { categoryDisplayName, categoryIconFor, categoryToneFor, statusToneFor, colors } from "./ui";
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
    densityCellPress = useRef(onDensityCellPress),
    barangayPress = useRef(onBarangayPress),
    backgroundPress = useRef(onMapBackgroundPress),
    barangayView = useRef(showBarangayBoundaries),
    viewportChange = useRef(onViewportChange),
    markers = useRef<maplibre.Marker[]>([]);
  choose.current = onChoose;
  pointPress.current = onPointPress;
  densityCellPress.current = onDensityCellPress;
  barangayPress.current = onBarangayPress;
  backgroundPress.current = onMapBackgroundPress;
  barangayView.current = showBarangayBoundaries;
  viewportChange.current = onViewportChange;
  const pointsKey = useMemo(() => points.map((p) => `${p.id}:${p.latitude}:${p.longitude}`).join("|"), [points]);
  const reportPoints = useMemo(() => points.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180), [points]);
  const reportCells = useMemo(() => aggregateReportCells(reportPoints), [reportPoints]);
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
      attributionControl: { compact: true },
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
        ],
      },
      maxPitch: 70,
    });
    map.current = m;
    let resizeFrame = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (container.current?.clientWidth && container.current.clientHeight) m.resize();
      });
    });
    resize.observe(container.current);
    m.on("load", () => {
      const attribution = m.getContainer().querySelector("details.maplibregl-ctrl-attrib");
      attribution?.classList.remove("maplibregl-compact-show");
      attribution?.removeAttribute("open");
      setReady(true);
    });
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
    m.on("click", "barangay-fill", (e) => {
      const name = e.features?.[0]?.properties?.name;
      if (typeof name === "string") barangayPress.current?.(name);
    });
    m.on("moveend", () => {
      const bounds = m.getBounds(), center = m.getCenter();
      viewportChange.current?.({ latitude: center.lat, longitude: center.lng, latitudeDelta: bounds.getNorth() - bounds.getSouth(), longitudeDelta: bounds.getEast() - bounds.getWest() });
    });
    m.on("error", () =>
      setError(onChoose ? "Map tiles unavailable. Use current location or enter coordinates below." : "Map tiles unavailable. Try another base layer or switch to List view."),
    );
    return () => {
      resize.disconnect();
      cancelAnimationFrame(resizeFrame);
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
      current.easeTo({ pitch: base === "terrain" ? 45 : 0, duration: 350 });
    };
    update();
    return () => { map.current?.off("idle", update); };
  }, [base, density, ready, points.length, showBarangayBoundaries]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const cells: GeoJSON.FeatureCollection<GeoJSON.Polygon> = { type: "FeatureCollection", features: reportCells.map((cell) => ({
      type: "Feature", geometry: { type: "Polygon", coordinates: [
        [...cell.bounds.map(({ latitude, longitude }) => [longitude, latitude] as [number, number]), [cell.bounds[0].longitude, cell.bounds[0].latitude]],
      ] }, properties: { count: cell.count, color: cell.color },
    })) };
    (map.current.getSource("density") as maplibre.GeoJSONSource).setData(cells);
  }, [ready, reportCells]);
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
    markers.current = [...(point ? [point] : []), ...(userPoint ? [userPoint] : []), ...(showPoints && !showBarangayBoundaries ? reportPoints : [])].map((p, index) => {
      const isUser = p === userPoint;
      const markerKey = isUser ? "user" : p === point ? "chosen" : p.id ?? `${p.latitude}:${p.longitude}:${index}`;
      const signature = JSON.stringify([p.latitude, p.longitude, p.title, p.subtitle, p.categoryName, p.color, p.createdAt, p.photoUrl, p.photoCredit, p.statusLabel, p.barangayName, !!onChoose]);
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
      const marker = new maplibre.Marker({ element: pin, anchor: "bottom", draggable: p === point && !!onChoose })
        .setLngLat([p.longitude, p.latitude])
        .addTo(map.current!);
      if (p.title || p === userPoint) {
        const popup = new maplibre.Popup({ closeButton: false, offset: 18, maxWidth: "280px", className: "report-pin-popup" });
        const card = document.createElement("article");
        card.className = "report-pin-card";
        card.style.cssText = `width:276px;box-sizing:border-box;padding:12px;border:1px solid ${colors.line};border-radius:18px;background:#fff;color:${colors.brandDark};box-shadow:0 6px 18px #173b3a24;font-family:system-ui,sans-serif`;
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
        title.style.cssText = "display:block;color:#12343d;font-size:14px;line-height:18px;font-weight:800";
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
            if (p.photoCredit?.attribution) {
              const credit = document.createElement("aside");
              credit.style.cssText = "position:absolute;bottom:20px;left:20px;right:20px;max-height:180px;overflow:auto;padding:12px;border-radius:12px;background:#06111eee;color:#e3efed;font:12px/17px system-ui,sans-serif";
              credit.textContent = p.photoCredit.attribution;
              if (p.photoCredit.source_url?.startsWith("https://")) {
                const source = document.createElement("a");
                source.href = p.photoCredit.source_url; source.target = "_blank"; source.rel = "noopener noreferrer";
                source.textContent = "Original source and license ↗";
                source.style.cssText = "display:block;min-height:44px;padding-top:8px;color:#8ce0d0";
                credit.append(source);
              }
              viewer.append(credit);
            }
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
          subtitle.style.cssText = "margin:0;color:#5d7378;font-size:11px;line-height:15px";
          details.append(subtitle);
        }
        if (!isUser && p.createdAt) {
          const date = document.createElement("p");
          date.className = "report-pin-card__subtitle";
          date.textContent = new Date(p.createdAt).toLocaleDateString();
          date.style.cssText = "margin:0;color:#5d7378;font-size:11px;line-height:15px";
          details.append(date);
        }
        content.append(details);
        card.append(top, content);
        if (!isUser) {
          const action = document.createElement("button");
          action.className = "report-pin-card__action";
          action.type = "button";
          action.textContent = "View report details";
          action.style.cssText = `width:100%;min-height:48px;margin-top:10px;border:0;border-radius:12px;background:${colors.brandSoft};color:${colors.brand};font-size:12px;font-weight:800;cursor:pointer`;
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
  }, [point?.latitude, point?.longitude, ready, userPoint?.latitude, userPoint?.longitude, !!onChoose, reportPoints, showPoints, showBarangayBoundaries]);
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
      <style>{`
        .report-map-pin{width:48px;height:48px;padding:6px;border:0;border-radius:50%;background:transparent;cursor:pointer;overflow:visible}
        .report-map-pin__core{display:flex;width:36px;height:36px;align-items:center;justify-content:center;border:3px solid #fff;border-radius:50%;background:var(--pin-color,${colors.brand});color:#fff;box-shadow:0 2px 8px #173b3a66;font:20px Ionicons,ionicons,sans-serif;box-sizing:border-box}
        .report-map-pin--you .report-map-pin__core{border-radius:50%;transform:none}
        .report-map-pin--selected .report-map-pin__core{box-shadow:0 0 0 4px #f5b840aa,0 2px 8px #173b3a66}
        .report-map-pin:focus-visible{outline:3px solid #f5b840;outline-offset:3px}
        .report-map-pin__hover{display:none;position:absolute;bottom:48px;left:50%;transform:translateX(-50%);width:180px;padding:10px;border-radius:12px;background:#fff;color:#12343d;box-shadow:0 3px 14px #173b3a33;text-align:left;font:12px/1.4 system-ui,sans-serif;pointer-events:none}
        .report-map-pin__hover strong,.report-map-pin__hover span{display:block;overflow-wrap:anywhere}
        .report-map-pin:hover .report-map-pin__hover,.report-map-pin:focus-visible .report-map-pin__hover{display:block}
        .report-pin-popup .maplibregl-popup-content{padding:0;border-radius:18px;box-shadow:none}
        .report-pin-card__close{margin-left:auto;min-width:48px;min-height:48px;border:0;border-radius:50%;background:#eef5f3;color:#12343d;font-size:24px;cursor:pointer}
        .maplibregl-ctrl-attrib.maplibregl-compact{min-width:48px;min-height:48px;padding:0;box-sizing:border-box}
        .maplibregl-ctrl-attrib.maplibregl-compact-show{padding:8px 54px 8px 10px;max-width:min(280px,calc(100vw - 64px))}
        .maplibregl-ctrl-attrib-button{width:48px;height:48px;background-repeat:no-repeat;background-position:center;background-size:24px 24px}
      `}</style>
      <style>{`.report-photo-lightbox{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;background:#06111eee}.report-photo-lightbox img{max-width:100%;max-height:100%;object-fit:contain}.report-photo-lightbox__close{position:fixed;top:max(18px,env(safe-area-inset-top));right:18px;width:48px;height:48px;border:0;border-radius:50%;background:#fff;color:#12343d;font-size:30px;line-height:1;cursor:pointer}.report-photo-lightbox__close:focus-visible{outline:3px solid #f5b840;outline-offset:2px}.report-pin-card__photo-button{display:block;width:100%;padding:0;border:0;background:transparent;text-align:left;cursor:zoom-in}`}</style>
      <View>
      <div style={{ position: "relative" }}>
        <div ref={container} style={{ height, borderRadius: 16, overflow: "hidden" }} aria-label="Community location map" />
        <View style={{ position: "absolute", left: 10, top: 10, flexDirection: "row", alignItems: "center", gap: 2, borderRadius: 13, padding: 4, backgroundColor: "white", elevation: 3, zIndex: 4 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Map style" accessibilityState={{ expanded: stylePickerOpen }} onPress={() => setStylePickerOpen(!stylePickerOpen)} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.brandSoft }}><Ionicons name="layers-outline" size={15} color={colors.brand} /><Text style={{ color: colors.brand, fontSize: 11, fontWeight: "800" }}>{baseName}</Text><Ionicons name={stylePickerOpen ? "chevron-up" : "chevron-down"} size={12} color={colors.brand} /></Pressable>
          {stylePickerOpen && <View style={{ position: "absolute", top: 60, left: 0, width: 150, gap: 4, padding: 4, borderWidth: 1, borderColor: "#e0e9e6", borderRadius: 12, backgroundColor: "white", elevation: 3 }}>
            {(["map", "terrain", "satellite"] as const).map((value) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: base === value }} accessibilityLabel={`${value === "map" ? "Map" : value === "terrain" ? "Terrain" : "Satellite"}${base === value ? ", selected" : ""}`} onPress={() => { setLocalBase(value); onMapStyleChange?.(value); setStylePickerOpen(false); }} style={{ minHeight: 48, paddingHorizontal: 10, borderRadius: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: base === value ? colors.brandSoft : colors.surface }}><Text style={{ color: base === value ? colors.brand : colors.muted, fontSize: 14, fontWeight: "700" }}>{value === "map" ? "Map" : value === "terrain" ? "Terrain" : "Satellite"}</Text>{base === value && <Ionicons name="checkmark" size={18} color={colors.brand} />}</Pressable>)}
          </View>}
        </View>
        {density && <View pointerEvents="none" style={{ position: "absolute", left: 10, bottom: 10, width: 194, maxWidth: "calc(100% - 20px)", borderRadius: 12, paddingHorizontal: 9, paddingVertical: 7, backgroundColor: "#ffffffed", boxShadow: "0 3px 12px #173b3a30" } as never}>
          {!points.length ? <Text style={{ color: "#526461", fontSize: 10, fontWeight: "700" }}>No matching reports</Text> : <>
            <Text style={{ color: "#173b3a", fontSize: 10, fontWeight: "800", marginBottom: 4 }}>Reports / 250 m cell</Text>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 4 }}>{[["#4e9ed0", "1"], ["#41ae76", "2–3"], ["#f5b840", "4–7"], ["#d64732", "8+"]].map(([color, label]) => <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}><View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }} /><Text style={{ color: "#18304f", fontSize: 9 }}>{label}</Text></View>)}</View>
            <Text style={{ color: "#647571", fontSize: 8, marginTop: 3 }}>Tap a square to view its count</Text>
          </>}
        </View>}
        <div style={{ position: "absolute", right: 12, top: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {[["Zoom in", "+", () => map.current?.zoomIn({ duration: 180 })], ["Zoom out", "−", () => map.current?.zoomOut({ duration: 180 })]].map(([label, icon, action]) => <button key={label as string} type="button" aria-label={label as string} onClick={action as () => void} style={{ width: 48, height: 48, border: 0, borderRadius: 14, background: "white", color: "#12343d", boxShadow: "0 2px 10px #173b3a33", cursor: "pointer", fontSize: 22 }}>{icon as string}</button>)}
          <button type="button" aria-label={userPoint ? "Recenter on my location" : locating ? "Finding your location" : "Find my location"} disabled={locating} onClick={() => {
            if (userPoint) map.current?.easeTo({ center: [userPoint.longitude, userPoint.latitude], zoom: 13, duration: 250 });
            else onLocate?.();
          }} style={{ width: 48, height: 48, border: 0, borderRadius: 14, background: "white", color: "#12343d", boxShadow: "0 2px 10px #173b3a33", cursor: "pointer", fontSize: 22 }}>◎</button>
          {onExpand && <button type="button" aria-label="Expand map" onClick={onExpand} style={{ width: 48, height: 48, border: 0, borderRadius: 12, background: "white", color: "#12343d", boxShadow: "0 2px 10px #173b3a33", cursor: "pointer" }}>⛶</button>}
        </div>
      </div>
      {error && <Text>{error}</Text>}
      </View>
    </>
  );
}
