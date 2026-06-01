import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const APIFY_BASE = "https://api.apify.com/v2";
const APIFY_SYNC_TIMEOUT_SECONDS = 55;
const FETCH_TIMEOUT_MS = 65_000;
const AI_TIMEOUT_MS = 70_000;
const MAX_KEYS_PER_QUERY = 2;
const MAX_SECONDARY_KEYWORDS = 1;

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

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
    .update({ progress_log: log, updated_at: new Date().toISOString() })
    .eq("id", projectId);
}

async function runApifyActor(
  apiKey: string,
  actorId: string,
  input: any,
): Promise<any[]> {
  // Apify actor IDs may contain '/' which must be encoded as '~'
  const safeActorId = actorId.replace(/\//g, "~");
  const url = `${APIFY_BASE}/acts/${safeActorId}/run-sync-get-dataset-items?token=${apiKey}&timeout=${APIFY_SYNC_TIMEOUT_SECONDS}`;
  const resp = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, (APIFY_SYNC_TIMEOUT_SECONDS + 10) * 1000);
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
  const data = await resp.json();
  return Array.isArray(data) ? data : (data?.items || data?.data || []);
}

async function getApifyRunLog(apiKey: string, runId: string): Promise<string> {
  try {
    const resp = await fetchWithTimeout(`${APIFY_BASE}/logs/${runId}?token=${apiKey}`, {}, 8_000);
    if (!resp.ok) return "";
    const text = await resp.text();
    return text.split("\n").filter(Boolean).slice(-8).join("\n").slice(0, 900);
  } catch {
    return "";
  }
}

