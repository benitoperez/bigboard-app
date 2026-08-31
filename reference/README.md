# Reference Screens

Visual reference for the Big Board build. These are design targets, not
final specs — where a screen and `../SPEC.md` disagree, the spec wins.

| File | Screen | What it shows |
|---|---|---|
| `01-home-leaderboard-top.jpg` | Home / Leaderboard | Top Overall cards (ring scores), Fastest 40-Yard Dash list |
| `02-home-leaderboard-scrolled.jpg` | Home / Leaderboard | Best Hands — Catching (bar meters), start of Top By Position |
| `03-home-top-by-position.jpg` | Home / Leaderboard | Full Top By Position boards, one card per position |
| `04-athletes-list.jpg` | Athletes | Roster list, search by name or number, position chips, overall score |
| `05-athletes-list-scrolled.jpg` | Athletes | Same list scrolled, full 10-athlete roster |
| `06-account-profile.jpg` | Account | Evaluator profile, session stats, tryout metadata, sign out |
| `07-player-eval-wr.jpg` | Player detail | WR evaluation — 0-10 sliders, 40 time, coach notes |
| `08-player-eval-qb-save.jpg` | Player detail | QB evaluation — sliders, coach notes, Save Evaluation CTA |

## Patterns worth carrying into the build

- Dark UI throughout, high contrast for outdoor/bright-sun use
- Ring gauges for overall score, horizontal bar meters for single attributes
- Color-coded position chips; initials avatars as the identity element
- Three-tab bottom nav: Home / Players / Account
- Ratings are 0-10 sliders with large touch targets; overall renders 0-100
- Every eval screen pairs sliders with a free-text Coach Notes field

## Known mismatch with SPEC.md

The screens show **QB, WR, RB, CB, S, LB**. The spec defines six positions as
**WR, DB, LB, R, QB, OL**. RB / CB / S in these mockups do not exist in the
spec, and the spec's DB, R, and OL never appear in a screen.

QB attributes also differ: screens show Throw Accuracy / Pocket Movement /
Decision Making, while the spec lists throwing_power / accuracy /
pocket_movement.

Resolve this before building the position and attribute model.
