# Big Board

Big Board is a full stack tryout management and evaluation platform, designed to operate tryouts/recruiting for organized sports programs: club, varsity, travel, youth and AAU teams. Created as an alternative solution to sluggish, expensive, and outdated methods or systems such as clipboards, excel, or other commonly out of scope softwares.

Evaluators rate athletes all from their phones on the field, and the app consolidates every input into live ranked boards by position. It imports rosters from spreadsheets, AI parsing/OCR, or pasted text. The eval system is intuitive to understand and the AI scout creates summaries from the data and notes already collected. Created as the VP of NCSU Club Flag Football team as an idea to streamline, coordinate, and manage tryouts efficiently and accurately and already has over roughly 40 active users

## The problem

Tryouts get run on clipboards and shared spreadsheets. Fifteen evaluators score a hundred or more athletes at once, on a field, with no live consolidation. Some evaluators see certain athletes far more than others, and nobody can tell which scores rest on one look and which on ten. Cut decisions end up driven by whoever speaks loudest rather than by the data.

Tools such as Hudl, TeamSnap and the recruiting platforms are built and priced for funded programs with dedicated staff. Nothing serves a self-organized club running a two-hour tryout on no budget. That is the gap this fills.

## How it works

Each position has a set of weighted attributes, and any evaluator rates an athlete 0 to 10 on a slider for each one their positions use.

The team rating for an attribute is the median across evaluators, not the mean, so one evaluator who rates everything a 9 cannot swing a prospect.

Measured drills such as the 40-yard dash become a percentile within the tryout class rather than a score on an absolute scale, so ratings calibrate to the talent actually present.

Ratings are gated behind minimum coverage. A position rating appears only when every weighted input has data and enough evaluators have contributed. Until then the athlete shows progress, such as "4 of 6 inputs, missing route running", instead of a number. A barely-rated 91 above a fully-vetted 84 gets the wrong athlete cut.

Boards are ranked by position rather than as one master list, because teams recruit for specific needs.

## Features

- Multi-tenant organizations with four roles: owner, admin, evaluator and viewer. Admin is granted by promotion only. Invite codes are role-scoped and rotatable; rotating stops new joins without removing anyone.
- Sport templates. Flag football and baseball ship as seeds, basketball is planned, and a template editor supports building from scratch. Weights must total 100 per position, enforced at every layer down to a database trigger.
- Selected, a shared shortlist for cut meetings, grouped by position with a sort per group.
- Roster import from CSV or Excel, a photo or screenshot, or pasted text, all landing in one editable review table.
- AI scouting summaries from an athlete's ratings, drill results and evaluator notes.
- CSV export of every drill attempt, position rating and attribute median, with columns generated from the template.
- Every evaluator writes to one shared record, and screens re-read after each save.

## AI integration

Gemini Flash handles roster extraction and scouting summaries.

The API key is server-side only and never carries a public prefix. The browser only calls the app's own authenticated routes, each of which verifies the caller is a confirmed member of the organization at a sufficient role before anything leaves for Google. A build-time check fails if the key is referenced from any client component.

Every route enforces a per-user and a global daily cap, counted in an ai_usage table.

AI output never writes directly to the database. Roster extraction is told to return null for anything it cannot read confidently, and its output lands in an editable review table with flagged fields highlighted. A hallucinated 40 time is worse than a blank field: the blank gets fixed, the plausible wrong value gets imported.

## Tech stack

Next.js App Router, TypeScript, Tailwind, Supabase for Postgres, Auth and Storage, the Gemini API, and Vercel.

The data layer carries most of the design. Row-level security policies enforce organization isolation and role permissions on every table. SQL views handle cross-row aggregation: medians per attribute and direction-aware percentile windows per drill. pg_cron removes unconfirmed accounts after seven days and orphaned ones after thirty.

## V1 to V2

V1 shipped as a single-team tool in a compressed build: one club, one sport, accounts created by hand. That got the app onto a field in time for a real tryout.

V2 generalized it into a multi-tenant, multi-sport platform, and the rewrite was not cheap. Organization isolation meant adding an org_id to every table and rewriting every row-level security policy. Supporting more than one sport meant moving position configuration out of a TypeScript constant into organization-owned database tables.

Shipping the narrow version first produced the information needed to build the general one. The gating rule, the median and the percentile within class all came out of watching the narrow version get used.

## What's next

- Evaluator bias normalization, z-scoring each evaluator against their own distribution so a consistently harsh or generous rater stops distorting the medians.
- Historical comparison across tryout years.
- More sport templates, starting with basketball.
