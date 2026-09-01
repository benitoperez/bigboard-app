"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type SignupState = { error: string | null };

/**
 * Public signup with REQUIRED email confirmation — SPEC-V2.md section 4.
 *
 * v1 had no signup at all; accounts were made by hand in the Supabase
 * dashboard. v2 opens it, which is why confirmation is not optional: without
 * it, anyone could take an org's invite code and an address they do not own.
 *
 * The `profiles` row is created by a database trigger on auth.users rather
 * than here. With confirmation required, signUp returns NO session, so this
 * request has no auth.uid() and could not satisfy the profiles insert policy
 * — the row would have to wait until first login, leaving a window where a
 * confirmed user has no profile.
 */
export async function signUp(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("display_name") ?? "").trim();

  if (!displayName) return { error: "Enter your name." };
  if (displayName.length > 60) return { error: "That name is too long." };
  if (!email) return { error: "Enter your email address." };
  if (password.length < 8) {
    return { error: "Use a password of at least 8 characters." };
  }

  const supabase = await createClient();

  // Confirmation links must come back to the site the user actually signed
  // up on, so previews and localhost do not send people to production.
  const origin = (await headers()).get("origin");

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      emailRedirectTo: origin ? `${origin}/auth/confirm` : undefined,
    },
  });

  if (error) {
    // Supabase distinguishes "already registered" from other failures, which
    // would confirm to a stranger that an address has an account here. Weak
    // or breached passwords are worth naming, because the user can act on
    // them and the message reveals nothing about anyone else.
    if (/password/i.test(error.message)) {
      return {
        error:
          "That password was rejected. Try a longer one, or one you have not used elsewhere.",
      };
    }
    return { error: "Could not create that account. Check the address and try again." };
  }

  revalidatePath("/", "layout");
  redirect("/confirm-email?sent=1");
}

/** Re-send the confirmation email from the "check your inbox" screen. */
export async function resendConfirmation(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter the address you signed up with." };

  const supabase = await createClient();
  const origin = (await headers()).get("origin");

  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: origin ? `${origin}/auth/confirm` : undefined },
  });

  // Rate limiting is the common failure here and it is worth naming; other
  // failures are reported without confirming whether the address exists.
  if (error) {
    return /rate/i.test(error.message)
      ? { error: "Too many emails just now. Wait a minute and try again." }
      : { error: "Could not send that email. Try again in a moment." };
  }

  return { error: null };
}
