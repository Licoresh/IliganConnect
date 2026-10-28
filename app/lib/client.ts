import "react-native-url-polyfill/auto";
import { storage } from "./storage";
import { Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";

export const configured = !!(
  process.env.EXPO_PUBLIC_SUPABASE_URL &&
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
);
export const db = configured
  ? createClient(
      process.env.EXPO_PUBLIC_SUPABASE_URL!,
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          storage,
          autoRefreshToken: true,
          persistSession: true,
          flowType: "pkce",
          detectSessionInUrl: Platform.OS === "web",
        },
      },
    )
  : null;
export async function result<T>(
  query: PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as T;
}
