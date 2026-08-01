// AI chat using the user's own Gemini key (no Lovable credits used).
// Supports text + multiple images per message.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type ImgRef = { path: string; mime: string };
type ClientMsg = { role: "user" | "assistant"; content: string; images?: ImgRef[] };

const SYSTEM = `You are RankForge AI, a general-purpose expert assistant — NOT limited to Fiverr.
Answer ANY question fully and accurately: coding, math, business, writing, study help, health/general info, tech support, travel, design, marketing, translation, anything.
Only bring up Fiverr when the user actually asks about it.
When images/screenshots are provided, analyze them carefully (objects, text/OCR, design, code, charts, errors, products) and solve the problem you see.
Never refuse a reasonable request or say a topic is out of scope. If information is missing, make sensible assumptions and state them, then give a complete answer.
Use markdown with **bold**, clear headings, lists and code blocks. Be specific, actionable and complete.`;

async function fetchImageAsBase64(admin: any, path: string): Promise<string> {
  const { data, error } = await admin.storage.from("chat-uploads").download(path);
  if (error || !data) throw new Error(`Could not load image ${path}: ${error?.message}`);
  const buf = new Uint8Array(await data.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const userId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { threadId, messages } = await req.json() as { threadId: string; messages: ClientMsg[] };
    if (!threadId || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "threadId and messages required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Verify thread ownership
    const { data: thread } = await admin.from("chat_threads").select("id,user_id,title").eq("id", threadId).maybeSingle();
    if (!thread || thread.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Thread not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get optional user Gemini key (override); otherwise use Lovable AI Gateway
    const { data: ai } = await admin.from("user_ai_settings").select("gemini_api_key").eq("user_id", userId).maybeSingle();
    const geminiKey = (ai?.gemini_api_key || "").trim();
    const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY") || "";

    // ---------- Call user's Gemini key first (if present) ----------
    async function callUserGemini(): Promise<{ ok: boolean; text?: string; retryable?: boolean; error?: string }> {
      const contents: any[] = [];
      for (const m of messages) {
        const parts: any[] = [];
        if (m.content?.trim()) parts.push({ text: m.content });
        if (m.role === "user" && m.images?.length) {
          for (const img of m.images) {
            try {
              const b64 = await fetchImageAsBase64(admin, img.path);
              parts.push({ inline_data: { mime_type: img.mime || "image/jpeg", data: b64 } });
            } catch (e) {
              parts.push({ text: `[image failed to load: ${(e as Error).message}]` });
            }
          }
        }
        if (parts.length === 0) parts.push({ text: " " });
        contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
      }
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
        }),
      });
      if (resp.status === 429 || resp.status === 401 || resp.status === 403) {
        return { ok: false, retryable: true, error: `user_key_${resp.status}` };
      }
      if (!resp.ok) {
        const txt = await resp.text();
        return { ok: false, retryable: false, error: `Gemini ${resp.status}: ${txt.slice(0, 400)}` };
      }
      const data = await resp.json();
      const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("\n") || "(empty response)";
      return { ok: true, text };
    }

    // ---------- Lovable AI Gateway fallback (no user key needed) ----------
    async function callLovableAI(): Promise<{ ok: boolean; text?: string; error?: string; status?: number }> {
      if (!LOVABLE_KEY) return { ok: false, error: "Lovable AI not configured", status: 500 };
      const gwMessages: any[] = [{ role: "system", content: SYSTEM }];
      for (const m of messages) {
        const content: any[] = [];
        if (m.content?.trim()) content.push({ type: "text", text: m.content });
        if (m.role === "user" && m.images?.length) {
          for (const img of m.images) {
            try {
              const b64 = await fetchImageAsBase64(admin, img.path);
              content.push({ type: "image_url", image_url: { url: `data:${img.mime || "image/jpeg"};base64,${b64}` } });
            } catch (e) {
              content.push({ type: "text", text: `[image failed to load: ${(e as Error).message}]` });
            }
          }
        }
        gwMessages.push({ role: m.role, content: content.length === 1 && content[0].type === "text" ? content[0].text : content });
      }
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_KEY}` },
        body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: gwMessages }),
      });
      if (resp.status === 429) return { ok: false, error: "Rate limit reached on Lovable AI. Try again shortly.", status: 429 };
      if (resp.status === 402) return { ok: false, error: "Lovable AI credits exhausted. Add credits in Settings → Workspace → Usage.", status: 402 };
      if (!resp.ok) {
        const txt = await resp.text();
        return { ok: false, error: `Lovable AI ${resp.status}: ${txt.slice(0, 400)}`, status: 500 };
      }
      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content || "(empty response)";
      return { ok: true, text };
    }

    let text: string;
    if (geminiKey) {
      const r = await callUserGemini();
      if (r.ok) {
        text = r.text!;
      } else if (r.retryable) {
        // User key hit quota/auth — silently fall back to Lovable AI
        const fb = await callLovableAI();
        if (!fb.ok) {
          return new Response(JSON.stringify({ error: fb.error }), { status: fb.status || 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        text = fb.text!;
      } else {
        return new Response(JSON.stringify({ error: r.error }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } else {
      const fb = await callLovableAI();
      if (!fb.ok) {
        return new Response(JSON.stringify({ error: fb.error }), { status: fb.status || 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      text = fb.text!;
    }

    // Save assistant message
    await admin.from("chat_messages").insert({ thread_id: threadId, user_id: userId, role: "assistant", content: text, images: [] });
    // Bump thread updated_at + auto-title from first user msg if still default
    const updates: any = { updated_at: new Date().toISOString() };
    if (thread.title === "New chat") {
      const firstUser = messages.find(m => m.role === "user")?.content?.trim();
      if (firstUser) updates.title = firstUser.slice(0, 60);
    }
    await admin.from("chat_threads").update(updates).eq("id", threadId);

    return new Response(JSON.stringify({ text }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
