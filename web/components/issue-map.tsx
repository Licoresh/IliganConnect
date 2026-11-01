"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, ArrowUpRight, BadgeCheck, BarChart3, CheckCircle2, CircleAlert, Cog, FileText, Flame, Layers3, List, MapPin, MapPinned, RefreshCw, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { db, result } from "../lib/client";
import { Report, statuses, label } from "@community/shared";
import { ILIGAN_MAP_BOUNDS } from "../../shared/iligan";
import {
  barangayAreaKm2,
  barangayDensity,
  barangayDensityColor,
  barangayHeatColor,
  barangayMapKey,
  iliganBarangayBoundaries,
} from "../../app/lib/barangay-map";
import type { References } from "./workspace";
import { useAccess } from "./access-context";
import { permissionFingerprint } from "../lib/access";
import { ReportDetail } from "./reports";
import { philippineDateBoundary } from "../lib/export";
import { pointInPolygon } from "../lib/map-geometry";
import { reportHeatCells } from "../lib/report-map-data";
import { reportCategoryPresentation, reportCategoryPresentationForKey, ReportCategoryLabel, type CategoryKey } from "./report-category";

const categoryKeys: CategoryKey[] = ["streetlights", "roads", "drainage", "garbage", "wires", "signs", "other"];
const markerKinds = Object.fromEntries(categoryKeys.map((key) => [key, reportCategoryPresentationForKey(key)])) as Record<CategoryKey, ReturnType<typeof reportCategoryPresentationForKey>>;

function markerKindFor(name: string) {
  return reportCategoryPresentation(name).key;
}

async function addReportMarkerImages(target: maplibregl.Map) {
  await Promise.all(Object.entries(markerKinds).map(([kind, marker]) => new Promise<void>((resolve, reject) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="112" viewBox="0 0 44 56"><path d="M22 54C19 48 5 33 5 22a17 17 0 1 1 34 0c0 11-14 26-17 32Z" fill="${marker.foreground}" stroke="#fff" stroke-width="2.5"/><circle cx="22" cy="22" r="11.5" fill="${marker.foreground}"/><g transform="translate(10 10)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${marker.glyph}</g></svg>`;
    const image = new Image();
    image.onload = () => {
      if (target.getStyle() && !target.hasImage(`report-${kind}`)) target.addImage(`report-${kind}`, image, { pixelRatio: 2 });
      resolve();
    };
    image.onerror = () => reject(new Error(`Could not load ${kind} map marker`));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  })));
}

function boundsForBoundary(feature: { geometry: { coordinates: number[][][] } }): [[number, number], [number, number]] {
  const points = feature.geometry.coordinates.flat();
  return [
    [Math.min(...points.map((point) => point[0])), Math.min(...points.map((point) => point[1]))],
    [Math.max(...points.map((point) => point[0])), Math.max(...points.map((point) => point[1]))],
  ];
}

