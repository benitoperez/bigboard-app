"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { COMMENT_MAX, type Comment } from "@/lib/comments";
import { postComment, deleteComment } from "./comment-actions";

/**
 * Comment thread - SPEC.md section 10.3: a scrolling list of officer
 * comments, newest at the bottom, with a text input pinned below it.
 */
export function Comments({
  prospectId,
  comments,
  officerId,
}: {
  prospectId: string;
  comments: Comment[];
  officerId: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Newest at the bottom means the newest is off-screen unless we scroll to
  // it. Jump to the end whenever the thread grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comments.length]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;

    setError(null);
    startTransition(async () => {
      const res = await postComment(prospectId, trimmed);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBody("");
      router.refresh();
    });
  }

  function remove(commentId: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteComment(prospectId, commentId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const remaining = COMMENT_MAX - body.length;

  return (
    <section className="mt-6">
      <h2 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground uppercase">
        Notes
      </h2>

      <div className="mt-2 rounded-lg border border-border bg-card">
        <div
          ref={scrollRef}
          className="max-h-80 overflow-y-auto px-4 py-3"
          role="log"
          aria-label="Officer comments"
        >
          {comments.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No notes yet. Anything the numbers do not capture goes here.
            </p>
          ) : (
            <ul className="space-y-3">
              {comments.map((c) => (
                <li key={c.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-bold text-primary">
                      {c.officerName}
                    </span>
                    <span className="flex items-baseline gap-2">
                      <time
                        dateTime={c.createdAt}
                        className="tnum text-[11px] text-muted-foreground"
                      >
                        {formatWhen(c.createdAt)}
                      </time>
                      {c.officerId === officerId && (
                        <button
                          type="button"
                          onClick={() => remove(c.id)}
                          disabled={pending}
                          aria-label="Delete your comment"
                          className="text-[11px] text-muted-foreground underline disabled:opacity-50"
                        >
                          delete
                        </button>
                      )}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm break-words whitespace-pre-wrap text-foreground">
                    {c.body}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Input pinned below the list. */}
        <form
          onSubmit={submit}
          className="flex items-end gap-2 border-t border-border p-3"
        >
          <div className="flex-1">
            <label htmlFor="comment-body" className="sr-only">
              Add a note
            </label>
            <textarea
              id="comment-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={COMMENT_MAX}
              rows={2}
              placeholder="Add a note..."
              disabled={pending}
              className="w-full resize-none rounded-md border border-border bg-input px-3 py-2
                         text-base text-foreground placeholder:text-muted-foreground outline-none
                         focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40
                         disabled:opacity-50"
            />
            {remaining < 100 && (
              <p className="tnum mt-1 text-[11px] text-muted-foreground">
                {remaining} left
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={pending || body.trim().length === 0}
            className="min-h-tap shrink-0 rounded-md bg-primary px-4 text-sm font-bold
                       text-primary-foreground disabled:opacity-40"
          >
            {pending ? "..." : "Post"}
          </button>
        </form>

        {error && (
          <p role="alert" className="px-3 pb-3 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
