import { useEffect, useState } from "react";
import { Platform } from "react-native";

// Resident desktop layouts need a wide window AND a precise hovering pointer (mouse/trackpad),
// so large touch tablets in landscape keep the tablet layout instead of the desktop shell.
const DESKTOP_POINTER = "(hover: hover) and (pointer: fine)";
const finePointerNow = () =>
  Platform.OS === "web" && typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(DESKTOP_POINTER).matches
    : false;

export function useFinePointer() {
  const [fine, setFine] = useState(finePointerNow);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(DESKTOP_POINTER);
    const update = () => setFine(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return fine;
}

export const isDesktopWeb = (width: number, finePointer: boolean) => Platform.OS === "web" && width >= 1200 && finePointer;
export const isTabletWeb = (width: number, finePointer: boolean) => Platform.OS === "web" && width >= 768 && !isDesktopWeb(width, finePointer);
