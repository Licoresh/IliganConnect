import { Stack } from "expo-router";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useState, useEffect } from "react";
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { db } from "../lib/client";
import AppUpdateNotice from "../components/app-update";
import SaveToast from "../components/save-toast";
import "../lib/background-alerts";
import { expoProjectId, getDevicePushPreference, pollResidentAlerts, registerDevicePushToken, removeDevicePushTokens } from "../lib/push-notifications";
import { syncResidentBackgroundAlerts } from "../lib/background-alerts";

// Resident website typography: Inter for text, Public Sans for headings (same pairing as the staff site).
// Native apps keep the platform font. Scoped under #root so it outranks react-native-web's text classes;
// icon fonts set fontFamily inline and are unaffected.
if (Platform.OS === "web" && typeof document !== "undefined" && !document.getElementById("ic-typography")) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=Public+Sans:wght@600..800&display=swap";
  const style = document.createElement("style");
  style.id = "ic-typography";
  style.textContent = `
    #root :is(div, span, input, textarea, button) { font-family: Inter, "Segoe UI", Roboto, system-ui, sans-serif; letter-spacing: -0.003em; font-feature-settings: "cv11", "ss01"; }
    #root [role="heading"], #root [aria-level] { font-family: "Public Sans", Inter, "Segoe UI", sans-serif; letter-spacing: -0.015em; }
  `;
  document.head.append(link, style);
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function ResidentPushRegistration() {
  useEffect(() => {
    if (Platform.OS === "web" || !db) return;
    const client = db;
    let disposed = false;
    let generation = 0;
    const sync = async (userId: string | null) => {
      const current = ++generation;
      if (!userId) return;
      try {
        const { data, error } = await client
          .from("profiles")
          .select("role, account_status, notifications_enabled")
          .eq("id", userId)
          .maybeSingle();
        if (error || !data) return;
        if (!data.notifications_enabled || data.role !== "resident" || data.account_status !== "active") {
          await removeDevicePushTokens(userId);
          return;
        }
        if (await getDevicePushPreference(userId) === false) {
          await removeDevicePushTokens(userId);
          return;
        }
        const permission = await Notifications.getPermissionsAsync();
        if (!permission.granted) {
          await removeDevicePushTokens(userId);
          return;
        }
        if (!disposed && current === generation) await registerDevicePushToken(userId);
      } catch {
        // Retry on the next sign-in or foreground; push registration must not block app startup.
      }
    };

    void client.auth.getSession().then(({ data }) => {
      if (!disposed) void sync(data.session?.user.id ?? null);
    }).catch(() => undefined);
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id ?? null;
      setTimeout(() => { if (!disposed) void sync(id); }, 0);
    });
    const foreground = AppState.addEventListener("change", state => {
      if (state === "active") void client.auth.getSession().then(({ data }) => sync(data.session?.user.id ?? null)).catch(() => undefined);
    });
    return () => {
      disposed = true;
      subscription.unsubscribe();
      foreground.remove();
    };
  }, []);
  return null;
}

function ResidentForegroundAlerts() {
  useEffect(() => {
    if (Platform.OS === "web" || !db) return;
    const client = db;
    let stopped = false;
    let polling = false;
    let taskEnabled: boolean | null = null;

    const poll = async () => {
      if (stopped || polling || AppState.currentState !== "active") return;
      polling = true;
      try {
        const enabled = await pollResidentAlerts();
        const shouldRunBackground = enabled && !expoProjectId();
        if (shouldRunBackground !== taskEnabled) {
          await syncResidentBackgroundAlerts(shouldRunBackground);
          taskEnabled = shouldRunBackground;
        }
      } catch {
        // Foreground alerts retry on the next poll; they never block the app.
      } finally {
        polling = false;
      }
    };
    if (Platform.OS === "android") void Notifications.setNotificationChannelAsync("community-alerts", { name: "Community alerts", importance: Notifications.AndroidImportance.HIGH, sound: "default" });
    void poll();
    const interval = setInterval(() => void poll(), 30000);
    const foreground = AppState.addEventListener("change", state => { if (state === "active") void poll(); });
    const { data: { subscription } } = client.auth.onAuthStateChange(() => {
      taskEnabled = null;
      setTimeout(() => { if (!stopped) void poll(); }, 0);
    });
    return () => { stopped = true; clearInterval(interval); foreground.remove(); subscription.unsubscribe(); void syncResidentBackgroundAlerts(false); };
  }, []);
  return null;
}
export default function Layout() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30000, retry: 1 } },
      }),
  );
  useEffect(() => {
    if (Platform.OS === "web") return;
    const updateFocus = (state: string) => {
      const active = state === "active";
      focusManager.setFocused(active);
      if (active) db?.auth.startAutoRefresh();
      else db?.auth.stopAutoRefresh();
    };
    updateFocus(AppState.currentState);
    const subscription = AppState.addEventListener("change", updateFocus);
    return () => {
      subscription.remove();
      db?.auth.stopAutoRefresh();
      focusManager.setFocused(undefined);
    };
  }, []);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <Stack screenOptions={{ headerShown: false }} />
        <ResidentPushRegistration />
        <ResidentForegroundAlerts />
        <AppUpdateNotice />
        <SaveToast />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
