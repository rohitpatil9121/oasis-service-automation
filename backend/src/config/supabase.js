import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

// Server-side client using the SERVICE ROLE key (bypasses RLS).
// Never expose this key to the frontend.
export const supabase = createClient(
  env.supabaseUrl || "http://localhost",
  env.supabaseServiceKey || "missing-key",
  { auth: { persistSession: false, autoRefreshToken: false } }
);
