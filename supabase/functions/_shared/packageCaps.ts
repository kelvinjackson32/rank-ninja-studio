// Fiverr package limits — HARD enforced server-side.
// Fiverr caps each pricing package description at 100 characters TOTAL.
// So: package name <= 100 chars, each feature <= 100 chars, and the whole
// pasteable package description (all features joined) <= 100 chars.

const MAX = 100;
const SEP = " • ";

const trim = (s: string, max = MAX) =>
  s.length > max ? s.slice(0, Math.max(1, max - 1)).trimEnd() + "…" : s;

export function capPackageFeatures(features: any[]): string[] {
  const cleaned = (features || [])
    .map((f) => String(f ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const kept: string[] = [];
  let used = 0;
  for (const f of cleaned) {
    const cost = (kept.length ? SEP.length : 0) + f.length;
    if (used + cost <= MAX) {
      kept.push(f);
      used += cost;
      continue;
    }
    // Room left for a shortened version of this feature?
    const room = MAX - used - (kept.length ? SEP.length : 0);
    if (kept.length === 0 && room > 10) {
      kept.push(trim(f, room));
      used = MAX;
    }
    break;
  }
  if (kept.length === 0 && cleaned[0]) kept.push(trim(cleaned[0], MAX));
  return kept;
}

export function capPackages(packages: any) {
  if (!packages || typeof packages !== "object") return packages;
  for (const tier of Object.keys(packages)) {
    const pk = packages[tier];
    if (!pk || typeof pk !== "object") continue;
    if (typeof pk.name === "string") pk.name = trim(pk.name.trim(), MAX);
    if (Array.isArray(pk.features)) pk.features = capPackageFeatures(pk.features);
    const desc = (pk.features || []).join(SEP);
    pk.description = trim(desc, MAX);
  }
  return packages;
}

export type PackageViolation = { tier: string; field: string; length: number; max: number; text: string };

// FINAL server-side gate. Runs AFTER capPackages. Returns exact char counts per tier
// and any item still over the 100-char Fiverr limit.
export function validatePackages(packages: any): { ok: boolean; violations: PackageViolation[]; counts: Record<string, { name: number; description: number }> } {
  const violations: PackageViolation[] = [];
  const counts: Record<string, { name: number; description: number }> = {};
  if (!packages || typeof packages !== "object") return { ok: true, violations, counts };
  for (const tier of Object.keys(packages)) {
    const pk = packages[tier];
    if (!pk || typeof pk !== "object") continue;
    const name = String(pk.name ?? "");
    const description = String(pk.description ?? (Array.isArray(pk.features) ? pk.features.join(SEP) : ""));
    counts[tier] = { name: name.length, description: description.length };
    if (name.length > MAX) violations.push({ tier, field: "name", length: name.length, max: MAX, text: name });
    if (description.length > MAX) violations.push({ tier, field: "description", length: description.length, max: MAX, text: description });
    if (Array.isArray(pk.features)) {
      for (const f of pk.features) {
        const t = String(f ?? "");
        if (t.length > MAX) violations.push({ tier, field: "feature", length: t.length, max: MAX, text: t });
      }
    }
  }
  return { ok: violations.length === 0, violations, counts };
}

// Cap + hard-block. Throws with exact char counts if anything is still over 100 chars.
export function enforcePackages(packages: any) {
  const capped = capPackages(packages);
  const { ok, violations, counts } = validatePackages(capped);
  if (!ok) {
    const detail = violations
      .map((v) => `${v.tier}.${v.field} = ${v.length}/${v.max} chars ("${v.text.slice(0, 60)}…")`)
      .join("; ");
    throw new Error(`Fiverr package limit exceeded — save blocked. ${detail}`);
  }
  return { packages: capped, counts };
}

export const PACKAGE_RULES = `PRICING PACKAGES — HARD FIVERR LIMIT:
- Fiverr allows only 100 characters TOTAL for each package description (Basic, Standard AND Premium).
- Therefore each package's "features" array must contain 2-3 VERY short benefit phrases whose COMBINED length (including " • " separators) is 100 characters or LESS. Never exceed it.
- Package "name" must be <= 100 characters (aim for 2-4 words).
- Write telegraphic, punchy phrases (e.g. "30s AI reel", "1080p file", "2 revisions") — no full sentences.`;
