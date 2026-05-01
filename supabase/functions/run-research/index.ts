import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const APIFY_BASE = "https://api.apify.com/v2";

async function appendLog(supabase: any, projectId: string, msg: string) {
  const { data: project } = await supabase
    .from("projects")
    .select("progress_log")
    .eq("id", projectId)
    .single();
  const log = (project?.progress_log || []) as any[];
  log.push({ ts: new Date().toISOString(), msg });
  await supabase
    .from("projects")
    .update({ progress_log: log })
    .eq("id", projectId);
}

async function runApifyActor(
  apiKey: string,
  actorId: string,
  input: any,
): Promise<any[]> {
  // Apify actor IDs may contain '/' which must be encoded as '~'
  const safeActorId = actorId.replace(/\//g, "~");
  const url = `${APIFY_BASE}/acts/${safeActorId}/run-sync-get-dataset-items?token=${apiKey}&timeout=120`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!resp.ok) {
    const text = await resp.text();
    const runId = text.match(/run ID:\s*([A-Za-z0-9_-]+)/)?.[1];
    const runLog = runId ? await getApifyRunLog(apiKey, runId) : "";
    const err: any = new Error(
      `Apify ${resp.status}: ${text.slice(0, 300)}${runLog ? `\nRun log: ${runLog}` : ""}`,
    );
    err.status = resp.status;
    throw err;
  }
  return await resp.json();
}

async function getApifyRunLog(apiKey: string, runId: string): Promise<string> {
  try {
    const resp = await fetch(`${APIFY_BASE}/logs/${runId}?token=${apiKey}`);
    if (!resp.ok) return "";
    const text = await resp.text();
    return text.split("\n").filter(Boolean).slice(-8).join("\n").slice(0, 900);
  } catch {
    return "";
  }
}

