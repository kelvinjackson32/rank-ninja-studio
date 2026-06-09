// Official Fiverr field limits (as of 2025).
// Used for live validation in the editor + paste wizard.

export type FieldRule = {
  label: string;
  max?: number;          // hard char cap
  recommendedMin?: number; // soft floor (warn if shorter)
  hint?: string;
};

export const FIVERR_LIMITS = {
  // Profile
  display_name: { label: "Display Name", max: 30 },
  profile_title: { label: "Profile Title", max: 70, recommendedMin: 30 },
  short_bio: { label: "Short Bio", max: 150, recommendedMin: 80 },
  about: { label: "About / Description", max: 600, recommendedMin: 200, hint: "Fiverr caps the About section at 600 chars." },

  // Gig
  gig_title: { label: "Gig Title", max: 80, recommendedMin: 40, hint: "Must start with 'I will…'." },
  description: { label: "Gig Description", max: 1200, recommendedMin: 400 },
  search_tag: { label: "Search Tag", max: 20, hint: "Each tag ≤20 chars, lowercase, no punctuation. Max 5 tags." },
  faq_question: { label: "FAQ Question", max: 100 },
  faq_answer: { label: "FAQ Answer", max: 300 },
  requirement_question: { label: "Buyer Requirement", max: 400 },

  // Pricing packages
  package_name: { label: "Package Name", max: 100 },
  package_description: { label: "Package Description", max: 100 },
} as const;

export type FiverrFieldKey = keyof typeof FIVERR_LIMITS;

export type ValidationStatus = "ok" | "warn" | "error";

export type ValidationResult = {
  status: ValidationStatus;
  message: string;
  length: number;
  max?: number;
};

export function validateField(key: FiverrFieldKey, value: string): ValidationResult {
  const rule = FIVERR_LIMITS[key];
  const len = (value || "").length;
  const max = rule.max;
  if (max && len > max) {
    return { status: "error", message: `Exceeds Fiverr limit by ${len - max} chars`, length: len, max };
  }
  if (max && len > max * 0.95) {
    return { status: "warn", message: `Approaching limit (${max - len} chars left)`, length: len, max };
  }
  if ("recommendedMin" in rule && rule.recommendedMin && len > 0 && len < rule.recommendedMin) {
    return { status: "warn", message: `Short — aim for ${rule.recommendedMin}+ chars for better conversion`, length: len, max };
  }
  if (len === 0) {
    return { status: "warn", message: "Empty", length: 0, max };
  }
  return { status: "ok", message: `Within limit`, length: len, max };
}

// Validate a search tags array (max 5, each ≤20, lowercase, no punctuation)
export function validateSearchTags(tags: string[]): ValidationResult[] {
  return tags.map((t) => {
    const len = t.length;
    if (len > 20) return { status: "error" as const, message: `Tag too long (${len}/20)`, length: len, max: 20 };
    if (/[^a-z0-9 ]/i.test(t)) return { status: "error" as const, message: "Contains punctuation/symbols — Fiverr rejects", length: len, max: 20 };
    if (/[A-Z]/.test(t)) return { status: "warn" as const, message: "Should be lowercase", length: len, max: 20 };
    return { status: "ok" as const, message: "OK", length: len, max: 20 };
  });
}
