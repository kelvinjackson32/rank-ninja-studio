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
        waitFor: 3000,
        location: { country: "US", languages: ["en"] },
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Firecrawl ${resp.status}: ${text.slice(0, 200)}`);
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
    const gigUrl: string | undefined = body.gigUrl?.trim();
    const niche: string | undefined = body.niche?.trim();
    const issue: string | undefined = body.issue?.trim(); // e.g. "low impressions, no orders"

    if (!profileUrl && !gigUrl) {
      return new Response(JSON.stringify({ error: "Provide profileUrl and/or gigUrl" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const scraped: any = {};
    if (profileUrl) {
      const r = await firecrawlScrape(profileUrl);
      if (!r) throw new Error("Failed to scrape profile URL");
      scraped.profile = r;
    }
    if (gigUrl) {
      const r = await firecrawlScrape(gigUrl);
      if (!r) throw new Error("Failed to scrape gig URL");
      scraped.gig = r;
    }

    const system = `You are a Fiverr ranking expert. Audit a seller's profile/gig against top-performing sellers in the same niche. Output ONLY valid JSON. No markdown fences. No commentary.`;

    const prompt = `Audit this Fiverr account. Return STRICT JSON with this exact shape:
{
  "overall_score": <0-100>,
  "verdict": "<one-sentence diagnosis of why the account is underperforming>",
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
  "action_plan": [
    { "step": 1, "action": "...", "expected_impact": "...", "time_to_apply": "5 min|1 hour|..." }
  ],
  "image_prompts": [
    { "slot": "Thumbnail 1|2|3", "prompt": "1280x769 detailed prompt for Fiverr gig image..." }
  ]
}

Niche/service: ${niche || "infer from scraped content"}
User-reported problem: ${issue || "low impressions, low clicks, no orders"}

${scraped.profile ? `=== SCRAPED PROFILE PAGE (${profileUrl}) ===\n${scraped.profile.markdown}\n` : ""}
${scraped.gig ? `=== SCRAPED GIG PAGE (${gigUrl}) ===\n${scraped.gig.markdown}\n` : ""}

Be brutally honest. Compare against top-ranking Fiverr sellers. Identify EXACTLY what's missing or weak. Provide concrete, copy-paste-ready rewrites. Descriptions must be 1000-1150 chars with the standard 5-section skeleton (About this gig / What You Get / Why Choose Me? / What I Need From You / CTA). Profile bio 600-1000 chars, warm and authoritative.`;

    const raw = await callAI(prompt, system);
    let cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    let audit: any;
    try { audit = JSON.parse(cleaned); }
    catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      audit = m ? JSON.parse(m[0]) : { error: "AI returned non-JSON", raw: cleaned };
    }

    return new Response(JSON.stringify({ success: true, audit, scraped: { profileUrl, gigUrl } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("audit error", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
