import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function callGemini(prompt: string, system: string, geminiKey: string, json = false, maxTokens = 4096) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;
  const generationConfig: any = { temperature: 0.85, maxOutputTokens: maxTokens };
  if (json) generationConfig.responseMimeType = "application/json";
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
    }),
    signal: AbortSignal.timeout(110_000),
  });
  if (resp.status === 429) {
    const txt = await resp.text();
    const isNoQuota = /limit:\s*0|quota exceeded|free_tier_requests/i.test(txt);
    throw new Error(isNoQuota
      ? "Gemini key is recognized, but its Google project has no Gemini generation quota. Use a key from a Google AI Studio project with Gemini API quota/billing."
      : "Gemini quota/rate limit hit for this key. Wait a moment or switch to another Google project key.");
  }
  if (resp.status === 401 || resp.status === 403) throw new Error("Gemini API key invalid or unauthorized. Update it in Settings → AI Generation.");
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("\n") || "";
}

function extractJson(text: string): any {
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  // find first balanced { ... }
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0 && start >= 0) { try { return JSON.parse(cleaned.slice(start, i + 1)); } catch {} } }
  }
  throw new Error("Gemini returned non-JSON output");
}

import { capPackages } from "../_shared/packageCaps.ts";

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

    const { data: settings } = await admin
      .from("user_ai_settings").select("gemini_api_key").eq("user_id", user.id).maybeSingle();
    const geminiKey = (settings?.gemini_api_key || "").trim();
    if (!geminiKey) {
      return new Response(JSON.stringify({
        error: "No Gemini API key configured. Open Settings → AI Generation and paste your Google Gemini API key.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { resultId, section, field, instruction } = await req.json();

    const { data: result } = await admin.from("research_results").select("*").eq("id", resultId).eq("user_id", user.id).single();
    if (!result) throw new Error("Result not found");
    const { data: project } = await admin.from("projects").select("niche, target_duration_seconds, character_lock").eq("id", (result as any).project_id).maybeSingle();
    const targetDuration = project?.target_duration_seconds || 30;
    const characterLock = project?.character_lock !== false;
    const niche = project?.niche || "";

    // ========== CASCADE BRANCH: regenerating gig_title rebuilds every dependent field ==========
    if (section === "gig" && field === "gig_title") {
      const currentGig = (result as any).gig_optimization || {};
      const insightsCtx = JSON.stringify((result as any).insights || {}).slice(0, 6000);
      const currentTitle = currentGig.gig_title || "";
      const variations = (currentGig.title_variations || []).map((v: any) => v.title).filter(Boolean);

      const system = "You are an elite Fiverr strategist. Return ONLY valid JSON. No markdown fences, no commentary.";
      const prompt = `Niche: "${niche}"
Target video duration: ${targetDuration}s
Character lock: ${characterLock ? "ON" : "OFF"}
Previous gig title (do NOT reuse): "${currentTitle}"
Other previously used variations to avoid: ${JSON.stringify(variations).slice(0, 600)}
Insights context: ${insightsCtx}

User instruction: ${instruction || "Generate a fresh, distinct gig title and rebuild EVERY dependent field so they all match the new title perfectly."}

Generate ONE brand-new high-CTR gig_title (<=80 chars, primary keyword at start, must be meaningfully different from the previous title). Then rebuild EVERY dependent field so they all align with this NEW title's promise, angle, tone, and deliverable. Return strict JSON in this exact shape:

{
  "gig_title": "<=80 chars, NEW, distinct from previous",
  "title_variations": [6 items, each {"title":"<=80 chars","angle":"...","why_it_works":"..."} — all aligned with the new gig_title's angle],
  "category": {"category":"...","subcategory":"...","service_type":"...","why":"..."},
  "gig_metadata": [4-6 items {"field":"Fiverr field name","recommended_values":["..."],"why":"..."}],
  "search_tags": [8-10 ranking tags that match the NEW title],
  "description": "1000-1150 chars, sections: About this gig, What You Get, Why Choose Me?, What I Need From You, Call to Action. Real \\n line breaks and • bullets. Must reflect the NEW title's promise.",
  "buyer_requirements": [4-6 niche-specific items {"question":"...","type":"free_text|multiple_choice|attachment","required":true,"options":["only for multiple_choice"]}],
  "faqs": [exactly 8 items {"q":"...","a":"..."} all aligned with the new title],
  "packages": {
    "basic":   {"name":"<=100 chars","price":"$X","delivery_days":2,"revisions":1,"features":["each <=100 chars"]},
    "standard":{"name":"<=100 chars","price":"$X","delivery_days":3,"revisions":2,"features":["each <=100 chars"]},
    "premium": {"name":"<=100 chars","price":"$X","delivery_days":5,"revisions":3,"features":["each <=100 chars"]}
  },
  "thumbnail_prompts": [EXACTLY 2 items {"style":"...","prompt":"80-140 word image-gen prompt for 1280x769 Fiverr gig image with bold headline words that match the NEW title, focal point, trust elements, palette, --ar 1280:769 --no watermark, blurry, low-res, lorem-ipsum text --style raw"}],
  "is_video_gig": ${currentGig.is_video_gig === true},
  "video_concepts": ${currentGig.is_video_gig === true ? `[EXACTLY 2 items aligned to the new title, each {"concept_title":"...","concept_summary":"...","duration_seconds":${targetDuration},"visual_style":"...","character_appearance_sheet":${characterLock ? `"markdown sheet locking 1-3 named characters with appearance/outfit/HEX palette"` : `""`},"stage_prompts":{"stage_1_ideas":"...","stage_2_lyrics_or_script":"...","stage_3_video_scene_script":"EXACTLY ${targetDuration}s, ${Math.max(3, Math.ceil(targetDuration/5))} scenes ~5s each with timestamps","stage_4_scene_image_prompts":"...","stage_5_character_prompts":"...","stage_6_final_scene_assembly":"..."},"tools_suggested":["..."]}]` : "[]"}
}

HARD RULES:
- Every package name AND every feature string MUST be <=100 chars (Fiverr limit).
- Every field must clearly reflect the NEW gig_title — no leftover phrasing from the previous title.
- Return ONLY the JSON object above. No prose.`;

      const text = await callGemini(prompt, system, geminiKey, true, 20000);
      const newGig = extractJson(text);
      newGig.packages = capPackages(newGig.packages);
      if (typeof newGig.gig_title === "string" && newGig.gig_title.length > 80) {
        newGig.gig_title = newGig.gig_title.slice(0, 80);
      }

      const { applySafetyFilter } = await import("../_shared/safety.ts");
      const safe = applySafetyFilter(newGig, "gig");
      const merged = { ...currentGig, ...safe.sanitized, safety_report: safe.report };
      await admin.from("research_results").update({ gig_optimization: merged }).eq("id", resultId);

      return new Response(JSON.stringify({ success: true, cascade: true, gig_optimization: merged }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ========== SINGLE-FIELD REGEN (existing behavior) ==========
    const context = JSON.stringify({
      insights: (result as any).insights,
      current: section === "profile" ? (result as any).profile_optimization : (result as any).gig_optimization,
    }).slice(0, 12000);

    const system = "You are a Fiverr expert. Return ONLY raw text/JSON for the requested field, no markdown, no commentary.";
    const prompt = `Context:\n${context}\n\nRegenerate the "${field}" field of the ${section} section. Custom instruction: ${instruction || "Improve quality"}. Return only the new value (string for text fields, JSON array/object for structured fields). For packages: every name and feature MUST be <=100 chars.`;

    const text = await callGemini(prompt, system, geminiKey, false, 4096);
    let value: any = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    try { value = JSON.parse(value); } catch {}
    if (field === "packages") value = capPackages(value);

    const { applySafetyFilter } = await import("../_shared/safety.ts");
    const fieldSafe = applySafetyFilter({ [field]: value }, section);
    value = (fieldSafe.sanitized as any)[field];

    const key = section === "profile" ? "profile_optimization" : "gig_optimization";
    const existing = (result as any)[key] || {};
    const existingReport = existing.safety_report || { applied_at: new Date().toISOString(), total_fixes: 0, flags: [], notes: [] };
    const mergedReport = {
      applied_at: new Date().toISOString(),
      total_fixes: (existingReport.total_fixes || 0) + fieldSafe.report.total_fixes,
      flags: [...(existingReport.flags || []).filter((f: any) => !f.field?.startsWith(field)), ...fieldSafe.report.flags],
      notes: Array.from(new Set([...(existingReport.notes || []), ...fieldSafe.report.notes])),
    };
    const updated = { ...existing, [field]: value, safety_report: mergedReport };
    await admin.from("research_results").update({ [key]: updated }).eq("id", resultId);

    return new Response(JSON.stringify({ success: true, value, safety_report: fieldSafe.report }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
