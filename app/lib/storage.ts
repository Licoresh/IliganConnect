import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { randomUUID } from "expo-crypto";

const chunkSize = 1800;
const manifestKey = (key: string) => `${key}.parts`;
const partKey = (key: string, version: string, index: number) => `${key}.${version}.${index}`;
type Manifest = { version: string; count: number };

async function readManifest(key: string): Promise<Manifest | null> {
  const raw = await SecureStore.getItemAsync(manifestKey(key));
  return raw ? JSON.parse(raw) : null;
}

async function removeParts(key: string, manifest: Manifest | null) {
  if (manifest) {
    await Promise.allSettled(Array.from({ length: manifest.count }, (_, index) =>
      SecureStore.deleteItemAsync(partKey(key, manifest.version, index)),
    ));
  }
}

export const storage = {
  getItem: async (key: string) => {
    if (Platform.OS === "web") return typeof window === "undefined" ? null : window.localStorage.getItem(key);
    const manifest = await readManifest(key);
    if (!manifest) return SecureStore.getItemAsync(key);
    const parts = await Promise.all(Array.from({ length: manifest.count }, (_, index) =>
      SecureStore.getItemAsync(partKey(key, manifest.version, index)),
    ));
    return parts.some((part) => part === null) ? null : decodeURIComponent(parts.join(""));
  },
  setItem: async (key: string, value: string) => {
    if (Platform.OS === "web") {
      window.localStorage.setItem(key, value);
      return;
    }
    const encoded = encodeURIComponent(value);
    const previous = await readManifest(key);
    if (encoded.length <= chunkSize) {
      await SecureStore.setItemAsync(key, value);
      await SecureStore.deleteItemAsync(manifestKey(key));
    } else {
      const next = { version: randomUUID(), count: Math.ceil(encoded.length / chunkSize) };
      try {
        for (let index = 0; index < next.count; index++) {
          await SecureStore.setItemAsync(partKey(key, next.version, index), encoded.slice(index * chunkSize, (index + 1) * chunkSize));
        }
        await SecureStore.setItemAsync(manifestKey(key), JSON.stringify(next));
      } catch (error) {
        await removeParts(key, next);
        throw error;
      }
      await SecureStore.deleteItemAsync(key);
    }
    await removeParts(key, previous);
  },
  removeItem: async (key: string) => {
    if (Platform.OS === "web") {
      window.localStorage.removeItem(key);
      return;
    }
    const previous = await readManifest(key);
    await SecureStore.deleteItemAsync(key);
    await SecureStore.deleteItemAsync(manifestKey(key));
    await removeParts(key, previous);
  },
};
