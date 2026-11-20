"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapPin } from "lucide-react";
import { barangayMapKey, iliganBarangayBoundaries } from "../../app/lib/barangay-map";
import type { References } from "./workspace";
import { pointInPolygon } from "../lib/map-geometry";

export type WalkInPin = { latitude: number; longitude: number } | null;

export function WalkInLocationMap({ barangayId, barangays, value, onChange }: {
  barangayId: string;
  barangays: References["barangays"];
  value: WalkInPin;
  onChange: (pin: WalkInPin) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<MapLibreMarker | null>(null);
  const maplibre = useRef<typeof import("maplibre-gl") | null>(null);
  const latestChange = useRef(onChange);
  const [ready, setReady] = useState(false);
  const [pinError, setPinError] = useState("");
  const [mapError, setMapError] = useState("");
  const [mapAttempt, setMapAttempt] = useState(0);
  latestChange.current = onChange;
  const barangay = barangays.find((item) => item.id === barangayId);
  const boundary = useMemo(() => barangay
    ? iliganBarangayBoundaries.find((feature) => barangayMapKey(feature.properties.adm4_en) === barangayMapKey(barangay.name)) ?? null
    : null, [barangay]);

  useEffect(() => {
    if (!container.current || !boundary) return;
    const activeBoundary = boundary;
    let disposed = false;
    let instance: MapLibreMap | null = null;
    let resizeObserver: ResizeObserver | null = null;
    setReady(false);
    setMapError("");
    const element = container.current;

    function initialize(maplibregl: typeof import("maplibre-gl")) {
      if (disposed || instance || !element) return;
      const { width, height } = element.getBoundingClientRect();
      if (width < 1 || height < 1) return;

      // Use the same static worker bundle as the main GIS map. This also works
      // when the dialog mounts before it becomes visible.
      maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      maplibre.current = maplibregl;
      const mapInstance = new maplibregl.Map({
        container: element,
        center: [124.2452, 8.228],
        zoom: 13,
        minZoom: 10,
        maxZoom: 19,
        fadeDuration: 0,
        style: {
          version: 8,
          sources: { osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          } },
          layers: [{ id: "osm", type: "raster", source: "osm" }],
        },
      });
      instance = mapInstance;
      map.current = mapInstance;
      const mapBoundary = activeBoundary as never;
      mapInstance.on("load", () => {
        if (disposed) return;
        mapInstance.addSource("walk-in-barangay", { type: "geojson", data: mapBoundary });
        mapInstance.addLayer({ id: "walk-in-boundary-fill", type: "fill", source: "walk-in-barangay", paint: { "fill-color": "#087f78", "fill-opacity": 0.12 } });
        mapInstance.addLayer({ id: "walk-in-boundary-line", type: "line", source: "walk-in-barangay", paint: { "line-color": "#087f78", "line-width": 2.5, "line-opacity": 0.9 } });
        const bounds = new maplibregl.LngLatBounds();
        for (const ring of activeBoundary.geometry.coordinates) for (const coordinate of ring) bounds.extend(coordinate as [number, number]);
        mapInstance.fitBounds(bounds, { padding: 42, maxZoom: 15.5, duration: 0 });
        mapInstance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        mapInstance.on("click", (event) => {
          const point: [number, number] = [event.lngLat.lng, event.lngLat.lat];
          if (!pointInPolygon(point, activeBoundary.geometry)) {
            setPinError(`Pin the reported location inside ${barangay?.name || "this barangay"}.`);
            return;
          }
          setPinError("");
          latestChange.current({ latitude: point[1], longitude: point[0] });
        });
        setReady(true);
        mapInstance.resize();
      });
      mapInstance.on("error", (event) => {
        if (disposed) return;
        console.error("Walk-in location map failed to load:", event.error);
        setMapError("Map tiles could not load. Check the connection and retry.");
      });
    }

    void import("maplibre-gl").then((maplibregl) => {
      if (disposed) return;
      resizeObserver = new ResizeObserver(() => {
        if (instance) instance.resize();
        else initialize(maplibregl);
      });
      resizeObserver.observe(element);
      initialize(maplibregl);
    }).catch((cause: unknown) => {
      if (!disposed) {
        console.error("Walk-in location map could not start:", cause);
        setMapError("The map could not start. Retry to load the location picker.");
      }
    });
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      marker.current?.remove();
      marker.current = null;
      instance?.remove();
      if (map.current === instance) map.current = null;
      if (maplibre.current) maplibre.current = null;
    };
    // The map is intentionally recreated only when the jurisdiction changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundary, barangay?.name, mapAttempt]);

  useEffect(() => {
    marker.current?.remove();
    marker.current = ready && value && map.current && maplibre.current
      ? new maplibre.current.Marker({ color: "#087f78", scale: 0.9 })
        .setLngLat([value.longitude, value.latitude]).addTo(map.current)
      : null;
  }, [ready, value?.latitude, value?.longitude]);

  return <div className="walk-in-map-field">
    <div className="walk-in-map-heading"><div><strong>Pinpoint the reported location <span aria-hidden="true">*</span></strong><small>Click inside the outlined {barangay?.name || "barangay"} boundary. This pin is required.</small></div>
      {value && <button type="button" className="text-button" onClick={() => { setPinError(""); latestChange.current(null); }}>Clear pin</button>}
    </div>
    {boundary ? <div className="walk-in-map-canvas-wrap"><div ref={container} className="walk-in-map-canvas" role="region" aria-label={`Map of ${barangay?.name || "the assigned barangay"}. Click to pinpoint the report location.`} />
      {!ready && <div className="walk-in-map-loading" role="status">Loading barangay map…</div>}
      {mapError && <div className="walk-in-map-error" role="alert"><span>{mapError}</span><button type="button" onClick={() => setMapAttempt((attempt) => attempt + 1)}>Retry map</button></div>}
      <span className="walk-in-map-badge"><MapPin size={13} aria-hidden="true" />{value ? "Location pinned" : "Select a location"}</span>
    </div> : <p className="walk-in-map-unavailable" role="alert">A mapped boundary is unavailable for this barangay, so a walk-in report cannot be pinned here yet.</p>}
    {pinError && <p className="walk-in-field-error" role="alert">{pinError}</p>}
    {value && <p className="walk-in-map-coordinates">Pinned at {value.latitude.toFixed(6)}, {value.longitude.toFixed(6)}</p>}
  </div>;
}
