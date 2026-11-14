import { useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import Ionicons from "@expo/vector-icons/Ionicons";
import { aggregateReportCells, ILIGAN_MAP_BOUNDS } from "@community/shared";
import { barangayAreaKm2, barangayCenter, barangayDensity, barangayDensityColor, barangayHeatColor, barangayMapKey, iliganBarangayBoundaries } from "../lib/barangay-map";
import { categoryDisplayName, categoryIconFor, categoryToneFor, colors } from "./ui";
import type { MapProps, MapStyle } from "./location-map";

export { ILIGAN_MAP_BOUNDS };
export type { MapBounds, MapProps, MapStyle, Point } from "./location-map";

const tiles: Record<MapStyle, string> = {
  map: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  terrain: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
  satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
};
const credits: Record<MapStyle, string> = {
  map: "© OpenStreetMap contributors",
  terrain: "© OpenStreetMap contributors, SRTM | OpenTopoMap",
  satellite: "Tiles © Esri",
};

const pinGlyphs: Record<string, string> = {
  "bulb-outline": '<path d="M9 18h6m-5 4h4M9 14c-.3-1.2-.8-1.8-1.7-2.7A6 6 0 1 1 16.7 11c-.9.9-1.4 1.5-1.7 3H9Z"/>',
  "navigate-outline": '<path d="M12 21v-8M12 6V3M6 6h12l4 3.5L18 13H6L2 9.5 6 6Z"/>',
  "car-outline": '<path d="M5 10 7 6h10l2 4M4 10h16v8H4zM7 18v2m10-2v2M7 14h.01M17 14h.01"/>',
  "water-outline": '<path d="M12 2c-2.5 5-7 8-7 13a7 7 0 0 0 14 0c0-5-4.5-8-7-13Z"/>',
  "trash-outline": '<path d="M4 6h16M9 6V4h6v2m3 0-1 15H7L6 6m4 4v7m4-7v7"/>',
  "flash-outline": '<path d="M13 2 4 14h7l-1 8 10-12h-7l1-8Z"/>',
  "alert-circle-outline": '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
};
const pinCss = ".report-pin{position:relative;width:44px;height:52px;filter:drop-shadow(0 2px 3px #10263f99)} .report-pin__body{position:absolute;left:4px;top:0;width:36px;height:48px} .report-pin__glyph{position:absolute;left:13px;top:10px;width:18px;height:18px;fill:none;stroke:white;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}";
const MAP_GESTURE_THRESHOLD = 12;

function mapHtml(data: Record<string, unknown>) {
  const payload = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><style>html,body,#map{height:100%;margin:0;background:#e8f1ee} .leaflet-container{font:12px system-ui,sans-serif} ${pinCss} .count{min-width:28px;height:28px;padding:0 3px;border:2px solid white;border-radius:15px;box-shadow:0 2px 7px #10263f66;display:grid;place-items:center;color:white;font-weight:800} #error{display:none;position:absolute;inset:0;align-items:center;justify-content:center;text-align:center;padding:28px;color:#173b3a;background:#e8f1ee;z-index:999}</style></head><body><div id="map"></div><div id="error">Map tiles could not load. Check your connection and try again.</div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" onerror="document.getElementById('error').style.display='flex'"></script><script>
const d=${payload}; const send=(type,detail={})=>window.ReactNativeWebView.postMessage(JSON.stringify({type,...detail}));
if(window.L){
const map=L.map('map',{zoomControl:false,attributionControl:true,maxZoom:19}).setView([d.center.latitude,d.center.longitude],d.zoom);
L.tileLayer(d.tile,{maxZoom:19,attribution:d.credit}).addTo(map);
if(d.boundaries){d.boundaries.forEach(b=>{const shape=L.polygon(b.rings,{color:b.selected?'#083f75':b.count?'#fff':'#e2e8f0',weight:b.selected?3:1.5,fillColor:b.fill,fillOpacity:b.count?.65:.2});shape.addTo(map);shape.on('click',e=>{L.DomEvent.stopPropagation(e);send('barangay',{name:b.name})});});}
if(d.cells){d.cells.forEach(c=>{const shape=L.polygon(c.rings,{color:c.color,weight:1,fillColor:c.color,fillOpacity:.35});shape.addTo(map);shape.on('click',e=>{L.DomEvent.stopPropagation(e);send('cell',{count:c.count})});});}
const pinHtml=(color,glyph)=>'<div class="report-pin"><svg class="report-pin__body" viewBox="0 0 36 48" aria-hidden="true"><path d="M18 1.5C8.9 1.5 1.5 8.9 1.5 18c0 12.3 16.5 28.5 16.5 28.5S34.5 30.3 34.5 18C34.5 8.9 27.1 1.5 18 1.5Z" fill="'+(/^#[0-9a-fA-F]{3,8}$/.test(color)?color:'#08756b')+'" stroke="white" stroke-width="2.5"/></svg><svg class="report-pin__glyph" viewBox="0 0 24 24" aria-hidden="true">'+glyph+'</svg></div>';
const draw=()=>{if(window.reportLayer)window.reportLayer.forEach(m=>map.removeLayer(m));window.reportLayer=[];const add=(lat,lng,color,label,kind,id,glyph,title)=>{const report=kind==='report',html=report?pinHtml(color,glyph):'<div class="count" style="background:'+color+'">'+label+'</div>';const m=L.marker([lat,lng],{title:title||'',icon:L.divIcon({html,className:'',iconSize:report?[44,52]:[36,36],iconAnchor:report?[22,47]:[18,18]})}).addTo(map);m.on('click',e=>{L.DomEvent.stopPropagation(e);if(kind==='group')map.setView([lat,lng],Math.min(16,map.getZoom()+2));else send(kind,{id})});window.reportLayer.push(m)};
if(d.showPoints){if(d.gis&&map.getZoom()<12){d.totals.forEach(t=>add(t.latitude,t.longitude,d.summaryColor,String(t.count),'barangay',t.name));}else if(d.gis&&map.getZoom()<15){d.groups.forEach(g=>add(g.latitude,g.longitude,g.color,String(g.count),'group',g.id));}else{d.points.forEach(p=>add(p.latitude,p.longitude,p.color,'','report',p.id,p.glyph,p.title));}}};
draw();map.on('zoomend',draw);
if(d.point)L.marker([d.point.latitude,d.point.longitude],{icon:L.divIcon({html:pinHtml('#08756b','<path d="m5 12 4 4L19 6"/>'),className:'',iconSize:[44,52],iconAnchor:[22,47]})}).addTo(map);
if(d.userPoint)L.circleMarker([d.userPoint.latitude,d.userPoint.longitude],{radius:8,color:'#fff',weight:3,fillColor:'#1687d8',fillOpacity:1}).addTo(map);
map.on('click',e=>{if(d.canChoose)send('choose',{latitude:e.latlng.lat,longitude:e.latlng.lng});else send('background')});
map.on('moveend',()=>{const c=map.getCenter(),b=map.getBounds();send('viewport',{latitude:c.lat,longitude:c.lng,latitudeDelta:b.getNorth()-b.getSouth(),longitudeDelta:b.getEast()-b.getWest()})});
if(d.pageScroll){const container=map.getContainer();let axis='pending',startX=0,startY=0,lastY=0,pending=0,frame=0;const flush=()=>{frame=0;if(pending){send('pageScroll',{delta:pending});pending=0}};const finish=()=>{if(axis!=='page')return;if(frame)cancelAnimationFrame(frame);flush();send('pageScrollEnd');map.dragging.enable();axis='pending'};container.addEventListener('touchstart',e=>{if(e.touches.length!==1){finish();axis='map';return}const t=e.touches[0];axis='pending';startX=t.clientX;startY=lastY=t.clientY},{capture:true,passive:true});container.addEventListener('touchmove',e=>{if(e.touches.length!==1){finish();axis='map';return}const t=e.touches[0];if(axis==='pending'){const dx=Math.abs(t.clientX-startX),dy=Math.abs(t.clientY-startY);if(Math.max(dx,dy)<12)return;axis=dx>dy*1.15?'map':'page';if(axis==='page'){map.dragging.disable();send('pageScrollStart')}}if(axis==='page'){e.preventDefault();e.stopImmediatePropagation();pending+=lastY-t.clientY;lastY=t.clientY;if(!frame)frame=requestAnimationFrame(flush)}},{capture:true,passive:false});const end=e=>{if(e.touches.length)return;finish();axis='pending'};container.addEventListener('touchend',end,{capture:true,passive:true});container.addEventListener('touchcancel',end,{capture:true,passive:true})}
window.mapCommand=(action,detail)=>{if(action==='zoom')map.zoomIn(detail);if(action==='center')map.setView([detail.latitude,detail.longitude],detail.zoom||15);};
send('ready');}
</script></body></html>`;
}

export default function LocationMap({ point, points = [], onChoose, onPointPress, onDensityCellPress, onLocate, locating, userPoint, density, showPoints = true, height = 300, onExpand, onGestureActiveChange, onPageScroll, mapStyle, onMapStyleChange, initialRegion, onViewportChange, zoomBehavior = "issue-map", showBarangayBoundaries, barangayCounts = {}, onBarangayPress, onMapBackgroundPress, selectedBarangayName, barangayMetric = "density", summaryColor = colors.brand }: MapProps) {
  const web = useRef<WebView>(null);
  const gestureStart = useRef({ x: 0, y: 0 });
  const gestureAxis = useRef<"pending" | "page" | "map">("pending");
  const gestureLocked = useRef(false);
  const initialViewport = useRef(initialRegion || { latitude: 8.228, longitude: 124.2452, latitudeDelta: 0.12, longitudeDelta: 0.12 });
  const latestViewport = useRef(initialViewport.current);
  const [style, setStyle] = useState<MapStyle>(mapStyle || "satellite");
  const [failed, setFailed] = useState(false);
  const base = mapStyle || style;
  const region = initialViewport.current;
  const maxDensity = Math.max(0, ...iliganBarangayBoundaries.map(b => barangayDensity(barangayCounts[barangayMapKey(b.properties.adm4_en)] || 0, barangayAreaKm2(b))));
  const validPoints = points.filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180);
  const boundaries = showBarangayBoundaries ? iliganBarangayBoundaries.map(b => {
    const name = b.properties.adm4_en, count = barangayCounts[barangayMapKey(name)] || 0;
    return { name, count, selected: selectedBarangayName === name, fill: barangayMetric === "density" ? barangayDensityColor(barangayDensity(count, barangayAreaKm2(b)), maxDensity) : barangayHeatColor(count), rings: b.geometry.coordinates[0].map(([lng, lat]) => [lat, lng]) };
  }) : [];
  const totals = iliganBarangayBoundaries.flatMap(b => { const count = barangayCounts[barangayMapKey(b.properties.adm4_en)] || 0; const center = count && barangayCenter(b); return center ? [{ ...center, name: b.properties.adm4_en, count }] : []; });
  const groups = Object.values(validPoints.reduce<Record<string, { id: string; latitude: number; longitude: number; color: string; count: number }>>((acc, p) => {
    const key = `${p.categoryName || "Report"}:${Math.round(p.latitude * 60)}:${Math.round(p.longitude * 60)}`;
    const row = acc[key] || { id: key, latitude: 0, longitude: 0, color: p.color || summaryColor, count: 0 };
    row.count++; row.latitude += (p.latitude - row.latitude) / row.count; row.longitude += (p.longitude - row.longitude) / row.count; acc[key] = row; return acc;
  }, {}));
  const cells = density && zoomBehavior === "issue-map" ? aggregateReportCells(validPoints).map(cell => ({ count: cell.count, color: cell.color, rings: cell.bounds.map(p => [p.latitude, p.longitude]) })) : [];
  const data = { center: point || region, zoom: point ? 16 : Math.max(9, Math.min(18, Math.round(Math.log2(360 / Math.max(region.longitudeDelta, .002))))), tile: tiles[base], credit: credits[base], points: validPoints.map(p => ({ id: p.id, latitude: p.latitude, longitude: p.longitude, color: p.color || categoryToneFor(p.categoryName || "").foreground, glyph: pinGlyphs[categoryIconFor(p.categoryName || "")] || pinGlyphs["alert-circle-outline"], title: `${categoryDisplayName(p.categoryName || "Community report")}: ${p.title || "Reported issue"}` })), point, userPoint, canChoose: !!onChoose, pageScroll: !!onPageScroll, showPoints, gis: zoomBehavior === "barangay-gis", totals, groups, boundaries, cells, summaryColor };
  const html = useMemo(() => mapHtml(data), [JSON.stringify(data)]);
  const source = useMemo(() => ({ html, baseUrl: "https://iliganconnect.local/" }), [html]);
  const lockMapGesture = () => {
    if (gestureLocked.current) return;
    gestureLocked.current = true;
    gestureAxis.current = "map";
    onGestureActiveChange?.(true);
  };
  const startMapTouch = (event: { nativeEvent: { pageX: number; pageY: number; touches?: unknown[] } }) => {
    gestureLocked.current = false;
    gestureAxis.current = "pending";
    gestureStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
    onGestureActiveChange?.(false);
    if ((event.nativeEvent.touches?.length ?? 0) > 1) lockMapGesture();
  };
  const moveMapTouch = (event: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (gestureAxis.current !== "pending") return;
    const dx = Math.abs(event.nativeEvent.pageX - gestureStart.current.x);
    const dy = Math.abs(event.nativeEvent.pageY - gestureStart.current.y);
    if (Math.max(dx, dy) < MAP_GESTURE_THRESHOLD) return;
    if (dy > dx * 1.15) {
      gestureAxis.current = "page";
      return;
    }
    if (dx > dy * 1.15) lockMapGesture();
    else gestureAxis.current = "page";
  };
  const endMapTouch = (event?: { nativeEvent?: { touches?: unknown[] } }) => {
    if ((event?.nativeEvent?.touches?.length ?? 0) > 0) return;
    if (gestureLocked.current) onGestureActiveChange?.(false);
    gestureLocked.current = false;
    gestureAxis.current = "pending";
  };
  const startPageScroll = () => {
    if (gestureLocked.current) onGestureActiveChange?.(false);
    gestureLocked.current = false;
    gestureAxis.current = "page";
  };
  const send = (action: string, detail?: unknown) => web.current?.injectJavaScript(`window.mapCommand&&window.mapCommand(${JSON.stringify(action)},${JSON.stringify(detail ?? null)});true;`);
  const onMessage = (event: WebViewMessageEvent) => { try { const message = JSON.parse(event.nativeEvent.data); if (message.type === "choose") onChoose?.({ latitude: message.latitude, longitude: message.longitude }); if (message.type === "report") { const p = validPoints.find(x => x.id === message.id); if (p) onPointPress?.(p); } if (message.type === "barangay") onBarangayPress?.(message.name); if (message.type === "background") onMapBackgroundPress?.(); if (message.type === "cell") onDensityCellPress?.(message.count); if (message.type === "viewport") { latestViewport.current = message; onViewportChange?.(message); } if (message.type === "pageScrollStart") startPageScroll(); if (message.type === "pageScroll") onPageScroll?.(Number(message.delta) || 0); if (message.type === "pageScrollEnd") endMapTouch(); } catch { /* Ignore malformed map messages. */ } };
  return <View style={{ height, borderRadius: 18, overflow: "hidden", backgroundColor: "#e8f1ee" }}>
    <WebView ref={web} source={source} originWhitelist={["*"]} javaScriptEnabled nestedScrollEnabled scrollEnabled={false} onTouchStart={startMapTouch} onTouchMove={moveMapTouch} onTouchEnd={endMapTouch} onTouchCancel={endMapTouch} onMessage={onMessage} onError={() => setFailed(true)} style={{ flex: 1 }} />
    {failed && <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: "#e8f1ee" }}><Text style={{ color: colors.brandDark, textAlign: "center" }}>Map could not load. Check your connection and reopen this screen.</Text></View>}
    <View style={{ position: "absolute", top: 12, left: 12, borderRadius: 12, backgroundColor: "white", padding: 4, flexDirection: "row", gap: 2 }}>
      {(["map", "terrain", "satellite"] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: base === value }} onPress={() => { initialViewport.current = latestViewport.current; setStyle(value); onMapStyleChange?.(value); }} style={{ minHeight: 44, minWidth: 48, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: base === value ? colors.brand : "white" }}><Text style={{ fontSize: 11, color: base === value ? "white" : colors.brandDark, fontWeight: "700" }}>{value === "map" ? "Map" : value === "terrain" ? "Terrain" : "Satellite"}</Text></Pressable>)}
    </View>
    <View style={{ position: "absolute", top: 64, right: 12, gap: 7 }}>{([
      { icon: "add", action: () => send("zoom", 1), label: "Zoom in" },
      { icon: "remove", action: () => send("zoom", -1), label: "Zoom out" },
      { icon: "locate-outline", action: userPoint ? () => send("center", { ...userPoint, zoom: 15 }) : onLocate || (() => send("center", { ...region, zoom: 13 })), label: "Find my location" },
      ...(onExpand ? [{ icon: "expand-outline", action: onExpand, label: "Expand map" }] : []),
    ]).map(({ icon, action, label }) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} disabled={label === "Find my location" && locating} onPress={action} style={{ width: 48, height: 48, backgroundColor: "white", borderRadius: 13, alignItems: "center", justifyContent: "center" }}><Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={21} color={colors.brandDark} /></Pressable>)}</View>
    {point && <View pointerEvents="none" style={{ position: "absolute", bottom: 12, left: 12, right: 12, alignItems: "center" }}><Text style={{ backgroundColor: "white", color: colors.brandDark, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, fontSize: 11 }}>Pinned location · {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</Text></View>}
  </View>;
}
