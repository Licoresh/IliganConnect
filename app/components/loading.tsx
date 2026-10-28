import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, View, useWindowDimensions } from "react-native";
import { styles as s } from "./ui";

type Variant = "row" | "card" | "report" | "publicReport" | "discussion" | "announcement" | "conversation" | "meeting" | "notification" | "home";
const block = (width: number | `${number}%`, height: number, radius = 6) => <View style={{ width, height, borderRadius: radius, backgroundColor: "#dce7e3" }} />;

function SkeletonContent({ variant, count, windowWidth }: { variant: Variant; count: number; windowWidth: number }) {
  if (variant === "home") return <View style={{ gap: 14 }}>
    <View style={{ gap: 9, paddingTop: 8 }}>{block("42%", 14)}{block("78%", 30, 8)}{block("48%", 42, 22)}</View>
    <View style={{ minHeight: 140, borderRadius: 22, padding: 18, backgroundColor: "#dce7e3", justifyContent: "center", gap: 10 }}>{block("34%", 10)}{block("78%", 24, 8)}{block("88%", 14)}{block("62%", 14)}</View>
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>{block("42%", 19)}{block("24%", 16)}</View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 }}>{Array.from({ length: 4 }, (_, i) => <View key={i} style={[s.categoryCard, { backgroundColor: "white" }]}><View style={{ width: 38, height: 44, borderRadius: 15, backgroundColor: "#dce7e3" }} /><View style={{ flex: 1, gap: 6 }}>{block("86%", 11)}{block("66%", 9)}</View></View>)}</View>
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>{block("34%", 19)}{block("20%", 15)}</View>
    {Array.from({ length: 2 }, (_, i) => <SkeletonContent key={i} variant="report" count={1} windowWidth={windowWidth} />)}
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>{block("43%", 19)}{block("29%", 15)}</View>
    <SkeletonContent variant="announcement" count={1} windowWidth={windowWidth} />
  </View>;

  return <View style={{ gap: 10 }}>
    {Array.from({ length: count }, (_, index) => {
      if (variant === "report") return <View key={index} style={[s.reportListItem, { minHeight: 96, backgroundColor: "white" }]}>
        <View style={{ width: 78, height: 78, borderRadius: 14, backgroundColor: "#dce7e3" }} />
        <View style={{ flex: 1, gap: 9 }}>{block("78%", 14)}{block("94%", 16)}<View style={{ flexDirection: "row", gap: 8 }}>{block("34%", 12)}{block("30%", 12)}</View></View>
      </View>;
      if (variant === "publicReport") return <View key={index} style={[s.card, { flexDirection: "row", gap: 11, minHeight: 140, backgroundColor: "white" }]}>
        <View style={{ width: windowWidth < 360 ? 76 : 92, minHeight: 108, borderRadius: 13, backgroundColor: "#dce7e3" }} />
        <View style={{ flex: 1, gap: 8 }}>{block("80%", 14)}{block("96%", 15)}{block("64%", 15)}{block("85%", 12)}{block("50%", 12)}</View>
      </View>;
      if (variant === "discussion") return <View key={index} style={[s.card, { gap: 10, backgroundColor: "white" }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: "#dce7e3" }} /><View style={{ flex: 1, gap: 6 }}>{block("48%", 11)}{block("64%", 10)}</View>{block(54, 24, 13)}</View>
        {block("76%", 17)}{block("96%", 13)}{block("88%", 13)}{block("60%", 13)}{block("56%", 13)}
      </View>;
      if (variant === "announcement") return <View key={index} style={[s.card, { gap: 9, backgroundColor: "white" }]}>{block("28%", 11)}{block("72%", 18)}{block("96%", 13)}{block("91%", 13)}{block("58%", 13)}{block("48%", 11)}</View>;
      if (variant === "conversation") return <View key={index} style={[s.card, { gap: 10, backgroundColor: "white" }]}>{block("42%", 11)}{block("94%", 13)}{block("82%", 13)}{block("57%", 11)}<View style={{ flexDirection: "row", gap: 8 }}>{block("36%", 38, 12)}{block("36%", 38, 12)}</View></View>;
      if (variant === "meeting") return <View key={index} style={[s.card, { gap: 10, backgroundColor: "white" }]}><View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: "#dce7e3" }} /><View style={{ flex: 1, gap: 6 }}>{block("44%", 11)}{block("54%", 11)}</View></View>{block("70%", 17)}{block("94%", 13)}{block("82%", 13)}</View>;
      if (variant === "notification") return <View key={index} style={[s.notificationItem, { backgroundColor: "white" }]}><View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: "#dce7e3" }} /><View style={{ flex: 1, gap: 8 }}>{block("88%", 14)}{block("42%", 11)}</View></View>;
      return <View key={index} style={variant === "card" ? [s.card, { minHeight: 130, backgroundColor: "white" }] : [s.reportListItem, { minHeight: 64, backgroundColor: "white" }]}>
        {variant === "row" && <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: "#dce7e3" }} />}
        <View style={{ flex: 1, gap: 10 }}>{block("82%", 15)}{variant === "card" && block("95%", 12)}{block("48%", 12)}</View>
      </View>;
    })}
  </View>;
}

export function ListSkeleton({ count = 3, label = "Loading reports", variant = "row" }: { count?: number; label?: string; variant?: Variant }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const { width } = useWindowDimensions();
  useEffect(() => {
    let disposed = false;
    let animation: Animated.CompositeAnimation | undefined;
    const update = (reduce: boolean) => {
      if (disposed) return;
      animation?.stop();
      opacity.setValue(1);
      if (reduce) return;
      animation = Animated.loop(Animated.sequence([
        Animated.timing(opacity, { toValue: 0.55, duration: 800, useNativeDriver: true, isInteraction: false }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true, isInteraction: false }),
      ]));
      animation.start();
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(update);
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", update);
    return () => { disposed = true; animation?.stop(); listener.remove(); };
  }, [opacity]);
  return <View accessible accessibilityLabel={label} accessibilityState={{ busy: true }} accessibilityLiveRegion="polite">
    <Animated.View style={{ opacity, gap: 12 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <SkeletonContent variant={variant} count={Math.max(1, count)} windowWidth={width} />
    </Animated.View>
  </View>;
}
