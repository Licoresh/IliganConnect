import { useEffect, useRef, useState } from "react";
import { AppState, Linking, Modal, Platform, Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { checkAndroidUpdate, type AndroidUpdate } from "../lib/app-update";
import { colors } from "./ui";

const installedVersion = (require("../app.json") as { expo: { version: string } }).expo.version;
const checkIntervalMs = 6 * 60 * 60 * 1000;

export default function AppUpdateNotice() {
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
      <View style={{ width: "100%", maxWidth: 380, padding: 20, gap: 13, borderRadius: 22, backgroundColor: "white", borderWidth: 1, borderColor: colors.line }}>
        <View style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: colors.brandSoft }}><Ionicons name="download-outline" size={24} color={colors.brand} /></View>
        <View style={{ gap: 5 }}><Text accessibilityRole="header" style={{ color: colors.brandDark, fontSize: 21, fontWeight: "800" }}>Update available</Text><Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>Iligan Connect v{available?.version} is ready. Download the APK, open it from your phone’s Downloads, and confirm the installation.</Text></View>
        {openError ? <Text accessibilityRole="alert" style={{ color: "#a43d35", fontSize: 12 }}>{openError}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Download Iligan Connect update" onPress={() => void download()} style={({ pressed }) => ({ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 13, backgroundColor: colors.brand, opacity: pressed ? .8 : 1 })}><Ionicons name="open-outline" size={18} color="white" /><Text style={{ color: "white", fontSize: 14, fontWeight: "800" }}>Download update</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Remind me later" onPress={dismiss} style={({ pressed }) => ({ minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, opacity: pressed ? .7 : 1 })}><Text style={{ color: colors.brand, fontSize: 13, fontWeight: "700" }}>Later</Text></Pressable>
      </View>
    </View>
  </Modal>;
}
