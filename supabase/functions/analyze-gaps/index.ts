import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function callGemini(prompt: string, system: string, key: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 3000, responseMimeType: "application/json" },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("\n") || "";
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  return JSON.parse(cleaned);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: settings } = await admin.from("user_ai_settings").select("gemini_api_key").eq("user_id", user.id).maybeSingle();
    const geminiKey = (settings?.gemini_api_key || "").trim();
    if (!geminiKey) return new Response(JSON.stringify({ error: "No Gemini API key. Open Settings → AI Generation." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { projectId } = await req.json();
    const { data: research } = await admin.from("research_results").select("*").eq("project_id", projectId).eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!research) return new Response(JSON.stringify({ error: "No research found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const insights = research.insights || {};
    const gig = research.gig_optimization || {};
    const sellers = (insights.top_sellers || []).slice(0, 8);

    const prompt = `Compare this user's planned Fiverr gig against the top sellers in the niche and find GAPS the user can exploit.

USER'S PLANNED GIG:
Title: ${gig.gig_title || "(none)"}
Description: ${(gig.description || "").slice(0, 800)}
Packages: ${JSON.stringify(gig.packages || {}).slice(0, 800)}
Tags: ${(gig.search_tags || []).join(", ")}

TOP SELLERS (${sellers.length}):
${sellers.map((s: any, i: number) => `${i+1}. ${s.title || s.name || "untitled"} — ${s.price ? "$"+s.price : ""} — ${s.reviews_count || s.reviews || 0} reviews
   Description excerpt: ${(s.description || "").slice(0, 250)}`).join("\n")}

Return JSON ONLY in this shape:
{
  "missing_features": [{"feature": "...", "why_it_matters": "...", "how_many_competitors_offer_it": 0}],
  "overcrowded_features": [{"feature": "...", "note": "everyone offers this — don't market on it"}],
  "untapped_angles": [{"angle": "...", "evidence": "..."}],
  "price_gap": {"competitor_avg": 0, "your_starting": 0, "recommendation": "..."},
  "differentiation_score": 0,
  "top_recommendations": ["actionable advice 1", "..."]
}
differentiation_score is 0-100 (how different the user's gig is from the pack). Be specific, no fluff.`;

    const result = await callGemini(prompt, "You are a Fiverr competitive strategist. Output strict JSON only.", geminiKey);

    // store on research_results.insights
    const updatedInsights = { ...insights, gap_analysis: { ...result, generated_at: new Date().toISOString() } };
    await admin.from("research_results").update({ insights: updatedInsights }).eq("id", research.id);

    return new Response(JSON.stringify({ success: true, gap_analysis: result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
