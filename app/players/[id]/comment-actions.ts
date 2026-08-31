"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOfficer } from "@/lib/auth";
import { COMMENT_MAX } from "@/lib/comments";

export type CommentResult = { ok: true } | { ok: false; error: string };

/**
 * Post a comment - SPEC.md section 10.3.
 *
 * The officer_id is taken from the session, never from the client. The RLS
 * policy enforces the same thing with check (officer_id = auth.uid()), so
 * posting as someone else fails at the database even if this layer were
 * bypassed.
 */
export async function postComment(
  prospectId: string,
  body: string,
): Promise<CommentResult> {
  const { officer } = await getOfficer();
  if (!officer) return { ok: false, error: "Not signed in." };

  const trimmed = body.trim();
  // Mirrors the CHECK constraint: length between 1 and 1000.
  if (trimmed.length === 0) return { ok: false, error: "Write something first." };
  if (trimmed.length > COMMENT_MAX) {
    return { ok: false, error: `Keep it under ${COMMENT_MAX} characters.` };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("comments").insert({
    prospect_id: prospectId,
    officer_id: officer.id,
    body: trimmed,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/players/${prospectId}`);
  return { ok: true };
}

/**
 * Delete a comment.
 *
 * Own comments only. The comments_delete policy is
 * using (officer_id = auth.uid()), unlike drill_results where anyone may
 * clear a bad time: a comment is one officer's words, and nobody else gets
 * to retract them. A delete of someone else's comment removes zero rows
 * rather than erroring, so this reports what actually happened.
 */
export async function deleteComment(
  prospectId: string,
  commentId: string,
): Promise<CommentResult> {
  const { officer } = await getOfficer();
  if (!officer) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("comments")
    .delete()
    .eq("id", commentId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "You can only delete your own comments." };
  }

  revalidatePath(`/players/${prospectId}`);
  return { ok: true };
}
