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

export const PACKAGE_RULES = `PRICING PACKAGES — HARD FIVERR LIMIT:
- Fiverr allows only 100 characters TOTAL for each package description (Basic, Standard AND Premium).
- Therefore each package's "features" array must contain 2-3 VERY short benefit phrases whose COMBINED length (including " • " separators) is 100 characters or LESS. Never exceed it.
- Package "name" must be <= 100 characters (aim for 2-4 words).
- Write telegraphic, punchy phrases (e.g. "30s AI reel", "1080p file", "2 revisions") — no full sentences.`;