async function callAI(prompt: string, system: string): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");
  const resp = await fetch(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    },
  );
  if (resp.status === 429)
    throw new Error("AI rate limit. Try again in a moment.");
  if (resp.status === 402)
    throw new Error(
      "AI credits exhausted. Add credits in Settings → Workspace → Usage.",
    );
  if (!resp.ok)
    throw new Error(`AI error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in AI response");
  return JSON.parse(raw.slice(start, end + 1));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";

  const userClient = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: authHeader } },
    },
  );
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user)
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const { projectId } = await req.json();
    if (!projectId) throw new Error("projectId required");

    const { data: project } = await admin
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single();
    if (!project) throw new Error("Project not found");

    await admin
      .from("projects")
      .update({ status: "scraping", progress_log: [] })
      .eq("id", projectId);
    await appendLog(
      admin,
      projectId,
      `🔍 Starting research for "${project.niche}"`,
    );

    // Get user's keys ordered by status (active first), then last_used_at
    const { data: keys } = await admin
      .from("api_keys")
      .select("*")
      .eq("user_id", user.id)
      .order("status")
      .order("last_used_at", { ascending: true, nullsFirst: true });
    if (!keys || keys.length === 0)
      throw new Error("No Apify API keys configured. Add one in Settings.");

    const queries = [
      project.niche,
      ...(project.secondary_keywords || []),
    ].filter(Boolean);
    const allItems: any[] = [];

    for (const q of queries) {
      await appendLog(admin, projectId, `🌐 Scraping Fiverr for: "${q}"`);
      let success = false;
      let lastError = "";
      for (const key of keys) {
        if (key.status === "rate_limited") continue;
        const actorId = key.actor_id || "piotrv1001/fiverr-listings-scraper";
        try {
          await appendLog(
            admin,
            projectId,
            `   → Using key "${key.name}" (actor: ${actorId})`,
          );
          const searchUrl = `https://www.fiverr.com/search/gigs?query=${encodeURIComponent(q)}`;
          const items = await runApifyActor(key.api_key, actorId, {
            // piotrv1001/fiverr-listings-scraper expects `searchUrls` as string URLs.
            searchUrls: [searchUrl],
            maxItemsPerUrl: 30,
            // Compatibility with other community actors (epctex, etc.)
            startUrls: [{ url: searchUrl }],
            search: q,
            maxItems: 30,
            maxPages: 3,
          });
          await admin
            .from("api_keys")
            .update({
              status: "active",
              last_used_at: new Date().toISOString(),
              error_message: null,
            })
            .eq("id", key.id);
          allItems.push(...items.map((it: any) => ({ ...it, _query: q })));
          await appendLog(admin, projectId, `   ✓ Got ${items.length} gigs`);
          success = true;
          break;
        } catch (e: any) {
          const status = e.status === 429 ? "rate_limited" : "error";
          lastError = e.message || String(e);
          await admin
            .from("api_keys")
            .update({ status, error_message: lastError.slice(0, 200) })
            .eq("id", key.id);
          await appendLog(
            admin,
            projectId,
            `   ⚠ Key "${key.name}" failed: ${lastError.slice(0, 160)}`,
          );
        }
      }
      if (!success)
        throw new Error(
          `Scraping failed for "${q}". Last error: ${lastError || "no active keys"}. If the actor ID is invalid, update it in Settings (try "piotrv1001/fiverr-listings-scraper").`,
        );
    }

    await appendLog(
      admin,
      projectId,
      `📊 Analyzed ${allItems.length} gigs total. Generating intelligence...`,
    );
    await admin
      .from("projects")
      .update({ status: "analyzing" })
      .eq("id", projectId);

    // Compact scraped data for AI
    const compacted = allItems.slice(0, 60).map((g: any) => ({
      title: g.title || g.gigTitle,
      seller: g.seller?.name || g.sellerName || g.seller,
      level: g.seller?.level || g.sellerLevel,
      isTopRated: !!(g.seller?.isTopRated || g.isTopRated),
      isFiverrChoice: !!(g.isFiverrChoice || g.choice),
      rating: g.rating || g.seller?.rating,
      reviews: g.reviewCount || g.numReviews || g.reviews,
      price: g.price || g.startingPrice,
      tags: g.tags || g.searchTags,
      description: (g.description || g.gigDescription || "").slice(0, 400),
      query: g._query,
    }));

    const dataBlob = JSON.stringify(compacted).slice(0, 35000);

    await appendLog(admin, projectId, `🤖 AI analyzing winning patterns...`);

    const insightsText = await callAI(
      `Analyze these REAL Fiverr gigs scraped for niche "${project.niche}":\n${dataBlob}\n\nReturn JSON with these EXACT keys:
{
  "competition_level": "low|medium|high|saturated",
  "competition_summary": "2-3 sentences on the market state",
  "top_keywords": ["10-15 high-ranking keywords pulled from real titles/tags"],
  "winning_patterns": ["5-8 patterns the best gigs share"],
  "top_rated_differentiators": ["5-8 things Top Rated / Fiverr's Choice sellers do differently"],
  "average_starting_price": "$X",
  "common_package_structure": "describe basic/standard/premium pattern",
  "top_sellers": [
    {
      "seller_name": "from data",
      "gig_title": "their actual gig title",
      "level": "Top Rated / Level 2 / Fiverr's Choice / etc",
      "rating": "4.9",
      "reviews": 1234,
      "starting_price": "$X",
      "why_ranking": "1 sentence: why THIS gig ranks (keyword placement, price, packaging, social proof, niche angle)",
      "what_to_copy": "1 actionable tactic the user should steal from them"
    }
  ],
  "key_learnings": ["6-10 plain-English lessons the user should take away from this research, written as direct advice ('Lead your title with the primary keyword, like X does...', 'Price your basic at $Y because...')"]
}

For "top_sellers": pick the 5 BEST performers (prioritize Top Rated, Fiverr's Choice, highest review counts). Use REAL names and titles from the scraped data. Be specific in "why_ranking" and "what_to_copy" — reference actual words from their titles when possible.`,
      "You are an expert Fiverr SEO analyst. Output only valid JSON, no prose. Be specific and reference real data.",
    );
    const insights = extractJson(insightsText);

    await appendLog(admin, projectId, `✏️ Generating profile optimization...`);
    const profileText = await callAI(
      `Based on this Fiverr competitor research for "${project.niche}":\nInsights: ${JSON.stringify(insights)}\nTop gigs sample: ${dataBlob.slice(0, 10000)}\n\nGenerate a complete Fiverr PROFILE for a NEW seller (zero reviews) that competes with top performers. Return JSON:
{
  "display_name": "...",
  "profile_title": "headline under name (max 70 chars)",
  "short_bio": "MAX 150 characters. Punchy, keyword-rich, hook-style. This is the short bio shown on the profile card. NEVER exceed 150 chars.",
  "about": "600-1000 char authority-building long bio for the About section, keyword-rich, conversion-focused, human tone",
  "skills": ["max 15 skills"],
  "work_experience": [{"title":"...","company":"...","years":"..."}],
  "education": [{"degree":"...","institution":"...","year":"..."}],
  "certifications": ["..."],
  "languages": [{"name":"English","level":"Native/Fluent"}]
}
CRITICAL: short_bio must be <=150 characters total including spaces.`,
      "You are an expert Fiverr profile strategist. Output only valid JSON. Make text natural, persuasive, never robotic. Build trust for new sellers. Strictly respect character limits.",
    );
    const profile_optimization = extractJson(profileText);

    await appendLog(admin, projectId, `🎯 Generating gig optimization...`);
    const gigText = await callAI(
      `Based on the research for "${project.niche}":\nInsights: ${JSON.stringify(insights)}\nReal top gigs: ${dataBlob.slice(0, 12000)}\n\nGenerate the BEST possible Fiverr gig. Return JSON: { "gig_title": "max 80 chars, primary keyword at start", "search_tags": ["8-10 ranking tags"], "description": "1000-1150 chars, structure: problem→solution→why me→deliverables→CTA. Primary keyword 3-5 times naturally", "faqs": [{"q":"...","a":"..."}, ... 10 items], "packages": { "basic": {"name":"...","price":"$X","delivery_days":N,"revisions":N,"features":["..."]}, "standard": {...}, "premium": {...} } }`,
      "You are a Fiverr ranking expert. Output only valid JSON. Description must be persuasive, algorithm-friendly, 1000-1150 chars exactly. Tags must be search-volume optimized.",
    );
    const gig_optimization = extractJson(gigText);

    await admin.from("research_results").insert({
      project_id: projectId,
      user_id: user.id,
      scraped_data: { count: allItems.length, sample: compacted },
      insights,
      profile_optimization,
      gig_optimization,
    });

    await admin
      .from("projects")
      .update({ status: "complete" })
      .eq("id", projectId);
    await appendLog(
      admin,
      projectId,
      `✅ Done! Open the results to view your competitive blueprint.`,
    );

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("run-research error:", e);
    try {
      const body = await req.clone().json();
      if (body.projectId) {
        await admin
          .from("projects")
          .update({ status: "error" })
          .eq("id", body.projectId);
        await appendLog(admin, body.projectId, `❌ ${e.message}`);
      }
    } catch {}
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
