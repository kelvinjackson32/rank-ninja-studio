import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ScrapeResult = {
  url: string;
  markdown: string;
  metadata: any;
  source: "apify" | "firecrawl";
};

const FUNCTION_DEADLINE_MS = 132_000;
const startedAt = () => Date.now();
const msLeft = (start: number, reserve = 8_000) => Math.max(1_000, FUNCTION_DEADLINE_MS - (Date.now() - start) - reserve);
const hasTimeFor = (start: number, ms: number) => msLeft(start, 0) > ms;

const FIVERR_BLOCKED_PATTERNS = /access denied|captcha|robot|unusual traffic|enable javascript|page not found|not available|sorry, we couldn't find|log in to fiverr|join fiverr/i;

function canonicalUrl(raw: string | undefined | null): string {
  const value = (raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value.startsWith("http") ? value : `https://www.fiverr.com/${value.replace(/^@/, "")}`);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return value;
  }
}

function normalizeProfileInput(raw?: string): string | undefined {
  const value = (raw || "").trim();
  if (!value) return undefined;
  if (!/^https?:\/\//i.test(value) && !value.includes("/")) {
    return `https://www.fiverr.com/${value.replace(/^@/, "")}`;
  }
  return canonicalUrl(value);
}

function getFiverrUsername(raw?: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://www.fiverr.com/${raw}`);
    const [username] = url.pathname.split("/").filter(Boolean);
    if (!username || ["categories", "search", "gigs", "users", "support", "inbox"].includes(username.toLowerCase())) return null;
    return username;
  } catch {
    return null;
  }
}

function isLikelyGigUrl(raw: string, username?: string | null): boolean {
  try {
    const url = new URL(raw);
    if (!/fiverr\.com$/i.test(url.hostname.replace(/^www\./, ""))) return false;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return false;
    if (username && parts[0].toLowerCase() !== username.toLowerCase()) return false;
    const second = parts[1].toLowerCase();
    return !["portfolio", "reviews", "about", "seller_dashboard", "users"].includes(second);
  } catch {
    return false;
  }
}

function looksUsable(markdown: string): boolean {
  const text = (markdown || "").trim();
  if (text.length < 250) return false;
  if (FIVERR_BLOCKED_PATTERNS.test(text) && text.length < 2500) return false;
  return true;
}

function extractApifyMarkdown(item: any): string {
  const meta = item?.metadata || {};
  const chunks = [
    meta.title && `Title: ${meta.title}`,
    meta.description && `Meta description: ${meta.description}`,
    item?.markdown,
    item?.text,
    item?.description,
    item?.html && String(item.html).replace(/<[^>]+>/g, " "),
  ].filter(Boolean);
  return chunks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function apifyCrawl(startUrls: string[], opts: { maxCrawlDepth: number; maxPages: number; timeoutMs?: number }): Promise<ScrapeResult[]> {
  const token = Deno.env.get("APIFY_API_TOKEN");
  if (!token || startUrls.length === 0) return [];

  const actor = (Deno.env.get("APIFY_FIVERR_ACTOR_ID") || "apify/website-content-crawler").replace("/", "~");
  const resp = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      startUrls: startUrls.map((url) => ({ url: canonicalUrl(url) })),
      crawlerType: "playwright:firefox",
      maxCrawlDepth: opts.maxCrawlDepth,
      maxCrawlPages: opts.maxPages,
      maxResults: opts.maxPages,
      useSitemaps: false,
      respectRobotsTxtFile: false,
      proxyConfiguration: { useApifyProxy: true },
      dynamicContentWaitSecs: 6,
      requestTimeoutSecs: 24,
      maxRequestRetries: 1,
      maxSessionRotations: 4,
      removeCookieWarnings: true,
      blockMedia: true,
      htmlTransformer: "none",
      saveMarkdown: true,
      removeElementsCssSelector: "script, style, noscript, svg, img[src^='data:']",
    }),
    signal: AbortSignal.timeout(opts.timeoutMs || 42_000),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    console.error(`Apify ${resp.status}: ${txt.slice(0, 300)}`);
    return [];
  }

  const data = await resp.json().catch(() => []);
  const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
  return items.map((item: any) => {
    const metadata = item?.metadata || {};
    const url = canonicalUrl(item?.url || item?.loadedUrl || item?.sourceUrl || metadata.sourceURL || "");
    return {
      url,
      markdown: extractApifyMarkdown(item).slice(0, 20000),
      metadata,
      source: "apify" as const,
    };
  }).filter((item) => item.url && looksUsable(item.markdown));
}

