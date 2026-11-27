import { useEffect, useRef, useState } from "react";
import { AppState, Modal, Platform, Pressable, ScrollView, Text, View, ActivityIndicator, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { checkAndroidUpdate, type AndroidUpdate } from "../lib/app-update";
import { colors } from "./ui";

const installedVersion = (require("../app.json") as { expo: { version: string } }).expo.version;
const checkIntervalMs = 6 * 60 * 60 * 1000;

export default function AppUpdateNotice() {
  const { height } = useWindowDimensions();
  const [available, setAvailable] = useState<AndroidUpdate | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState("");
  const [openError, setOpenError] = useState("");
  const [downloadedApk, setDownloadedApk] = useState<{ version: string; uri: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
  const [installerOpened, setInstallerOpened] = useState(false);
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
    if (!available || downloading) return;
    setDownloading(true);
    setOpenError("");
    let installerAttempt = false;
    try {
      let apkUri = downloadedApk?.version === available.version ? downloadedApk.uri : null;
      if (!apkUri) {
        if (!FileSystem.cacheDirectory) throw new Error("App cache unavailable");
        apkUri = `${FileSystem.cacheDirectory}Iligan-Connect-Resident-v${available.version}.apk`;
        await FileSystem.deleteAsync(apkUri, { idempotent: true });
        const task = FileSystem.createDownloadResumable(
          available.downloadUrl,
          apkUri,
          { headers: { Accept: "application/vnd.android.package-archive" } },
          ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
            if (totalBytesExpectedToWrite > 0) {
              setDownloadPercent(Math.min(100, Math.round(totalBytesWritten / totalBytesExpectedToWrite * 100)));
            }
          }
        );
        const result = await task.downloadAsync();
        if (!result) throw new Error("APK download was cancelled");
        const info = await FileSystem.getInfoAsync(result.uri);
        if (result.status !== 200 || !info.exists || !info.size || info.size < 1024 * 1024) {
          throw new Error("APK download was incomplete");
        }
        apkUri = result.uri;
        setDownloadedApk({ version: available.version, uri: result.uri });
      }

      const contentUri = await FileSystem.getContentUriAsync(apkUri);
      installerAttempt = true;
      setInstallerOpened(true);
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: contentUri,
        type: "application/vnd.android.package-archive",
        flags: 1,
      });
    } catch {
      setOpenError(installerAttempt
        ? "The update is downloaded, but Android could not open the installer. Tap below to try again. If asked, allow installs from Iligan Connect."
        : "The update could not be downloaded. Check your connection and try again.");
    } finally {
      setDownloading(false);
      setDownloadPercent(null);
    }
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
        <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>We’ll download the update and open Android’s installer. Tap Install there to finish updating.</Text>
        {installerOpened && <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 11, borderRadius: 12, backgroundColor: colors.brandSoft }}>
          <Ionicons name="phone-portrait-outline" size={17} color={colors.brand} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, color: colors.brandDark, fontSize: 12, lineHeight: 18 }}>Android’s installer opened. Choose Install to finish. If you returned here, you can reopen the installer below.</Text>
        </View>}
        {downloading && <View accessibilityRole="progressbar" accessibilityLabel={downloadPercent == null ? "Downloading update" : `Downloading update, ${downloadPercent} percent`} style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
          <ActivityIndicator size="small" color={colors.brand} />
          <Text style={{ color: colors.brandDark, fontSize: 13, fontWeight: "700" }}>{downloadPercent == null ? "Downloading update…" : `Downloading update… ${downloadPercent}%`}</Text>
        </View>}
        {openError ? <Text accessibilityRole="alert" style={{ color: "#a43d35", fontSize: 12 }}>{openError}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={downloadedApk?.version === available?.version ? "Open Android installer" : "Download and install Iligan Connect update"} accessibilityState={{ disabled: downloading }} disabled={downloading} onPress={() => void download()} style={({ pressed }) => ({ minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 13, backgroundColor: colors.brand, opacity: downloading ? .7 : pressed ? .8 : 1 })}><Ionicons name="download-outline" size={18} color="white" /><Text style={{ color: "white", fontSize: 14, fontWeight: "800" }}>{downloading ? "Please wait…" : downloadedApk?.version === available?.version ? "Open installer" : "Download and install"}</Text></Pressable>
      </View>
    </View>
  </Modal>;
}
