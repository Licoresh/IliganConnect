"use client";
import { createContext, useContext } from "react";
import type { StaffContext } from "../lib/access";
export const AccessContext = createContext<StaffContext | null>(null);
export function useAccess() {
  const access = useContext(AccessContext);
  if (!access) throw new Error("Administrative access is not available.");
  return access;
}