// Try Firecrawl with retry. Fiverr aggressively blocks bots, so we attempt twice
// with different waits, then gracefully give up so the audit still runs.
async function firecrawlScrape(url: string, timeoutMs = 22_000): Promise<{ markdown: string; metadata: any } | null> {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) {
    console.warn("FIRECRAWL_API_KEY missing — skipping live scrape");
    return null;
  }
  const attempts = [
    { waitFor: 4000, onlyMainContent: true },
    { waitFor: 8000, onlyMainContent: false },
  ];
  for (const opts of attempts) {
    try {
      const resp = await fetch("https://api.firecrawl.dev/v2/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          formats: ["markdown"],
          onlyMainContent: opts.onlyMainContent,
          waitFor: opts.waitFor,
          location: { country: "US", languages: ["en"] },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!resp.ok) {
        console.error(`Firecrawl ${resp.status} for ${url}`);
        continue;
      }
      const data = await resp.json();
      const md: string = data.data?.markdown || data.markdown || "";
      const meta = data.data?.metadata || data.metadata || {};
      if (md && md.trim().length > 250) {
        return { markdown: md.slice(0, 16000), metadata: meta };
      }
      console.warn(`Firecrawl returned thin content (${md.length} chars) for ${url}`);
    } catch (e) {
      console.error("firecrawl error", url, (e as Error).message);
    }
  }
  return null;
}

async function scrapeSingle(url: string, timeoutMs = 34_000): Promise<ScrapeResult | null> {
  const normalized = canonicalUrl(url);
  const apify = await apifyCrawl([normalized], { maxCrawlDepth: 0, maxPages: 1, timeoutMs }).catch((e) => {
    console.error("apify single error", normalized, (e as Error).message);
    return [];
  });
  if (apify[0]) return apify[0];

  const firecrawl = await firecrawlScrape(normalized, Math.min(18_000, timeoutMs));
  if (firecrawl && looksUsable(firecrawl.markdown)) {
    return { url: normalized, markdown: firecrawl.markdown, metadata: firecrawl.metadata, source: "firecrawl" };
  }
  return null;
}

function unavailableAudit(target: "PROFILE" | "GIG", url: string, reason: string) {
  return {
    overall_score: 0,
    verdict: `${target === "PROFILE" ? "Profile" : "Gig"} could not be read from Fiverr, so no real setup audit was generated for this link.`,
    strengths: [],
    critical_issues: [{
      area: "Live data access",
      severity: "high",
      problem: reason,
      why_it_hurts: "Without the live Fiverr title, description, tags, packages, reviews, and profile text, the audit would be guessing instead of showing what to edit.",
      fix: "Check that the URL is public and spelled correctly. If the page opens in your browser but still fails here, Fiverr is blocking automated access for that page; paste the gig/profile text into AI Chat for a manual audit.",
    }],
    rewrites: {},
    action_plan: [{
      step: 1,
      action: "Open the Fiverr link in a private browser window to confirm buyers can see it publicly.",
      expected_impact: "Confirms whether the account or gig is hidden, paused, removed, or blocked from public view.",
      time_to_apply: "2 min",
    }],
    image_prompts: [],
    _scraped: false,
    _source: null,
    _url: url,
  };
}

