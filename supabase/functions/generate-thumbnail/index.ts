import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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

    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-image-2",
        prompt: enhancedPrompt,
         size: size || "1536x1024",
         quality: "high",
        n: 1,
      }),
    });

    if (upstream.status === 429) {
      return new Response(JSON.stringify({ error: "AI rate limit. Try again shortly." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (upstream.status === 402) {
      return new Response(JSON.stringify({ error: "AI credits exhausted. Top up Lovable AI in workspace settings." }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!upstream.ok) {
      const txt = await upstream.text();
      return new Response(JSON.stringify({ error: `Image gen failed: ${txt.slice(0, 300)}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await upstream.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      return new Response(JSON.stringify({ error: "No image returned" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
