"use client";

import { useActionState, useState } from "react";
import { createOrg, joinOrg, type OnboardingState } from "./actions";

const initialState: OnboardingState = { error: null };

const FIELD =
  "min-h-tap w-full rounded-md border border-border bg-input px-4 text-base " +
  "text-foreground outline-none " +
  "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40";

/**
 * Seed templates offered at org creation — SPEC-V2.md section 3.4.
 *
 * Basketball is deliberately visible but not selectable. Showing what is
 * coming is worth more than hiding it, as long as it cannot be picked and
 * says why.
 */
const TEMPLATES = [
  {
    slug: "flag_football",
    name: "Flag Football",
    blurb: "6 positions, 40 yard dash. The original Big Board setup.",
    available: true,
  },
  {
    slug: "baseball",
    name: "Baseball",
    blurb: "9 positions, 60 yard dash, exit and throwing velocity.",
    available: true,
  },
  {
    slug: "basketball",
    name: "Basketball",
    blurb: "Coming soon.",
    available: false,
  },
  {
    slug: "scratch",
    name: "Start From Scratch",
    blurb: "Build your own positions, attributes and drills.",
    available: true,
  },
] as const;

export function OnboardingChoice() {
  const [path, setPath] = useState<"none" | "create" | "join">("none");

  if (path === "create") return <CreateOrgForm onBack={() => setPath("none")} />;
  if (path === "join") return <JoinOrgForm onBack={() => setPath("none")} />;

  return (
    <div className="mt-8 flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setPath("create")}
        className="bb-card rounded-lg border border-border bg-card p-5 text-left active:bg-secondary"
      >
        <p className="text-lg font-bold text-foreground">Create an organization</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Start a new club. You become the owner and get invite codes to share.
        </p>
      </button>

      <button
        type="button"
        onClick={() => setPath("join")}
        className="bb-card rounded-lg border border-border bg-card p-5 text-left active:bg-secondary"
      >
        <p className="text-lg font-bold text-foreground">Join an organization</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter the invite code someone on the staff gave you.
        </p>
      </button>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="min-h-tap self-start text-sm text-muted-foreground"
    >
      &larr; Back
    </button>
  );
}

function CreateOrgForm({ onBack }: { onBack: () => void }) {
  const [state, formAction, pending] = useActionState(createOrg, initialState);
  const [template, setTemplate] = useState<string>("flag_football");

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      <BackButton onBack={onBack} />

      <div className="flex flex-col gap-2">
        <label htmlFor="org-name" className="text-sm font-semibold text-muted-foreground">
          Organization name
        </label>
        <input
          id="org-name"
          name="name"
          type="text"
          required
          maxLength={80}
          placeholder="NCSU Club Flag Football"
          className={FIELD}
        />
      </div>

      <input type="hidden" name="template" value={template} />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-muted-foreground">
          Start from
        </legend>

        {TEMPLATES.map((t) => {
          const selected = template === t.slug;
          return (
            <button
              key={t.slug}
              type="button"
              // Not clickable, and not merely styled that way: an unavailable
              // template must never reach the server as a slug.
              disabled={!t.available}
              aria-pressed={selected}
              onClick={() => t.available && setTemplate(t.slug)}
              className={
                "rounded-lg border p-4 text-left transition-colors " +
                (!t.available
                  ? "cursor-not-allowed border-border bg-card opacity-40"
                  : selected
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card active:bg-secondary")
              }
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-foreground">{t.name}</p>
                {!t.available && (
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
                    Coming Soon
                  </span>
                )}
                {t.available && selected && (
                  <span className="text-sm font-bold text-primary">Selected</span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{t.blurb}</p>
            </button>
          );
        })}
      </fieldset>

      {/* SPEC-V2 section 3.1: the framing is deliberate and must not drift
          into claiming these are fixed industry standards. */}
      <p className="text-xs text-muted-foreground">
        Weights are research-informed defaults, fully editable. You can change
        every position, attribute, drill and weight later from the Account tab.
      </p>

      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3
                     text-sm text-destructive-foreground"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="min-h-tap-large rounded-lg bg-primary px-6 text-base font-bold
                   tracking-wide text-primary-foreground active:opacity-80 disabled:opacity-50"
      >
        {pending ? "Creating..." : "Create Organization"}
      </button>
    </form>
  );
}

function JoinOrgForm({ onBack }: { onBack: () => void }) {
  const [state, formAction, pending] = useActionState(joinOrg, initialState);

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      <BackButton onBack={onBack} />

      <div className="flex flex-col gap-2">
        <label htmlFor="code" className="text-sm font-semibold text-muted-foreground">
          Invite code
        </label>
        <input
          id="code"
          name="code"
          type="text"
          required
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder="EVAL-7K2M"
          className={FIELD + " tnum text-center text-xl font-bold tracking-[0.2em] uppercase"}
        />
        <p className="text-xs text-muted-foreground">
          The code decides your role. Case and the dash do not matter.
        </p>
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3
                     text-sm text-destructive-foreground"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="min-h-tap-large rounded-lg bg-primary px-6 text-base font-bold
                   tracking-wide text-primary-foreground active:opacity-80 disabled:opacity-50"
      >
        {pending ? "Joining..." : "Join Organization"}
      </button>
    </form>
  );
}
