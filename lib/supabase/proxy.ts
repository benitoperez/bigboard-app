import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Paths reachable without a session. Everything else redirects to /login. */
const PUBLIC_PATHS = ["/login", "/auth"];

/**
 * Refreshes the Supabase session on every request and gates the app.
 *
 * SPEC.md section 11: every route except the login page is behind an auth
 * check. This is that check - doing it here rather than per-page means a new
 * screen is protected by default instead of by remembering to protect it.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Create a new client per request - never hoist this to module scope.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          );
        },
      },
    },
  );

  // Do not put code between createServerClient and getClaims(). Anything in
  // between makes "users are randomly logged out" very hard to debug.
  //
  // getClaims() over getSession(): getSession() does not revalidate the JWT,
  // so it cannot be trusted in server code. getClaims() verifies the
  // signature against the project's published public keys on every call.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  const isPublic = PUBLIC_PATHS.some((p) =>
    request.nextUrl.pathname.startsWith(p),
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Send them back where they were headed once they sign in.
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // Already signed in and sitting on the login page - send them home.
  if (user && request.nextUrl.pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Must be returned as-is. If you build a different response, copy the
  // cookies across or the session silently stops refreshing.
  return supabaseResponse;
}
