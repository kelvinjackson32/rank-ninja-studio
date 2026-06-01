import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    // Load user's Gemini key.
    const { data: settings } = await admin
      .from("user_ai_settings")
      .select("gemini_api_key")
      .eq("user_id", user.id)
      .maybeSingle();
    const geminiKey = (settings?.gemini_api_key || "").trim();
    if (!geminiKey) {
      return new Response(JSON.stringify({
        error: "No Gemini API key configured. Open Settings → AI Generation and paste your Google Gemini API key.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { resultId, section, field, instruction } = await req.json();

    const { data: result } = await admin.from("research_results").select("*").eq("id", resultId).eq("user_id", user.id).single();
    if (!result) throw new Error("Result not found");

    const context = JSON.stringify({ insights: result.insights, current: section === "profile" ? result.profile_optimization : result.gig_optimization }).slice(0, 12000);

    const system = "You are a Fiverr expert. Return ONLY raw text/JSON for the requested field, no markdown, no commentary.";
    const prompt = `Context:\n${context}\n\nRegenerate the "${field}" field of the ${section} section. Custom instruction: ${instruction || "Improve quality"}. Return only the new value (string for text fields, JSON array/object for structured fields).`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 4096 },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (resp.status === 429) throw new Error("Gemini rate limit hit. Try again in a moment.");
    if (resp.status === 401 || resp.status === 403) throw new Error("Gemini API key invalid or unauthorized. Update it in Settings → AI Generation.");
    if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 200)}`);

    const data = await resp.json();
    let value: any = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("\n") || "";
    value = value.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    try { value = JSON.parse(value); } catch {}

    const key = section === "profile" ? "profile_optimization" : "gig_optimization";
    const updated = { ...(result as any)[key], [field]: value };
    await admin.from("research_results").update({ [key]: updated }).eq("id", resultId);

    return new Response(JSON.stringify({ success: true, value }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
