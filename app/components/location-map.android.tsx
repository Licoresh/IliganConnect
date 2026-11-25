import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import Ionicons from "@expo/vector-icons/Ionicons";
import { reportHeatCellsByBarangay, ILIGAN_CITY_MAX_MAP_ZOOM, ILIGAN_CITY_MIN_MAP_ZOOM, ILIGAN_MAP_BOUNDS, mapZoomFromLongitudeDelta } from "@community/shared";
import { barangayAreaKm2, barangayCenter, barangayDensity, barangayDensityColor, barangayHeatColor, barangayMapKey, iliganBarangayBoundaries } from "../lib/barangay-map";
import { categoryDisplayName, categoryIconFor, categoryToneFor, colors } from "./ui";
import { mapPinGlyphs as pinGlyphs } from "./map-pin-glyphs";
import type { MapProps, MapStyle } from "./location-map";

export { ILIGAN_MAP_BOUNDS };
export type { MapBounds, MapProps, MapStyle, Point } from "./location-map";

const tiles: Record<MapStyle, string> = {
  map: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  terrain: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
  satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
};
const pinCss = ".report-pin{position:relative;width:44px;height:52px;filter:drop-shadow(0 2px 3px #10263f99)} .report-pin--selected{filter:drop-shadow(0 0 4px #f5b840) drop-shadow(0 2px 3px #10263f99)} .report-pin__body{position:absolute;left:4px;top:0;width:36px;height:48px} .report-pin__glyph{position:absolute;left:13px;top:10px;width:18px;height:18px;fill:none;stroke:white;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}";
function mapHtml(data: Record<string, unknown>) {
  const payload = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><style>html,body,#map{height:100%;margin:0;background:#e8f1ee} .leaflet-container{font:12px system-ui,sans-serif} ${pinCss} .leaflet-tooltip.location-pin-label{padding:7px 10px;border:1px solid #dce8e4;border-radius:12px;background:white;color:#173b3a;box-shadow:0 3px 10px #173b3a30;font:700 11px system-ui,sans-serif} .leaflet-tooltip.location-pin-label:before{display:none} .count{min-width:28px;height:28px;padding:0 3px;border:2px solid white;border-radius:15px;box-shadow:0 2px 7px #10263f66;display:grid;place-items:center;color:white;font-weight:800} #error{display:none;position:absolute;inset:0;align-items:center;justify-content:center;text-align:center;padding:28px;color:#173b3a;background:#e8f1ee;z-index:999}</style></head><body><div id="map"></div><div id="error">Map tiles could not load. Check your connection and try again.</div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" onerror="document.getElementById('error').style.display='flex'"></script><script>
let d=${payload}; const send=(type,detail={})=>window.ReactNativeWebView.postMessage(JSON.stringify({type,...detail}));
if(window.L){
const cityBounds=[[d.bounds.southWest.latitude,d.bounds.southWest.longitude],[d.bounds.northEast.latitude,d.bounds.northEast.longitude]];const map=L.map('map',{zoomControl:false,attributionControl:false,minZoom:${ILIGAN_CITY_MIN_MAP_ZOOM},maxZoom:${ILIGAN_CITY_MAX_MAP_ZOOM},maxBounds:cityBounds,maxBoundsViscosity:1}).setView([d.center.latitude,d.center.longitude],d.zoom);new ResizeObserver(()=>map.invalidateSize({pan:false})).observe(map.getContainer());
const tileLayer=L.tileLayer(d.tile,{maxZoom:19}).addTo(map);
window.barangayShapes={};window.cellLayer=[];window.reportLayer=[];window.pointMarker=null;window.userPointMarker=null;window.selectedBarangayName='';
const pinHtml=(color,glyph,selected=false)=>'<div class="report-pin'+(selected?' report-pin--selected':'')+'"><svg class="report-pin__body" viewBox="0 0 36 48" aria-hidden="true"><path d="M18 1.5C8.9 1.5 1.5 8.9 1.5 18c0 12.3 16.5 28.5 16.5 28.5S34.5 30.3 34.5 18C34.5 8.9 27.1 1.5 18 1.5Z" fill="'+(/^#[0-9a-fA-F]{3,8}$/.test(color)?color:'#08756b')+'" stroke="'+(selected?'#f5b840':'white')+'" stroke-width="'+(selected?'4':'2.5')+'"/></svg><svg class="report-pin__glyph" viewBox="0 0 24 24" aria-hidden="true">'+glyph+'</svg></div>';
const drawBoundaries=()=>{Object.values(window.barangayShapes).forEach(shape=>map.removeLayer(shape));window.barangayShapes={};(d.boundaries||[]).forEach(b=>{const selected=d.gis&&b.name===window.selectedBarangayName,shape=L.polygon(b.rings,{color:selected?'#083f75':'#fff',weight:selected?3:1.5,fillColor:b.fill,fillOpacity:b.opacity}).addTo(map);window.barangayShapes[b.name]=shape;shape.on('click',e=>{L.DomEvent.stopPropagation(e);if(d.gis)send('barangay',{name:b.name})});});};
const drawCells=()=>{window.cellLayer.forEach(layer=>map.removeLayer(layer));window.cellLayer=[];(d.cells||[]).forEach(c=>{const shape=L.polygon(c.rings,{color:'#ffffff',weight:1,fillColor:c.color,fillOpacity:.62}).addTo(map);shape.on('click',e=>{L.DomEvent.stopPropagation(e);send('cell',{count:c.count})});window.cellLayer.push(shape);});};
const drawReports=()=>{window.reportLayer.forEach(marker=>map.removeLayer(marker));window.reportLayer=[];const add=(lat,lng,color,label,kind,id,glyph,title)=>{const report=kind==='report',selected=report&&id===d.selectedPointId,html=report?pinHtml(color,glyph,selected):'<div class="count" style="background:'+color+'">'+label+'</div>';const marker=L.marker([lat,lng],{title:title||'',zIndexOffset:selected?100000:0,icon:L.divIcon({html,className:'',iconSize:report?[44,52]:[36,36],iconAnchor:report?[22,47]:[18,18]})}).addTo(map);if(report)marker.getElement().dataset.reportId=id;marker.on('click',e=>{L.DomEvent.stopPropagation(e);if(report){d.selectedPointId=id;updatePinSelection();send(kind,{id});return;}const zoom=kind==='barangay'?Math.max(12,map.getZoom()):Math.max(14,map.getZoom());map.setView([lat,lng],zoom,{animate:true,duration:.35});send(kind,kind==='barangay'?{name:id}:{id})});window.reportLayer.push(marker)};if(d.showPoints){if(d.gis&&map.getZoom()<12){d.totals.forEach(t=>add(t.latitude,t.longitude,d.summaryColor,String(t.count),'barangay',t.name));}else if(d.gis&&map.getZoom()<15){d.groups.forEach(g=>add(g.latitude,g.longitude,g.color,String(g.count),'group',g.id));}else{d.points.forEach(p=>add(p.latitude,p.longitude,p.color,'','report',p.id,p.glyph,p.title));}}};
const updatePinSelection=()=>{window.reportLayer.forEach(marker=>{const pin=marker.getElement()?.querySelector('.report-pin');if(!pin)return;const selected=marker.getElement()?.dataset.reportId===d.selectedPointId;marker.setZIndexOffset(selected?100000:0);pin.classList.toggle('report-pin--selected',selected);const path=pin.querySelector('.report-pin__body path');if(path){path.setAttribute('stroke',selected?'#f5b840':'white');path.setAttribute('stroke-width',selected?'4':'2.5');}});};
const drawPoint=()=>{if(!d.point){if(window.pointMarker)map.removeLayer(window.pointMarker);window.pointMarker=null;return;}if(!window.pointMarker)window.pointMarker=L.marker([d.point.latitude,d.point.longitude],{icon:L.divIcon({html:pinHtml('#08756b','<path d="m5 12 4 4L19 6"/>'),className:'',iconSize:[44,52],iconAnchor:[22,47]})}).addTo(map);else window.pointMarker.setLatLng([d.point.latitude,d.point.longitude]);if(d.pointLabel){if(window.pointMarker.getTooltip())window.pointMarker.setTooltipContent(d.pointLabel);else window.pointMarker.bindTooltip(d.pointLabel,{permanent:true,direction:'top',offset:[0,-43],className:'location-pin-label'}).openTooltip();}else if(window.pointMarker.getTooltip())window.pointMarker.unbindTooltip();};
const drawUserPoint=()=>{if(window.userPointMarker)map.removeLayer(window.userPointMarker);window.userPointMarker=d.userPoint?L.circleMarker([d.userPoint.latitude,d.userPoint.longitude],{radius:8,color:'#fff',weight:3,fillColor:'#1687d8',fillOpacity:1}).addTo(map):null;};
drawBoundaries();drawCells();drawReports();drawPoint();drawUserPoint();map.on('zoomend',drawReports);
map.on('click',e=>{if(d.canChoose)send('choose',{latitude:e.latlng.lat,longitude:e.latlng.lng});else send('background')});
map.on('moveend',()=>{const c=map.getCenter(),b=map.getBounds();send('viewport',{latitude:c.lat,longitude:c.lng,latitudeDelta:b.getNorth()-b.getSouth(),longitudeDelta:b.getEast()-b.getWest()})});
window.mapCommand=(action,detail)=>{if(action==='update'){const next=detail||{},boundariesChanged=JSON.stringify(d.boundaries)!==JSON.stringify(next.boundaries),cellsChanged=JSON.stringify(d.cells)!==JSON.stringify(next.cells),reportsChanged=JSON.stringify([d.points,d.totals,d.groups,d.showPoints,d.gis,d.summaryColor])!==JSON.stringify([next.points,next.totals,next.groups,next.showPoints,next.gis,next.summaryColor]),selectionChanged=d.selectedPointId!==next.selectedPointId,pointChanged=JSON.stringify([d.point,d.pointLabel])!==JSON.stringify([next.point,next.pointLabel]),userPointChanged=JSON.stringify(d.userPoint)!==JSON.stringify(next.userPoint),tileChanged=d.tile!==next.tile;d=next;if(tileChanged)tileLayer.setUrl(d.tile);if(boundariesChanged)drawBoundaries();if(cellsChanged)drawCells();if(reportsChanged)drawReports();else if(selectionChanged)updatePinSelection();if(pointChanged)drawPoint();if(userPointChanged)drawUserPoint();}if(action==='zoom')map.zoomIn(detail);if(action==='center')map.setView([detail.latitude,detail.longitude],detail.zoom||15);if(action==='focusReport'){map.stop();map.setView([detail.latitude,detail.longitude],Math.max(14,map.getZoom()),{animate:false});}if(action==='selectBarangay'){window.selectedBarangayName=detail||'';Object.entries(window.barangayShapes).forEach(([name,shape])=>shape.setStyle({color:name===window.selectedBarangayName?'#083f75':'#fff',weight:name===window.selectedBarangayName?3:1.5}));}};
send('ready');}
</script></body></html>`;
}

export default function LocationMap({ point, pointLabel, showPointCoordinates = true, points = [], onChoose, onPointPress, selectedPointId, onDensityCellPress, userPoint, density, showPoints = true, height = 300, onExpand, mapStyle, onMapStyleChange, initialRegion, onViewportChange, bounds, zoomBehavior = "issue-map", showBarangayBoundaries, barangayCounts = {}, onBarangayPress, onMapBackgroundPress, selectedBarangayName, barangayMetric = "density", summaryColor = colors.brand }: MapProps) {
  const compactControls = useWindowDimensions().width <= 600;
  const web = useRef<WebView>(null);
  const initialViewport = useRef(initialRegion || {
    latitude: (ILIGAN_MAP_BOUNDS.northEast.latitude + ILIGAN_MAP_BOUNDS.southWest.latitude) / 2,
    longitude: (ILIGAN_MAP_BOUNDS.northEast.longitude + ILIGAN_MAP_BOUNDS.southWest.longitude) / 2,
    latitudeDelta: (ILIGAN_MAP_BOUNDS.northEast.latitude - ILIGAN_MAP_BOUNDS.southWest.latitude) * 1.2,
    longitudeDelta: (ILIGAN_MAP_BOUNDS.northEast.longitude - ILIGAN_MAP_BOUNDS.southWest.longitude) * 1.2,
  });
  const latestViewport = useRef(initialViewport.current);
  const [zoomLevel, setZoomLevel] = useState(() => mapZoomFromLongitudeDelta(initialViewport.current.longitudeDelta));
  const [style, setStyle] = useState<MapStyle>(mapStyle || "satellite");
  const [failed, setFailed] = useState(false);
  const [styleSelectorExpanded, setStyleSelectorExpanded] = useState(false);
  const base = mapStyle || style;
  const region = initialViewport.current;
  const maxDensity = Math.max(0, ...iliganBarangayBoundaries.map(b => barangayDensity(barangayCounts[barangayMapKey(b.properties.adm4_en)] || 0, barangayAreaKm2(b))));
  const validPoints = useMemo(() => points.filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180), [points]);
  const boundaries = showBarangayBoundaries ? iliganBarangayBoundaries.map(b => {
    const name = b.properties.adm4_en, count = barangayCounts[barangayMapKey(name)] || 0;
    return { name, count, fill: barangayMetric === "density" ? barangayDensityColor(barangayDensity(count, barangayAreaKm2(b)), maxDensity) : barangayHeatColor(count), opacity: zoomBehavior === "barangay-gis" ? 0.65 : 0.035, rings: b.geometry.coordinates[0].map(([lng, lat]) => [lat, lng]) };
  }) : [];
  const totals = iliganBarangayBoundaries.flatMap(b => { const count = barangayCounts[barangayMapKey(b.properties.adm4_en)] || 0; const center = count && barangayCenter(b); return center ? [{ ...center, name: b.properties.adm4_en, count }] : []; });
  const groups = Object.values(validPoints.reduce<Record<string, { id: string; latitude: number; longitude: number; color: string; count: number }>>((acc, p) => {
    const key = `${p.categoryName || "Report"}:${Math.round(p.latitude * 60)}:${Math.round(p.longitude * 60)}`;
    const row = acc[key] || { id: key, latitude: 0, longitude: 0, color: p.color || summaryColor, count: 0 };
    row.count++; row.latitude += (p.latitude - row.latitude) / row.count; row.longitude += (p.longitude - row.longitude) / row.count; acc[key] = row; return acc;
  }, {}));
  const heatBoundaries = useMemo(() => iliganBarangayBoundaries.map(b => ({ coordinates: b.geometry.coordinates })), []);
  const cells = useMemo(() => density && zoomBehavior === "issue-map" ? reportHeatCellsByBarangay(validPoints, heatBoundaries).flatMap(cell => cell.geometry.coordinates.map(polygon => ({ count: cell.count, color: cell.color, rings: polygon.map(ring => ring.map(([longitude, latitude]) => [latitude, longitude])) }))) : [], [density, zoomBehavior, validPoints, heatBoundaries]);
  const data = { selectedPointId, center: point || region, zoom: point ? 16 : Math.max(ILIGAN_CITY_MIN_MAP_ZOOM, Math.min(ILIGAN_CITY_MAX_MAP_ZOOM, Math.round(mapZoomFromLongitudeDelta(region.longitudeDelta)))), bounds: bounds ?? ILIGAN_MAP_BOUNDS, tile: tiles[base], points: validPoints.map(p => ({ id: p.id, latitude: p.latitude, longitude: p.longitude, color: p.color || categoryToneFor(p.categoryName || "").foreground, glyph: pinGlyphs[categoryIconFor(p.categoryName || "")] || pinGlyphs["alert-circle-outline"], title: `${categoryDisplayName(p.categoryName || "Community report")}: ${p.title || "Reported issue"}` })), point, pointLabel, userPoint, canChoose: !!onChoose, showPoints, gis: zoomBehavior === "barangay-gis", totals, groups, boundaries, cells, summaryColor };
  const dataKey = JSON.stringify({ ...data, center: undefined, zoom: undefined });
  const [source] = useState(() => ({ html: mapHtml(data), baseUrl: "https://iliganconnect.local/" }));
  const dataRef = useRef(data);
  const selectedBarangayRef = useRef(selectedBarangayName || "");
  const mapReady = useRef(false);
  dataRef.current = data;
  selectedBarangayRef.current = selectedBarangayName || "";
  const send = (action: string, detail?: unknown) => web.current?.injectJavaScript(`window.mapCommand&&window.mapCommand(${JSON.stringify(action)},${JSON.stringify(detail ?? null)});true;`);
  useEffect(() => { if (mapReady.current) send("update", dataRef.current); }, [dataKey]);
  useEffect(() => { if (mapReady.current) send("selectBarangay", selectedBarangayRef.current); }, [selectedBarangayName]);
  useEffect(() => {
    if (!mapReady.current || !selectedPointId) return;
    const selected = validPoints.find((item) => item.id === selectedPointId);
    if (selected) send("focusReport", selected);
  }, [selectedPointId, dataKey]);
  const onMessage = (event: WebViewMessageEvent) => { try { const message = JSON.parse(event.nativeEvent.data); if (message.type === "ready") { mapReady.current = true; send("update", dataRef.current); send("selectBarangay", selectedBarangayRef.current); if (selectedPointId) { const selected = validPoints.find(x => x.id === selectedPointId); if (selected) send("focusReport", selected); } } if (message.type === "choose") onChoose?.({ latitude: message.latitude, longitude: message.longitude }); if (message.type === "report") { const p = validPoints.find(x => x.id === message.id); if (p) onPointPress?.(p); } if (message.type === "barangay") onBarangayPress?.(message.name); if (message.type === "background") onMapBackgroundPress?.(); if (message.type === "cell") onDensityCellPress?.(message.count); if (message.type === "viewport") { latestViewport.current = message; setZoomLevel(mapZoomFromLongitudeDelta(message.longitudeDelta)); onViewportChange?.(message); } } catch { /* Ignore malformed map messages. */ } };
  return <View style={{ height, borderRadius: 18, overflow: "hidden", backgroundColor: "#e8f1ee" }}>
    <WebView ref={web} source={source} originWhitelist={["*"]} javaScriptEnabled nestedScrollEnabled scrollEnabled onMessage={onMessage} onError={() => setFailed(true)} style={{ flex: 1 }} />
    {failed && <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", padding: 20, backgroundColor: "#e8f1ee" }}><Text style={{ color: colors.brandDark, textAlign: "center" }}>Map could not load. Check your connection and reopen this screen.</Text></View>}
    <View style={{ position: "absolute", top: 12, left: 12, borderRadius: 12, backgroundColor: "white", padding: 4, flexDirection: "row", gap: 2, elevation: 3 }}>
      {styleSelectorExpanded ? <>
        {(["map", "terrain", "satellite"] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: base === value }} onPress={() => { initialViewport.current = latestViewport.current; setStyle(value); onMapStyleChange?.(value); }} style={{ minHeight: 44, minWidth: 48, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: base === value ? colors.brand : "white" }}><Text style={{ fontSize: 11, color: base === value ? "white" : colors.brandDark, fontWeight: "700" }}>{value === "map" ? "Map" : value === "terrain" ? "Terrain" : "Satellite"}</Text></Pressable>)}
        <Pressable accessibilityRole="button" accessibilityLabel="Collapse map styles" accessibilityState={{ expanded: true }} onPress={() => setStyleSelectorExpanded(false)} style={{ width: 40, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: "white" }}><Ionicons name="chevron-back" size={19} color={colors.brandDark} /></Pressable>
      </> : <Pressable accessibilityRole="button" accessibilityLabel="Show map styles" accessibilityState={{ expanded: false }} onPress={() => setStyleSelectorExpanded(true)} style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "white" }}><Ionicons name="chevron-forward" size={19} color={colors.brandDark} /></Pressable>}
    </View>
    <View style={{ position: "absolute", top: compactControls ? styleSelectorExpanded ? 60 : 12 : 52, right: 10, flexDirection: "column", gap: compactControls ? 4 : 5, zIndex: 5, elevation: 8 }}>{([
      { icon: "add", action: () => send("zoom", 1), label: "Zoom in" },
      { icon: "remove", action: () => send("zoom", -1), label: "Zoom out" },
      ...(onExpand ? [{ icon: "expand-outline", action: onExpand, label: "Expand map" }] : []),
    ]).map(({ icon, action, label }) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={action} style={{ width: compactControls ? 44 : 40, height: compactControls ? 44 : 40, backgroundColor: "white", borderRadius: 12, alignItems: "center", justifyContent: "center", elevation: 5 }}><Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={19} color={colors.brandDark} /></Pressable>)}</View>
    {point && showPointCoordinates && <View pointerEvents="none" style={{ position: "absolute", bottom: 12, left: 12, right: compactControls && onExpand ? 64 : 12, alignItems: "center" }}><Text style={{ backgroundColor: "white", color: colors.brandDark, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, fontSize: 11 }}>Pinned location · {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</Text></View>}
  </View>;
}
