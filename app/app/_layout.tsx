import { Stack } from "expo-router";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useState, useEffect } from "react";
import { AppState, Platform } from "react-native";
import { db } from "../lib/client";
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
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
