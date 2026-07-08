import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ScrapeResult = {
  url: string;
  markdown: string;
  metadata: any;
  source: "direct" | "apify" | "firecrawl";
};

const FUNCTION_DEADLINE_MS = 140_000;

type ApifyToken = { id: string | null; token: string; actor_id: string | null };

async function loadApifyTokens(admin: any, userId: string): Promise<ApifyToken[]> {
  const tokens: ApifyToken[] = [];
  try {
    const { data } = await admin
      .from("api_keys")
      .select("id, api_key, actor_id, status")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("last_used_at", { ascending: true, nullsFirst: true });
    for (const row of (data || []) as any[]) {
      if (row?.api_key) tokens.push({ id: row.id, token: String(row.api_key).trim(), actor_id: row.actor_id || null });
    }
  } catch (e) {
    console.error("loadApifyTokens error", (e as Error).message);
  }
  const envToken = Deno.env.get("APIFY_API_TOKEN");
  if (envToken) tokens.push({ id: null, token: envToken, actor_id: null });
  // de-dupe by token
  const seen = new Set<string>();
  return tokens.filter((t) => (t.token && !seen.has(t.token) && (seen.add(t.token), true)));
}

async function markApifyKey(admin: any, id: string | null, status: string, error?: string) {
  if (!id) return;
  try {
    await admin.from("api_keys").update({
      status,
      error_message: error ? String(error).slice(0, 500) : null,
      last_used_at: new Date().toISOString(),
    }).eq("id", id);
  } catch (_) { /* ignore */ }
}
const startedAt = () => Date.now();
const msLeft = (start: number, reserve = 8_000) => Math.max(1_000, FUNCTION_DEADLINE_MS - (Date.now() - start) - reserve);
const hasTimeFor = (start: number, ms: number) => msLeft(start, 0) > ms;

const FIVERR_BLOCKED_PATTERNS = /access denied|captcha|robot|unusual traffic|enable javascript|page not found|not available|sorry, we couldn't find|log in to fiverr|join fiverr/i;

function canonicalUrl(raw: string | undefined | null): string {
  const value = (raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value.startsWith("http") ? value : `https://www.fiverr.com/${value.replace(/^@/, "")}`);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return value;
  }
}

function normalizeProfileInput(raw?: string): string | undefined {
  const value = (raw || "").trim();
  if (!value) return undefined;
  if (!/^https?:\/\//i.test(value) && !value.includes("/")) {
    return `https://www.fiverr.com/${value.replace(/^@/, "")}`;
  }
  return canonicalUrl(value);
}

function getFiverrUsername(raw?: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://www.fiverr.com/${raw}`);
    const [username] = url.pathname.split("/").filter(Boolean);
    if (!username || ["categories", "search", "gigs", "users", "support", "inbox"].includes(username.toLowerCase())) return null;
    return username;
  } catch {
    return null;
  }
}

function isLikelyGigUrl(raw: string, username?: string | null): boolean {
  try {
    const url = new URL(raw);
    if (!/fiverr\.com$/i.test(url.hostname.replace(/^www\./, ""))) return false;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0]?.toLowerCase() === "s" && parts[1]) return true;
    if (parts.length < 2) return false;
    if (username && parts[0].toLowerCase() !== username.toLowerCase()) return false;
    const second = parts[1].toLowerCase();
    return !["portfolio", "reviews", "about", "seller_dashboard", "users"].includes(second);
  } catch {
    return false;
  }
}

function looksUsable(markdown: string): boolean {
  const text = (markdown || "").trim();
  if (text.length < 250) return false;
  if (FIVERR_BLOCKED_PATTERNS.test(text) && text.length < 2500) return false;
  return true;
}