export default function IssueMap({
  refs,
  initialBarangay = "",
  compact = false,
  overview = false,
  initialMode = "heat",
  hideReportList = false,
}: {
  refs: References;
  initialBarangay?: string;
  compact?: boolean;
  overview?: boolean;
  initialMode?: string;
  hideReportList?: boolean;
}) {
  const access = useAccess();
  const container = useRef<HTMLDivElement>(null),
    map = useRef<maplibregl.Map | null>(null),
    barangayPopup = useRef<maplibregl.Popup | null>(null),
    reportListHeading = useRef<HTMLHeadingElement>(null),
    hoveredFeatureId = useRef<string | number | undefined>(undefined);
  const [ready, setReady] = useState(false),
    [retryKey, setRetryKey] = useState(0),
    [tileError, setTileError] = useState(false),
    [showBoundary, setShowBoundary] = useState(false),
    [overviewCategory, setOverviewCategory] = useState(""),
    [overviewState, setOverviewState] = useState(""),
    [overviewDateRange, setOverviewDateRange] = useState("all"),
    [overviewSince, setOverviewSince] = useState(""),
    [overviewUntil, setOverviewUntil] = useState(""),
    [bounds, setBounds] = useState<[number, number, number, number]>([
      ILIGAN_MAP_BOUNDS.southWest.longitude,
      ILIGAN_MAP_BOUNDS.southWest.latitude,
      ILIGAN_MAP_BOUNDS.northEast.longitude,
      ILIGAN_MAP_BOUNDS.northEast.latitude,
    ]),
    [overviewMode, setOverviewMode] = useState<"map" | "barangays" | "list">(
      initialMode === "barangays" || initialMode === "list" ? initialMode : "map",
    ),
    [showMarkers, setShowMarkers] = useState(true),
    [showHeat, setShowHeat] = useState(true),
    [base, setBase] = useState<"map" | "terrain" | "satellite">("satellite"),
    [barangayMetric, setBarangayMetric] = useState<"count" | "density">("count"),
    [showSavedLocations, setShowSavedLocations] = useState(false),
    [category, setCategory] = useState(""),
    [barangay, setBarangay] = useState(initialBarangay),
    [state, setState] = useState(""),
    [since, setSince] = useState(""),
    [until, setUntil] = useState(""),
    [reportPage, setReportPage] = useState(0),
    [manualRefreshing, setManualRefreshing] = useState(false),
    [error, setError] = useState(""),
    [selectedId, setSelectedId] = useState("");
  const baseRef = useRef(base);
  baseRef.current = base;
  const mode = overview || !hideReportList ? overviewMode : "map";
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const setMode = setOverviewMode;
  useEffect(() => { barangayPopup.current?.remove(); }, [mode]);
  const invalidDates = !!(since && until && since > until);
  useEffect(() => setReportPage(0), [category, barangay, state, since, until, mode]);
  const canChangeBarangay = access.profile.role !== "barangay" && !hideReportList;
  const mapScopeId = access.profile.role === "barangay" ? access.profile.barangay_id : barangay;
  useEffect(() => setShowSavedLocations(false), [mapScopeId]);
  const selectedBarangayName = refs.barangays.find((item) => item.id === mapScopeId)?.name ?? "";
  const selectBarangay = (id: string) => {
    if (!canChangeBarangay && id !== mapScopeId) return false;
    barangayPopup.current?.remove();
    setError("");
    setBarangay(id);
    if (!id) setBounds([ILIGAN_MAP_BOUNDS.southWest.longitude, ILIGAN_MAP_BOUNDS.southWest.latitude, ILIGAN_MAP_BOUNDS.northEast.longitude, ILIGAN_MAP_BOUNDS.northEast.latitude]);
    else if (id === mapScopeId && mapScopeFeature) map.current?.fitBounds(boundsForBoundary(mapScopeFeature), { padding: mode === "barangays" ? 28 : compact ? 32 : 52, maxZoom: 14, duration: 360 });
    return true;
  };
  const selectBarangayRef = useRef(selectBarangay);
  selectBarangayRef.current = selectBarangay;
  const mapScopeFeature = useMemo(() => {
    const name = refs.barangays.find((item) => item.id === mapScopeId)?.name;
    return name
      ? iliganBarangayBoundaries.find((feature) => barangayMapKey(feature.properties.adm4_en) === barangayMapKey(name)) ?? null
      : null;
  }, [mapScopeId, refs.barangays]);
  const mapScopeName = mapScopeFeature?.properties.adm4_en ?? "";
  const queryBounds: [number, number, number, number] = mode === "barangays" || !!mapScopeId
    ? [
        ILIGAN_MAP_BOUNDS.southWest.longitude,
        ILIGAN_MAP_BOUNDS.southWest.latitude,
        ILIGAN_MAP_BOUNDS.northEast.longitude,
        ILIGAN_MAP_BOUNDS.northEast.latitude,
      ]
    : bounds;
  const mapFilters = [category, mapScopeId, state, since, until, permissionFingerprint(access)];
  const q = useQuery<Report[]>({
    enabled: !invalidDates,
    queryKey: [
      "map",
      queryBounds,
      ...mapFilters,
    ],
    // Retain the view during viewport requests, but never across filters or access changes.
    placeholderData: (previous, previousQuery) => mapFilters.every((filter, index) => previousQuery?.queryKey[index + 2] === filter) ? previous : undefined,
    queryFn: ({ signal }) =>
      result<Report[]>(
        db!.rpc("map_reports", {
          west: queryBounds[0],
          south: queryBounds[1],
          east: queryBounds[2],
          north: queryBounds[3],
          category: category || null,
          barangay: mapScopeId || null,
          report_state: state || null,
          office: null,
          since: philippineDateBoundary(since),
          until: philippineDateBoundary(until, true),
          verified_only: false,
          unresolved_only: false,
          recurring_only: false,
        }).abortSignal(signal),
      ),
  });
  const selectedMapReport = q.data?.find((report) => report.id === selectedId);
  const linkedReport = useQuery({
    queryKey: ["map-linked-report", selectedId, permissionFingerprint(access)],
    enabled: !!selectedId && !selectedMapReport,
    queryFn: ({ signal }) => result<Report | null>(db!.from("reports").select("*").eq("id", selectedId).abortSignal(signal).maybeSingle()),
  });
  const selectedReport = selectedMapReport || linkedReport.data;
  const gis = useQuery({
    enabled: mode === "barangays" && !invalidDates,
    queryKey: ["map-barangay-counts", category, state, since, until, permissionFingerprint(access)],
    queryFn: ({ signal }) => result<{ barangay_id: string; barangay_name: string; report_count: number }[]>(db!.rpc("map_barangay_counts", {
      p_category: category || null,
      p_barangay: null,
      p_report_state: state || null,
      p_since: philippineDateBoundary(since),
      p_until: philippineDateBoundary(until, true),
      p_verified_only: false,
      p_unresolved_only: false,
      p_office: null,
      p_recurring_only: false,
    }).abortSignal(signal)),
  });
  const refreshGeographicData = async () => {
    if (manualRefreshing || invalidDates) return;
    setManualRefreshing(true);
    try {
      await Promise.all([
        q.refetch({ cancelRefetch: false }),
        ...(mode === "barangays" ? [gis.refetch({ cancelRefetch: false })] : []),
      ]);
    } finally {
      setManualRefreshing(false);
    }
  };
  const reportPageCount = Math.max(1, Math.ceil((q.data?.length ?? 0) / 20));
  const currentReportPage = Math.min(reportPage, reportPageCount - 1);
  const listedReports = q.data?.slice(currentReportPage * 20, currentReportPage * 20 + 20) ?? [];
  const changeReportPage = (page: number) => {
    setReportPage(page);
    reportListHeading.current?.focus({ preventScroll: true });
    reportListHeading.current?.scrollIntoView({ block: "start" });
  };
  const withinBoundaryReports = useMemo(() => {
    const reports = invalidDates ? [] : q.data ?? [];
    if (!mapScopeFeature) return reports;
    return reports.filter((report) =>
      pointInPolygon([report.longitude, report.latitude], mapScopeFeature.geometry),
    );
  }, [invalidDates, mapScopeFeature, q.data]);
  const mapReports = showSavedLocations && !invalidDates ? q.data ?? [] : withinBoundaryReports;
  const hotspotCells = useMemo(() => reportHeatCells(mapReports.map((report) => ({
    latitude: report.latitude,
    longitude: report.longitude,
  })), showSavedLocations ? null : mapScopeFeature?.geometry), [mapReports, mapScopeFeature, showSavedLocations]);
  const frequentCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const report of mapReports) counts.set(report.category_id, (counts.get(report.category_id) ?? 0) + 1);
    return refs.categories.map((item) => ({ ...item, count: counts.get(item.id) ?? 0 }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [mapReports, refs.categories]);
  const outOfScopeMapReports = Math.max(0, (invalidDates ? 0 : q.data?.length ?? 0) - withinBoundaryReports.length);
  const reportCountsByBarangay = useMemo(() => {
    return (invalidDates ? [] : gis.data ?? []).reduce<Record<string, number>>((counts, row) => {
      counts[barangayMapKey(row.barangay_name)] = Number(row.report_count);
      return counts;
    }, {});
  }, [gis.data, invalidDates]);
  const barangayGeoJson = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon>>(() => {
    const countFor = (feature: (typeof iliganBarangayBoundaries)[number]) =>
      reportCountsByBarangay[barangayMapKey(feature.properties.adm4_en)] ?? 0;
    const maxDensity = Math.max(0, ...iliganBarangayBoundaries.map((feature) =>
      barangayDensity(countFor(feature), barangayAreaKm2(feature)),
    ));
    return {
      type: "FeatureCollection",
      features: iliganBarangayBoundaries.map((feature) => {
        const count = countFor(feature);
        const density = barangayDensity(count, barangayAreaKm2(feature));
        return {
          type: "Feature",
          id: feature.properties.adm4_psgc,
          geometry: feature.geometry,
          properties: {
            name: feature.properties.adm4_en,
            count,
            density,
            fill: barangayMetric === "density" ? barangayDensityColor(density, maxDensity) : barangayHeatColor(count),
            selected: barangayMapKey(feature.properties.adm4_en) === barangayMapKey(selectedBarangayName),
          },
        };
      }),
    };
  }, [reportCountsByBarangay, barangayMetric, selectedBarangayName]);
  const barangaySummaryRows = useMemo(() => {
    const ids = new Map(refs.barangays.map((item) => [barangayMapKey(item.name), item.id]));
    const rows = iliganBarangayBoundaries.map((feature) => {
      const name = feature.properties.adm4_en;
      const report_count = reportCountsByBarangay[barangayMapKey(name)] ?? 0;
      return {
        barangay_id: ids.get(barangayMapKey(name)) ?? "",
        barangay_name: name,
        report_count,
        density: barangayDensity(report_count, barangayAreaKm2(feature)),
      };
    }).filter((row) => row.report_count > 0 || row.barangay_name === selectedBarangayName)
      .sort((a, b) => b.report_count - a.report_count || a.barangay_name.localeCompare(b.barangay_name));
    const maximum = Math.max(0, ...rows.map((row) => barangayMetric === "density" ? row.density : row.report_count));
    return rows.map((row) => {
      const value = barangayMetric === "density" ? row.density : row.report_count;
      return {
        ...row,
        width: value ? Math.max(4, value / maximum * 100) : 0,
        color: barangayMetric === "density" ? barangayDensityColor(row.density, maximum) : barangayHeatColor(row.report_count),
      };
    });
  }, [reportCountsByBarangay, barangayMetric, refs.barangays, selectedBarangayName]);
  useEffect(() => {
    if (!container.current) return;
    maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    const m = new maplibregl.Map({
      container: container.current,
      center: [124.2452, 8.228],
      zoom: 11.2,
      minZoom: 10,
      maxZoom: 18,
      fadeDuration: 0,
      attributionControl: overview ? false : undefined,
      maxBounds: [
        [ILIGAN_MAP_BOUNDS.southWest.longitude, ILIGAN_MAP_BOUNDS.southWest.latitude],
        [ILIGAN_MAP_BOUNDS.northEast.longitude, ILIGAN_MAP_BOUNDS.northEast.latitude],
      ],
      style: {
        version: 8,
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
        },
        layers: [
          { id: "base", type: "raster", source: "osm", layout: { visibility: "none" } },
          { id: "topo-base", type: "raster", source: "topo", layout: { visibility: "none" } },
          { id: "imagery-base", type: "raster", source: "imagery", layout: { visibility: "visible" } },
        ],
      },
    });
    map.current = m;
    const resize = new ResizeObserver(() => m.resize());
    resize.observe(container.current);
    m.addControl(new maplibregl.NavigationControl());
    m.addControl(new maplibregl.FullscreenControl({ container: container.current.parentElement || container.current }));
    let timer: ReturnType<typeof setTimeout>, initialMapLoaded = false;
    m.on("moveend", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (modeRef.current === "list") return;
        const b = m.getBounds();
        setBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      }, 300);
    });
    m.on("error", (event) => {
      const sourceId = (event as typeof event & { sourceId?: string }).sourceId;
      const activeSource = baseRef.current === "map" ? "osm" : baseRef.current === "terrain" ? "topo" : "imagery";
      if (sourceId !== activeSource) {
        console.error("MapLibre error outside the active basemap:", event.error);
        return;
      }
      if (overview) {
        if (!initialMapLoaded) setTileError(true);
      } else {
        setError("The selected map layer could not load. Try another map style or check your connection.");
      }
    });
    m.on("load", async () => {
      initialMapLoaded = true;
      setTileError(false);
      let markersReady = true;
      try {
        await addReportMarkerImages(m);
      } catch {
        markersReady = false;
        setError("Category markers could not load; showing simple report dots instead.");
      }
      if (map.current !== m) return;
      m.addSource("reports", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addSource("density", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addSource("barangays", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addLayer({
        id: "heat",
        type: "fill",
        source: "density",
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.62, "fill-outline-color": "#ffffff" },
      });
      m.addLayer({
        id: "barangay-fill",
        type: "fill",
        source: "barangays",
        layout: { visibility: "none" },
        paint: { "fill-color": ["get", "fill"], "fill-opacity": 0.46, "fill-outline-color": "#ffffff" },
      });
      m.addLayer({
        id: "barangay-outline",
        type: "line",
        source: "barangays",
        layout: { visibility: "none" },
        paint: {
          "line-color": ["case", ["get", "selected"], "#062f59", "#ffffff"],
          "line-width": ["case", ["get", "selected"], 3, 1.25],
          "line-opacity": 0.96,
        },
      });
      m.addLayer({
        id: "barangay-counts",
        type: "symbol",
        source: "barangays",
        filter: [">", ["get", "count"], 0],
        layout: {
          visibility: "none",
          "icon-image": ["concat", "barangay-count-", ["to-string", ["get", "count"]]],
          "icon-padding": 4,
        },
      });
      m.on("click", "barangay-fill", (event) => {
        const feature = event.features?.[0];
        const name = feature?.properties?.name;
        if (typeof name !== "string") return;
        const selected = refs.barangays.find((item) => barangayMapKey(item.name) === barangayMapKey(name));
        const boundary = iliganBarangayBoundaries.find((item) => barangayMapKey(item.properties.adm4_en) === barangayMapKey(name));
        if (!selected || !boundary) {
          setError("We couldn’t match this mapped boundary to a barangay record.");
          return;
        }
        if (!selectBarangayRef.current(selected.id)) return;

        const count = Number(feature?.properties?.count ?? 0);
        const density = Number(feature?.properties?.density ?? 0);
        const card = document.createElement("article");
        card.className = "map-popup-card";
        const eyebrow = document.createElement("span");
        eyebrow.className = "map-popup-eyebrow";
        eyebrow.textContent = "BARANGAY REPORT SUMMARY";
        const title = document.createElement("strong");
        title.className = "map-popup-title";
        title.textContent = name;
        const note = document.createElement("p");
        note.className = "map-popup-note";
        note.textContent = `${count} ${count === 1 ? "matching report" : "matching reports"} · ${density.toFixed(1)} per km²`;
        const button = document.createElement("button");
        button.className = "map-popup-action";
        button.type = "button";
        button.textContent = "View barangay reports";
        button.addEventListener("click", () => {
          if (overview) setMode("list");
          requestAnimationFrame(() => {
            reportListHeading.current?.scrollIntoView({ block: "start" });
            reportListHeading.current?.focus({ preventScroll: true });
          });
        });
        card.append(eyebrow, title, note, button);
        barangayPopup.current = new maplibregl.Popup({ closeButton: true, offset: 12, maxWidth: "300px", className: "map-data-popup" })
          .setLngLat(event.lngLat)
          .setDOMContent(card)
          .addTo(m);
      });
      m.on("mouseenter", "barangay-fill", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "barangay-fill", () => { m.getCanvas().style.cursor = ""; });
      m.on("click", "heat", (event) => {
        if (m.queryRenderedFeatures(event.point, { layers: ["points"] }).length) return;
        const feature = event.features?.[0];
        if (!feature) return;
        const count = Number(feature.properties?.count);
        const card = document.createElement("article");
        card.className = "map-popup-card";
        const eyebrow = document.createElement("span");
        eyebrow.className = "map-popup-eyebrow";
        eyebrow.textContent = "HOTSPOT · 250 M CELL";
        const title = document.createElement("strong");
        title.className = "map-popup-title";
        title.textContent = `${count} ${count === 1 ? "matching report" : "matching reports"}`;
        const note = document.createElement("p");
        note.className = "map-popup-note";
        note.textContent = "Count reflects the filters and reports loaded in this map view.";
        card.append(eyebrow, title, note);
        new maplibregl.Popup({ closeButton: true, offset: 12, maxWidth: "300px", className: "map-data-popup" }).setLngLat(event.lngLat).setDOMContent(card).addTo(m);
      });
      m.addLayer(markersReady ? {
        id: "points",
        type: "symbol",
        source: "reports",
        layout: {
          "icon-image": ["get", "marker_icon"],
          "icon-anchor": "bottom",
          "icon-size": 0.9,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: { "icon-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0.88] },
      } : {
        id: "points",
        type: "circle",
        source: "reports",
        paint: {
          "circle-color": ["get", "category_color"],
          "circle-radius": ["case", ["boolean", ["feature-state", "hover"], false], 9, 7.5],
          "circle-stroke-width": ["case", ["boolean", ["feature-state", "hover"], false], 3, 2.5],
          "circle-stroke-color": "#fff",
        },
      });
      m.on("click", "points", (e) => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== "Point") return;
        const node = document.createElement("article");
        node.className = "map-popup-card";
        const eyebrow = document.createElement("span");
        eyebrow.className = "map-popup-eyebrow";
        eyebrow.textContent = "COMMUNITY REPORT";
        const category = reportCategoryPresentation(String(f.properties.category_name || "Other"));
        const categoryLabel = document.createElement("span");
        categoryLabel.className = "map-popup-category";
        const categoryIcon = document.createElement("span");
        categoryIcon.className = "map-popup-category-icon";
        categoryIcon.style.backgroundColor = category.background;
        categoryIcon.style.color = category.foreground;
        categoryIcon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${category.glyph}</svg>`;
        const categoryName = document.createElement("span");
        categoryName.textContent = category.label;
        categoryLabel.append(categoryIcon, categoryName);
        const title = document.createElement("strong");
        title.className = "map-popup-title";
        title.textContent = f.properties.title;
        const status = document.createElement("span");
        status.className = "map-popup-status";
        status.textContent =
          label(f.properties.status);
        const button = document.createElement("button");
        button.className = "map-popup-action";
        button.textContent = "Open report";
        button.addEventListener("click", () =>
          setSelectedId(String(f.properties.id)),
        );
        node.append(eyebrow, categoryLabel, title, status, button);
        new maplibregl.Popup({ closeButton: true, offset: 12, maxWidth: "300px", className: "map-data-popup" })
          .setLngLat(f.geometry.coordinates as [number, number])
          .setDOMContent(node)
          .addTo(m);
      });
      m.on("mouseenter", "points", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mousemove", "points", (e) => {
        const id = e.features?.[0]?.id;
        if (id === undefined || id === hoveredFeatureId.current) return;
        if (hoveredFeatureId.current !== undefined) m.setFeatureState({ source: "reports", id: hoveredFeatureId.current }, { hover: false });
        hoveredFeatureId.current = id;
        m.setFeatureState({ source: "reports", id }, { hover: true });
      });
      m.on("mouseleave", "points", () => {
        m.getCanvas().style.cursor = "";
        if (hoveredFeatureId.current !== undefined) m.setFeatureState({ source: "reports", id: hoveredFeatureId.current }, { hover: false });
        hoveredFeatureId.current = undefined;
      });
      setReady(true);
    });
    return () => {
      clearTimeout(timer);
      resize.disconnect();
      m.remove();
      map.current = null;
    };
  }, [retryKey]);
  useEffect(() => {
    if (!ready || !map.current || mode === "list") return;
    map.current.fitBounds(mapScopeFeature
      ? boundsForBoundary(mapScopeFeature)
      : [[ILIGAN_MAP_BOUNDS.southWest.longitude, ILIGAN_MAP_BOUNDS.southWest.latitude], [ILIGAN_MAP_BOUNDS.northEast.longitude, ILIGAN_MAP_BOUNDS.northEast.latitude]], {
      padding: mode === "barangays" || !mapScopeFeature ? 28 : compact ? 32 : 52,
      maxZoom: 14,
      duration: 360,
    });
  }, [compact, mapScopeFeature, mode, ready]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: mapReports.map((r) => {
        const categoryKey = markerKindFor(refs.categories.find((item) => item.id === r.category_id)?.name ?? "");
        return {
          type: "Feature" as const,
          id: r.id,
          geometry: { type: "Point" as const, coordinates: [r.longitude, r.latitude] },
          properties: { id: r.id, title: r.title, status: r.status, is_demo: r.is_demo, category: r.category_id, category_name: refs.categories.find((item) => item.id === r.category_id)?.name || "Other", marker_icon: `report-${categoryKey}`, category_color: markerKinds[categoryKey].foreground },
        };
      }),
    };
    (map.current.getSource("reports") as maplibregl.GeoJSONSource).setData(
      data,
    );
    const cells: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: hotspotCells
      .map((cell) => ({ type: "Feature", geometry: cell.geometry, properties: { count: cell.count, color: cell.color } })) };
    (map.current.getSource("density") as maplibregl.GeoJSONSource).setData(cells);
  }, [mapReports, refs.categories, hotspotCells, ready]);
  useEffect(() => {
    if (ready && mode !== "list") map.current?.resize();
  }, [mode, ready]);
  useEffect(() => {
    if (!ready || !map.current) return;
    map.current.setLayoutProperty("points", "visibility", mode === "map" && showMarkers ? "visible" : "none");
    map.current.setLayoutProperty("heat", "visibility", mode === "map" && showHeat ? "visible" : "none");
    map.current.setLayoutProperty("barangay-fill", "visibility", mode === "barangays" && !!gis.data ? "visible" : "none");
    map.current.setLayoutProperty("barangay-counts", "visibility", mode === "barangays" && !!gis.data ? "visible" : "none");
    map.current.setLayoutProperty("barangay-outline", "visibility", mode === "barangays" || showBoundary ? "visible" : "none");
  }, [ready, mode, showMarkers, showHeat, showBoundary, gis.data]);
  useEffect(() => {
    if (!ready || !map.current) return;
    // Local count badges avoid another font/tile service and reuse each distinct total.
    for (const feature of barangayGeoJson.features) {
      const count = Number(feature.properties?.count ?? 0);
      const imageId = `barangay-count-${count}`;
      if (!count || map.current.hasImage(imageId)) continue;
      const canvas = document.createElement("canvas");
      canvas.width = 112; canvas.height = 64;
      const context = canvas.getContext("2d");
      if (!context) continue;
      context.scale(2, 2);
      context.fillStyle = "#ffffff";
      context.strokeStyle = "#31556b";
      context.lineWidth = 1.5;
      context.beginPath(); context.roundRect(2, 2, 52, 28, 9); context.fill(); context.stroke();
      context.fillStyle = "#102b47";
      context.font = "600 14px system-ui";
      context.textAlign = "center"; context.textBaseline = "middle";
      context.fillText(count.toLocaleString("en-PH"), 28, 16, 46);
      map.current.addImage(imageId, context.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: 2 });
    }
    const source = map.current.getSource("barangays") as maplibregl.GeoJSONSource | undefined;
    source?.setData(barangayGeoJson);
  }, [barangayGeoJson, ready]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const active = base === "map" ? "base" : base === "terrain" ? "topo-base" : "imagery-base";
    for (const id of ["base", "topo-base", "imagery-base"])
      map.current.setLayoutProperty(id, "visibility", id === active ? "visible" : "none");
  }, [base, ready]);
  const toggleSavedLocations = () => {
    const show = !showSavedLocations;
    setShowSavedLocations(show);
    const target = map.current;
    if (!target || !mapScopeFeature) return;
    if (show && q.data?.length) {
      const locations = new maplibregl.LngLatBounds(...boundsForBoundary(mapScopeFeature));
      q.data.forEach((report) => locations.extend([report.longitude, report.latitude]));
      target.fitBounds(locations, { padding: compact ? 32 : 52, maxZoom: 15, duration: 360 });
    } else target.fitBounds(boundsForBoundary(mapScopeFeature), { padding: compact ? 32 : 52, maxZoom: 14, duration: 360 });
  };
  const scopeWarning = mode === "map" && outOfScopeMapReports > 0 && mapScopeName && <div className="notice map-scope-warning" role="status">
    <span><strong>{withinBoundaryReports.length} inside {mapScopeName} · {outOfScopeMapReports} locations need review.</strong> The saved coordinates do not match the assigned barangay. {showSavedLocations ? "Pins and heat now include these saved locations; they have not been moved." : "Barangay GIS counts these reports by assignment. Inspect their saved locations to check the mismatch."}</span>
    <button type="button" className="secondary" aria-pressed={showSavedLocations} onClick={toggleSavedLocations}>{showSavedLocations ? "Show boundary only" : `Show ${outOfScopeMapReports} saved locations`}</button>
  </div>;
  const overviewReports = invalidDates ? [] : q.data ?? [];
  const overviewStats = [
    { label: "Total records", value: overviewReports.length, Icon: FileText, tone: "blue" },
    { label: "Verified issues", value: overviewReports.filter((report) => !!report.verified_at).length, Icon: BadgeCheck, tone: "green" },
    { label: "Unresolved", value: overviewReports.filter((report) => !!report.verified_at && report.status !== "resolved").length, Icon: CircleAlert, tone: "red" },
    { label: "In progress", value: overviewReports.filter((report) => report.status === "in_progress").length, Icon: Cog, tone: "blue" },
    { label: "Resolved", value: overviewReports.filter((report) => report.status === "resolved").length, Icon: CheckCircle2, tone: "green" },
  ];
  const summaryReports = mode === "barangays" ? (invalidDates ? [] : q.data ?? []) : mapReports;
  const mapSummaryStats = [
    { label: "Total reports", value: summaryReports.length, Icon: FileText, tone: "blue" },
    { label: "Verified", value: summaryReports.filter((report) => !!report.verified_at).length, Icon: BadgeCheck, tone: "green" },
    { label: "Unresolved", value: summaryReports.filter((report) => !!report.verified_at && report.status !== "resolved").length, Icon: CircleAlert, tone: "red" },
    { label: "In progress", value: summaryReports.filter((report) => report.status === "in_progress").length, Icon: Cog, tone: "blue" },
  ];
  const organizationScope = access.organizations.map((item) => item.name).join(" · ") || "Authorized areas";
  const authorizedArea = access.profile.role === "admin"
    ? "Iligan City · all barangays"
    : access.profile.role === "barangay"
      ? refs.barangays.find((item) => item.id === access.profile.barangay_id)?.name || "Assigned barangay"
      : organizationScope;
  const coverageLabel = mapScopeFeature
    ? `${mapScopeName} · ${access.profile.role === "barangay" ? "assigned" : "selected"} barangay`
    : access.profile.role === "admin"
      ? "Iligan City · all barangays"
      : access.organizations.length ? `${organizationScope} · authorized areas` : "Authorized areas";
  const backgroundControls = <div className={`overview-map-base segmented${mode === "barangays" ? " gis-map-background" : ""}`} role="group" aria-label="Map background">
    {(["map", "terrain", "satellite"] as const).map((value) => <button type="button" key={value} aria-pressed={base === value} className={base === value ? "active" : ""} onClick={() => setBase(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
  </div>;
  const gisMapControls = <div className="gis-background-picker">{backgroundControls}<div className="map-gis-caption" role="status">{gis.isPending ? "Loading barangay counts…" : gis.error ? "Barangay counts unavailable" : "Colors and labels: report totals"}</div></div>;
  return (
    <div className={`issue-map${compact ? " compact" : ""}${overview ? " overview-map" : ""}`}>
      {!overview && <div className="dashboard-brief overview-scope map-authorized-area">
        <div className="overview-scope-copy"><span className="overview-scope-icon"><ShieldCheck size={17} aria-hidden="true" /></span><strong>Authorized area</strong><span className="overview-scope-divider" aria-hidden="true" /><span>You are viewing records within your assigned scope: <b>{authorizedArea}</b></span></div>
        <button className="text-button overview-updated" type="button" disabled={manualRefreshing || invalidDates} aria-busy={manualRefreshing} onClick={() => void refreshGeographicData()} aria-label={manualRefreshing ? "Refreshing geographic data" : "Refresh geographic data"}>
          <RefreshCw size={14} className={manualRefreshing ? "refreshing" : ""} aria-hidden="true" />
        {manualRefreshing ? "Refreshing…" : "Refresh data"}
        </button>
      </div>}
      <div className="overview-map-tools">
        <section className="overview-map-coverage">
          <span className="overview-map-tool-icon"><MapPin size={19} aria-hidden="true" /></span>
          {canChangeBarangay ? <label className="map-coverage-picker"><strong>Your geographic coverage</strong>
            <select aria-label="Barangay coverage" value={mapScopeId || ""} onChange={(event) => selectBarangay(event.target.value)}>
              <option value="">All permitted barangays</option>
              {refs.barangays.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label> : <span><strong>Your geographic coverage</strong><small>{coverageLabel}</small></span>}
        </section>
        <form className="overview-map-filter" onSubmit={(event) => {
          event.preventDefault();
          const dateValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
          let start = "", end = "";
          if (overviewDateRange === "custom") { start = overviewSince; end = overviewUntil; }
          if (overviewDateRange === "30" || overviewDateRange === "90") {
            const today = new Date(); end = dateValue(today);
            today.setDate(today.getDate() - Number(overviewDateRange) + 1); start = dateValue(today);
          }
          setCategory(overviewCategory); setState(overviewState); setSince(start); setUntil(end);
        }}>
          <strong><SlidersHorizontal size={15} aria-hidden="true" />Filter geographic data</strong>
          <div className="overview-map-filter-fields">
            <label>Category<select value={overviewCategory} onChange={(event) => setOverviewCategory(event.target.value)}><option value="">All categories</option>{refs.categories.map((item) => <option key={item.id} value={item.id}>{reportCategoryPresentation(item.name).label}</option>)}</select></label>
            <label>Status<select value={overviewState} onChange={(event) => setOverviewState(event.target.value)}><option value="">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></label>
            <label>Date range<select value={overviewDateRange} onChange={(event) => setOverviewDateRange(event.target.value)}><option value="all">All time</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="custom">Custom dates</option></select></label>
            <button type="submit"><SlidersHorizontal size={14} aria-hidden="true" />Apply filters</button>
          </div>
          {overviewDateRange === "custom" && <div className="overview-map-custom-dates"><label>From<input type="date" value={overviewSince} max={overviewUntil || undefined} onChange={(event) => setOverviewSince(event.target.value)} /></label><label>Through<input type="date" value={overviewUntil} min={overviewSince || undefined} onChange={(event) => setOverviewUntil(event.target.value)} /></label></div>}
        </form>
      </div>
      {overview ? <>
        <div className="overview-map-view-tabs" role="group" aria-label="Geographic view">
          {(["map", "barangays", "list"] as const).map((value) => <button type="button" key={value} aria-pressed={mode === value} className={mode === value ? "active" : ""} onClick={() => setMode(value)}>{value === "map" ? "Issue map" : value === "barangays" ? "Barangay GIS" : "Report list"}</button>)}
        </div>
      </> : <>
      <div className="map-page-toolbar">
        {!hideReportList && <div className="overview-map-view-tabs" role="group" aria-label="Geographic view">
          {(["map", "barangays"] as const).map((value) => <button type="button" key={value} aria-pressed={mode === value} className={mode === value ? "active" : ""} onClick={() => setMode(value)}>{value === "map" ? "Issue map" : "Barangay GIS"}</button>)}
        </div>}
        <span className="map-page-result-count" role="status">
          {invalidDates ? "Check the date range" : mode === "barangays" ? gis.isPending ? "Loading barangay counts…" : `${Object.values(reportCountsByBarangay).reduce((sum, count) => sum + count, 0)} permitted reports · totals by assigned barangay` : q.isFetching ? "Loading reports…" : `${mapReports.length} ${showSavedLocations ? "saved locations" : "mapped reports"}${outOfScopeMapReports ? ` · ${outOfScopeMapReports} need location review` : ""}`}
        </span>
        <div className="map-page-actions">
          <button type="button" className="secondary" onClick={() => {
            if (canChangeBarangay && mapScopeId) { selectBarangay(""); return; }
            map.current?.fitBounds(
            mapScopeFeature
              ? boundsForBoundary(mapScopeFeature)
              : [[ILIGAN_MAP_BOUNDS.southWest.longitude, ILIGAN_MAP_BOUNDS.southWest.latitude], [ILIGAN_MAP_BOUNDS.northEast.longitude, ILIGAN_MAP_BOUNDS.northEast.latitude]],
            { padding: mapScopeFeature ? (compact ? 32 : 52) : 28, maxZoom: mapScopeFeature ? 14 : undefined, duration: 360 },
          ); }}>Reset map</button>
          {mode === "map" && <button type="button" className="secondary" disabled={!mapReports.length} onClick={() => {
            const resultBounds = new maplibregl.LngLatBounds();
            mapReports.forEach((report) => resultBounds.extend([report.longitude, report.latitude]));
            map.current?.fitBounds(resultBounds, { padding: 45, maxZoom: 16, duration: 360 });
          }}>Fit results</button>}
        </div>
      </div>
      </>}
      {invalidDates && <p className="error" role="alert">The end date must be on or after the start date.</p>}
      {(q.error || (mode === "barangays" && gis.error) || error) && (
        <p role="alert" className="error">
          {q.error?.message || (mode === "barangays" && gis.error?.message) || error}
        </p>
      )}
      {!overview && scopeWarning}
      {q.data?.length === 1000 && <p className="notice" role="status">Pins and the report list are limited to 1,000 matching reports. Narrow the filters for detail. Barangay GIS totals count all permitted matches.</p>}
      {overview ? <div className="overview-map-stage">
        <div ref={container} className={`map${mode === "list" || (mode === "map" && tileError) ? " hidden" : ""}`} aria-label={mode === "barangays" ? "Barangay report count map" : "Iligan issue map"} />
        {mode === "barangays" && gisMapControls}
        {mode === "map" && tileError && <section className="overview-map-failure" role="alert" aria-live="polite">
          <div className="overview-map-failure-copy"><span className="overview-map-failure-icon"><AlertTriangle size={20} aria-hidden="true" /></span><div><strong>Map tiles could not load</strong><p>Check your connection, retry the map, or open the matching reports as a list.</p><div className="overview-map-failure-actions"><button type="button" onClick={() => { setReady(false); setError(""); setTileError(false); setRetryKey((key) => key + 1); }}><RefreshCw size={14} aria-hidden="true" />Retry loading map</button><button type="button" className="secondary" onClick={() => setMode("list")}><List size={14} aria-hidden="true" />Open report list</button></div></div></div>
          <div className="overview-map-failure-art" aria-hidden="true"><MapPin size={26} /><span><i /><i /><i /></span><CircleAlert size={20} /></div>
        </section>}
        {mode === "map" && !tileError && <>
          {backgroundControls}
          <div className="overview-map-layer-switches" aria-label="Map layers">
            {[{ label: "Show pins", value: showMarkers, change: () => setShowMarkers((current) => !current) }, { label: "Heatmap", value: showHeat, change: () => setShowHeat((current) => !current) }, { label: "Barangay boundary", value: showBoundary, change: () => setShowBoundary((current) => !current) }].map((toggle) => <button type="button" key={toggle.label} aria-pressed={toggle.value} onClick={toggle.change}><span className={`overview-switch${toggle.value ? " on" : ""}`} aria-hidden="true"><i /></span>{toggle.label}</button>)}
          </div>
          {showHeat && <div className="overview-map-density" aria-label="Matching reports per 250 meter grid cell">
            <strong>Report density</strong><div>{[["#4e9ed0", "1"], ["#41ae76", "2–3"], ["#f5b840", "4–7"], ["#d64732", "8+"]].map(([color, range]) => <span key={range}><i style={{ background: color }} />{range}</span>)}</div>
          </div>}
        </>}
      </div> : <div className={`map-page-layout${mode === "map" ? " has-side" : ""}`}>
        <div className="map-page-main">
          <div className="overview-map-stage map-page-stage">
            <div ref={container} className={`map${mode === "list" ? " hidden" : ""}`} aria-label={mode === "barangays" ? "Barangay report count map" : "Iligan issue map"} />
            {mode === "barangays" && gisMapControls}
            {mode === "map" && <>
              {backgroundControls}
              {showHeat && <div className="overview-map-density" aria-label="Matching reports per 250 meter grid cell">
                <strong>Report density</strong><div>{[["#4e9ed0", "1"], ["#41ae76", "2–3"], ["#f5b840", "4–7"], ["#d64732", "8+"]].map(([color, range]) => <span key={range}><i style={{ background: color }} />{range}</span>)}</div>
              </div>}
            </>}
          </div>
        </div>
        {mode === "map" && <aside className="map-reference-panel" aria-label="Map summary and controls">
          <section className="map-reference-card map-reference-summary">
            <header><span className="map-reference-icon"><MapPinned size={16} aria-hidden="true" /></span><div><strong>Map summary</strong><small>{mapScopeName || "Iligan City"} · current filters</small></div></header>
            <div className="map-reference-stats">{mapSummaryStats.map(({ label: title, value, Icon, tone }) => <div className="map-reference-stat" key={title}><span className={`map-reference-stat-icon ${tone}`}><Icon size={13} aria-hidden="true" /></span><span><b>{value}</b><small>{title}</small></span></div>)}</div>
          </section>
          <section className="map-reference-card">
            <header><span className="map-reference-icon"><Layers3 size={16} aria-hidden="true" /></span><div><strong>Map layers</strong><small>Show or hide map information</small></div></header>
            <div className="map-reference-layers">
              {[{ label: "Report pins", value: showMarkers, change: () => setShowMarkers((current) => !current) }, { label: "Heatmap layer", value: showHeat, change: () => setShowHeat((current) => !current) }, { label: "Barangay boundary", value: showBoundary, change: () => setShowBoundary((current) => !current) }].map((toggle) => <button type="button" key={toggle.label} aria-pressed={toggle.value} onClick={toggle.change}><span>{toggle.label}</span><span className={`overview-switch${toggle.value ? " on" : ""}`} aria-hidden="true"><i /></span></button>)}
            </div>
          </section>
          <section className="map-reference-card map-reference-insights">
            <header><span className="map-reference-icon"><BarChart3 size={16} aria-hidden="true" /></span><div><strong>Quick insights</strong><small>Based on the reports shown</small></div></header>
            <div className="map-reference-links">
              <button type="button" disabled={!hotspotCells.length} onClick={() => {
                const hotspot = hotspotCells[0];
                if (!hotspot || !map.current) return;
                setShowHeat(true);
                const hotspotBounds = new maplibregl.LngLatBounds();
                hotspot.bounds.forEach(({ longitude, latitude }) => hotspotBounds.extend([longitude, latitude]));
                map.current.fitBounds(hotspotBounds, { padding: 90, maxZoom: 16, duration: 420 });
              }}><Flame size={15} aria-hidden="true" /><span><b>Top hotspot</b><small>{hotspotCells[0] ? `${hotspotCells[0].count} ${hotspotCells[0].count === 1 ? "report" : "reports"} in a 250 m cell` : "No hotspot in this view"}</small></span><ArrowUpRight size={14} aria-hidden="true" /></button>
              <button type="button" disabled={!frequentCategories.length} onClick={() => {
                const frequent = frequentCategories[0];
                if (frequent) { setCategory(frequent.id); setOverviewCategory(frequent.id); }
              }}><Activity size={15} aria-hidden="true" /><span><b>Most reported issue</b><small>{frequentCategories[0] ? `${reportCategoryPresentation(frequentCategories[0].name).label} · ${frequentCategories[0].count} reports` : "No reports in this view"}</small></span><ArrowUpRight size={14} aria-hidden="true" /></button>
            </div>
          </section>
        </aside>}
      </div>}
      {overview && scopeWarning}
      {overview && <div className="overview-map-result-count" role="status">{mode === "barangays"
        ? gis.isFetching ? "Updating barangay counts…" : `${selectedBarangayName || "Authorized area"} · ${selectedBarangayName ? reportCountsByBarangay[barangayMapKey(selectedBarangayName)] ?? 0 : Object.values(reportCountsByBarangay).reduce((sum, count) => sum + count, 0)} assigned reports`
        : q.isFetching ? "Updating reports…" : mode === "list" ? `${q.data?.length ?? 0} matching reports` : `${mapReports.length} ${showSavedLocations ? "saved locations" : "mapped reports"}${outOfScopeMapReports ? ` · ${outOfScopeMapReports} need location review` : ""}`}</div>}
      {mode === "barangays" && (
        <section className="panel barangay-gis-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">CURRENT MAP VIEW · CITY BOUNDARIES</p><h2>Reports by barangay</h2></div>
            <div className="segmented" aria-label="Barangay heat metric">
              <button className={barangayMetric === "count" ? "" : "secondary"} aria-pressed={barangayMetric === "count"} onClick={() => setBarangayMetric("count")}>Report count</button>
              <button className={barangayMetric === "density" ? "" : "secondary"} aria-pressed={barangayMetric === "density"} onClick={() => setBarangayMetric("density")}>Per km²</button>
            </div>
          </div>
          <p className="muted barangay-gis-copy">Colors and totals follow assigned barangays and current filters, independent of zoom. Select an area to see its reports below. Only reports you have permission to view are counted; gray means no matching accessible reports.</p>
          {mapScopeId && <div className="barangay-gis-selection"><span>{canChangeBarangay ? "Selected" : "Assigned"}: <strong>{selectedBarangayName}</strong></span>{canChangeBarangay && <button type="button" className="secondary" onClick={() => selectBarangay("")}>Clear selection</button>}</div>}
          {gis.isPending ? <p className="empty">Loading barangay counts…</p> : gis.error ? <p className="empty">Counts could not load. Try refreshing geographic data.</p> : barangaySummaryRows.length ? <div className="barangay-list">{barangaySummaryRows.map((row) => <button className="bar-row barangay-heat-row" key={row.barangay_id || row.barangay_name} aria-pressed={row.barangay_id === mapScopeId} disabled={!row.barangay_id || (!canChangeBarangay && row.barangay_id !== mapScopeId)} aria-label={`${row.barangay_name}: ${barangayMetric === "density" ? `${row.density.toFixed(1)} reports per square kilometer` : `${row.report_count} reports`}`} onClick={() => { if (row.barangay_id) selectBarangay(row.barangay_id); }}>
              <span className="barangay-heat-name">{row.barangay_name}</span>
              <span className="barangay-heat-track"><span style={{ width: `${row.width}%`, background: row.color }} /></span>
              <strong>{barangayMetric === "density" ? row.density.toFixed(1) : row.report_count}</strong>
            </button>)}</div> : <p className="empty">No barangay data is available for these filters.</p>}
          <div className="map-legend barangay-gis-legend" aria-label={barangayMetric === "density" ? "Relative reports per square kilometer" : "Report count by barangay"}>
            <strong>{barangayMetric === "density" ? "Relative reports per km²" : "Reports per barangay"}</strong>
            {(barangayMetric === "density"
              ? [["#cbd5e1", "0"], ["#34d399", "Lower"], ["#facc15", "Moderate"], ["#f97316", "High"], ["#ef4444", "Highest"]]
              : [["#cbd5e1", "0"], ["#38bdf8", "1–2"], ["#14b8a6", "3–5"], ["#f59e0b", "6–10"], ["#ef4444", "11+"]]).map(([color, range]) => <span className="map-legend-bin" key={range}><i style={{ background: color }} />{range}</span>)}
          </div>
        </section>
      )}
      {(!overview || mode === "list") && !hideReportList && (
        <section className="panel map-report-list">
          <div className="panel-heading">
            <div><p className="eyebrow">{selectedBarangayName ? `REPORTS ASSIGNED TO ${selectedBarangayName.toUpperCase()}` : "REPORTS IN THIS MAP VIEW"}</p><h2 ref={reportListHeading} tabIndex={-1}>{q.data?.length ?? 0} reports</h2></div>
            {selectedBarangayName && <span className="badge">{selectedBarangayName}</span>}
          </div>
          {q.isFetching && !q.data ? <p className="empty">Loading reports…</p> : q.data?.length ? <div className="table-scroll"><table className="reports-table">
            <caption className="sr-only">{selectedBarangayName ? `Reports assigned to ${selectedBarangayName}` : "Reports matching the current geographic view"}</caption>
            <thead><tr><th scope="col">Report</th><th scope="col">Location &amp; category</th><th scope="col">Status</th><th scope="col">Assigned office</th><th scope="col">Received</th></tr></thead>
            <tbody>{listedReports.map((r) => {
              const categoryName = refs.categories.find((item) => item.id === r.category_id)?.name || "Other";
              const locationName = refs.barangays.find((item) => item.id === r.barangay_id)?.name || "Location pending";
              const officeName = refs.organizations.find((item) => item.id === r.organization_id)?.name || "Awaiting assignment";
              return <tr key={r.id}>
                <th scope="row"><button className="report-title" aria-label={`Open report: ${r.title}`} onClick={() => setSelectedId(r.id)}><span>{r.title}</span><ArrowUpRight size={15} aria-hidden="true" /></button>
                  <small className="record-meta">{r.id.slice(0, 8).toUpperCase()}{r.severity && ` · Severity ${r.severity}/5`}</small></th>
                <td data-label="Location"><span className="report-location"><MapPin size={13} aria-hidden="true" /><strong>{locationName}</strong></span>
                  <ReportCategoryLabel name={categoryName} compact className="report-category" /></td>
                <td data-label="Status"><span className={`badge ${r.status}`}>{label(r.status)}</span></td>
                <td data-label="Office">{officeName}</td>
                <td className="report-received" data-label="Received"><time dateTime={r.created_at}>{new Date(r.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" })}</time><button className="report-open" aria-label={`Open report: ${r.title}`} onClick={() => setSelectedId(r.id)}><ArrowUpRight size={15} aria-hidden="true" /></button></td>
              </tr>;
            })}</tbody>
          </table></div> : <p className="empty">No reports match this map view and filter.</p>}
          {!!q.data?.length && q.data.length > 20 && <nav className="map-list-pagination" aria-label="Map report pages">
            <span role="status">Showing {currentReportPage * 20 + 1}–{Math.min((currentReportPage + 1) * 20, q.data.length)} of {q.data.length}</span>
            <div><button type="button" className="secondary" disabled={!currentReportPage || q.isFetching} onClick={() => changeReportPage(currentReportPage - 1)}>Previous</button>
              <span>Page {currentReportPage + 1} of {reportPageCount}</span>
              <button type="button" className="secondary" disabled={currentReportPage + 1 >= reportPageCount || q.isFetching} onClick={() => changeReportPage(currentReportPage + 1)}>Next</button></div>
          </nav>}
        </section>
      )}
      <div className={`map-counts${overview ? " overview-map-stats" : ""}`}>
        {overview ? overviewStats.map(({ label: title, value, Icon, tone }) => <div className="overview-map-stat" key={title}><span className={`overview-map-stat-icon ${tone}`}><Icon size={15} aria-hidden="true" /></span><span><b>{value}</b><small>{title}</small></span></div>) : <>
        <span>
          <b>{mapReports.filter((r) => r.verified_at).length}</b> verified
          issues
        </span>
        <span>
          <b>{mapReports.filter((r) => !r.verified_at).length}</b> unverified
          reports
        </span>
        <span>Each report contributes equally to the heatmap.</span>
        </>}
      </div>
      {overview && mode === "map" && !tileError && <div className="overview-map-category-legend" aria-label="Report types legend">
        <strong>Report types (legend)</strong>{refs.categories.map((item) => <ReportCategoryLabel key={item.id} name={item.name} compact className="map-report-category" />)}
      </div>}
      {overview && mode === "map" && !tileError && <p className="overview-map-note">Markers show reports in your authorized area. Heat cells count matching reports in 250 m grid cells; they show reporting activity, not severity.</p>}
      {overview && mode === "map" && !tileError && <p className="overview-map-attribution">{base === "map" ? "Map data © OpenStreetMap contributors" : base === "terrain" ? "Map data © OpenStreetMap contributors, SRTM · Map style © OpenTopoMap (CC-BY-SA)" : "Satellite imagery © Esri, Vantor, Earthstar Geographics, and the GIS User Community"}</p>}
      {!overview && mode === "map" && showMarkers && <div className="map-legend map-marker-legend" aria-label="Report marker colors by category">
        <strong>Report types:</strong>
        {refs.categories.map((item) => <ReportCategoryLabel key={item.id} name={item.name} compact className="map-report-category map-legend-bin" />)}
      </div>}
      {!overview && mode === "map" && showHeat && <div className="map-legend" aria-label="Reports per 250 meter grid cell">
        <strong>Matching reports in each 250 m cell:</strong>
        {[["#4e9ed0", "1"], ["#41ae76", "2–3"], ["#f5b840", "4–7"], ["#d64732", "8+"]].map(([color, range]) => <span className="map-legend-bin" key={range}><i style={{ background: color }} />{range}</span>)}
        <span>
          Rejected and duplicate records excluded. {" "}
          Includes unverified submissions.
        </span>
      </div>}
      {!hideReportList && q.data?.length === 0 && (
        <p className="empty">No reports match {mode === "barangays" ? "this barangay and filters" : "this viewport and filters"}.</p>
      )}
      {!overview && mode === "map" && showHeat && <p className="fine">Hotspots show submitted reports, not risk or severity. Each report contributes equally; cell counts are based on the current map view and filters.</p>}
      {mode === "barangays" && <p className="fine">Boundary geometry is the same 44-barangay dataset used in the resident map. It is a mapped reference boundary, not a certified legal survey. City totals remain limited to your approved access scope.</p>}
      {selectedId && !selectedReport && <div className="notice" role="status">
        <p>{linkedReport.isPending ? "Opening linked report…" : "This report is unavailable or outside your current access."}</p>
        {linkedReport.error && <button type="button" className="secondary" disabled={linkedReport.isFetching} onClick={() => void linkedReport.refetch()}>Retry linked report</button>}
        <button type="button" className="text-button" onClick={() => setSelectedId("")}>Close linked report</button>
      </div>}
      {selectedId && selectedReport && (
        <ReportDetail
          key={selectedReport.id}
          report={selectedReport}
          refs={refs}
          close={() => setSelectedId("")}
          onOpenLinked={setSelectedId}
        />
      )}
    </div>
  );
}
