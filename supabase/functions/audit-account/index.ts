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

const FIVERR_BLOCKED_PATTERNS = /access denied|captcha|robot|unusual traffic|enable javascript|page not found|not available|sorry, we couldn't find|log in to fiverr|join fiverr/i;

function canonicalUrl(raw: string): string {
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://www.fiverr.com/${raw.replace(/^@/, "")}`);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return raw.trim();
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

async function apifyCrawl(startUrls: string[], opts: { maxCrawlDepth: number; maxPages: number }): Promise<ScrapeResult[]> {
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
      dynamicContentWaitSecs: 12,
      requestTimeoutSecs: 45,
      maxRequestRetries: 2,
      maxSessionRotations: 8,
      removeCookieWarnings: true,
      blockMedia: true,
      htmlTransformer: "none",
      saveMarkdown: true,
      removeElementsCssSelector: "script, style, noscript, svg, img[src^='data:']",
    }),
    signal: AbortSignal.timeout(95_000),
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
async function firecrawlScrape(url: string): Promise<{ markdown: string; metadata: any } | null> {
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
        signal: AbortSignal.timeout(45_000),
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

async function scrapeSingle(url: string): Promise<ScrapeResult | null> {
  const normalized = canonicalUrl(url);
  const apify = await apifyCrawl([normalized], { maxCrawlDepth: 0, maxPages: 1 }).catch((e) => {
    console.error("apify single error", normalized, (e as Error).message);
    return [];
  });
  if (apify[0]) return apify[0];

  const firecrawl = await firecrawlScrape(normalized);
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

async function callAI(prompt: string, system: string, geminiKey: string): Promise<string> {
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
    signal: AbortSignal.timeout(90_000),
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
  "strengths": ["..."],
  "critical_issues": [
    { "area": "Title|Tags|Description|Pricing|Images|Profile Bio|Skills|Packages|SEO|Trust", "severity": "high|medium|low", "problem": "...", "why_it_hurts": "...", "fix": "..." }
  ],
  "rewrites": {
    "title": { "current": "...", "improved": "...", "reason": "..." },
    "tags": { "current": ["..."], "improved": ["..."], "reason": "..." },
    "description": { "improved": "...", "reason": "..." },
    "profile_bio": { "improved": "...", "reason": "..." },
    "packages": { "improved": [{ "name": "Basic|Standard|Premium", "price": 0, "delivery_days": 0, "revisions": 0, "includes": ["..."] }], "reason": "..." },
    "search_tags": { "improved": ["..."], "reason": "..." }
  },
  "action_plan": [{ "step": 1, "action": "...", "expected_impact": "...", "time_to_apply": "5 min" }],
  "image_prompts": [{ "slot": "Thumbnail 1|2|3", "prompt": "1280x769 detailed prompt..." }]
}`;

async function auditOne(opts: {
  niche?: string; issue?: string;
  profile?: ScrapeResult | null;
  gig?: ScrapeResult | null;
  geminiKey: string;
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
- Use the scraped Fiverr setup only. Mention the exact existing weak title/profile bio/description/package/image/trust signals you see before rewriting them.
- Tell the seller exactly where to edit inside Fiverr: Profile headline/bio, Gig title, Gallery image, Search tags, Description, FAQ, Packages, Requirements, Pricing, Portfolio, or Reviews/trust.
- Compare against top-ranking sellers in this niche.
- Description rewrite MUST be 1000–1150 chars using the 5-section skeleton: ABOUT THIS GIG / WHAT YOU GET / WHY CHOOSE ME / WHAT I NEED FROM YOU / READY TO ORDER (CTA). Use line breaks, ✅ ✔️ 🔥 sparingly.
- Profile bio rewrite 600–1000 chars, hooks first sentence, ends with CTA.
- 5 search tags max, each <20 chars, lowercase, ranking-keyword-stuffed.
- 3 thumbnail prompts, each 1280x769, niche-specific, high CTR (bold subject, contrast, 2–4 word overlay text).
- 5–8 critical_issues, mix of severities, each with concrete fix.
- 3–6 action_plan steps, ordered by impact, with realistic time estimates.`;

  const raw = await callAI(prompt, system, opts.geminiKey);
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
    const profileUrl: string | undefined = body.profileUrl?.trim();
    const niche: string | undefined = body.niche?.trim();
    const issue: string | undefined = body.issue?.trim();
    const gigUrls: string[] = Array.isArray(body.gigUrls)
      ? body.gigUrls.map((u: string) => u?.trim()).filter(Boolean)
      : (body.gigUrl?.trim() ? [body.gigUrl.trim()] : []);

    if (!profileUrl && gigUrls.length === 0) {
      return new Response(JSON.stringify({ error: "Provide a profile URL and/or one or more gig URLs." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Cap gigs to avoid timeout (Edge functions have hard limits)
    const cappedGigs = gigUrls.slice(0, 6);
    const skippedGigs = gigUrls.slice(6);

    // Scrape everything in parallel — failures return null and we still audit.
    const profilePromise = profileUrl ? firecrawlScrape(profileUrl) : Promise.resolve(null);
    const gigPromises = cappedGigs.map((u) => firecrawlScrape(u).then((r) => ({ url: u, r })));
    const [profileScrape, gigScrapes] = await Promise.all([profilePromise, Promise.all(gigPromises)]);

    const failedGigs = gigScrapes.filter((g) => !g.r).map((g) => g.url);

    // Audit profile + gigs in parallel; even blocked URLs still get an AI audit.
    const profileAuditPromise = profileUrl
      ? auditOne({ niche, issue, profile: { url: profileUrl, markdown: profileScrape?.markdown || null }, geminiKey })
      : Promise.resolve(null);

    const gigAuditPromises = gigScrapes.map(async (g) => {
      try {
        const audit = await auditOne({ niche, issue, gig: { url: g.url, markdown: g.r?.markdown || null }, geminiKey });
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
      blockedNote: failedGigs.length > 0
        ? "Fiverr blocked live scraping for some URLs. The AI audit ran on the URL + niche context — results are still actionable but copy-check against the live page."
        : null,
      audit: profileAudit || ranked[0]?.audit || null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("audit error", e);
    return new Response(JSON.stringify({ error: e.message || "Audit failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