function absoluteFiverrUrl(href: string, base = "https://www.fiverr.com") {
  try {
    return canonicalUrl(new URL(href.replace(/\\\//g, "/"), base).toString());
  } catch {
    return "";
  }
}

function extractFiverrLinks(raw: string, baseUrl: string): string[] {
  const found = new Set<string>();
  const hrefRe = /href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(raw))) {
    const href = m[1];
    if (href.includes("fiverr.com") || href.startsWith("/")) {
      const url = absoluteFiverrUrl(href, baseUrl);
      if (url) found.add(url);
    }
  }
  const urlRe = /https?:\\?\/\\?\/(?:www\.)?fiverr\.com\\?\/[^\s"'<>\\)]+/gi;
  while ((m = urlRe.exec(raw))) {
    const url = absoluteFiverrUrl(m[0].replace(/\\\//g, "/"), baseUrl);
    if (url) found.add(url);
  }
  return Array.from(found);
}

function extractMeta(html: string, key: string): string {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
  const alt = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${key}["'][^>]*>`, "i");
  return (html.match(re)?.[1] || html.match(alt)?.[1] || "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveFiverrUrl(raw: string, timeoutMs = 5_000): Promise<string> {
  const normalized = canonicalUrl(raw);
  try {
    const url = new URL(normalized);
    if (url.hostname.replace(/^www\./, "") !== "fiverr.com" || !url.pathname.startsWith("/s/")) return normalized;
    const resp = await fetch(normalized, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const location = resp.headers.get("location");
    return location ? absoluteFiverrUrl(location, normalized) || normalized : normalized;
  } catch {
    return normalized;
  }
}

async function directFiverrScrape(url: string, timeoutMs = 8_000): Promise<ScrapeResult | null> {
  const normalized = canonicalUrl(url);
  try {
    const resp = await fetch(normalized, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const finalUrl = canonicalUrl(resp.url || normalized);
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || extractMeta(html, "og:title");
    const description = extractMeta(html, "description") || extractMeta(html, "og:description");
    const links = extractFiverrLinks(html, finalUrl);
    const bodyText = htmlToText(html).slice(0, 18000);
    const markdown = [`Title: ${title || ""}`, `Meta description: ${description || ""}`, bodyText].filter(Boolean).join("\n\n").trim();
    if (!looksUsable(markdown)) return null;
    return { url: finalUrl, markdown, metadata: { title, description, links, statusCode: resp.status }, source: "direct" };
  } catch (e) {
    console.error("direct fiverr error", normalized, (e as Error).message);
    return null;
  }
}

function extractApifyMarkdown(item: any): string {
  const meta = item?.metadata || {};
  const chunks = [
    meta.title && `Title: ${meta.title}`,
    meta.description && `Meta description: ${meta.description}`,
    item?.markdown,
    item?.text,
    item?.description,
    item?.html && String(item.html).replace(/<[^>]+>/g, " "),
  ].filter(Boolean);
  return chunks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function apifyCrawl(startUrls: string[], opts: { maxCrawlDepth: number; maxPages: number; timeoutMs?: number }): Promise<ScrapeResult[]> {
  const token = Deno.env.get("APIFY_API_TOKEN");
  if (!token || startUrls.length === 0) return [];

  const actor = (Deno.env.get("APIFY_FIVERR_ACTOR_ID") || "apify/website-content-crawler").replace("/", "~");
  const runUrl = new URL(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`);
  runUrl.searchParams.set("token", token);
  runUrl.searchParams.set("memory", "1024");
  runUrl.searchParams.set("timeout", String(Math.max(8, Math.ceil((opts.timeoutMs || 10_000) / 1000))));
  const resp = await fetch(runUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      startUrls: startUrls.map((url) => ({ url: canonicalUrl(url) })),
      crawlerType: "playwright:firefox",
      maxCrawlDepth: opts.maxCrawlDepth,
      maxCrawlPages: opts.maxPages,
      maxResults: opts.maxPages,
      useSitemaps: false,
      respectRobotsTxtFile: false,
      proxyConfiguration: { useApifyProxy: true },
      dynamicContentWaitSecs: 1,
      requestTimeoutSecs: 8,
      maxRequestRetries: 0,
      maxConcurrency: 1,
      maxSessionRotations: 4,
      removeCookieWarnings: true,
      blockMedia: true,
      htmlTransformer: "none",
      saveMarkdown: true,
      removeElementsCssSelector: "script, style, noscript, svg, img[src^='data:']",
    }),
    signal: AbortSignal.timeout(opts.timeoutMs || 10_000),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    console.error(`Apify ${resp.status}: ${txt.slice(0, 300)}`);
    return [];
  }

  const data = await resp.json().catch(() => []);
  const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
  return items
    .map((item: any): ScrapeResult => {
      const metadata = item?.metadata || {};
      const url = canonicalUrl(item?.url || item?.loadedUrl || item?.sourceUrl || metadata.sourceURL || "");
      return {
        url,
        markdown: extractApifyMarkdown(item).slice(0, 20000),
        metadata: { ...metadata, links: item?.links || item?.urls || metadata.links || [] },
        source: "apify" as const,
      };
    })
    .filter((item: ScrapeResult) => item.url && looksUsable(item.markdown));
}

// Try Firecrawl with retry. Fiverr aggressively blocks bots, so we attempt twice
// with different waits, then gracefully give up so the audit still runs.
async function firecrawlScrape(url: string, timeoutMs = 8_000): Promise<{ markdown: string; metadata: any } | null> {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) {
    console.warn("FIRECRAWL_API_KEY missing — skipping live scrape");
    return null;
  }
  const attempts = [{ waitFor: 1500, onlyMainContent: false }];
  for (const opts of attempts) {
    try {
      const resp = await fetch("https://api.firecrawl.dev/v2/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          formats: ["markdown", "links"],
          onlyMainContent: opts.onlyMainContent,
          waitFor: opts.waitFor,
          location: { country: "US", languages: ["en"] },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!resp.ok) {
        console.error(`Firecrawl ${resp.status} for ${url}`);
        continue;
      }
      const data = await resp.json();
      const md: string = data.data?.markdown || data.markdown || "";
      const meta = { ...(data.data?.metadata || data.metadata || {}), links: data.data?.links || data.links || [] };
      if (md && md.trim().length > 250) {
        return { markdown: md.slice(0, 16000), metadata: meta };
      }
      console.warn(`Firecrawl returned thin content (${md.length} chars) for ${url}`);
    } catch (e) {
      console.error("firecrawl error", url, (e as Error).message);
    }
  }
  return null;
}

async function scrapeSingle(url: string, timeoutMs = 34_000): Promise<ScrapeResult | null> {
  const normalized = await resolveFiverrUrl(url);

  const direct = await directFiverrScrape(normalized, Math.min(5_000, timeoutMs));
  if (direct) return direct;

  const firecrawl = await firecrawlScrape(normalized, Math.min(7_000, timeoutMs));
  if (firecrawl && looksUsable(firecrawl.markdown)) {
    return { url: normalized, markdown: firecrawl.markdown, metadata: firecrawl.metadata, source: "firecrawl" };
  }

  const apify = await apifyCrawl([normalized], { maxCrawlDepth: 0, maxPages: 1, timeoutMs: Math.min(8_000, timeoutMs) }).catch((e) => {
    console.error("apify single error", normalized, (e as Error).message);
    return [];
  });
  if (apify[0]) return apify[0];
  return null;
}

function serviceHintFromUrl(raw: string, niche?: string): string {
  if (niche?.trim()) return niche.trim();
  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    const slug = parts[0]?.toLowerCase() === "s" ? parts[1] : parts[1] || parts[0] || raw;
    return decodeURIComponent(slug)
      .replace(/[-_]+/g, " ")
      .replace(/\b(i|will|do|make|create|design|your|for|and|or|the|a|an)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim() || "Fiverr service";
  } catch {
    return niche || "Fiverr service";
  }
}

function titleCase(value: string): string {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function compactTitle(value: string, max = 78): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}`;
}

function heuristicAudit(target: "PROFILE" | "GIG", url: string, opts: { niche?: string; issue?: string; reason?: string }) {
  const service = serviceHintFromUrl(url, opts.niche) || "Fiverr service";
  const serviceTitle = titleCase(service);
  const title = compactTitle(`I will create ${service} that helps buyers get results fast`);
  const tags = Array.from(new Set(service.toLowerCase().split(/\s+/).filter((w) => w.length > 2).slice(0, 4).concat("expert"))).slice(0, 5);
  const reason = opts.reason || "The live Fiverr page could not be fully verified before timeout, so this audit uses the URL/niche plus Fiverr ranking best practices.";

  return {
    overall_score: 38,
    verdict: `${target === "PROFILE" ? "Profile" : "Gig"} needs clearer positioning, stronger buyer trust, and SEO-focused edits to improve ranking and orders.`,
    top_issues_summary: [
      "Live page could not be fully verified, so confirm the gig/profile is public",
      "Title needs stronger buyer-intent keywords and a clearer result",
      "Description should sell the outcome, process, proof, and next step",
      "Requirements should collect buyer details before work starts",
      "Thumbnail should be upgraded for higher click-through rate",
    ],
    strengths: [
      `The service direction appears focused on ${serviceTitle}.`,
      "The URL gives enough niche context to create a practical first rewrite.",
    ],
    critical_issues: [
      {
        area: "Live data access",
        severity: "high",
        problem: reason,
        why_it_hurts: "If buyers or scrapers cannot reliably read the page, Fiverr ranking signals and audit accuracy both suffer.",
        fix: "Open the profile/gig in a private browser window. If it is public, paste the exact current title, description, tags, packages, and profile bio into chat for a deeper line-by-line audit.",
      },
      {
        area: "Title",
        severity: "high",
        problem: "The gig title likely does not lead with the strongest buyer-search phrase and outcome.",
        why_it_hurts: "Weak titles reduce impressions, clicks, and relevance for Fiverr search.",
        fix: `Use this tighter title: ${title}`,
      },
      {
        area: "Gig Description",
        severity: "high",
        problem: "The description needs a clearer offer structure: result, deliverables, proof, process, and CTA.",
        why_it_hurts: "Buyers leave when they cannot quickly understand what they get and why they should trust you.",
        fix: "Replace the description with the copy-paste rewrite below and keep short readable sections.",
      },
      {
        area: "Buyer Requirements",
        severity: "medium",
        problem: "Missing or weak requirements cause delays, revisions, and unclear expectations.",
        why_it_hurts: "Late clarification hurts delivery speed, reviews, and repeat orders.",
        fix: "Add the buyer questions below in Gig → Requirements before accepting work.",
      },
      {
        area: "Images",
        severity: "medium",
        problem: "The thumbnail needs a premium, benefit-led design that stands out in Fiverr search.",
        why_it_hurts: "Low click-through rate tells Fiverr buyers are not choosing the gig, which can reduce ranking momentum.",
        fix: "Use one of the premium thumbnail prompts below to create a clean high-contrast 1280×769 gig image.",
      },
    ],
    rewrites: {
      gig_title: {
        current: "Could not verify live current title",
        improved: title,
        reason: "It puts the service keyword and buyer result into one clear promise while staying within Fiverr title limits.",
      },
      tags: { current: [], improved: tags, reason: "Use focused lowercase tags that match likely buyer searches." },
      search_tags: { improved: tags, reason: "Keep tags tightly matched to the main service instead of broad unrelated keywords." },
      gig_description: {
        current_snippet: "Could not verify live current description",
        improved: `ABOUT THIS GIG\nI will help you with professional ${service} that is clear, polished, and built around your buyer goal. My focus is to deliver work that looks trustworthy, communicates fast, and helps you move from idea to finished result without confusion.\n\nWHAT YOU GET\n✅ A clean, ready-to-use ${service} deliverable\n✅ Strong attention to detail and buyer instructions\n✅ Clear communication before and during the order\n✅ Files/output prepared according to your package\n\nWHY CHOOSE ME\nI focus on quality, fast understanding, and practical results. I do not only complete the task — I make sure the final work fits your purpose, audience, and style.\n\nMY PROCESS\n1. I review your requirements\n2. I confirm the direction\n3. I create the work carefully\n4. I deliver and support revisions based on the package\n\nREADY TO ORDER?\nSend your details now and I will help you get a clean, professional result for your project.`,
        reason: "This separates the offer into buyer-friendly sections, adds trust, explains the process, and ends with a clear CTA.",
      },
      profile_description: {
        current_snippet: "Could not verify live current profile bio",
        improved: `Hi, I’m a dedicated freelancer focused on helping buyers get professional ${service} results with clear communication and reliable delivery. I care about understanding your goal first, then creating work that is clean, useful, and ready for your project.\n\nI can help with planning, creating, improving, and polishing the work so it matches your brand, audience, and expectations. My priority is simple: make the process easy for you and deliver quality that can earn trust.\n\nMessage me before ordering if you want help choosing the right package or explaining your project details.`,
        reason: "The profile bio sells the seller and trust, while the gig description sells the specific service deliverable.",
      },
      buyer_requirements: {
        improved: [
          `What exact ${service} result do you want me to create?`,
          "Who is the target audience or end user?",
          "Do you have brand colors, examples, references, or style preferences?",
          "What files, text, links, images, or access do you want me to use?",
          "What deadline and final format do you need?",
        ],
        reason: "These questions reduce confusion, prevent revisions, and help delivery start faster.",
      },
      packages: {
        improved: [
          { name: "Basic", price: 10, delivery_days: 3, revisions: 1, includes: ["Simple version", "Clear delivery", "Basic support"] },
          { name: "Standard", price: 25, delivery_days: 4, revisions: 2, includes: ["More complete version", "Better detail", "Priority communication"] },
          { name: "Premium", price: 50, delivery_days: 5, revisions: 3, includes: ["Best quality version", "Full polish", "Commercial-ready delivery"] },
        ],
        reason: "Three clear packages help buyers choose quickly and raise average order value.",
      },
    },
    ranking_tips: [
      "Put the main buyer keyword at the front of the title and repeat it naturally in the first paragraph.",
      "Use all 5 search tags, but keep them narrow and directly related to the service.",
      "Improve thumbnail CTR with 2–4 words of benefit text and one clear visual outcome.",
      "Reply fast to every message because response time affects buyer trust and conversion.",
      "Start with a focused niche before expanding to broader keywords.",
      "Add portfolio examples or delivery samples so buyers can trust the quality before ordering.",
    ],
    account_edits: [
      { where_to_edit: "Gig → Overview → Title", what_to_change: `Replace the title with: ${title}`, priority: "high" },
      { where_to_edit: "Gig → Description", what_to_change: "Paste the new gig-specific description and format it with short sections.", priority: "high" },
      { where_to_edit: "Gig → Requirements", what_to_change: "Add the buyer questions so every order starts with complete details.", priority: "high" },
      { where_to_edit: "Gig → Gallery", what_to_change: "Replace weak thumbnails with a premium 1280×769 image using one prompt below.", priority: "medium" },
      { where_to_edit: "Profile → Description", what_to_change: "Use the seller-focused profile bio, not the same text as the gig description.", priority: "medium" },
    ],
    action_plan: [
      { step: 1, action: "Confirm the Fiverr link opens publicly in a private browser window.", expected_impact: "Removes hidden/private URL issues before editing.", time_to_apply: "2 min" },
      { step: 2, action: "Update the gig title, tags, and first paragraph with the main keyword.", expected_impact: "Improves Fiverr search relevance and click clarity.", time_to_apply: "10 min" },
      { step: 3, action: "Replace the gig description with the structured rewrite.", expected_impact: "Improves buyer trust and conversion.", time_to_apply: "15 min" },
      { step: 4, action: "Add buyer requirements and adjust packages.", expected_impact: "Reduces revisions and increases order value.", time_to_apply: "15 min" },
      { step: 5, action: "Create a stronger thumbnail and upload it to the gig gallery.", expected_impact: "Improves click-through rate from search results.", time_to_apply: "30 min" },
    ],
    image_prompts: [
      { slot: "Thumbnail 1", prompt: `Premium 1280x769 Fiverr thumbnail for ${service}, bold centered subject, high contrast clean background, overlay text "PRO RESULTS", brand color accent, professional lighting, mock UI/product visible, sharp bold sans-serif typography, no watermark, top-1% CTR style` },
      { slot: "Thumbnail 2", prompt: `Premium 1280x769 service thumbnail for ${service}, left-side expert workspace visual, right-side 3-word hook "FAST QUALITY WORK", bright accent color, clean modern layout, realistic deliverable preview, crisp typography, no watermark` },
      { slot: "Thumbnail 3", prompt: `Premium 1280x769 Fiverr gig image for ${service}, before-and-after result composition, strong focal point, benefit text "READY TO USE", polished professional lighting, high trust design, bold sans-serif text, no watermark` },
    ],
    _scraped: false,
    _source: "built-in-fallback",
    _url: url,
  };
}

async function fallbackAudit(target: "PROFILE" | "GIG", url: string, opts: { niche?: string; issue?: string; geminiKey: string; timeoutMs?: number }) {
  const serviceHint = serviceHintFromUrl(url, opts.niche);
  const system = `You are a Fiverr ranking expert. Output ONLY valid JSON, no markdown fences, no commentary.`;
  const prompt = `Fiverr live scraping did not return enough readable content for this ${target}, but the user still needs an actionable audit to edit the account and win orders.

Return STRICT JSON ONLY in this EXACT shape:
${AUDIT_SHAPE}

Target: ${target}
URL: ${url}
Likely service/niche from URL or user input: ${serviceHint}
User-reported problem: ${opts.issue || "low impressions, low clicks, no orders"}

Rules:
- Be honest: include one high-priority issue that says the live Fiverr page could not be fully verified, so the user must confirm public visibility and paste exact text for a deeper line-by-line review.
- Still provide a strong NEW gig title, gig description, profile description, buyer requirements, search tags, packages, account edits, ranking tips, action plan, and 3 premium 1280x769 thumbnail prompts.
- Do NOT leave rewrites empty. Make them specific to the likely service/niche.
- rewrites.gig_title must be <= 80 chars and must not copy the raw URL slug word-for-word.
- rewrites.gig_description must be about the gig service. rewrites.profile_description must be about the seller bio. Keep them different.
- account_edits must tell exactly where to edit inside Fiverr.
- overall_score should reflect risk from missing live verification, usually 20-45 unless the URL/niche gives strong clarity.`;
  try {
    const raw = await callAI(prompt, system, opts.geminiKey, opts.timeoutMs || 28_000);
    const parsed = safeParseJSON(raw);
    if (parsed) {
      parsed._scraped = false;
      parsed._source = "fallback";
      parsed._url = url;
      return parsed;
    }
  } catch (e) {
    console.error("fallback audit error", url, (e as Error).message);
  }
  return heuristicAudit(target, url, {
    niche: opts.niche,
    issue: opts.issue,
    reason: "Fiverr blocked automated reading or the AI provider could not generate right now, so built-in Fiverr best-practice recommendations were used.",
  });
}

function extractGigUrlsFromScrape(scrape: ScrapeResult | null | undefined, username?: string | null): string[] {
  if (!scrape) return [];
  const links = Array.isArray(scrape.metadata?.links) ? scrape.metadata.links : [];
  const fromMarkdown = extractFiverrLinks(scrape.markdown || "", scrape.url);
  return Array.from(new Set([...links, ...fromMarkdown].map((u: string) => canonicalUrl(u)).filter((u: string) => isLikelyGigUrl(u, username))));
}

function unavailableAudit(target: "PROFILE" | "GIG", url: string, reason: string) {
  return {
    overall_score: 0,
    verdict: `${target === "PROFILE" ? "Profile" : "Gig"} could not be read from Fiverr, so no real setup audit was generated for this link.`,
    strengths: [],
    critical_issues: [{
      area: "Live data access",
      severity: "high",
      problem: reason,
      why_it_hurts: "Without the live Fiverr title, description, tags, packages, reviews, and profile text, the audit would be guessing instead of showing what to edit.",
      fix: "Check that the URL is public and spelled correctly. If the page opens in your browser but still fails here, Fiverr is blocking automated access for that page; paste the gig/profile text into AI Chat for a manual audit.",
    }],
    rewrites: {},
    action_plan: [{
      step: 1,
      action: "Open the Fiverr link in a private browser window to confirm buyers can see it publicly.",
      expected_impact: "Confirms whether the account or gig is hidden, paused, removed, or blocked from public view.",
      time_to_apply: "2 min",
    }],
    image_prompts: [],
    _scraped: false,
    _source: null,
    _url: url,
  };
}

async function callAI(prompt: string, system: string, geminiKey: string, timeoutMs = 45_000): Promise<string> {
  if (!geminiKey) {
    throw new Error("No Gemini API key configured. Open Settings → AI Generation and paste your Google Gemini API key.");
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 8192 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (resp.status === 429) {
    const txt = await resp.text();
    const isNoQuota = /limit:\s*0|quota exceeded|free_tier_requests/i.test(txt);
    throw new Error(isNoQuota
      ? "Gemini key is recognized, but its Google project has no Gemini generation quota. Use a key from a Google AI Studio project with Gemini API quota/billing."
      : "Gemini quota/rate limit hit for this key. Wait a moment or switch to another Google project key.");
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new Error("Gemini API key invalid or unauthorized. Update it in Settings → AI Generation.");
  }
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("\n") || "";
}

function safeParseJSON(raw: string): any {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}

const AUDIT_SHAPE = `{
  "overall_score": <0-100>,
  "verdict": "<one-sentence diagnosis>",
  "top_issues_summary": ["short bullet naming each critical issue affecting this account/gig"],
  "strengths": ["..."],
  "critical_issues": [
    { "area": "Title|Tags|Gig Description|Profile Bio|Buyer Requirements|Pricing|Images|Packages|SEO|Ranking|Trust", "severity": "high|medium|low", "problem": "...", "why_it_hurts": "...", "fix": "..." }
  ],
  "rewrites": {
    "gig_title": { "current": "...", "improved": "<NEW perfect Fiverr gig title, <= 80 chars, keyword-front-loaded, buyer-intent, high-CTR>", "reason": "..." },
    "tags": { "current": ["..."], "improved": ["..."], "reason": "..." },
    "search_tags": { "improved": ["..."], "reason": "..." },
    "gig_description": { "current_snippet": "...", "improved": "<NEW gig-specific description, 1000-1200 chars, 5 sections: ABOUT THIS GIG / WHAT YOU GET / WHY CHOOSE ME / MY PROCESS / READY TO ORDER (CTA). Use line breaks and ✅ sparingly. Must be about the GIG offering, NOT the seller bio.>", "reason": "..." },
    "profile_description": { "current_snippet": "...", "improved": "<NEW profile bio, 600-900 chars, first-person, hooks in first line, positions the SELLER (skills, experience, results), ends with CTA to order. Different from the gig description.>", "reason": "..." },
    "buyer_requirements": { "improved": ["<clear question 1 to ask the buyer before starting>", "<question 2>", "<question 3>", "<question 4>", "<question 5>"], "reason": "why these requirements reduce revisions and speed delivery" },
    "packages": { "improved": [{ "name": "Basic|Standard|Premium", "price": 0, "delivery_days": 0, "revisions": 0, "includes": ["..."] }], "reason": "..." }
  },
  "ranking_tips": ["specific Fiverr ranking action (SEO tags, first 24h impressions, response rate, delivery time, buyer requests, promoted gigs, video, portfolio, niche-down) — 5 to 8 tips"],
  "account_edits": [
    { "where_to_edit": "Profile → Description | Gig → Overview → Title | Gig → Description | Gig → Gallery | Gig → Requirements | Gig → Pricing | Profile → Skills | Profile → Languages", "what_to_change": "...", "priority": "high|medium|low" }
  ],
  "action_plan": [{ "step": 1, "action": "...", "expected_impact": "...", "time_to_apply": "5 min" }],
  "image_prompts": [{ "slot": "Thumbnail 1|2|3", "prompt": "<PREMIUM 1280x769 Fiverr gig thumbnail prompt. Must include: bold subject centered/left, high contrast background, 2-4 word overlay hook, brand color accent, professional lighting, mock UI or product visible, buyer-benefit-driven text, no watermark, sharp typography (bold sans-serif). Optimized for top-1% CTR>" }]
}`;

async function auditOne(opts: {
  niche?: string; issue?: string;
  profile?: ScrapeResult | null;
  gig?: ScrapeResult | null;
  geminiKey: string;
  timeoutMs?: number;
}) {
  const target = opts.gig ? "GIG" : "PROFILE";
  const item = opts.gig || opts.profile;
  const url = item?.url || "";
  const markdown = item?.markdown;
  const scraped = !!markdown;

  const system = `You are a Fiverr ranking expert who has reverse-engineered what makes top-1% sellers convert. Output ONLY valid JSON, no markdown fences, no commentary.`;

  const scrapedBlock = `=== LIVE SCRAPED FIVERR CONTENT VIA ${item?.source?.toUpperCase() || "SCRAPER"} (${url}) ===\n${markdown}\n`;

  const prompt = `Audit this Fiverr ${target}. Return STRICT JSON ONLY (no fences) in this EXACT shape:
${AUDIT_SHAPE}

Niche: ${opts.niche || "infer from URL slug"}
User-reported problem: ${opts.issue || "low impressions, low clicks, no orders"}

${scrapedBlock}

Rules:
- Be brutally honest, specific, and actionable. No fluff.
- Use the ACTUAL scraped Fiverr setup. Quote the exact existing weak title / bio / description / package / image / trust signal you see, THEN rewrite it.
- rewrites.gig_title MUST be a NEW perfect gig title (never repeat the current one).
- rewrites.gig_description is about the GIG service (what buyer gets). rewrites.profile_description is about the SELLER (bio). They must be clearly different.
- rewrites.buyer_requirements = the questions to ask buyer at order start, tailored to this niche.
- top_issues_summary = 3-6 short bullets naming the biggest issues affecting this account (used as visible warning chips).
- account_edits = concrete list of "go here → change this" edits inside Fiverr, ordered by priority.
- ranking_tips = Fiverr-specific SEO/ranking moves (impressions, CTR, response rate, delivery, buyer requests, promoted gigs, video, niche-down).
- 3 image_prompts, each PREMIUM 1280x769, high-CTR, buyer-magnet quality — assume the current thumbnail is weak unless clearly stated otherwise.
- 5 search tags max, each <20 chars, lowercase.
- 5–8 critical_issues, mix of severities, each with concrete fix.
- 3–6 action_plan steps, ordered by impact, with realistic time estimates.`;

  const raw = await callAI(prompt, system, opts.geminiKey, opts.timeoutMs || 45_000);
  const parsed = safeParseJSON(raw);
  if (!parsed) {
    return {
      overall_score: 0,
      verdict: "AI did not return valid JSON. Re-run the audit.",
      strengths: [],
      critical_issues: [],
      rewrites: {},
      action_plan: [],
      image_prompts: [],
      _scraped: scraped,
    };
  }
  parsed._scraped = scraped;
  parsed._source = item?.source || null;
  return parsed;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const requestStart = startedAt();
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Load the signed-in user's Gemini key — required for any AI generation.
    const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: settings } = await admin
      .from("user_ai_settings")
      .select("gemini_api_key")
      .eq("user_id", user.id)
      .maybeSingle();
    const geminiKey = (settings?.gemini_api_key || "").trim();
    if (!geminiKey) {
      return new Response(JSON.stringify({
        error: "No Gemini API key configured. Open Settings → AI Generation and paste your Google Gemini API key (free at https://aistudio.google.com/apikey).",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const profileUrl: string | undefined = normalizeProfileInput(body.profileUrl);
    const username = getFiverrUsername(profileUrl);
    const niche: string | undefined = body.niche?.trim();
    const issue: string | undefined = body.issue?.trim();
    const gigUrls: string[] = Array.isArray(body.gigUrls)
      ? body.gigUrls.map((u: string) => canonicalUrl(u)).filter(Boolean)
      : (body.gigUrl?.trim() ? [canonicalUrl(body.gigUrl.trim())] : []);

    if (!profileUrl && gigUrls.length === 0) {
      return new Response(JSON.stringify({ error: "Provide a profile URL and/or one or more gig URLs." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Use the fastest path first. Direct HTML often exposes the profile meta and gig links;
    // Apify/Firecrawl are fallbacks, not blockers for the whole audit.
    const directProfileScrape = profileUrl && hasTimeFor(requestStart, 10_000)
      ? await directFiverrScrape(profileUrl, Math.min(7_000, msLeft(requestStart, 70_000)))
      : null;

    const profileCrawl = profileUrl && !directProfileScrape && hasTimeFor(requestStart, 14_000)
      ? await apifyCrawl([profileUrl], { maxCrawlDepth: 1, maxPages: 4, timeoutMs: Math.min(10_000, msLeft(requestStart, 72_000)) }).catch((e) => {
        console.error("apify profile crawl error", (e as Error).message);
        return [] as ScrapeResult[];
      })
      : [];

    const profileScrape = profileUrl
      ? (directProfileScrape
        || profileCrawl.find((item) => !isLikelyGigUrl(item.url, username) && getFiverrUsername(item.url)?.toLowerCase() === username?.toLowerCase())
        || (hasTimeFor(requestStart, 16_000) ? await scrapeSingle(profileUrl, Math.min(12_000, msLeft(requestStart, 62_000))) : null))
      : null;

    const discoveredGigUrls = Array.from(new Set([
      ...extractGigUrlsFromScrape(directProfileScrape, username),
      ...extractGigUrlsFromScrape(profileScrape, username),
      ...profileCrawl.filter((item) => isLikelyGigUrl(item.url, username)).map((item) => canonicalUrl(item.url)),
    ]));

    const allRequestedGigUrls = Array.from(new Set([...gigUrls, ...discoveredGigUrls]));
    const allGigUrls = allRequestedGigUrls.slice(0, 3);
    const skippedGigs = allRequestedGigUrls.slice(3);

    const gigScrapes = await Promise.all(allGigUrls.map(async (url) => {
      const fromProfileCrawl = profileCrawl.find((item) => canonicalUrl(item.url) === canonicalUrl(url));
      const r = fromProfileCrawl || (hasTimeFor(requestStart, 12_000) ? await scrapeSingle(url, Math.min(10_000, msLeft(requestStart, 52_000))) : null);
      return { url, r };
    }));

    const failedGigs = gigScrapes.filter((g) => !g.r).map((g) => g.url);

    const profileAuditPromise = profileUrl
      ? (profileScrape
        ? (hasTimeFor(requestStart, 22_000)
          ? auditOne({ niche, issue, profile: profileScrape, geminiKey, timeoutMs: Math.min(28_000, msLeft(requestStart, 20_000)) }).catch((e: any) =>
            fallbackAudit("PROFILE", profileUrl, { niche, issue: `Audit generation failed after scrape: ${e.message}. ${issue || ""}`, geminiKey, timeoutMs: Math.min(24_000, msLeft(requestStart, 12_000)) })
          )
          : fallbackAudit("PROFILE", profileUrl, { niche, issue: `The live scrape used too much time. ${issue || ""}`, geminiKey, timeoutMs: Math.min(22_000, msLeft(requestStart, 12_000)) }))
        : fallbackAudit("PROFILE", profileUrl, { niche, issue: `Fiverr profile could not be fully read by the scraper. ${issue || ""}`, geminiKey, timeoutMs: Math.min(24_000, msLeft(requestStart, 12_000)) }))
      : Promise.resolve(null);

    const gigAuditPromises = gigScrapes.map(async (g) => {
      try {
        const audit = g.r
          ? (hasTimeFor(requestStart, 20_000)
            ? await auditOne({ niche, issue, gig: g.r, geminiKey, timeoutMs: Math.min(26_000, msLeft(requestStart, 12_000)) }).catch((e: any) =>
              fallbackAudit("GIG", g.url, { niche, issue: `Live content was found but audit generation failed: ${e.message}. ${issue || ""}`, geminiKey, timeoutMs: Math.min(22_000, msLeft(requestStart, 8_000)) })
            )
            : await fallbackAudit("GIG", g.url, { niche, issue: `The scrape used too much time, so generate best-practice edits from the URL/niche. ${issue || ""}`, geminiKey, timeoutMs: Math.min(22_000, msLeft(requestStart, 8_000)) }))
          : await fallbackAudit("GIG", g.url, { niche, issue: `Fiverr blocked or returned an empty gig page before Apify/Firecrawl could read its setup. ${issue || ""}`, geminiKey, timeoutMs: Math.min(22_000, msLeft(requestStart, 8_000)) });
        const title = g.r?.metadata?.title || g.url.split("/").pop() || g.url;
        return { url: g.url, title, audit };
      } catch (e: any) {
        return {
          url: g.url,
          title: g.url.split("/").pop() || g.url,
          audit: {
            overall_score: 0,
            verdict: `Audit error: ${e.message}`,
            strengths: [], critical_issues: [], rewrites: {}, action_plan: [], image_prompts: [],
            _scraped: false,
          },
        };
      }
    });

    const [profileAudit, gigAudits] = await Promise.all([profileAuditPromise, Promise.all(gigAuditPromises)]);

    const ranked = gigAudits
      .map((g) => {
        const issues = g.audit?.critical_issues || [];
        const high = issues.filter((i: any) => i.severity === "high").length;
        const med = issues.filter((i: any) => i.severity === "medium").length;
        const low = issues.filter((i: any) => i.severity === "low").length;
        const score = g.audit?.overall_score ?? 50;
        const priority = (100 - score) + high * 15 + med * 6 + low * 2;
        return { ...g, priority, high, med, low, score };
      })
      .sort((a, b) => b.priority - a.priority)
      .map((g, i) => ({ ...g, rank: i + 1 }));

    const responsePayload = {
      success: true,
      profileAudit,
      gigAudits: ranked,
      failedGigs,
      skippedGigs,
      blockedNote: failedGigs.length > 0 || (profileUrl && !profileScrape) || (profileUrl && allGigUrls.length === 0)
        ? "The backend tried direct Fiverr reading first, then Apify and Firecrawl. Some live pages could not be fully verified, so the audit includes best-practice rewrites plus a warning to confirm public visibility."
        : null,
      audit: profileAudit || ranked[0]?.audit || null,
    };

    // Persist so the user can re-open the audit later from the saved list.
    try {
      const label = username
        ? `@${username}`
        : (ranked[0]?.title || gigUrls[0] || profileUrl || "Fiverr audit").toString().slice(0, 80);
      const { data: saved } = await admin.from("saved_audits").insert({
        user_id: user.id,
        label,
        profile_url: profileUrl || null,
        gig_urls: allRequestedGigUrls,
        niche: niche || null,
        issue: issue || null,
        profile_audit: profileAudit,
        gig_audits: ranked,
        failed_gigs: failedGigs,
        blocked_note: responsePayload.blockedNote,
      }).select("id").maybeSingle();
      (responsePayload as any).savedId = saved?.id || null;
    } catch (e) {
      console.error("save audit error", (e as Error).message);
    }

    return new Response(JSON.stringify(responsePayload), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("audit error", e);
    return new Response(JSON.stringify({ error: e.message || "Audit failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
