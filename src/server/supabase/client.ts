import "server-only";
import { createClient } from "@supabase/supabase-js";
import { ApiError } from "../../lib/api-error";
import type { Database } from "./database.types";

export function getSupabaseClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) {
    throw new ApiError("Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.", 503);
  }

  // Configuration check only; Supabase still authenticates the actual credential.
  const isSecretKey = key.startsWith("sb_secret_");
  const isLegacyJwt = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key);
  if (!isSecretKey && !isLegacyJwt) {
    throw new ApiError(
      "SUPABASE_SECRET_KEY must be a Supabase server secret (sb_secret_...) or legacy service_role JWT. Copy it from Settings → API Keys, not the database password or publishable key.",
      503,
    );
  }

  // No shared user session: this privileged client is only for our local server/worker.
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
