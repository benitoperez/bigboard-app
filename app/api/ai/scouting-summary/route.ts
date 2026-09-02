import { NextResponse, type NextRequest } from "next/server";
import { guardAiRequest, recordAiUsage } from "@/lib/ai/guard";
import { generate } from "@/lib/ai/gemini";
import {
  getProspectDetail,
  type ProspectDetailResult,
} from "@/lib/data/prospect-detail";
import { getComments } from "@/lib/data/comments";
import { formatDrillValue } from "@/lib/template";

/**
 * AI scouting summary — SPEC-V2.md section 6.4.
 *
 * Three sentences from the ratings, drill results and comments already in
 * the system. Not stored: regenerating is cheap, and a stored summary goes
 * stale the moment anyone moves a slider, which is worse than not having one.
 *
 * The prospect is read with the CALLER'S session, so RLS decides what can be
 * summarized. A caller who cannot read a prospect cannot have the model
 * describe them either — the org check and the data read enforce the same
 * boundary from two directions.
 *
 * Trade, stated plainly: athlete names, ratings and officer comments are
 * sent to Google's API under its data terms. An org-level AI kill switch is
 * future work (SPEC-V2 section 11).
 */
export async function POST(request: NextRequest) {
  let body: { prospectId?: string; orgId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  if (!body.prospectId) {
    return NextResponse.json({ error: "No athlete named." }, { status: 400 });
  }

  // Auth, membership, role, and both daily caps — all before Gemini.
  const guard = await guardAiRequest(body.orgId, "evaluator");
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const detail = await getProspectDetail(body.prospectId, guard.actor.userId!);
  if (!detail) {
    return NextResponse.json({ error: "Athlete not found." }, { status: 404 });
  }

  const { template, prospect } = detail;

  // The prospect belongs to a tryout in the caller's org by construction —
  // RLS returned it — but the template's org is checked anyway, because a
  // mismatch would mean the summary described data from elsewhere.
  if (template.orgId !== guard.orgId) {
    return NextResponse.json({ error: "Athlete not found." }, { status: 404 });
  }

  const comments = await getComments(body.prospectId);
  const prompt = buildPrompt(detail, comments.map((c) => c.body));

  const result = await generate(prompt, { maxOutputTokens: 400 });
  if (!result.ok) {
    // A failed call costs no quota.
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await recordAiUsage(guard.orgId, guard.actor.userId!, "scouting-summary");

  return NextResponse.json({
    summary: result.text,
    athlete: prospect.fullName,
  });
}

function buildPrompt(detail: ProspectDetailResult, comments: string[]): string {
  const { template, prospect } = detail;

  const positions = prospect.positionRatings
    .map((r) => {
      const rating =
        r.rating.rating === null
          ? `not yet rated (${r.rating.covered} of ${r.rating.required} inputs${
              r.missing.length ? `, missing ${r.missing.join(", ")}` : ""
            })`
          : `${r.rating.rating} out of 99, from ${r.rating.inputs} officer inputs`;
      return `- ${r.label} (${r.position}): ${rating}`;
    })
    .join("\n");

  const attributes = prospect.attributes
    .map((a) =>
      a.teamRating === null
        ? `- ${a.label}: not rated`
        : `- ${a.label}: ${a.teamRating.toFixed(1)} out of 10 (median of ${a.raterCount} officer${a.raterCount === 1 ? "" : "s"})`,
    )
    .join("\n");

  const drills = prospect.drills
    .map((d) => {
      if (d.best === null) return `- ${d.drill.label}: not measured`;
      const pct =
        d.percentile !== null
          ? `, ${d.percentile}th percentile in this tryout class`
          : " (percentile not yet meaningful — too few measured)";
      return `- ${d.drill.label}: ${formatDrillValue(d.drill, d.best)}${pct}`;
    })
    .join("\n");

  const notes = comments.length
    ? comments.map((c) => `- "${c}"`).join("\n")
    : "- none";

  // The instruction to say "limited data" rather than invent is the point of
  // this prompt. A confident three sentences about an athlete nobody has
  // rated would be worse than no summary at all, and this app's whole gating
  // rule exists to stop exactly that kind of false confidence.
  return `You are helping coaching staff at a ${template.sport.replace(/_/g, " ")} tryout summarize an athlete they are evaluating.

Write EXACTLY three sentences: one on strengths, one on concerns, one bottom-line recommendation.

Rules:
- Use ONLY the data below. Do not invent statistics, events, or observations.
- WEIGH THE OFFICER COMMENTS HEAVILY. They are eyewitness notes from people who watched this athlete, and they carry things no rating captures: attitude, coachability, injuries, conditioning, whether a number is misleading. Where a comment and a rating disagree, say so rather than picking one silently.
- If the data is thin, say so plainly (for example "limited data so far") instead of guessing.
- Ratings are medians of officer opinions on a 0-10 scale. Position ratings are on a 45-99 scale where a missing rating means not enough evaluation yet, NOT a poor athlete.
- Percentiles are within this tryout class only, never against an absolute standard.
- Be direct and specific. No preamble, no headings, no bullet points.

ATHLETE: ${prospect.fullName}, jersey #${prospect.jerseyNumber}

POSITION RATINGS:
${positions || "- none"}

JUDGED ATTRIBUTES:
${attributes || "- none"}

MEASURED DRILLS:
${drills || "- none"}

OFFICER COMMENTS:
${notes}`;
}