// Firecrawl fallback — scrapes Fiverr search pages and parses gig cards from markdown.
async function scrapeWithFirecrawl(query: string): Promise<any[]> {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) throw new Error("FIRECRAWL_API_KEY missing");
  const items: any[] = [];
  for (const page of [1, 2]) {
    const url = `https://www.fiverr.com/search/gigs?query=${encodeURIComponent(query)}&page=${page}`;
    const resp = await fetchWithTimeout("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown", "links"],
        onlyMainContent: true,
        waitFor: 1200,
        location: { country: "US", languages: ["en"] },
      }),
    }, 35_000);
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`Firecrawl ${resp.status}: ${t.slice(0, 200)}`);
    }
    const data = await resp.json();
    const md: string = data.markdown || data.data?.markdown || "";
    const links: string[] = data.links || data.data?.links || [];
    // Extract gig URLs
    const gigUrls = Array.from(new Set(
      links
        .filter((l) => typeof l === "string" && /fiverr\.com\/[^/]+\/[^?#]+/.test(l) && !l.includes("/search"))
        .slice(0, 48),
    ));
    // Heuristic: pull blocks separated by blank lines, attempt to parse title + price
    const blocks = md.split(/\n{2,}/);
    for (const url of gigUrls) {
      const handle = url.match(/fiverr\.com\/([^/?#]+)/)?.[1] || "";
      const slug = url.match(/fiverr\.com\/[^/]+\/([^?#]+)/)?.[1]?.replace(/-/g, " ") || "";
      const block = blocks.find((b) => b.toLowerCase().includes(slug.toLowerCase().slice(0, 25))) || "";
      const priceMatch = block.match(/\$\s?(\d+[\d,]*)/);
      const ratingMatch = block.match(/([45]\.\d)\s*\(?\s*(\d[\d,]*)\)?/);
      items.push({
        title: slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : "",
        seller: handle,
        sellerName: handle,
        url,
        gigUrl: url,
        seller_url: `https://www.fiverr.com/${handle}`,
        price: priceMatch ? `$${priceMatch[1]}` : undefined,
        rating: ratingMatch ? ratingMatch[1] : undefined,
        reviewCount: ratingMatch ? Number(ratingMatch[2].replace(/,/g, "")) : undefined,
        isFiverrChoice: /fiverr['’]s? choice/i.test(block),
        isPro: /\bpro\b/i.test(block),
        isTopRated: /top rated/i.test(block),
        description: block.slice(0, 400),
        _source: "firecrawl",
      });
    }
  }
  return items;
}

async function callAI(prompt: string, system: string, geminiKey: string, model = "gemini-2.5-flash"): Promise<string> {
  if (!geminiKey) {
    throw new Error("No Gemini API key configured. Open Settings → AI Generation and paste your Google Gemini API key (free at https://aistudio.google.com/apikey).");
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;
  const resp = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 8192 },
    }),
  }, AI_TIMEOUT_MS);
  if (resp.status === 429) throw new Error("Gemini rate limit hit. Wait a moment and retry.");
  if (resp.status === 401 || resp.status === 403) {
    throw new Error("Gemini API key invalid or unauthorized. Update it in Settings → AI Generation.");
  }
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Gemini error ${resp.status}: ${txt.slice(0, 300)}`);
  }
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("\n") || "";
  if (!text) throw new Error("Gemini returned an empty response.");
  return text;
}

async function getUserGeminiKey(admin: any, userId: string): Promise<string> {
  const { data } = await admin
    .from("user_ai_settings")
    .select("gemini_api_key")
    .eq("user_id", userId)
    .maybeSingle();
  const key = (data?.gemini_api_key || "").trim();
  if (!key) {
    throw new Error("No Gemini API key configured. Open Settings → AI Generation and paste your Google Gemini API key (free at https://aistudio.google.com/apikey).");
  }
  return key;
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
      .update({ status: "scraping", progress_log: [], updated_at: new Date().toISOString() })
      .eq("id", projectId);
    await appendLog(
      admin,
      projectId,
      `🔍 Starting research for "${project.niche}" (running in background)`,
    );

    // Run heavy work in background to avoid 150s edge timeout.
    // Frontend tracks progress via realtime updates on `projects`.
    const work = (async () => {
      try {
        await runResearchWork(admin, user.id, projectId, project);
      } catch (e: any) {
        console.error("background run-research error:", e);
        try {
          await admin.from("projects").update({ status: "error", updated_at: new Date().toISOString() }).eq("id", projectId);
          await appendLog(admin, projectId, `❌ ${e.message}`);
        } catch {}
      }
    })();
    // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(work);
    }

    return new Response(JSON.stringify({ success: true, queued: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("run-research error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function runResearchWork(admin: any, userId: string, projectId: string, project: any) {

    // Require the user's Gemini key up front — fail fast with a clear message before scraping.
    const geminiKey = await getUserGeminiKey(admin, userId);

    // Get user's keys ordered by status (active first), then last_used_at
    const { data: keys } = await admin
      .from("api_keys")
      .select("*")
      .eq("user_id", userId)
      .order("status")
      .order("last_used_at", { ascending: true, nullsFirst: true });
    if ((!keys || keys.length === 0) && !Deno.env.get("FIRECRAWL_API_KEY"))
      throw new Error("No scraper is configured. Add an Apify API key in Settings and try again.");

    const queries = [
      project.niche,
      ...(project.secondary_keywords || []),
    ].filter(Boolean).slice(0, 1 + MAX_SECONDARY_KEYWORDS);
    const allItems: any[] = [];

    for (const q of queries) {
      await appendLog(admin, projectId, `🌐 Scraping Fiverr for: "${q}"`);
      let success = false;
      let lastError = keys?.length ? "" : "No Apify key saved; using backup scraper";
      for (const key of (keys || []).filter((k: any) => k.status !== "rate_limited").slice(0, MAX_KEYS_PER_QUERY)) {
        if (key.status === "rate_limited") continue;
        const actorId = key.actor_id || "piotrv1001/fiverr-listings-scraper";
        try {
          await appendLog(
            admin,
            projectId,
            `   → Using key "${key.name}" (actor: ${actorId})`,
          );
          // Scrape the first 2 pages for speed/reliability, then let AI extrapolate patterns.
          const pageUrls = [1, 2].map((page) =>
            `https://www.fiverr.com/search/gigs?query=${encodeURIComponent(q)}&page=${page}`,
          );
          const items = await runApifyActor(key.api_key, actorId, {
            // piotrv1001/fiverr-listings-scraper expects `searchUrls` as string URLs.
            searchUrls: pageUrls,
            maxItemsPerUrl: 24,
            // Compatibility with other community actors (epctex, etc.)
            startUrls: pageUrls.map((url) => ({ url })),
            search: q,
            maxItems: 48,
            maxPages: 2,
          });
          await admin
            .from("api_keys")
            .update({
              status: "active",
              last_used_at: new Date().toISOString(),
              error_message: null,
            })
            .eq("id", key.id);
          if (items.length > 0) {
            allItems.push(...items.map((it: any) => ({ ...it, _query: q })));
            await appendLog(admin, projectId, `   ✓ Got ${items.length} gigs`);
            success = true;
            break;
          }
          lastError = "Scraper returned 0 gigs";
          await appendLog(admin, projectId, `   ⚠ Key "${key.name}" returned 0 gigs; trying fallback`);
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
      if (!success) {
        // Try Firecrawl fallback if configured
        if (Deno.env.get("FIRECRAWL_API_KEY")) {
          try {
            await appendLog(admin, projectId, `   ↻ Falling back to Firecrawl for "${q}"`);
            const fcItems = await scrapeWithFirecrawl(q);
            if (fcItems.length) {
              allItems.push(...fcItems.map((it: any) => ({ ...it, _query: q })));
              await appendLog(admin, projectId, `   ✓ Firecrawl returned ${fcItems.length} gigs`);
              success = true;
            } else {
              await appendLog(admin, projectId, `   ⚠ Firecrawl returned 0 results`);
            }
          } catch (fe: any) {
            await appendLog(admin, projectId, `   ⚠ Firecrawl failed: ${(fe.message || String(fe)).slice(0, 160)}`);
          }
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
      .update({ status: "analyzing", updated_at: new Date().toISOString() })
      .eq("id", projectId);

    // Compact scraped data for AI — include order/queue signals + source URLs
    const normalizeUrl = (u: any): string | null => {
      if (!u || typeof u !== "string") return null;
      if (u.startsWith("http")) return u;
      if (u.startsWith("/")) return `https://www.fiverr.com${u}`;
      return null;
    };
    const compacted = allItems.slice(0, 60).map((g: any) => {
      const sellerName = g.seller?.name || g.sellerName || (typeof g.seller === "string" ? g.seller : null) || g.username;
      const gigUrl = normalizeUrl(g.url || g.gigUrl || g.link || g.gigLink || g.permalink);
      const sellerUrl = normalizeUrl(g.seller?.url || g.seller?.profileUrl || g.sellerUrl || g.sellerProfileUrl)
        || (sellerName ? `https://www.fiverr.com/${String(sellerName).replace(/^@/, "")}` : null);
      return {
        title: g.title || g.gigTitle,
        seller: sellerName,
        level: g.seller?.level || g.sellerLevel,
        isTopRated: !!(g.seller?.isTopRated || g.isTopRated),
        isFiverrChoice: !!(g.isFiverrChoice || g.choice || g.fiverrChoice),
        isPro: !!(g.isPro || g.seller?.isPro),
        rating: g.rating || g.seller?.rating,
        reviews: g.reviewCount || g.numReviews || g.reviews,
        orders_in_queue: g.ordersInQueue || g.queue || g.activeOrders,
        price: g.price || g.startingPrice,
        tags: g.tags || g.searchTags,
        description: (g.description || g.gigDescription || "").slice(0, 400),
        gig_url: gigUrl,
        seller_url: sellerUrl,
        query: g._query,
      };
    });

    const dataBlob = JSON.stringify(compacted).slice(0, 26000);

    await appendLog(admin, projectId, `🤖 AI analyzing winning patterns across the strongest first-page data...`);

    // Variation seed so each Re-run produces fresh niche angles + edited titles/sellers/etc.
    const variationSeed = Math.floor(Math.random() * 1_000_000);

    const insightsText = await callAI(
      `Analyze these REAL Fiverr gigs scraped for niche "${project.niche}":\n${dataBlob}\n\nVariation seed (use to ensure this run produces DIFFERENT niche_angles than any previous run): ${variationSeed}\n\nReturn JSON with these EXACT keys (no extras):
{
  "competition_level": "low|medium|high|saturated",
  "competition_summary": "2-3 sentences on the market state",
  "opportunity_score": 0-100 integer (how viable for a NEW seller — weigh demand against saturation),
  "opportunity_reasoning": "2-3 sentences explaining the opportunity_score honestly",
  "average_starting_price": "$X",
  "average_top_orders": "approximate average orders/queue across the strongest gigs, e.g. '180+ active orders' or 'unknown'",
  "niche_angles": [
    {
      "title": "specific service angle the user could offer (NOT a gig title — a focused sub-niche / service positioning, max 70 chars). Must be a COMBINATION/refinement of the broad niche '${project.niche}' that has VALIDATED demand on Fiverr but LOWER competition than the saturated head term. Examples of good angles: 'Faceless YouTube shorts for finance creators', 'Minimalist logo for SaaS startups', 'AI UGC ads for skincare brands'. Bad: just repeating '${project.niche}'.",
      "demand_signal": "1 sentence citing what in the scraped data proves buyers want this (orders in queue, repeat patterns, gig count vs review velocity)",
      "competition_signal": "1 sentence on why this angle is LESS saturated than the head term (fewer Top Rated holding it, gap in tag coverage, etc.)",
      "why_pick_this": "1 sentence: how a NEW seller can realistically rank and convert here",
      "estimated_competition": "low|medium",
      "primary_keyword": "the exact keyword phrase to target"
    }
  ],
  "top_keywords": ["10-15 high-ranking keywords pulled from real titles/tags"],
  "keyword_expansion": ["10-15 long-tail and secondary keyword variations a NEW seller should target — different from top_keywords, lower-competition angles, buyer-intent phrases"],
  "winning_patterns": ["5-8 patterns the best gigs share"],
  "top_rated_differentiators": ["5-8 things Top Rated / Fiverr's Choice / Pro sellers do differently"],
  "common_package_structure": "describe basic/standard/premium pattern",
  "top_sellers": [
    {
      "seller_name": "from data",
      "gig_title": "their actual gig title",
      "level": "Top Rated / Level 2 / Fiverr's Choice / Pro / etc",
      "rating": "4.9",
      "reviews": 1234,
      "orders_in_queue": 45,
      "starting_price": "$X",
      "gig_url": "exact gig_url copied from the input data for this seller (must start with https://www.fiverr.com). If unknown, use empty string.",
      "seller_url": "exact seller_url copied from the input data (must start with https://www.fiverr.com). If unknown, use empty string.",
      "why_ranking": "1 sentence: why THIS gig ranks (keyword placement, price, packaging, social proof, niche angle)",
      "what_to_copy": "1 actionable tactic the user should steal from them"
    }
  ],
  "key_learnings": ["6-10 plain-English lessons written as direct advice"]
}

For "top_sellers": pick the 5 BEST performers, prioritizing: Fiverr's Choice → Top Rated → Pro → highest active orders/queue → highest review counts. Use REAL names, titles, AND copy the gig_url + seller_url EXACTLY from the matching entry in the input data — never invent URLs.
For "opportunity_score": be brutally honest. Saturated low-demand = 20-40. Saturated high-demand = 50-65. Healthy demand with differentiation room = 70-90.
For "niche_angles": return EXACTLY 3 distinct angles. Each must be a REFINEMENT/COMBINATION of the broad niche the user submitted, NOT a generic restatement. Pick angles that have proven demand in the scraped data (visible orders/reviews/queues) BUT are not dominated by Top Rated / Pro / Fiverr's Choice — i.e. realistic for a brand-new seller to break into. Avoid suggesting the most saturated head terms even if they have demand. Use the variation seed so this run produces different angles than previous runs would.`,
      "You are an expert Fiverr SEO analyst. Output only valid JSON, no prose. Be specific and reference real data. When the input contains gig_url/seller_url, copy them verbatim into top_sellers — do not invent or guess URLs. Each Re-run must use the variation seed to surface DIFFERENT niche_angles than prior runs.",
      geminiKey,
    );
    const insights = extractJson(insightsText);

    // Backfill / verify source URLs from real scraped data
    if (Array.isArray(insights?.top_sellers)) {
      const norm = (s: any) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      insights.top_sellers = insights.top_sellers.map((s: any) => {
        const sn = norm(s.seller_name);
        const gt = norm(s.gig_title);
        const match = compacted.find((c) => sn && norm(c.seller) === sn)
          || compacted.find((c) => gt && norm(c.title) && (norm(c.title).includes(gt) || gt.includes(norm(c.title))));
        const gigUrl = (typeof s.gig_url === "string" && s.gig_url.startsWith("http") ? s.gig_url : null) || match?.gig_url || null;
        const sellerUrl = (typeof s.seller_url === "string" && s.seller_url.startsWith("http") ? s.seller_url : null)
          || match?.seller_url
          || (s.seller_name ? `https://www.fiverr.com/${String(s.seller_name).replace(/^@/, "").replace(/\s+/g, "")}` : null);
        const searchUrl = `https://www.fiverr.com/search/gigs?query=${encodeURIComponent(s.gig_title || s.seller_name || project.niche)}`;
        return { ...s, gig_url: gigUrl || searchUrl, seller_url: sellerUrl, source_search_url: searchUrl };
      });
    }

    await appendLog(admin, projectId, `✏️ Generating profile, gig package, requirements, and thumbnails...`);
    const targetDuration = Number(project.target_duration_seconds) || 30;
    const characterLock = project.character_lock !== false;
    const offerText = await callAI(
      `Based on this Fiverr competitor research for "${project.niche}":
Insights: ${JSON.stringify(insights)}
Top gigs sample: ${dataBlob.slice(0, 9000)}

Variation seed: ${variationSeed}

Generate the complete Fiverr profile and gig package in ONE valid JSON object with EXACTLY these top-level keys:
{
  "profile_optimization": {
    "display_name": "...",
    "profile_title": "keyword-rich headline, max 70 chars",
    "short_bio": "MAX 150 characters",
    "about": "Natural Fiverr About section, MAX 500 characters total, real \n line breaks, no markdown",
    "skills": ["max 15 skills"],
    "work_experience": [{"title":"...","company":"...","years":"..."}],
    "education": [{"degree":"...","institution":"...","year":"..."}],
    "certifications": ["..."],
    "languages": [{"name":"English","level":"Native/Fluent"}],
    "profile_strength": {
      "score": 0-100,
      "breakdown": {"title_keywords":0-20,"bio_hook":0-20,"skills_coverage":0-20,"credibility_signals":0-20,"niche_fit":0-20},
      "tips": ["3-6 specific tips"]
    }
  },
  "gig_optimization": {
    "gig_title": "max 80 chars, primary keyword at start",
    "title_variations": [{"title":"max 80 chars","angle":"...","why_it_works":"..."}],
    "category": {"category":"best Fiverr category","subcategory":"best subcategory","service_type":"best service type","why":"..."},
    "gig_metadata": [{"field":"Fiverr field name","recommended_values":["value1","value2"],"why":"..."}],
    "search_tags": ["8-10 ranking tags"],
    "description": "1000-1150 chars. Use sections: About this gig, What You Get, Why Choose Me?, What I Need From You, Call to Action. Use real \n and bullet • markers.",
    "buyer_requirements": [{"question":"niche-specific order question","type":"free_text|multiple_choice|attachment","required":true,"options":["only for multiple_choice"]}],
    "faqs": [{"q":"...","a":"..."}],
    "packages": {
      "basic":{"name":"...","price":"$X","delivery_days":2,"revisions":1,"features":["each feature MAX 100 chars"]},
      "standard":{"name":"...","price":"$X","delivery_days":3,"revisions":2,"features":["each feature MAX 100 chars"]},
      "premium":{"name":"...","price":"$X","delivery_days":5,"revisions":3,"features":["each feature MAX 100 chars"]}
    },
    "thumbnail_prompts": [{"style":"...","prompt":"80-140 word image-gen prompt for 1280x769 Fiverr gig image, with bold headline words, focal point, trust elements, palette, --ar 1280:769 --no watermark, blurry, low-res, lorem-ipsum text --style raw"}],
    "is_video_gig": true_or_false_boolean_indicating_if_this_niche_requires_a_demo_video_upload_on_fiverr,
    "video_concepts": [
      {
        "concept_title": "short name of the video concept (e.g. 'Animated Nursery Rhyme — Counting Stars')",
        "concept_summary": "1-2 sentence description of the demo video idea, aligned to the gig style/niche",
        "duration_seconds": ${targetDuration},
        "visual_style": "art direction (e.g. 3D Pixar-like, flat 2D cartoon, cinematic UGC selfie, anime, claymation)",
        "character_appearance_sheet": ${characterLock ? `"a single ready-to-paste markdown 'appearance sheet' that LOCKS every recurring character: NAME, age, gender, ethnicity, hair (color/style), eyes, face shape, signature outfit (top/bottom/shoes/accessories), color palette (HEX), art style line. Format as: '### Character: <NAME>\\n- Age: ...\\n- ...'. Include 1-3 characters total. EVERY scene/image/video prompt below MUST reference these characters by NAME and quote the exact outfit + art style line so they stay 100% consistent across scenes."` : `"empty string — character lock is OFF"`},
        "stage_prompts": {
          "stage_1_ideas": "ready-to-paste prompt the user can send to Gemini/Grok/ChatGPT asking for 15 LATEST trending sub-ideas for this concept, referencing YouTube/Google trends, niche '${project.niche}', target length ${targetDuration}s, and the visual_style",
          "stage_2_lyrics_or_script": "ready-to-paste prompt to generate ONLY the lyrics (for music gigs) or the spoken script (for UGC/talking gigs) for the chosen idea — must say 'don't generate the music/voice, just the lyrics/script'. Word count MUST match a ${targetDuration}-second video (~${Math.round(targetDuration * 2.3)} words for spoken, or ${Math.round(targetDuration / 7)} short verses for music). State the duration explicitly.",
          "stage_3_video_scene_script": "ready-to-paste prompt to break the lyrics/script into a SECOND-BY-SECOND scene-by-scene video script of EXACTLY ${targetDuration} seconds total, divided into ${Math.max(3, Math.ceil(targetDuration / 5))} scenes of ~5s each, with explicit timestamps like '[0:00-0:05]', action, camera, mood. Total runtime MUST equal ${targetDuration}s.",
          "stage_4_scene_image_prompts": "ready-to-paste prompt asking the AI to output an image-generation prompt for EACH of the ~${Math.max(3, Math.ceil(targetDuration / 5))} scenes (for Midjourney / Flux / Nano Banana / Google Flow), aspect 16:9, no text, consistent style.${characterLock ? " EVERY scene prompt MUST start by quoting the locked appearance sheet line for whichever character appears, by NAME (e.g. 'Mia — purple dungarees, yellow tee, pixar-style')." : ""}",
          "stage_5_character_prompts": "ready-to-paste prompt to generate a separate image-gen prompt for EACH recurring character used in the video, with full appearance lock (face, outfit, palette).${characterLock ? " The prompt MUST instruct the AI to copy the appearance sheet verbatim for each character so they stay identical across every scene." : ""}",
          "stage_6_final_scene_assembly": "ready-to-paste prompt that tells the AI: 'I have generated the characters. Now give me a Google Flow / Veo / Kling text-to-video prompt for EACH of the ~${Math.max(3, Math.ceil(targetDuration / 5))} scenes that combines the right character(s) into that scene, referencing scene number, character NAME (must match appearance sheet), action, camera move, 5s clip — total ${targetDuration}s.'"
        },
        "tools_suggested": ["e.g. Suno AI for music", "Google Flow / Veo 3 for video", "Canva for final cut"]
      }
    ]
  }
}

REQUIREMENTS:
- profile_optimization.short_bio <=150 chars. profile_optimization.about <=500 chars. profile_strength.score must equal the breakdown sum.
- title_variations: EXACTLY 6 items, each <=80 chars.
- gig_metadata: 4-6 niche-specific items.
- buyer_requirements: 4-6 niche-specific items.
- faqs: exactly 8 items.
- thumbnail_prompts: EXACTLY 2 varied styles modeled on high-click Fiverr thumbnails.
- packages: every feature string MAX 100 characters (hard limit, Fiverr enforces this).
- is_video_gig: set to true ONLY if the niche is a video deliverable that Fiverr requires a video upload for (AI video, UGC video, music video, kids music video, video editing, video ads, animation, faceless YouTube, motion graphics, explainer video, etc). Otherwise false.
- video_concepts: if is_video_gig is true → return EXACTLY 2 distinct demo-video concepts aligned to the gig style. If false → return empty array [].
- EVERY video_concept.duration_seconds MUST equal ${targetDuration}. Stage 3 timestamps and Stage 6 scene counts MUST add up to exactly ${targetDuration} seconds.
- character_lock is ${characterLock ? "ON — fill character_appearance_sheet with a real markdown sheet (1-3 named characters with full appearance + outfit + HEX palette) and ensure stage_4/5/6 prompts EXPLICITLY tell the AI to reuse those exact character names, outfits, and art style line for EVERY scene." : "OFF — set character_appearance_sheet to empty string."}
- Every stage_prompts.* must be a COMPLETE, copy-pasteable prompt the user can drop into Gemini/Grok/ChatGPT with no edits — write it in first person as if the user is asking the AI.
- Everything must be specific to "${project.niche}" and grounded in the insights/top gigs.`,
      "You are a Fiverr top-seller strategist. Output only valid JSON. Generate premium but concise profile and gig assets that respect all Fiverr character limits.",
    );
    const offer = extractJson(offerText);
    const profile_optimization = offer.profile_optimization || {};
    const gig_optimization = offer.gig_optimization || {};
    if (typeof profile_optimization.short_bio === "string" && profile_optimization.short_bio.length > 150) {
      profile_optimization.short_bio = profile_optimization.short_bio.slice(0, 147).trimEnd() + "...";
    }
    if (typeof profile_optimization.about === "string" && profile_optimization.about.length > 500) {
      profile_optimization.about = profile_optimization.about.slice(0, 497).trimEnd() + "...";
    }
    // Hard-cap each package feature to 100 chars (Fiverr limit)
    if (gig_optimization.packages && typeof gig_optimization.packages === "object") {
      for (const tier of Object.keys(gig_optimization.packages)) {
        const pk = gig_optimization.packages[tier];
        if (pk && Array.isArray(pk.features)) {
          pk.features = pk.features.map((f: any) => {
            const s = String(f ?? "");
            return s.length > 100 ? s.slice(0, 97).trimEnd() + "..." : s;
          });
        }
      }
    }
    // Cap thumbnails to 2
    if (Array.isArray(gig_optimization.thumbnail_prompts) && gig_optimization.thumbnail_prompts.length > 2) {
      gig_optimization.thumbnail_prompts = gig_optimization.thumbnail_prompts.slice(0, 2);
    }

    await admin.from("research_results").insert({
      project_id: projectId,
      user_id: userId,
      scraped_data: { count: allItems.length, sample: compacted },
      insights,
      profile_optimization,
      gig_optimization,
    });

    await admin
      .from("projects")
      .update({ status: "complete", updated_at: new Date().toISOString() })
      .eq("id", projectId);
    await appendLog(
      admin,
      projectId,
      `✅ Done! Open the results to view your competitive blueprint.`,
    );
}

