import { memo, useEffect, useState } from "react";
import { View, Text } from "react-native";
import LocationMap, { type MapProps } from "./location-map";

// Paint the destination page before initializing its native map / WebGL surface.
// Reserve the exact map height so the surrounding content never jumps.
export default memo(function DeferredLocationMap(props: MapProps) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, []);
  return ready ? <LocationMap {...props} /> : (
    <View accessibilityLabel="Loading map" accessibilityState={{ busy: true }} style={{ height: props.height ?? 300, borderRadius: 18, backgroundColor: "#e8f1ee", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#647571", fontSize: 12 }}>Loading map…</Text>
    </View>
  );
});
