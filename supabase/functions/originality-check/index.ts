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
      generationConfig: { temperature: 0.4, maxOutputTokens: 8192, responseMimeType: "application/json" },
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
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("\n") || "";
  const finishReason = data.candidates?.[0]?.finishReason;
  let cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Attempt repair for truncated JSON (e.g. MAX_TOKENS)
    // Close any unterminated string, then close open brackets/braces.
    let repaired = cleaned;
    // Remove trailing incomplete content after last complete item
    const lastComma = Math.max(repaired.lastIndexOf("},"), repaired.lastIndexOf("],"), repaired.lastIndexOf('",'));
    // Count quotes to detect open string
    let inStr = false, esc = false;
    for (let i = 0; i < repaired.length; i++) {
      const c = repaired[i];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') inStr = !inStr;
    }
    if (inStr) repaired += '"';
    // Balance brackets
    const opens = (repaired.match(/[\{\[]/g) || []);
    const closes = (repaired.match(/[\}\]]/g) || []);
    const stack: string[] = [];
    let inStr2 = false, esc2 = false;
    for (const c of repaired) {
      if (esc2) { esc2 = false; continue; }
      if (c === "\\") { esc2 = true; continue; }
      if (c === '"') { inStr2 = !inStr2; continue; }
      if (inStr2) continue;
      if (c === "{") stack.push("}");
      else if (c === "[") stack.push("]");
      else if (c === "}" || c === "]") stack.pop();
    }
    // Strip trailing comma before closing
    repaired = repaired.replace(/,\s*$/, "");
    while (stack.length) repaired += stack.pop();
    try {
      return JSON.parse(repaired);
    } catch (e) {
      throw new Error(`Gemini returned malformed JSON (finishReason=${finishReason}): ${String(e).slice(0,200)}`);
    }
  }
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
    const sellers = (insights.top_sellers || []).slice(0, 10);

    const competitorCorpus = sellers.map((s: any, i: number) =>
      `[${i+1}] TITLE: ${s.title || s.name || ""}\nDESC: ${(s.description || "").slice(0, 400)}`
    ).join("\n---\n");

    const prompt = `Score the originality of this Fiverr gig copy against the actual competitor corpus. Identify copied/cliché phrasings and propose unique rewrites.

GIG TITLE: ${gig.gig_title || ""}
GIG DESCRIPTION:
${(gig.description || "").slice(0, 2000)}

COMPETITOR CORPUS:
${competitorCorpus}

Return JSON ONLY:
{
  "originality_score": 0,
  "title_originality": 0,
  "description_originality": 0,
  "matched_phrases": [{"phrase": "...", "found_in_competitors": 0, "severity": "low|medium|high", "rewrite": "..."}],
  "cliché_flags": ["high-quality work", "100% satisfaction", "..."],
  "rewrite_title_suggestion": "...",
  "rewrite_intro_suggestion": "...",
  "verdict": "one short sentence summary"
}
Scores 0-100, higher = more original. Be honest, be strict.`;

    const result = await callGemini(prompt, "You are a plagiarism + originality auditor. Output strict JSON only.", geminiKey);

    const updatedInsights = { ...insights, originality: { ...result, generated_at: new Date().toISOString() } };
    await admin.from("research_results").update({ insights: updatedInsights }).eq("id", research.id);

    return new Response(JSON.stringify({ success: true, originality: result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
