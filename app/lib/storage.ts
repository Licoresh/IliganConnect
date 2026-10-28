import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
export const storage = {
  getItem: async (key: string) =>
    Platform.OS === "web"
      ? typeof window === "undefined"
        ? null
        : window.localStorage.getItem(key)
      : SecureStore.getItemAsync(key),
  setItem: async (key: string, value: string) => {
    if (Platform.OS === "web") window.localStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  },
  removeItem: async (key: string) => {
    if (Platform.OS === "web") window.localStorage.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  },
};
