import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Where the confirmation email lands — SPEC-V2.md section 4.
 *
 * Supabase sends a one-time token here; exchanging it establishes the
 * session and marks the address confirmed. On success the user goes to
 * /onboarding, because a freshly confirmed account belongs to no org yet and
 * that is the only screen with anything on it.
 *
 * A route handler rather than a page: this has no UI of its own, and doing
 * the exchange in a page would run it again on any re-render.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (!token_hash || !type) {
    return NextResponse.redirect(`${origin}/confirm-email?error=missing`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash });

  if (error) {
    // Expired and already-used links both land here. The screen offers a
    // resend rather than a dead end.
    return NextResponse.redirect(`${origin}/confirm-email?error=invalid`);
  }

  return NextResponse.redirect(`${origin}/onboarding`);
}
