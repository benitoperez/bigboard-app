import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components.
 *
 * The anon key is public by design - it ships in the browser bundle. RLS is
 * what actually protects the data, which is why the policies in
 * supabase/migration.sql matter more than this file does.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
