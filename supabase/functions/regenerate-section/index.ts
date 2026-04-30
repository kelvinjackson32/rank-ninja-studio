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

    const { resultId, section, field, instruction } = await req.json();

    const { data: result } = await admin.from("research_results").select("*").eq("id", resultId).eq("user_id", user.id).single();
    if (!result) throw new Error("Result not found");

    const context = JSON.stringify({ insights: result.insights, current: section === "profile" ? result.profile_optimization : result.gig_optimization }).slice(0, 12000);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a Fiverr expert. Return ONLY raw text/JSON for the requested field, no markdown, no commentary." },
          { role: "user", content: `Context:\n${context}\n\nRegenerate the "${field}" field of the ${section} section. Custom instruction: ${instruction || "Improve quality"}. Return only the new value (string for text fields, JSON array/object for structured fields).` },
        ],
      }),
    });
    if (resp.status === 429) throw new Error("AI rate limit");
    if (resp.status === 402) throw new Error("AI credits exhausted");
    if (!resp.ok) throw new Error(`AI ${resp.status}`);
    const data = await resp.json();
    let value: any = data.choices?.[0]?.message?.content || "";
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
