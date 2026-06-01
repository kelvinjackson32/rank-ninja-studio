// Shared Gemini caller — uses the signed-in user's stored API key.
// Keep AI generation off the Lovable AI gateway entirely.

export async function getUserGeminiKey(admin: any, userId: string): Promise<string> {
  const { data } = await admin
    .from("user_ai_settings")
    .select("gemini_api_key")
    .eq("user_id", userId)
    .maybeSingle();
  const key = (data?.gemini_api_key || "").trim();
  if (!key) {
    throw new Error(
      "No Gemini API key configured. Open Settings → AI Generation and paste your Google Gemini API key (free at https://aistudio.google.com/apikey).",
    );
  }
  return key;
}

export async function callGemini(
  prompt: string,
  system: string,
  geminiKey: string,
  opts: { model?: string; timeoutMs?: number } = {},
): Promise<string> {
  const model = opts.model || "gemini-1.5-flash";
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 8192 },
      }),
      signal: controller.signal,
    });
    if (resp.status === 429) throw new Error("Gemini rate limit hit. Wait a moment and retry.");
    if (resp.status === 401 || resp.status === 403) {
      throw new Error("Gemini API key invalid or unauthorized. Update it in Settings → AI Generation.");
    }
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Gemini error ${resp.status}: ${txt.slice(0, 300)}`);
    }
    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("\n") || "";
    if (!text) throw new Error("Gemini returned an empty response.");
    return text;
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`Gemini request timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
