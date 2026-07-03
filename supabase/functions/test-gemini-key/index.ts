import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Quick ping to Google Gemini to verify the user's key and generation quota.
async function testKey(apiKey: string): Promise<{ ok: boolean; status?: "invalid" | "quota" | "network"; error?: string }> {
  if (!apiKey || apiKey.length < 10) return { ok: false, error: "Key looks too short." };
  try {
    const modelsResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
      method: "GET",
      signal: AbortSignal.timeout(15_000),
    });
    if (modelsResp.status === 401 || modelsResp.status === 403) {
      return { ok: false, status: "invalid", error: "Google rejected this key. Copy the API key again from Google AI Studio and paste the full value." };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Reply with just the word: OK" }] }],
        generationConfig: { maxOutputTokens: 10 },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (resp.status === 401 || resp.status === 403) return { ok: false, status: "invalid", error: "Google rejected this key. Copy the API key again from Google AI Studio and paste the full value." };
    if (resp.status === 429) {
      const txt = await resp.text();
      const isNoQuota = /limit:\s*0|quota exceeded|free_tier_requests/i.test(txt);
      return {
        ok: false,
        status: "quota",
        error: isNoQuota
          ? "This key is recognized, but its Google project has no Gemini generation quota. In Google AI Studio, create/select a project with Gemini API access or enable billing/quota, then test again."
          : "This key is recognized, but Gemini rate limit/quota is currently exhausted. Wait or use another Google project key.",
      };
    }
    if (!resp.ok) {
      const txt = await resp.text();
      return { ok: false, error: `Gemini ${resp.status}: ${txt.slice(0, 200)}` };
    }
    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!text) return { ok: false, error: "Empty response from Gemini." };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, status: "network", error: e?.message || "Network error contacting Gemini." };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    let apiKey: string = (body.apiKey || "").trim();

    // If no key supplied, test the stored key.
    if (!apiKey) {
      const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data } = await admin
        .from("user_ai_settings")
        .select("gemini_api_key")
        .eq("user_id", user.id)
        .maybeSingle();
      apiKey = (data?.gemini_api_key || "").trim();
      if (!apiKey) {
        return new Response(JSON.stringify({ ok: false, error: "No key saved yet." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const result = await testKey(apiKey);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || "Test failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
