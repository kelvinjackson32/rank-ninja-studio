// AI chat using the user's own Gemini key (no Lovable credits used).
// Supports text + multiple images per message.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type ImgRef = { path: string; mime: string };
type ClientMsg = { role: "user" | "assistant"; content: string; images?: ImgRef[] };

const SYSTEM = `You are RankForge AI, an expert assistant. Answer clearly, accurately and helpfully on ANY topic.
When images are provided, analyze them carefully (objects, text/OCR, design, code, charts, screenshots, products).
Use markdown with **bold**, headings, lists and code blocks. Be specific and actionable.`;

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

    // Get Gemini key
    const { data: ai } = await admin.from("user_ai_settings").select("gemini_api_key").eq("user_id", userId).maybeSingle();
    const geminiKey = (ai?.gemini_api_key || "").trim();
    if (!geminiKey) {
      return new Response(JSON.stringify({ error: "No Gemini API key configured. Open Settings → AI Generation and paste your free Google Gemini key." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Build Gemini contents
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return new Response(JSON.stringify({ error: `Gemini ${resp.status}: ${txt.slice(0, 400)}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("\n") || "(empty response)";

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
