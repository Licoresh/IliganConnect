import { useEffect, useState } from "react";
import { DeviceEventEmitter, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SAVE_FEEDBACK_EVENT, type SaveFeedback } from "../lib/save-feedback";

export default function SaveToast() {
  const insets = useSafeAreaInsets();
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const receive = (next: SaveFeedback) => {
      setFeedback(next);
      clearTimeout(timer);
      timer = setTimeout(() => setFeedback(null), next.kind === "error" ? 6000 : 3600);
    };
    if (Platform.OS === "web") {
      const onEvent = (event: Event) => receive((event as CustomEvent<SaveFeedback>).detail);
      window.addEventListener(SAVE_FEEDBACK_EVENT, onEvent);
      return () => { clearTimeout(timer); window.removeEventListener(SAVE_FEEDBACK_EVENT, onEvent); };
    }
    const subscription = DeviceEventEmitter.addListener(SAVE_FEEDBACK_EVENT, receive);
    return () => { clearTimeout(timer); subscription.remove(); };
  }, []);
  if (!feedback) return null;
  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    <Pressable
      accessibilityRole={feedback.kind === "error" ? "alert" : "text"}
      accessibilityLiveRegion="polite"
      accessibilityLabel={feedback.message}
      onPress={() => setFeedback(null)}
      style={[styles.toast, { top: insets.top + 8 }, feedback.kind === "error" && styles.error]}
    >
      <Text style={styles.text}>{feedback.message}</Text>
      <Text style={styles.dismiss}>×</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  toast: { position: "absolute", left: 12, right: 12, minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: "#cde8dc", borderRadius: 15, backgroundColor: "white", elevation: 9, shadowColor: "#123a35", shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
  error: { borderColor: "#f0c7c5", backgroundColor: "#fff8f7" },
  text: { flex: 1, color: "#135b47", fontSize: 14, lineHeight: 19, fontWeight: "700" },
  dismiss: { color: "#52697c", fontSize: 22, lineHeight: 26 },
});
