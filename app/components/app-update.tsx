import { useEffect, useRef, useState } from "react";
import { AppState, Linking, Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { checkAndroidUpdate, type AndroidUpdate } from "../lib/app-update";
import { colors } from "./ui";

const installedVersion = (require("../app.json") as { expo: { version: string } }).expo.version;
const checkIntervalMs = 6 * 60 * 60 * 1000;

export default function AppUpdateNotice() {
  const { height } = useWindowDimensions();
  const [available, setAvailable] = useState<AndroidUpdate | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState("");
  const [openError, setOpenError] = useState("");
  const lastCheck = useRef(0);
  const checking = useRef(false);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    let active = true;
    const check = async () => {
      if (checking.current || Date.now() - lastCheck.current < checkIntervalMs) return;
      checking.current = true;
      lastCheck.current = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const update = await checkAndroidUpdate(installedVersion, controller.signal);
        if (active) setAvailable(update);
      } catch {
        lastCheck.current = 0;
        /* Retry the next time the app returns to the foreground. */
      }
      finally { clearTimeout(timeout); checking.current = false; }
    };
    void check();
    const listener = AppState.addEventListener("change", state => { if (state === "active") void check(); });
    return () => { active = false; listener.remove(); };
  }, []);

  if (Platform.OS !== "android") return null;
  const dismiss = () => { if (available) setDismissedVersion(available.version); setOpenError(""); };
  const download = async () => {
    if (!available) return;
    try { await Linking.openURL(available.downloadUrl); dismiss(); }
    catch { setOpenError("Could not open the download. Check your connection and try again."); }
  };
  return <Modal visible={!!available && available.version !== dismissedVersion} transparent animationType="fade" onRequestClose={dismiss}>
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20, backgroundColor: "#071b27aa" }}>
      <View style={{ width: "100%", maxWidth: 380, maxHeight: height * 0.88, padding: 20, gap: 13, borderRadius: 22, backgroundColor: "white", borderWidth: 1, borderColor: colors.line }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 46, height: 46, alignItems: "center", justifyContent: "center", borderRadius: 15, backgroundColor: colors.brandSoft }}><Ionicons name="sparkles-outline" size={22} color={colors.brand} /></View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text accessibilityRole="header" style={{ color: colors.brandDark, fontSize: 19, fontWeight: "800" }}>What’s new</Text>
            <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>Iligan Connect v{available?.version}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close update details" onPress={dismiss} style={({ pressed }) => ({ width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: "#f1f6f5", opacity: pressed ? 0.72 : 1 })}><Ionicons name="close" size={20} color={colors.brandDark} /></Pressable>
        </View>
        <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>The latest improvements in this update:</Text>
        {available?.releaseNotes?.length ? <ScrollView style={{ maxHeight: Math.min(height * 0.34, 300) }} showsVerticalScrollIndicator contentContainerStyle={{ gap: 9, paddingVertical: 2 }}>
          {available.releaseNotes.map((note, index) => <View key={`${index}-${note}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <Ionicons name="checkmark-circle" size={17} color={colors.brand} style={{ marginTop: 1 }} />
            <Text style={{ flex: 1, color: colors.brandDark, fontSize: 13, lineHeight: 19 }}>{note}</Text>
          </View>)}
        </ScrollView> : <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>Release notes aren’t available for this version yet.</Text>}
        <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>Download the APK, open it from your phone’s Downloads, and confirm installation.</Text>
        {openError ? <Text accessibilityRole="alert" style={{ color: "#a43d35", fontSize: 12 }}>{openError}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Download Iligan Connect update" onPress={() => void download()} style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 13, backgroundColor: colors.brand, opacity: pressed ? .8 : 1 })}><Ionicons name="open-outline" size={18} color="white" /><Text style={{ color: "white", fontSize: 14, fontWeight: "800" }}>Download update</Text></Pressable>
      </View>
    </View>
  </Modal>;
}
