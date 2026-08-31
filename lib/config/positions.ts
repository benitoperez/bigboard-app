export const ATTRIBUTES = {
  catching:        { label: "Catching",        short: "CTH" },
  quickness:       { label: "Quickness",       short: "QCK" },
  route_running:   { label: "Route Running",   short: "RTE" },
  coverage:        { label: "Coverage",        short: "COV" },
  flag_pulling:    { label: "Flag Pulling",    short: "FLG" },
  throwing_power:  { label: "Throwing Power",  short: "PWR" },
  accuracy:        { label: "Accuracy",        short: "ACC" },
  pocket_movement: { label: "Pocket Movement", short: "PKT" },
  blocking:        { label: "Blocking",        short: "BLK" },
} as const;

export type AttributeKey = keyof typeof ATTRIBUTES;
export type PositionKey = "WR" | "DB" | "LB" | "R" | "QB" | "OL";

export const POSITIONS: Record<PositionKey, {
  label: string;
  attributes: AttributeKey[];
  weights: Partial<Record<AttributeKey | "speed", number>>;
}> = {
  WR: {
    label: "Wide Receiver",
    attributes: ["catching", "quickness", "route_running"],
    weights: { catching: 30, quickness: 20, route_running: 20, speed: 30 },
  },
  DB: {
    label: "Defensive Back",
    attributes: ["coverage", "quickness", "flag_pulling"],
    weights: { coverage: 30, quickness: 20, flag_pulling: 20, speed: 30 },
  },
  LB: {
    label: "Linebacker",
    attributes: ["coverage", "flag_pulling", "quickness"],
    weights: { coverage: 30, flag_pulling: 25, quickness: 20, speed: 25 },
  },
  R: {
    label: "Rusher",
    attributes: ["quickness", "flag_pulling"],
    weights: { quickness: 35, flag_pulling: 30, speed: 35 },
  },
  QB: {
    label: "Quarterback",
    attributes: ["throwing_power", "accuracy", "pocket_movement"],
    weights: { accuracy: 35, throwing_power: 30, pocket_movement: 20, speed: 15 },
  },
  OL: {
    label: "Offensive Line",
    attributes: ["blocking", "catching", "quickness"],
    weights: { blocking: 40, quickness: 25, catching: 20, speed: 15 },
  },
};

// Board display order on the dashboard. Editable, not hardcoded in components.
export const BOARD_ORDER: PositionKey[] = ["QB", "R", "WR", "DB", "LB", "OL"];

// Gating thresholds
export const MIN_RATINGS_FOR_DISPLAY = 3;   // total officer inputs for a position
export const MIN_TIMED_FOR_PERCENTILE = 15; // prospects with a 40 before percentile is valid
export const MAX_FORTY_ATTEMPTS = 2;
