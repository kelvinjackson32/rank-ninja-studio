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

// Firecrawl fallback — scrapes Fiverr search pages and parses gig cards from markdown.
async function scrapeWithFirecrawl(query: string): Promise<any[]> {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) throw new Error("FIRECRAWL_API_KEY missing");
  const items: any[] = [];
  for (const page of [1, 2, 3]) {
    const url = `https://www.fiverr.com/search/gigs?query=${encodeURIComponent(query)}&page=${page}`;
    const resp = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown", "links"],
        onlyMainContent: true,
        waitFor: 2500,
        location: { country: "US", languages: ["en"] },
      }),
    });
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
          await admin.from("projects").update({ status: "error" }).eq("id", projectId);
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

    // Get user's keys ordered by status (active first), then last_used_at
    const { data: keys } = await admin
      .from("api_keys")
      .select("*")
      .eq("user_id", userId)
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
          // Scrape pages 1, 2, 3 explicitly
          const pageUrls = [1, 2, 3].map((page) =>
            `https://www.fiverr.com/search/gigs?query=${encodeURIComponent(q)}&page=${page}`,
          );
          const items = await runApifyActor(key.api_key, actorId, {
            // piotrv1001/fiverr-listings-scraper expects `searchUrls` as string URLs.
            searchUrls: pageUrls,
            maxItemsPerUrl: 48,
            // Compatibility with other community actors (epctex, etc.)
            startUrls: pageUrls.map((url) => ({ url })),
            search: q,
            maxItems: 144,
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
      .update({ status: "analyzing" })
      .eq("id", projectId);

    // Compact scraped data for AI — include order/queue signals + source URLs
    const normalizeUrl = (u: any): string | null => {
      if (!u || typeof u !== "string") return null;
      if (u.startsWith("http")) return u;
      if (u.startsWith("/")) return `https://www.fiverr.com${u}`;
      return null;
    };
    const compacted = allItems.slice(0, 90).map((g: any) => {
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

    const dataBlob = JSON.stringify(compacted).slice(0, 38000);

    await appendLog(admin, projectId, `🤖 AI analyzing winning patterns across pages 1-3...`);

    // Variation seed so each Re-run produces fresh niche angles + edited titles/sellers/etc.
    const variationSeed = Math.floor(Math.random() * 1_000_000);

    const insightsText = await callAI(
      `Analyze these REAL Fiverr gigs (pages 1-3) scraped for niche "${project.niche}":\n${dataBlob}\n\nVariation seed (use to ensure this run produces DIFFERENT niche_angles than any previous run): ${variationSeed}\n\nReturn JSON with these EXACT keys (no extras):
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

    await appendLog(admin, projectId, `✏️ Generating profile + strength score...`);
    const profileText = await callAI(
      `Based on this Fiverr competitor research for "${project.niche}":\nInsights: ${JSON.stringify(insights)}\nTop gigs sample: ${dataBlob.slice(0, 10000)}\n\nGenerate a complete Fiverr PROFILE for a NEW seller (zero reviews) that competes with top performers. Return JSON:
{
  "display_name": "...",
  "profile_title": "headline under name (max 70 chars)",
  "short_bio": "MAX 150 characters. Punchy, keyword-rich, hook-style. NEVER exceed 150 chars.",
  "about": "STRUCTURED long bio for the Fiverr 'About me' section, 600-1000 characters total. MUST be plain text with real line breaks (use \\n). Open with a warm 1-line greeting + name (e.g. 'Hi there! I'm <Name>.'). Follow with a 2-3 sentence positioning paragraph: who you help, what you specialize in (use the niche keyword naturally 2-3 times), years/experience or proof, what makes you different. Close with 1 sentence inviting the buyer to message. Conversational, confident, never robotic. NO markdown headers, NO bullet symbols — match the natural paragraph style of top Fiverr 'About me' sections.",
  "skills": ["max 15 skills"],
  "work_experience": [{"title":"...","company":"...","years":"..."}],
  "education": [{"degree":"...","institution":"...","year":"..."}],
  "certifications": ["..."],
  "languages": [{"name":"English","level":"Native/Fluent"}],
  "profile_strength": {
    "score": 0-100 integer,
    "breakdown": {
      "title_keywords": 0-20,
      "bio_hook": 0-20,
      "skills_coverage": 0-20,
      "credibility_signals": 0-20,
      "niche_fit": 0-20
    },
    "tips": ["3-6 specific improvement tips the user can act on"]
  }
}
CRITICAL: short_bio <=150 characters. profile_strength.score = sum of breakdown values.`,
      "You are an expert Fiverr profile strategist. Output only valid JSON. Make text natural, persuasive, never robotic. Strictly respect character limits.",
    );
    const profile_optimization = extractJson(profileText);
    if (typeof profile_optimization.short_bio === "string" && profile_optimization.short_bio.length > 150) {
      profile_optimization.short_bio = profile_optimization.short_bio.slice(0, 147).trimEnd() + "...";
    }

    await appendLog(admin, projectId, `🎯 Generating gig + title variations + thumbnail prompts...`);
    const gigText = await callAI(
      `Based on the research for "${project.niche}":\nInsights: ${JSON.stringify(insights)}\nReal top gigs: ${dataBlob.slice(0, 12000)}\n\nVariation seed (use to ensure each re-run produces NEW gig_title, title_variations, packages, FAQ wording and thumbnail prompts): ${variationSeed}\n\nGenerate the BEST possible Fiverr gig PLUS 6-8 strong alternative title variations, gig metadata, requirements, and 4 thumbnail prompts. Return JSON:
{
  "gig_title": "max 80 chars, primary keyword at start",
  "title_variations": [
    {
      "title": "max 80 chars, distinct angle",
      "angle": "what hook this uses (e.g. 'price anchor', 'speed promise', 'authority claim', 'niche specificity')",
      "why_it_works": "1 sentence tied to real top-seller patterns from the data"
    }
  ],
  "category": {
    "category": "Top-level Fiverr category most chosen by the scraped top sellers for this niche (e.g. 'Video & Animation', 'Graphics & Design', 'Programming & Tech', 'Writing & Translation', 'Digital Marketing', 'Music & Audio', 'Business', 'AI Services'). Pick the BEST fit for niche '${project.niche}'.",
    "subcategory": "Exact Fiverr sub-category top sellers in the scraped data use most for this niche.",
    "service_type": "The 'Service type' Fiverr asks for (e.g. 'AI Video', 'Logo Design', 'WordPress Development'). Match what top sellers in the scraped data picked.",
    "why": "1 sentence: why this category/sub-category/service_type combo (cite the top-seller pattern observed)."
  },
  "gig_metadata": [
    { "field": "field name Fiverr asks (e.g. 'Style', 'Software', 'Voice Gender', 'Platform')", "recommended_values": ["value1","value2"], "why": "1 sentence: which top sellers picked this and why it helps ranking" }
  ],
  "search_tags": ["8-10 ranking tags"],
  "description": "STRUCTURED Fiverr gig description, 1000-1150 characters total. MUST be plain text with real line breaks (\\n) and use this EXACT skeleton, adapted to the niche '${project.niche}':\\n\\nAbout this gig\\n<1 punchy opening line that promises the outcome and uses the primary keyword>\\n\\n<2-3 sentence problem→solution paragraph that mentions the primary keyword once more, naturally>\\n\\nWhat You Get: <one line summarizing tiers/scope>\\n• <deliverable 1 with **bold** key benefit>\\n• <deliverable 2>\\n• <deliverable 3>\\n• <deliverable 4>\\n\\nWhy Choose Me?\\n• **Fast & Professional Communication** — <short reason>\\n• **Unlimited Revisions** until you're 100% happy\\n• **High-Quality Delivery** tailored to your goals\\n• **Niche Expertise** in <niche / sub-niche>\\n• **On-Time Delivery** every single order\\n\\nWhat I Need From You:\\n• <input 1 specific to the niche>\\n• <input 2>\\n• <input 3>\\n\\nCall to Action: Ready to <desired buyer outcome>? **Contact me** now to get started or place your order today!\\n\\nRULES: 1000-1150 chars; primary keyword 3-5 times naturally; no markdown headers (#).",
  "buyer_requirements": [
    { "question": "exact question to ask buyer at order start, niche-specific", "type": "free_text|multiple_choice|attachment", "required": true, "options": ["only for multiple_choice"] }
  ],
  "faqs": [{"q":"...","a":"..."}],
  "packages": {
    "basic":   {"name":"...","price":"$X","delivery_days":N,"revisions":N,"features":["..."]},
    "standard":{"name":"...","price":"$X","delivery_days":N,"revisions":N,"features":["..."]},
    "premium": {"name":"...","price":"$X","delivery_days":N,"revisions":N,"features":["..."]}
  },
  "thumbnail_prompts": [
    {
      "style": "e.g. 'Bold typography + product mockup' — modeled on what top sellers in this niche actually use to win clicks",
      "prompt": "Detailed image-gen prompt (80-140 words) sized for Fiverr's gig image of EXACTLY 1280x769 pixels. MUST include: subject specific to the niche '${project.niche}', composition for a 1280x769 horizontal canvas with safe margins, color palette inspired by top-converting Fiverr thumbnails in this niche (name the colors), lighting, 3-5 short bold headline words to overlay (high contrast, sans-serif, large), focal point (product/face/example), trust elements (badges, stars, before/after split if relevant). End with: --ar 1280:769 --no watermark, blurry, low-res, lorem-ipsum text, extra fingers --style raw"
    }
  ]
}

REQUIREMENTS:
- title_variations: EXACTLY 6-8 items, each ≤80 chars, distinct angles modeled on the scraped top sellers.
- gig_metadata: 4-7 items modeled on the actual fields/values top sellers picked for this niche.
- buyer_requirements: 4-6 niche-specific items (never generic).
- faqs: exactly 10 items.
- thumbnail_prompts: exactly 4 items, varied styles (typography-led, product-mockup, character/face, before-after split). EVERY prompt enforces 1280x769 sizing and reflects winning patterns for THIS niche.`,
      "You are a Fiverr top-seller copywriter + AI image prompt engineer. Output only valid JSON. The 'description' MUST follow the exact section skeleton with real \\n line breaks and bullet • markers, total 1000-1150 characters. Adapt every line to the user's niche. Title variations and thumbnail prompts must be specific, competitive, and modeled on real top sellers in the scraped data. Each Re-run uses the variation seed to produce DIFFERENT outputs.",
    );
    const gig_optimization = extractJson(gigText);

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
      .update({ status: "complete" })
      .eq("id", projectId);
    await appendLog(
      admin,
      projectId,
      `✅ Done! Open the results to view your competitive blueprint.`,
    );
}