async function callAI(prompt: string, system: string, geminiKey: string, timeoutMs = 45_000): Promise<string> {
  if (!geminiKey) {
    throw new Error("No Gemini API key configured. Open Settings → AI Generation and paste your Google Gemini API key.");
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 8192 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (resp.status === 429) {
    const txt = await resp.text();
    const isNoQuota = /limit:\s*0|quota exceeded|free_tier_requests/i.test(txt);
    throw new Error(isNoQuota
      ? "Gemini key is recognized, but its Google project has no Gemini generation quota. Use a key from a Google AI Studio project with Gemini API quota/billing."
      : "Gemini quota/rate limit hit for this key. Wait a moment or switch to another Google project key.");
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new Error("Gemini API key invalid or unauthorized. Update it in Settings → AI Generation.");
  }
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("\n") || "";
}

function safeParseJSON(raw: string): any {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}

const AUDIT_SHAPE = `{
  "overall_score": <0-100>,
  "verdict": "<one-sentence diagnosis>",
  "top_issues_summary": ["short bullet naming each critical issue affecting this account/gig"],
  "strengths": ["..."],
  "critical_issues": [
    { "area": "Title|Tags|Gig Description|Profile Bio|Buyer Requirements|Pricing|Images|Packages|SEO|Ranking|Trust", "severity": "high|medium|low", "problem": "...", "why_it_hurts": "...", "fix": "..." }
  ],
  "rewrites": {
    "gig_title": { "current": "...", "improved": "<NEW perfect Fiverr gig title, <= 80 chars, keyword-front-loaded, buyer-intent, high-CTR>", "reason": "..." },
    "tags": { "current": ["..."], "improved": ["..."], "reason": "..." },
    "search_tags": { "improved": ["..."], "reason": "..." },
    "gig_description": { "current_snippet": "...", "improved": "<NEW gig-specific description, 1000-1200 chars, 5 sections: ABOUT THIS GIG / WHAT YOU GET / WHY CHOOSE ME / MY PROCESS / READY TO ORDER (CTA). Use line breaks and ✅ sparingly. Must be about the GIG offering, NOT the seller bio.>", "reason": "..." },
    "profile_description": { "current_snippet": "...", "improved": "<NEW profile bio, 600-900 chars, first-person, hooks in first line, positions the SELLER (skills, experience, results), ends with CTA to order. Different from the gig description.>", "reason": "..." },
    "buyer_requirements": { "improved": ["<clear question 1 to ask the buyer before starting>", "<question 2>", "<question 3>", "<question 4>", "<question 5>"], "reason": "why these requirements reduce revisions and speed delivery" },
    "packages": { "improved": [{ "name": "Basic|Standard|Premium", "price": 0, "delivery_days": 0, "revisions": 0, "includes": ["..."] }], "reason": "..." }
  },
  "ranking_tips": ["specific Fiverr ranking action (SEO tags, first 24h impressions, response rate, delivery time, buyer requests, promoted gigs, video, portfolio, niche-down) — 5 to 8 tips"],
  "account_edits": [
    { "where_to_edit": "Profile → Description | Gig → Overview → Title | Gig → Description | Gig → Gallery | Gig → Requirements | Gig → Pricing | Profile → Skills | Profile → Languages", "what_to_change": "...", "priority": "high|medium|low" }
  ],
  "action_plan": [{ "step": 1, "action": "...", "expected_impact": "...", "time_to_apply": "5 min" }],
  "image_prompts": [{ "slot": "Thumbnail 1|2|3", "prompt": "<PREMIUM 1280x769 Fiverr gig thumbnail prompt. Must include: bold subject centered/left, high contrast background, 2-4 word overlay hook, brand color accent, professional lighting, mock UI or product visible, buyer-benefit-driven text, no watermark, sharp typography (bold sans-serif). Optimized for top-1% CTR>" }]
}`;

async function auditOne(opts: {
  niche?: string; issue?: string;
  profile?: ScrapeResult | null;
  gig?: ScrapeResult | null;
  geminiKey: string;
  timeoutMs?: number;
}) {
  const target = opts.gig ? "GIG" : "PROFILE";
  const item = opts.gig || opts.profile;
  const url = item?.url || "";
  const markdown = item?.markdown;
  const scraped = !!markdown;

  const system = `You are a Fiverr ranking expert who has reverse-engineered what makes top-1% sellers convert. Output ONLY valid JSON, no markdown fences, no commentary.`;

  const scrapedBlock = `=== LIVE SCRAPED FIVERR CONTENT VIA ${item?.source?.toUpperCase() || "SCRAPER"} (${url}) ===\n${markdown}\n`;

  const prompt = `Audit this Fiverr ${target}. Return STRICT JSON ONLY (no fences) in this EXACT shape:
${AUDIT_SHAPE}

Niche: ${opts.niche || "infer from URL slug"}
User-reported problem: ${opts.issue || "low impressions, low clicks, no orders"}

${scrapedBlock}

Rules:
- Be brutally honest, specific, and actionable. No fluff.
- Use the ACTUAL scraped Fiverr setup. Quote the exact existing weak title / bio / description / package / image / trust signal you see, THEN rewrite it.
- rewrites.gig_title MUST be a NEW perfect gig title (never repeat the current one).
- rewrites.gig_description is about the GIG service (what buyer gets). rewrites.profile_description is about the SELLER (bio). They must be clearly different.
- rewrites.buyer_requirements = the questions to ask buyer at order start, tailored to this niche.
- top_issues_summary = 3-6 short bullets naming the biggest issues affecting this account (used as visible warning chips).
- account_edits = concrete list of "go here → change this" edits inside Fiverr, ordered by priority.
- ranking_tips = Fiverr-specific SEO/ranking moves (impressions, CTR, response rate, delivery, buyer requests, promoted gigs, video, niche-down).
- 3 image_prompts, each PREMIUM 1280x769, high-CTR, buyer-magnet quality — assume the current thumbnail is weak unless clearly stated otherwise.
- 5 search tags max, each <20 chars, lowercase.
- 5–8 critical_issues, mix of severities, each with concrete fix.
- 3–6 action_plan steps, ordered by impact, with realistic time estimates.`;

  const raw = await callAI(prompt, system, opts.geminiKey, opts.timeoutMs || 45_000);
  const parsed = safeParseJSON(raw);
  if (!parsed) {
    return {
      overall_score: 0,
      verdict: "AI did not return valid JSON. Re-run the audit.",
      strengths: [],
      critical_issues: [],
      rewrites: {},
      action_plan: [],
      image_prompts: [],
      _scraped: scraped,
    };
  }
  parsed._scraped = scraped;
  parsed._source = item?.source || null;
  return parsed;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const requestStart = startedAt();
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Load the signed-in user's Gemini key — required for any AI generation.
    const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: settings } = await admin
      .from("user_ai_settings")
      .select("gemini_api_key")
      .eq("user_id", user.id)
      .maybeSingle();
    const geminiKey = (settings?.gemini_api_key || "").trim();
    if (!geminiKey) {
      return new Response(JSON.stringify({
        error: "No Gemini API key configured. Open Settings → AI Generation and paste your Google Gemini API key (free at https://aistudio.google.com/apikey).",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const profileUrl: string | undefined = normalizeProfileInput(body.profileUrl);
    const username = getFiverrUsername(profileUrl);
    const niche: string | undefined = body.niche?.trim();
    const issue: string | undefined = body.issue?.trim();
    const gigUrls: string[] = Array.isArray(body.gigUrls)
      ? body.gigUrls.map((u: string) => canonicalUrl(u)).filter(Boolean)
      : (body.gigUrl?.trim() ? [canonicalUrl(body.gigUrl.trim())] : []);

    if (!profileUrl && gigUrls.length === 0) {
      return new Response(JSON.stringify({ error: "Provide a profile URL and/or one or more gig URLs." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // First let Apify crawl the profile page. This can discover public gig links that
    // Fiverr hides from simple HTTP scrapers, then every missing direct gig gets a focused scrape.
    const profileCrawl = profileUrl && hasTimeFor(requestStart, 42_000)
      ? await apifyCrawl([profileUrl], { maxCrawlDepth: 1, maxPages: 8, timeoutMs: Math.min(38_000, msLeft(requestStart, 52_000)) }).catch((e) => {
        console.error("apify profile crawl error", (e as Error).message);
        return [] as ScrapeResult[];
      })
      : [];

    const profileScrape = profileUrl
      ? (profileCrawl.find((item) => !isLikelyGigUrl(item.url, username) && getFiverrUsername(item.url)?.toLowerCase() === username?.toLowerCase())
        || (hasTimeFor(requestStart, 34_000) ? await scrapeSingle(profileUrl, Math.min(28_000, msLeft(requestStart, 58_000))) : null))
      : null;

    const discoveredGigUrls = profileCrawl
      .filter((item) => isLikelyGigUrl(item.url, username))
      .map((item) => canonicalUrl(item.url));

    const allRequestedGigUrls = Array.from(new Set([...gigUrls, ...discoveredGigUrls]));
    const allGigUrls = allRequestedGigUrls.slice(0, 3);
    const skippedGigs = allRequestedGigUrls.slice(3);

    const gigScrapes = await Promise.all(allGigUrls.map(async (url) => {
      const fromProfileCrawl = profileCrawl.find((item) => canonicalUrl(item.url) === canonicalUrl(url));
      const r = fromProfileCrawl || (hasTimeFor(requestStart, 30_000) ? await scrapeSingle(url, Math.min(26_000, msLeft(requestStart, 48_000))) : null);
      return { url, r };
    }));

    const failedGigs = gigScrapes.filter((g) => !g.r).map((g) => g.url);

    const profileAuditPromise = profileUrl
      ? (profileScrape
        ? (hasTimeFor(requestStart, 26_000)
          ? auditOne({ niche, issue, profile: profileScrape, geminiKey, timeoutMs: Math.min(32_000, msLeft(requestStart, 18_000)) }).catch((e: any) =>
            unavailableAudit("PROFILE", profileUrl, `Audit generation took too long or failed: ${e.message}`)
          )
          : Promise.resolve(unavailableAudit("PROFILE", profileUrl, "The audit stopped before the backend timeout. Re-run with fewer gig links or paste one gig URL at a time for a deeper audit.")))
        : Promise.resolve(unavailableAudit("PROFILE", profileUrl, "The Fiverr profile was not found or Fiverr returned a blocked/empty page to the scraper.")))
      : Promise.resolve(null);

    const gigAuditPromises = gigScrapes.map(async (g) => {
      try {
        const audit = g.r
          ? (hasTimeFor(requestStart, 24_000)
            ? await auditOne({ niche, issue, gig: g.r, geminiKey, timeoutMs: Math.min(30_000, msLeft(requestStart, 12_000)) })
            : unavailableAudit("GIG", g.url, "The audit stopped before the backend timeout. Re-run this single gig URL for a deeper audit."))
          : unavailableAudit("GIG", g.url, "The Fiverr gig was not found, paused/private, misspelled, or blocked by Fiverr before Apify/Firecrawl could read its setup.");
        const title = g.r?.metadata?.title || g.url.split("/").pop() || g.url;
        return { url: g.url, title, audit };
      } catch (e: any) {
        return {
          url: g.url,
          title: g.url.split("/").pop() || g.url,
          audit: {
            overall_score: 0,
            verdict: `Audit error: ${e.message}`,
            strengths: [], critical_issues: [], rewrites: {}, action_plan: [], image_prompts: [],
          },
        };
      }
    });

    const [profileAudit, gigAudits] = await Promise.all([profileAuditPromise, Promise.all(gigAuditPromises)]);

    const ranked = gigAudits
      .map((g) => {
        const issues = g.audit?.critical_issues || [];
        const high = issues.filter((i: any) => i.severity === "high").length;
        const med = issues.filter((i: any) => i.severity === "medium").length;
        const low = issues.filter((i: any) => i.severity === "low").length;
        const score = g.audit?.overall_score ?? 50;
        const priority = (100 - score) + high * 15 + med * 6 + low * 2;
        return { ...g, priority, high, med, low, score };
      })
      .sort((a, b) => b.priority - a.priority)
      .map((g, i) => ({ ...g, rank: i + 1 }));

    return new Response(JSON.stringify({
      success: true,
      profileAudit,
      gigAudits: ranked,
      failedGigs,
      skippedGigs,
      blockedNote: failedGigs.length > 0 || (profileUrl && !profileScrape) || (profileUrl && allGigUrls.length === 0)
        ? "Apify was used first to inspect the Fiverr profile/gigs. Some pages still could not be found or read publicly, so those items are marked clearly instead of generating a guessed audit."
        : null,
      audit: profileAudit || ranked[0]?.audit || null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("audit error", e);
    return new Response(JSON.stringify({ error: e.message || "Audit failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
