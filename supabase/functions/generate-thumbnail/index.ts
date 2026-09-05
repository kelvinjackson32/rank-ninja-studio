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
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: settings } = await admin
      .from("user_ai_settings")
      .select("gemini_api_key")
      .eq("user_id", user.id)
      .maybeSingle();
    const geminiKey = String(settings?.gemini_api_key || "").trim();
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: "No Gemini API key configured. Open Settings → AI Generation first." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { prompt, size } = await req.json();
    if (!prompt || typeof prompt !== "string" || prompt.length > 4000) {
      return new Response(JSON.stringify({ error: "Invalid prompt" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fiverr conversion-focused thumbnail formula. It improves clarity and
    // click appeal without promising rankings, sales, or guaranteed results.
    const enhancedPrompt = `Create a Fiverr GIG THUMBNAIL (1280x769, landscape 5:3) engineered for maximum click-through and conversions, modeled after the top-selling gigs on Fiverr.

USER BRIEF: ${prompt}

MANDATORY DESIGN RULES (top-converting Fiverr gigs follow ALL of these):
- Bold, punchy HEADLINE text (3–6 words max), extra-large, ultra-legible even at thumbnail size. Use a strong sans-serif (Poppins/Montserrat/Inter Black). Place it on the LEFT half.
- Include a clear benefit-driven hook (e.g. "CLEAN BRAND DESIGN", "READY TO USE", "CONTENT THAT CONVERTS", "FAST PROFESSIONAL DELIVERY"). Do not promise rankings, sales, or guaranteed results. No spelling mistakes.
- High-contrast color palette: deep background (navy, black, dark gradient) with ONE vivid accent (electric yellow, neon green, orange, or hot red) for the headline / CTA. Avoid muddy or pastel colors.
- Add a small factual trust badge / ribbon only when supported by the user brief, such as "24H DELIVERY". Never invent ratings, guarantees, reviews, or seller levels.
- RIGHT half: a bold visual — realistic product mockup, professional photo of the deliverable, or a confident smiling seller headshot. Sharp, well-lit, professional studio quality.
- Use depth: subtle drop shadows, soft glow behind the headline, a slight gradient overlay so text pops off the background.
- Absolutely NO cluttered stock backgrounds, NO watermarks, NO tiny unreadable text, NO Fiverr logo, NO fake reviews.
- Composition: clean grid, generous padding from edges, headline aligned left, visual anchor right. Buyer must understand the offer in under 1 second.
- Output must look like a PREMIUM, professionally-designed Fiverr thumbnail from a Level 2 / Top Rated seller — not AI-generic, not amateur.`;

    // Use the user's Gemini key for image generation as well. The first model
    // is the current native image model; the second keeps older Google AI
    // Studio keys usable when the first catalog entry is unavailable.
    const models = ["gemini-2.5-flash-image", "gemini-2.0-flash-exp-image-generation"];
    let b64 = "";
    let lastError = "";
    for (const model of models) {
      const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: enhancedPrompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      });
      const responseText = await upstream.text();
      if (upstream.ok) {
        const data = JSON.parse(responseText);
        b64 = data?.candidates?.[0]?.content?.parts?.find((part: any) => part?.inlineData?.data)?.inlineData?.data || "";
        if (b64) break;
        lastError = "Gemini returned no image data.";
      } else {
        lastError = `Gemini image generation failed (${upstream.status}): ${responseText.slice(0, 250)}`;
        if (![404, 400].includes(upstream.status)) break;
      }
    }
    if (!b64) {
      return new Response(JSON.stringify({ error: lastError || "No image returned from Gemini." }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ image: `data:image/png;base64,${b64}` }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
