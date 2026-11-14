import { useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import Ionicons from "@expo/vector-icons/Ionicons";
import { aggregateReportCells, ILIGAN_MAP_BOUNDS } from "@community/shared";
import { barangayAreaKm2, barangayCenter, barangayDensity, barangayDensityColor, barangayHeatColor, barangayMapKey, iliganBarangayBoundaries } from "../lib/barangay-map";
import { colors } from "./ui";
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

function mapHtml(data: Record<string, unknown>) {
  const payload = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><style>html,body,#map{height:100%;margin:0;background:#e8f1ee} .leaflet-container{font:12px system-ui,sans-serif} .pin{width:25px;height:25px;border:2px solid white;border-radius:50%;box-shadow:0 2px 7px #10263f66;display:grid;place-items:center;color:white;font-weight:800} .count{min-width:28px;height:28px;padding:0 3px;border:2px solid white;border-radius:15px;box-shadow:0 2px 7px #10263f66;display:grid;place-items:center;color:white;font-weight:800} #error{display:none;position:absolute;inset:0;align-items:center;justify-content:center;text-align:center;padding:28px;color:#173b3a;background:#e8f1ee;z-index:999}</style></head><body><div id="map"></div><div id="error">Map tiles could not load. Check your connection and try again.</div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" onerror="document.getElementById('error').style.display='flex'"></script><script>
const d=${payload}; const send=(type,detail={})=>window.ReactNativeWebView.postMessage(JSON.stringify({type,...detail}));
if(window.L){
const map=L.map('map',{zoomControl:false,attributionControl:true,maxZoom:19}).setView([d.center.latitude,d.center.longitude],d.zoom);
L.tileLayer(d.tile,{maxZoom:19,attribution:d.credit}).addTo(map);
if(d.boundaries){d.boundaries.forEach(b=>{const shape=L.polygon(b.rings,{color:b.selected?'#083f75':b.count?'#fff':'#e2e8f0',weight:b.selected?3:1.5,fillColor:b.fill,fillOpacity:b.count?.65:.2});shape.addTo(map);shape.on('click',e=>{L.DomEvent.stopPropagation(e);send('barangay',{name:b.name})});});}
if(d.cells){d.cells.forEach(c=>{const shape=L.polygon(c.rings,{color:c.color,weight:1,fillColor:c.color,fillOpacity:.35});shape.addTo(map);shape.on('click',e=>{L.DomEvent.stopPropagation(e);send('cell',{count:c.count})});});}
const marker=(lat,lng,color,label,kind,id)=>{const html='<div class="'+(kind==='report'?'pin':'count')+'" style="background:'+color+'">'+label+'</div>';const m=L.marker([lat,lng],{icon:L.divIcon({html,className:'',iconSize:[32,32],iconAnchor:[16,16]})}).addTo(map);m.on('click',e=>{L.DomEvent.stopPropagation(e);send(kind,{id})});};
const draw=()=>{if(window.reportLayer)window.reportLayer.forEach(m=>map.removeLayer(m));window.reportLayer=[];const add=(lat,lng,color,label,kind,id)=>{const html='<div class="'+(kind==='report'?'pin':'count')+'" style="background:'+color+'">'+label+'</div>';const m=L.marker([lat,lng],{icon:L.divIcon({html,className:'',iconSize:[36,36],iconAnchor:[18,18]})}).addTo(map);m.on('click',e=>{L.DomEvent.stopPropagation(e);if(kind==='group')map.setView([lat,lng],Math.min(16,map.getZoom()+2));else send(kind,{id})});window.reportLayer.push(m)};
if(d.showPoints){if(d.gis&&map.getZoom()<12){d.totals.forEach(t=>add(t.latitude,t.longitude,d.summaryColor,String(t.count),'barangay',t.name));}else if(d.gis&&map.getZoom()<15){d.groups.forEach(g=>add(g.latitude,g.longitude,g.color,String(g.count),'group',g.id));}else{d.points.forEach(p=>add(p.latitude,p.longitude,p.color||'#08756b','•','report',p.id));}}};
draw();map.on('zoomend',draw);
if(d.point)marker(d.point.latitude,d.point.longitude,'#08756b','●','chosen','');
if(d.userPoint)L.circleMarker([d.userPoint.latitude,d.userPoint.longitude],{radius:8,color:'#fff',weight:3,fillColor:'#1687d8',fillOpacity:1}).addTo(map);
map.on('click',e=>{if(d.canChoose)send('choose',{latitude:e.latlng.lat,longitude:e.latlng.lng});else send('background')});
map.on('moveend',()=>{const c=map.getCenter(),b=map.getBounds();send('viewport',{latitude:c.lat,longitude:c.lng,latitudeDelta:b.getNorth()-b.getSouth(),longitudeDelta:b.getEast()-b.getWest()})});
window.mapCommand=(action,detail)=>{if(action==='zoom')map.zoomIn(detail);if(action==='center')map.setView([detail.latitude,detail.longitude],detail.zoom||15);};
send('ready');}
</script></body></html>`;
}

export default function LocationMap({ point, points = [], onChoose, onPointPress, onDensityCellPress, onLocate, locating, userPoint, density, showPoints = true, height = 300, onExpand, mapStyle, onMapStyleChange, initialRegion, onViewportChange, zoomBehavior = "issue-map", showBarangayBoundaries, barangayCounts = {}, onBarangayPress, onMapBackgroundPress, selectedBarangayName, barangayMetric = "density", summaryColor = colors.brand }: MapProps) {
  const web = useRef<WebView>(null);
  const [style, setStyle] = useState<MapStyle>(mapStyle || "satellite");
  const [failed, setFailed] = useState(false);
  const base = mapStyle || style;
  const region = initialRegion || { latitude: 8.228, longitude: 124.2452, latitudeDelta: 0.12, longitudeDelta: 0.12 };
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
  const data = { center: point || region, zoom: point ? 16 : Math.max(9, Math.min(18, Math.round(Math.log2(360 / Math.max(region.longitudeDelta, .002))))), tile: tiles[base], credit: credits[base], points: validPoints.map(p => ({ id: p.id, latitude: p.latitude, longitude: p.longitude, color: p.color })), point, userPoint, canChoose: !!onChoose, showPoints, gis: zoomBehavior === "barangay-gis", totals, groups, boundaries, cells, summaryColor };
  const html = useMemo(() => mapHtml(data), [JSON.stringify(data)]);
  const send = (action: string, detail?: unknown) => web.current?.injectJavaScript(`window.mapCommand&&window.mapCommand(${JSON.stringify(action)},${JSON.stringify(detail ?? null)});true;`);
  const onMessage = (event: WebViewMessageEvent) => { try { const message = JSON.parse(event.nativeEvent.data); if (message.type === "choose") onChoose?.({ latitude: message.latitude, longitude: message.longitude }); if (message.type === "report") { const p = validPoints.find(x => x.id === message.id); if (p) onPointPress?.(p); } if (message.type === "barangay") onBarangayPress?.(message.name); if (message.type === "background") onMapBackgroundPress?.(); if (message.type === "cell") onDensityCellPress?.(message.count); if (message.type === "viewport") onViewportChange?.(message); } catch { /* Ignore malformed map messages. */ } };
  return <View style={{ height, borderRadius: 18, overflow: "hidden", backgroundColor: "#e8f1ee" }}>
    <WebView ref={web} source={{ html, baseUrl: "https://iliganconnect.local/" }} originWhitelist={["*"]} javaScriptEnabled onMessage={onMessage} onError={() => setFailed(true)} style={{ flex: 1 }} />
    {failed && <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: "#e8f1ee" }}><Text style={{ color: colors.brandDark, textAlign: "center" }}>Map could not load. Check your connection and reopen this screen.</Text></View>}
    <View style={{ position: "absolute", top: 12, left: 12, borderRadius: 12, backgroundColor: "white", padding: 4, flexDirection: "row", gap: 2 }}>
      {(["map", "terrain", "satellite"] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: base === value }} onPress={() => { setStyle(value); onMapStyleChange?.(value); }} style={{ minHeight: 44, minWidth: 48, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: base === value ? colors.brand : "white" }}><Text style={{ fontSize: 11, color: base === value ? "white" : colors.brandDark, fontWeight: "700" }}>{value === "map" ? "Map" : value === "terrain" ? "Terrain" : "Satellite"}</Text></Pressable>)}
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
