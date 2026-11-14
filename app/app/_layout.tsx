import { Stack } from "expo-router";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useState, useEffect } from "react";
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { db } from "../lib/client";
import AppUpdateNotice from "../components/app-update";
import { getDevicePushPreference, registerDevicePushToken, removeDevicePushTokens } from "../lib/push-notifications";

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
        <AppUpdateNotice />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
