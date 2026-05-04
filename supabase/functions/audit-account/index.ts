import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function firecrawlScrape(url: string): Promise<{ markdown: string; metadata: any } | null> {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) throw new Error("FIRECRAWL_API_KEY missing");
  try {
    const resp = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: 3500,
        location: { country: "US", languages: ["en"] },
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error(`Firecrawl ${resp.status}:`, text.slice(0, 300));
      return null;
    }
    const data = await resp.json();
    const md = data.data?.markdown || data.markdown || "";
    const meta = data.data?.metadata || data.metadata || {};
    return { markdown: String(md).slice(0, 18000), metadata: meta };
  } catch (e) {
    console.error("firecrawl error", e);
    return null;
  }
}

async function callAI(prompt: string, system: string): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
    }),
  });
  if (resp.status === 429) throw new Error("AI rate limit reached");
  if (resp.status === 402) throw new Error("AI credits exhausted");
  if (!resp.ok) throw new Error(`AI ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

function safeParseJSON(raw: string): any {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
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
  profile?: { url: string; markdown: string };
  gig?: { url: string; markdown: string };
}) {
  const system = `You are a Fiverr ranking expert. Audit a seller's content against top-performing sellers. Output ONLY valid JSON. No markdown fences.`;
  const prompt = `Audit this Fiverr ${opts.gig ? "GIG" : "PROFILE"}. Return STRICT JSON with this exact shape:
${AUDIT_SHAPE}

Niche: ${opts.niche || "infer"}
User-reported problem: ${opts.issue || "low impressions, low clicks, no orders"}

${opts.profile ? `=== PROFILE (${opts.profile.url}) ===\n${opts.profile.markdown}\n` : ""}
${opts.gig ? `=== GIG (${opts.gig.url}) ===\n${opts.gig.markdown}\n` : ""}

Be brutally honest. Compare against top sellers. Identify EXACTLY what's weak. Provide concrete copy-paste rewrites. Description 1000-1150 chars with 5-section skeleton (About / What You Get / Why Choose Me / What I Need From You / CTA). Profile bio 600-1000 chars.`;
  const raw = await callAI(prompt, system);
  return safeParseJSON(raw);
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

    const body = await req.json();
    const profileUrl: string | undefined = body.profileUrl?.trim();
    const niche: string | undefined = body.niche?.trim();
    const issue: string | undefined = body.issue?.trim();
    const gigUrls: string[] = Array.isArray(body.gigUrls)
      ? body.gigUrls.map((u: string) => u?.trim()).filter(Boolean)
      : (body.gigUrl?.trim() ? [body.gigUrl.trim()] : []);

    if (!profileUrl && gigUrls.length === 0) {
      return new Response(JSON.stringify({ error: "Provide profileUrl and/or gigUrls" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Scrape profile + all gigs in parallel
    const profilePromise = profileUrl ? firecrawlScrape(profileUrl) : Promise.resolve(null);
    const gigPromises = gigUrls.map((u) => firecrawlScrape(u).then((r) => ({ url: u, r })));
    const [profileScrape, gigScrapes] = await Promise.all([profilePromise, Promise.all(gigPromises)]);

    if (profileUrl && !profileScrape) throw new Error("Failed to scrape profile URL — check URL or Firecrawl credits");
    const failedGigs = gigScrapes.filter((g) => !g.r).map((g) => g.url);
    if (failedGigs.length === gigUrls.length && gigUrls.length > 0) {
      throw new Error(`Failed to scrape gig URLs: ${failedGigs.join(", ")}`);
    }

    // Audit profile (if provided) and each successful gig in parallel
    const profileAuditPromise = profileScrape
      ? auditOne({ niche, issue, profile: { url: profileUrl!, markdown: profileScrape.markdown } })
      : Promise.resolve(null);

    const gigAuditPromises = gigScrapes
      .filter((g) => g.r)
      .map(async (g) => ({
        url: g.url,
        title: g.r!.metadata?.title || g.url,
        audit: await auditOne({ niche, issue, gig: { url: g.url, markdown: g.r!.markdown } }),
      }));

    const [profileAudit, gigAudits] = await Promise.all([profileAuditPromise, Promise.all(gigAuditPromises)]);

    // Rank gigs: lower score + more high-severity issues = higher priority
    const ranked = gigAudits
      .map((g) => {
        const issues = g.audit?.critical_issues || [];
        const high = issues.filter((i: any) => i.severity === "high").length;
        const med = issues.filter((i: any) => i.severity === "medium").length;
        const low = issues.filter((i: any) => i.severity === "low").length;
        const score = g.audit?.overall_score ?? 50;
        // priority score: lower health + more severe issues + bigger fix impact
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
      // legacy single-audit shape for backwards compat
      audit: profileAudit || ranked[0]?.audit || null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("audit error", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
