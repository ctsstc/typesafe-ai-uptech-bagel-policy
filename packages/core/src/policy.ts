// Tiers follow the headings of https://www.uptechstudio.com/bagels. Severity drives the overall verdict.
export const SEVERITY = {
  proper: 0,
  acceptable: 1,
  borderline: 2,
  violation: 3,
  just_stop: 4,
} as const;
export type Severity = (typeof SEVERITY)[keyof typeof SEVERITY];
export type VerdictId = keyof typeof SEVERITY;

type Tier = { readonly label: string; readonly severity: Severity | null };

export const BAGEL_TIERS = {
  proper: { label: "Proper", severity: SEVERITY.proper },
  acceptable: { label: "Acceptable", severity: SEVERITY.acceptable },
  not_a_bagel: { label: "Not a bagel", severity: SEVERITY.violation },
  unspecified: { label: "Not specified", severity: null },
} as const satisfies Record<string, Tier>;

export const SPREAD_TIERS = {
  proper: { label: "Proper", severity: SEVERITY.proper },
  acceptable: { label: "Acceptable", severity: SEVERITY.acceptable },
  garden_veggie: { label: "No", severity: SEVERITY.violation },
  sweet: { label: "No sweets", severity: SEVERITY.violation },
  none: { label: "None", severity: null },
} as const satisfies Record<string, Tier>;

export const TOPPING_TIERS = {
  proper: { label: "Proper", severity: SEVERITY.proper },
  acceptable: { label: "Acceptable", severity: SEVERITY.acceptable },
  borderline: { label: "Borderline", severity: SEVERITY.borderline },
  misc_vegetables: { label: "No", severity: SEVERITY.violation },
  just_stop: { label: "Just stop", severity: SEVERITY.just_stop },
  none: { label: "None", severity: null },
} as const satisfies Record<string, Tier>;

export type BagelTier = keyof typeof BAGEL_TIERS;
export type SpreadTier = keyof typeof SPREAD_TIERS;
export type ToppingTier = keyof typeof TOPPING_TIERS;

export const SECTIONS = {
  bagel: { title: "Bagel", tiers: BAGEL_TIERS },
  spread: { title: "Cream cheese", tiers: SPREAD_TIERS },
  toppings: { title: "Toppings", tiers: TOPPING_TIERS },
} as const;
export type SectionId = keyof typeof SECTIONS;
export const SECTION_IDS = Object.keys(SECTIONS) as SectionId[];

export const VERDICTS: Record<VerdictId, { label: string; blurb: string }> = {
  proper: { label: "Proper", blurb: "Fully compliant. Your values are aligned." },
  acceptable: { label: "Acceptable", blurb: "Tasty, but outside of canon. No action required." },
  borderline: {
    label: "Borderline",
    blurb: "Strictly speaking wrong, but some people believe it has its place.",
  },
  violation: { label: "Violation", blurb: "Subject to disciplinary action." },
  just_stop: { label: "Just stop", blurb: "A crime against bagels. HR has been notified." },
};

export const INPUT_KIND_IDS = ["bagel_order", "other_food", "not_food", "nonsense"] as const;
export type InputKindId = (typeof INPUT_KIND_IDS)[number];
