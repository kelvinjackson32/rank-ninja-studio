// Fiverr Policy Safety Filter
// Strips/flags risky wording before output reaches the user so they can
// safely paste into Fiverr without triggering common suspension reasons.

export type SafetyFlag = {
  field: string;
  category:
    | "guarantee"
    | "external_contact"
    | "payment_offsite"
    | "spam_claim"
    | "restricted"
    | "keyword_stuffing";
  original: string;
  replacement: string;
};

export type SafetyReport = {
  applied_at: string;
  total_fixes: number;
  flags: SafetyFlag[];
  notes: string[];
};

// --- Pattern libraries ----------------------------------------------------

const GUARANTEE_PATTERNS: { re: RegExp; replace: string }[] = [
  { re: /\b(100%|guaranteed|guarantee)\s+(ranking|rank|first\s*page|top\s*rank|results?)\b/gi, replace: "strong $2 focus" },
  { re: /\bguarantee(d|s)?\b/gi, replace: "aim for" },
  { re: /\b100%\s+(satisfaction|success|results?)\b/gi, replace: "high $1" },
  { re: /\b(rank|ranking)\s+(?:on|in)\s+(?:fiverr\s+)?(?:first|1st|top)\s*page\b/gi, replace: "improved visibility" },
  { re: /\bovernight\s+(success|results?|ranking)\b/gi, replace: "fast $1" },
  { re: /\bget\s+(?:you\s+)?rich\b/gi, replace: "grow your business" },
];

const EXTERNAL_CONTACT_PATTERNS: { re: RegExp; replace: string }[] = [
  { re: /\b(whats?app|telegram|signal|discord|skype|wechat|viber)\b[^.\n]*/gi, replace: "Fiverr inbox" },
  { re: /\b(?:contact|message|reach|dm|text|call)\s+me\s+(?:on|via|through|at)\s+[^.\n]+/gi, replace: "message me on Fiverr" },
  { re: /\b(?:my\s+)?(?:email|gmail|outlook)\s*(?:is|:)?\s*[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, replace: "send a Fiverr message" },
  { re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, replace: "" },
  { re: /\+?\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g, replace: "" },
  { re: /https?:\/\/(?!(?:www\.)?fiverr\.com)[^\s)]+/gi, replace: "" },
  { re: /\b(?:visit|check|see)\s+(?:my|our)\s+(?:website|site|portfolio link)\b[^.\n]*/gi, replace: "see my Fiverr profile" },
];

const PAYMENT_OFFSITE_PATTERNS: { re: RegExp; replace: string }[] = [
  { re: /\b(?:pay|payment|paid)\s+(?:outside|off|outside\s+of)\s+fiverr\b[^.\n]*/gi, replace: "all payments handled on Fiverr" },
  { re: /\b(?:paypal|venmo|cash\s*app|zelle|wise|payoneer|crypto|bitcoin|usdt)\b[^.\n]*/gi, replace: "" },
  { re: /\b(?:direct|bank|wire)\s+(?:transfer|deposit|payment)\b[^.\n]*/gi, replace: "" },
];

const SPAM_PATTERNS: { re: RegExp; replace: string }[] = [
  { re: /\b(?:cheap(?:est)?|lowest\s+price|unbeatable\s+price|best\s+price\s+ever)\b/gi, replace: "fair pricing" },
  { re: /\b(?:#1|number\s+one|best\s+seller\s+ever|world['']?s\s+best)\b/gi, replace: "highly-rated" },
  { re: /\b(?:hurry|act\s+now|limited\s+time\s+offer|don['']?t\s+miss)\b/gi, replace: "available now" },
  { re: /!{2,}/g, replace: "!" },
  { re: /\?{2,}/g, replace: "?" },
];

const RESTRICTED_PATTERNS: { re: RegExp; replace: string }[] = [
  { re: /\b(?:fake|buy)\s+(?:reviews?|followers?|likes?|subscribers?|traffic)\b[^.\n]*/gi, replace: "" },
  { re: /\b(?:essay|exam|assignment|homework)\s+(?:writing|help|done\s+for\s+you)\b[^.\n]*/gi, replace: "" },
  { re: /\b(?:hack|hacking|crack(?:ed|ing)?|bypass\s+verification)\b[^.\n]*/gi, replace: "" },
];

// --- Core sanitizer -------------------------------------------------------

function sanitizeString(input: string, fieldPath: string, flags: SafetyFlag[]): string {
  if (!input || typeof input !== "string") return input;
  let out = input;

  const run = (
    list: { re: RegExp; replace: string }[],
    category: SafetyFlag["category"],
  ) => {
    for (const { re, replace } of list) {
      out = out.replace(re, (match) => {
        const replacement = match.replace(re, replace).trim();
        flags.push({ field: fieldPath, category, original: match.trim(), replacement });
        return replacement;
      });
    }
  };

  run(GUARANTEE_PATTERNS, "guarantee");
  run(EXTERNAL_CONTACT_PATTERNS, "external_contact");
  run(PAYMENT_OFFSITE_PATTERNS, "payment_offsite");
  run(SPAM_PATTERNS, "spam_claim");
  run(RESTRICTED_PATTERNS, "restricted");

  // Keyword stuffing: same word repeated 4+ times in a short window
  const words = out.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  const counts: Record<string, number> = {};
  for (const w of words) counts[w] = (counts[w] || 0) + 1;
  for (const [w, c] of Object.entries(counts)) {
    if (c >= 5 && words.length > 0 && c / words.length > 0.05) {
      flags.push({
        field: fieldPath,
        category: "keyword_stuffing",
        original: `"${w}" repeated ${c} times`,
        replacement: "consider varying phrasing",
      });
    }
  }

  // collapse whitespace caused by removals
  out = out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").replace(/\s+([.,;:!?])/g, "$1").trim();
  return out;
}

function walk(node: any, path: string, flags: SafetyFlag[]): any {
  if (node == null) return node;
  if (typeof node === "string") return sanitizeString(node, path, flags);
  if (Array.isArray(node)) return node.map((v, i) => walk(v, `${path}[${i}]`, flags));
  if (typeof node === "object") {
    const out: any = {};
    for (const k of Object.keys(node)) {
      if (k === "safety_report") { out[k] = node[k]; continue; } // never recurse into prior report
      out[k] = walk(node[k], path ? `${path}.${k}` : k, flags);
    }
    return out;
  }
  return node;
}

export function applySafetyFilter<T>(payload: T, rootLabel = ""): { sanitized: T; report: SafetyReport } {
  const flags: SafetyFlag[] = [];
  const sanitized = walk(payload, rootLabel, flags);
  const notes: string[] = [];
  if (flags.some((f) => f.category === "guarantee")) notes.push("Removed guarantee-style claims (a common Fiverr ToS trigger).");
  if (flags.some((f) => f.category === "external_contact")) notes.push("Stripped external contact info (emails, phones, off-platform links).");
  if (flags.some((f) => f.category === "payment_offsite")) notes.push("Removed off-Fiverr payment references.");
  if (flags.some((f) => f.category === "spam_claim")) notes.push("Softened spammy superlatives and urgency wording.");
  if (flags.some((f) => f.category === "restricted")) notes.push("Removed restricted-service phrasing.");
  if (flags.some((f) => f.category === "keyword_stuffing")) notes.push("Flagged possible keyword-stuffing — vary your phrasing.");
  return {
    sanitized,
    report: { applied_at: new Date().toISOString(), total_fixes: flags.length, flags, notes },
  };
}
