/**
 * Client-safe comment types and limits.
 *
 * Kept apart from lib/data/comments.ts, which imports the Supabase server
 * client and therefore next/headers. A client component importing a VALUE
 * from that module drags server-only code into the browser bundle and the
 * build fails - types alone are erased, but a constant is not.
 */

/** Mirrors the CHECK constraint: length(body) between 1 and 1000. */
export const COMMENT_MAX = 1000;

export type Comment = {
  id: string;
  officerId: string;
  officerName: string;
  body: string;
  createdAt: string;
};
