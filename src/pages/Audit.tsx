import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  Stethoscope, Loader2, AlertTriangle, CheckCircle2, Wrench, Copy, Sparkles,
  Flame, TrendingUp, ExternalLink, Trophy, History, Trash2, RefreshCw, Target, Pencil,
  Image as ImageIcon, ChevronDown, Link2, User, ClipboardList,
} from "lucide-react";
import { SourceEvidencePanel, type EvidenceItem } from "@/components/SourceEvidencePanel";
import { askNotificationPermission, notifyJobDone } from "@/lib/notify";


type Issue = { area: string; severity: string; problem: string; why_it_hurts: string; fix: string };
type AccountEdit = { where_to_edit: string; what_to_change: string; priority: string };
type Audit = {
  overall_score: number;
  verdict: string;
  top_issues_summary?: string[];
  strengths: string[];
  critical_issues: Issue[];
  rewrites: any;
  ranking_tips?: string[];
  account_edits?: AccountEdit[];
  action_plan: { step: number; action: string; expected_impact: string; time_to_apply: string }[];
  image_prompts: { slot: string; prompt: string }[];
  source_evidence?: EvidenceItem[];
};
type RankedGig = { url: string; title: string; audit: Audit; priority: number; high: number; med: number; low: number; score: number; rank: number };
type SavedAudit = {
  id: string;
  label: string;
  profile_url: string | null;
  gig_urls: string[];
  niche: string | null;
  issue: string | null;
  profile_audit: Audit | null;
  gig_audits: RankedGig[];
  failed_gigs: string[];
  blocked_note: string | null;
  status: string | null;
  error_message?: string | null;
  created_at: string;
};

const sevRank = (s: string) => (s === "high" ? 0 : s === "medium" ? 1 : 2);

const sevColor = (s: string) =>
  s === "high" ? "bg-destructive/15 text-destructive border-destructive/30"
  : s === "medium" ? "bg-warning/15 text-warning border-warning/30"
  : "bg-muted text-muted-foreground border-border";

const scoreColor = (n: number) =>
  n >= 70 ? "text-success" : n >= 40 ? "text-warning" : "text-destructive";

const isStaleAudit = (audit: SavedAudit) =>
  audit.status === "processing" && Date.now() - new Date(audit.created_at).getTime() > 4 * 60 * 1000;

const copy = (v: any) => {
  navigator.clipboard.writeText(typeof v === "string" ? v : JSON.stringify(v, null, 2));
  toast({ title: "Copied" });
};

/** Pull profile + gig links out of one free-text box. */
const parseLinks = (raw: string) => {
  const tokens = raw.split(/[\s,\n]+/).map((t) => t.trim()).filter(Boolean);
  let profileUrl = "";
  const gigUrls: string[] = [];
  for (const t of tokens) {
    const clean = t.replace(/[)\]]+$/, "");
    if (/fiverr\.com/i.test(clean)) {
      const path = clean.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/^fiverr\.com\/?/i, "");
      const segments = path.split("?")[0].split("/").filter(Boolean);
      const isGig = segments.length >= 2 || /\/gigs?\//i.test(clean);
      const url = clean.startsWith("http") ? clean : `https://${clean}`;
      if (isGig) gigUrls.push(url);
      else if (!profileUrl) profileUrl = url;
    } else if (/^[a-z0-9_.-]{3,40}$/i.test(clean) && !profileUrl) {
      profileUrl = clean;
    }
  }
  return { profileUrl, gigUrls: Array.from(new Set(gigUrls)) };
};

const toneClass: Record<string, string> = {
  primary: "text-primary",
  destructive: "text-destructive",
  warning: "text-warning",
  success: "text-success",
  secondary: "text-secondary",
};

const Section = ({ title, icon: Icon, tone = "primary", children }: { title: string; icon: any; tone?: string; children: React.ReactNode }) => (
  <div>
    <div className={`font-mono text-xs uppercase mb-2 flex items-center gap-2 ${toneClass[tone] ?? toneClass.primary}`}>
      <Icon className="w-4 h-4" /> {title}
    </div>
    {children}
  </div>
);

const RewriteBlock = ({ label, current, improved, reason }: { label: string; current?: string; improved: string; reason?: string }) => (
  <div className="border border-border rounded-lg p-3 bg-card/40">
    <div className="flex items-center justify-between mb-1.5">
      <div className="font-semibold text-sm flex items-center gap-2"><Pencil className="w-3.5 h-3.5 text-primary" />{label}</div>
      <Button variant="ghost" size="sm" onClick={() => copy(improved)}><Copy className="w-3.5 h-3.5 mr-1" />Copy</Button>
    </div>
    {current && <div className="text-xs text-muted-foreground mb-1.5"><span className="font-mono">CURRENT:</span> {current}</div>}
    <pre className="text-sm whitespace-pre-wrap bg-muted/30 p-2.5 rounded font-sans leading-relaxed">{improved}</pre>
    {reason && <div className="text-xs text-muted-foreground mt-2">💡 {reason}</div>}
  </div>
);

/** Step 1 of the report: the only thing the user must read. */
const TopFixes = ({ audit }: { audit: Audit }) => {
  const fixes = [...(audit.critical_issues || [])].sort((a, b) => sevRank(a.severity) - sevRank(b.severity)).slice(0, 5);
  if (fixes.length === 0) return null;
  return (
    <Section title="Do these 5 things first" icon={Flame} tone="destructive">
      <Accordion type="single" collapsible className="space-y-2">
        {fixes.map((it, i) => (
          <AccordionItem key={i} value={`fix-${i}`} className="border border-border rounded-lg bg-card/40 px-3">
            <AccordionTrigger className="hover:no-underline py-3 text-left">
              <div className="flex items-center gap-3 flex-1">
                <div className="w-7 h-7 rounded-full bg-primary/10 text-primary font-mono font-bold text-sm flex items-center justify-center shrink-0">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{it.area}</div>
                  <div className="text-xs text-muted-foreground line-clamp-1">{it.problem}</div>
                </div>
                <Badge variant="outline" className={`${sevColor(it.severity)} shrink-0 hidden sm:inline-flex`}>{it.severity}</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-3 space-y-2">
              <div className="text-sm"><span className="text-muted-foreground">Problem:</span> {it.problem}</div>
              <div className="text-xs text-muted-foreground">Why it hurts: {it.why_it_hurts}</div>
              <div className="text-sm flex items-start gap-2 p-2.5 rounded bg-primary/5 border border-primary/20">
                <Wrench className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                <span><span className="font-medium">Fix:</span> {it.fix}</span>
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </Section>
  );
};

const Rewrites = ({ audit }: { audit: Audit }) => {
  const r = audit.rewrites;
  if (!r) return null;
  return (
    <Section title="Ready-to-paste rewrites" icon={Pencil}>
      <div className="space-y-2">
        {r.gig_title?.improved && <RewriteBlock label="Gig title (new)" current={r.gig_title.current} improved={r.gig_title.improved} reason={r.gig_title.reason} />}
        {r.gig_description?.improved && <RewriteBlock label="Gig description" current={r.gig_description.current_snippet} improved={r.gig_description.improved} reason={r.gig_description.reason} />}
        {r.profile_description?.improved && <RewriteBlock label="Profile description" current={r.profile_description.current_snippet} improved={r.profile_description.improved} reason={r.profile_description.reason} />}
        {r.search_tags?.improved && (
          <div className="border border-border rounded-lg p-3 bg-card/40">
            <div className="flex items-center justify-between mb-1.5">
              <div className="font-semibold text-sm">Search tags</div>
              <Button variant="ghost" size="sm" onClick={() => copy((r.search_tags.improved || []).join(", "))}><Copy className="w-3.5 h-3.5 mr-1" />Copy</Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(r.search_tags.improved as string[]).map((t, i) => <Badge key={i} variant="outline" className="bg-primary/10 text-primary border-primary/30">{t}</Badge>)}
            </div>
            {r.search_tags.reason && <div className="text-xs text-muted-foreground mt-2">💡 {r.search_tags.reason}</div>}
          </div>
        )}
        {r.buyer_requirements?.improved && (
          <div className="border border-border rounded-lg p-3 bg-card/40">
            <div className="flex items-center justify-between mb-1.5">
              <div className="font-semibold text-sm">Buyer requirements</div>
              <Button variant="ghost" size="sm" onClick={() => copy((r.buyer_requirements.improved || []).map((q: string, i: number) => `${i + 1}. ${q}`).join("\n"))}><Copy className="w-3.5 h-3.5 mr-1" />Copy</Button>
            </div>
            <ol className="text-sm space-y-1 list-decimal pl-5">
              {(r.buyer_requirements.improved as string[]).map((q, i) => <li key={i}>{q}</li>)}
            </ol>
          </div>
        )}
        {r.packages?.improved && (
          <div className="border border-border rounded-lg p-3 bg-card/40">
            <div className="flex items-center justify-between mb-1.5">
              <div className="font-semibold text-sm">Packages</div>
              <Button variant="ghost" size="sm" onClick={() => copy(r.packages.improved)}><Copy className="w-3.5 h-3.5 mr-1" />Copy</Button>
            </div>
            <pre className="text-xs whitespace-pre-wrap bg-muted/30 p-2.5 rounded font-mono leading-relaxed">{JSON.stringify(r.packages.improved, null, 2)}</pre>
          </div>
        )}
      </div>
    </Section>
  );
};

const AuditReport = ({ audit, onImproveImage }: { audit: Audit; onImproveImage?: (prompt: string) => void }) => (
  <div className="space-y-5">
    <TopFixes audit={audit} />
    <Rewrites audit={audit} />

    <Accordion type="multiple" className="space-y-2">
      {audit.account_edits && audit.account_edits.length > 0 && (
        <AccordionItem value="edits" className="border border-border rounded-lg bg-card/30 px-3">
          <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">
            <span className="flex items-center gap-2"><Target className="w-4 h-4 text-primary" /> Where to edit inside Fiverr</span>
          </AccordionTrigger>
          <AccordionContent className="pb-3 space-y-2">
            {audit.account_edits.map((e, i) => (
              <div key={i} className="border border-border rounded-lg p-3 bg-card/40 flex gap-2 items-start">
                <Badge variant="outline" className={sevColor(e.priority)}>{e.priority}</Badge>
                <div className="flex-1">
                  <div className="font-mono text-xs text-primary">{e.where_to_edit}</div>
                  <div className="text-sm mt-0.5">{e.what_to_change}</div>
                </div>
              </div>
            ))}
          </AccordionContent>
        </AccordionItem>
      )}

      {audit.action_plan?.length > 0 && (
        <AccordionItem value="plan" className="border border-border rounded-lg bg-card/30 px-3">
          <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">
            <span className="flex items-center gap-2"><ClipboardList className="w-4 h-4 text-success" /> Full step-by-step plan</span>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <ol className="space-y-2">
              {audit.action_plan.map((s) => (
                <li key={s.step} className="flex gap-3 border border-border rounded-lg p-3 bg-card/40">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary font-mono font-bold flex items-center justify-center shrink-0 text-sm">{s.step}</div>
                  <div>
                    <div className="font-medium text-sm">{s.action}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Impact: {s.expected_impact} · Time: {s.time_to_apply}</div>
                  </div>
                </li>
              ))}
            </ol>
          </AccordionContent>
        </AccordionItem>
      )}

      {audit.image_prompts?.length > 0 && (
        <AccordionItem value="images" className="border border-border rounded-lg bg-card/30 px-3">
          <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">
            <span className="flex items-center gap-2"><ImageIcon className="w-4 h-4 text-secondary" /> Thumbnail prompts (1280×769)</span>
          </AccordionTrigger>
          <AccordionContent className="pb-3 space-y-2">
            {audit.image_prompts.map((ip, i) => (
              <div key={i} className="border border-border rounded-lg p-3 bg-card/40">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-semibold text-sm">{ip.slot}</div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => copy(ip.prompt)}><Copy className="w-3.5 h-3.5 mr-1" />Copy</Button>
                    {onImproveImage && <Button variant="outline" size="sm" onClick={() => onImproveImage(ip.prompt)}><Sparkles className="w-3.5 h-3.5 mr-1" />Improve image</Button>}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{ip.prompt}</p>
              </div>
            ))}
          </AccordionContent>
        </AccordionItem>
      )}

      {(audit.ranking_tips?.length || audit.strengths?.length) ? (
        <AccordionItem value="extra" className="border border-border rounded-lg bg-card/30 px-3">
          <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">
            <span className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-secondary" /> Ranking tips & strengths</span>
          </AccordionTrigger>
          <AccordionContent className="pb-3 space-y-3">
            {audit.ranking_tips?.length ? (
              <ul className="space-y-1 text-sm">
                {audit.ranking_tips.map((t, i) => <li key={i} className="flex gap-2"><TrendingUp className="w-3.5 h-3.5 text-secondary mt-0.5 shrink-0" />{t}</li>)}
              </ul>
            ) : null}
            {audit.strengths?.length ? (
              <ul className="space-y-1 text-sm">
                {audit.strengths.map((s, i) => <li key={i} className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />{s}</li>)}
              </ul>
            ) : null}
          </AccordionContent>
        </AccordionItem>
      ) : null}

      {audit.source_evidence?.length ? (
        <AccordionItem value="evidence" className="border border-border rounded-lg bg-card/30 px-3">
          <AccordionTrigger className="text-sm font-semibold hover:no-underline py-3">
            <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-success" /> Proof: what was actually read from your page</span>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <SourceEvidencePanel evidence={audit.source_evidence} />
          </AccordionContent>
        </AccordionItem>
      ) : null}
    </Accordion>
  </div>
);

const Audit = () => {
  const [linkInput, setLinkInput] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [niche, setNiche] = useState("");
  const [issue, setIssue] = useState("");
  const [impressions, setImpressions] = useState("");
  const [clicks, setClicks] = useState("");
  const [orders, setOrders] = useState("");
  const [performancePeriod, setPerformancePeriod] = useState("30 days");
  const [pastedGig, setPastedGig] = useState("");
  const [pastedProfile, setPastedProfile] = useState("");
  const [loading, setLoading] = useState(false);
  const [profileAudit, setProfileAudit] = useState<Audit | null>(null);
  const [ranked, setRanked] = useState<RankedGig[]>([]);
  const [failedGigs, setFailedGigs] = useState<string[]>([]);
  const [blockedNote, setBlockedNote] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedAudit[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loadingSeconds, setLoadingSeconds] = useState(0);

  const toFiverrImage = (dataUrl: string) => new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 769;
      const context = canvas.getContext("2d");
      if (!context) { reject(new Error("Image conversion is not available")); return; }
      const targetRatio = 1280 / 769;
      const sourceRatio = image.width / image.height;
      let sx = 0;
      let sy = 0;
      let sw = image.width;
      let sh = image.height;
      if (sourceRatio > targetRatio) {
        sw = image.height * targetRatio;
        sx = (image.width - sw) / 2;
      } else {
        sh = image.width / targetRatio;
        sy = (image.height - sh) / 2;
      }
      context.drawImage(image, sx, sy, sw, sh, 0, 0, 1280, 769);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("The generated image could not be read"));
    image.src = dataUrl;
  });

  const generateImprovedImage = async (prompt: string, gigTitle: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("generate-thumbnail", { body: { prompt } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const link = document.createElement("a");
      link.href = await toFiverrImage(data.image);
      link.download = `fiverr-audit-${gigTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48)}-1280x769.png`;
      link.click();
      toast({ title: "Improved gig image ready", description: "The image is formatted for Fiverr at 1280×769." });
    } catch (error: any) {
      toast({ title: "Image improvement failed", description: error?.message || "Please try again.", variant: "destructive" });
    }
  };

  const parsed = useMemo(() => parseLinks(linkInput), [linkInput]);
  const hasTarget = Boolean(parsed.profileUrl || parsed.gigUrls.length || pastedGig.trim() || pastedProfile.trim());

  const performanceSummary = useMemo(() => {
    const parts = [
      impressions && `${impressions} impressions`,
      clicks && `${clicks} clicks`,
      orders && `${orders} orders`,
    ].filter(Boolean);
    return parts.length ? `Reported performance (${performancePeriod}): ${parts.join(", ")}.` : "";
  }, [clicks, impressions, orders, performancePeriod]);

  useEffect(() => {
    if (!loading) { setLoadingSeconds(0); return; }
    const timer = window.setInterval(() => setLoadingSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  const loadSaved = async () => {
    const { data, error } = await (supabase as any)
      .from("saved_audits")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) { console.error(error); return; }
    setSaved((data as SavedAudit[]) || []);
  };

  useEffect(() => { loadSaved(); }, []);

  const openSaved = (s: SavedAudit) => {
    setCurrentId(s.id);
    setLinkInput([s.profile_url || "", ...(s.gig_urls || [])].filter(Boolean).join("\n"));
    setNiche(s.niche || "");
    setIssue(s.issue || "");
    setProfileAudit(s.profile_audit || null);
    setRanked(s.gig_audits || []);
    setFailedGigs(s.failed_gigs || []);
    setBlockedNote(s.blocked_note || null);
    if (isStaleAudit(s)) {
      toast({ title: "Incomplete audit", description: "This audit was interrupted before results were saved. Run it again.", variant: "destructive" });
    } else if (s.status === "processing") {
      toast({ title: "Audit still running", description: "Results will appear here when the live check completes." });
    } else if (s.status === "error") {
      toast({ title: "Audit failed", description: s.error_message || "Please run this audit again.", variant: "destructive" });
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const waitForAudit = async (id: string) => {
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 2500));
      const { data, error } = await (supabase as any)
        .from("saved_audits")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw new Error(error.message);
      const audit = data as SavedAudit;
      if (audit.status === "error") {
        notifyJobDone("Audit failed ❌", audit.error_message || "The audit could not be completed.", `audit-${id}`);
        throw new Error(audit.error_message || "The audit could not be completed.");
      }
      if (audit.status === "complete") {
        notifyJobDone("Account audit ready ✅", `${audit.label || "Your Fiverr audit"} — open it to see the fix plan.`, `audit-${id}`);
        return audit;
      }

    }
    throw new Error("Still processing — open it from Saved audits in a moment to see the results.");
  };

  const deleteSaved = async (id: string) => {
    const { error } = await (supabase as any).from("saved_audits").delete().eq("id", id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    setSaved((arr) => arr.filter((s) => s.id !== id));
    if (currentId === id) {
      setCurrentId(null); setProfileAudit(null); setRanked([]); setFailedGigs([]); setBlockedNote(null);
    }
    toast({ title: "Audit deleted" });
  };

  const run = async () => {
    if (!hasTarget) {
      toast({ title: "Paste a Fiverr link first", description: "Your profile link, a gig link, or your username — one per line.", variant: "destructive" });
      return;
    }
    void askNotificationPermission();
    setLoading(true); setProfileAudit(null); setRanked([]); setFailedGigs([]); setBlockedNote(null); setCurrentId(null);

    try {
      const reportedIssue = [issue.trim(), performanceSummary].filter(Boolean).join("\n").slice(0, 2000);
      const { data, error } = await supabase.functions.invoke("audit-account", {
        body: {
          profileUrl: parsed.profileUrl,
          gigUrls: parsed.gigUrls,
          niche,
          issue: reportedIssue,
          pastedGig,
          pastedProfile,
          performance: { period: performancePeriod, impressions, clicks, orders },
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.savedId) throw new Error("The audit did not start correctly. Please try again.");
      setCurrentId(data.savedId);
      const completed = await waitForAudit(data.savedId);
      setProfileAudit(completed.profile_audit || null);
      setRanked(completed.gig_audits || []);
      setFailedGigs(completed.failed_gigs || []);
      setBlockedNote(completed.blocked_note || null);
      await loadSaved();
      toast({ title: "Audit complete", description: `${(completed.gig_audits || []).length} gig${(completed.gig_audits || []).length === 1 ? "" : "s"} checked and ranked.` });
    } catch (e: any) {
      toast({ title: "Audit failed", description: e.message, variant: "destructive" });
      await loadSaved();
    } finally {
      setLoading(false);
    }
  };

  const hasResults = Boolean(profileAudit) || ranked.length > 0;

  return (
    <AppShell>
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6 relative">
          <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5 blur-3xl" />
          <div className="font-mono text-xs text-primary uppercase tracking-widest mb-2">// ACCOUNT DOCTOR</div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center glow-primary shrink-0">
              <Stethoscope className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className="text-gradient">Fiverr Account Audit</span>
          </h1>
          <p className="text-sm md:text-base text-muted-foreground mt-3 max-w-2xl">
            Paste your Fiverr link and press one button. You get a score, the <span className="text-primary font-semibold">5 fixes that matter most</span>, and new text you can copy straight into Fiverr.
          </p>
        </div>

        {/* Step 1 — one box */}
        <Card className="mb-4 border-primary/30 surface-card">
          <CardContent className="p-4 md:p-5 space-y-4">
            <div>
              <label className="text-sm font-semibold flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-full bg-primary/15 text-primary font-mono text-xs flex items-center justify-center">1</span>
                Paste your Fiverr link
              </label>
              <Textarea
                rows={3}
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                placeholder={"https://www.fiverr.com/yourusername\nhttps://www.fiverr.com/yourusername/gig-slug"}
                className="font-mono text-sm"
              />
              <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
                <span>Profile link, gig links, or just your username — one per line.</span>
                {parsed.profileUrl && (
                  <Badge variant="outline" className="bg-secondary/10 text-secondary border-secondary/30"><User className="w-3 h-3 mr-1" />1 profile</Badge>
                )}
                {parsed.gigUrls.length > 0 && (
                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30"><Link2 className="w-3 h-3 mr-1" />{parsed.gigUrls.length} gig{parsed.gigUrls.length === 1 ? "" : "s"}</Badge>
                )}
              </div>
            </div>

            <Button
              onClick={run}
              disabled={loading || !hasTarget}
              size="lg"
              className="w-full bg-gradient-to-r from-primary to-secondary text-primary-foreground font-semibold"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Checking your account · {Math.floor(loadingSeconds / 60)}:{String(loadingSeconds % 60).padStart(2, "0")}</>
                : <><Sparkles className="w-4 h-4 mr-2" /> Audit my account</>}
            </Button>
            {loading && (
              <p className="text-xs text-muted-foreground text-center">
                Reading your live pages, then writing the fixes. This usually takes 40–90 seconds and is saved automatically, even if you leave this page.
              </p>
            )}

            {/* Optional extras */}
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="w-full flex items-center justify-between text-xs font-mono uppercase text-muted-foreground hover:text-foreground transition-colors pt-1"
            >
              <span>Optional — add your numbers for a sharper audit</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
            </button>

            {showAdvanced && (
              <div className="space-y-4 border-t border-border pt-4">
                <div>
                  <label className="text-xs font-mono uppercase text-muted-foreground mb-1.5 block">What have you noticed? (low impressions, no orders…)</label>
                  <Textarea rows={3} maxLength={1500} value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="e.g. Impressions dropped 2 weeks ago and I get clicks but no orders." />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs font-mono uppercase text-muted-foreground mb-1.5 block">Period</label>
                    <select value={performancePeriod} onChange={(e) => setPerformancePeriod(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" aria-label="Performance period">
                      <option>7 days</option><option>30 days</option><option>90 days</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-mono uppercase text-muted-foreground mb-1.5 block">Impressions</label>
                    <Input inputMode="numeric" placeholder="1,250" value={impressions} onChange={(e) => setImpressions(e.target.value.replace(/[^0-9,]/g, "").slice(0, 12))} />
                  </div>
                  <div>
                    <label className="text-xs font-mono uppercase text-muted-foreground mb-1.5 block">Clicks</label>
                    <Input inputMode="numeric" placeholder="32" value={clicks} onChange={(e) => setClicks(e.target.value.replace(/[^0-9,]/g, "").slice(0, 12))} />
                  </div>
                  <div>
                    <label className="text-xs font-mono uppercase text-muted-foreground mb-1.5 block">Orders</label>
                    <Input inputMode="numeric" placeholder="1" value={orders} onChange={(e) => setOrders(e.target.value.replace(/[^0-9,]/g, "").slice(0, 12))} />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-mono uppercase text-muted-foreground mb-1.5 block">Niche / service (optional)</label>
                  <Input placeholder="e.g. AI faceless YouTube shorts" value={niche} onChange={(e) => setNiche(e.target.value)} />
                </div>
                <div className="border border-border rounded-lg p-3 bg-muted/20 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Fiverr sometimes blocks bots. If your page can't be read, paste your current text here for a 100% accurate audit with no guessing.
                  </p>
                  <Textarea rows={4} value={pastedGig} onChange={(e) => setPastedGig(e.target.value)} className="font-mono text-xs" placeholder={"Title: I will...\nTags: ...\nDescription: ...\nPackages: Basic $10 / Standard $25 / Premium $50"} />
                  <Textarea rows={3} value={pastedProfile} onChange={(e) => setPastedProfile(e.target.value)} className="font-mono text-xs" placeholder={"Profile title: ...\nBio: ...\nSkills: ..."} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {blockedNote && (
          <Card className="mb-4 border-warning/40 bg-warning/5">
            <CardContent className="p-3 text-sm flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
              <span className="text-muted-foreground">{blockedNote}</span>
            </CardContent>
          </Card>
        )}

        {failedGigs.length > 0 && (
          <Card className="mb-4 border-destructive/40 bg-destructive/5">
            <CardContent className="p-3 text-sm">
              <span className="font-semibold text-destructive">Couldn't read these pages:</span>{" "}
              <span className="text-muted-foreground break-all">{failedGigs.join(", ")}</span>
              <div className="text-xs text-muted-foreground mt-1">Nothing was guessed for them. Check the links are public, or paste the text under the optional section.</div>
            </CardContent>
          </Card>
        )}

        {/* Results */}
         {profileAudit && (
          <Card className="mb-4 border-secondary/40 surface-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between gap-3">
                <span className="flex items-center gap-2"><User className="w-5 h-5 text-secondary" /> Your profile</span>
                <div className={`text-3xl font-bold font-mono ${scoreColor(profileAudit.overall_score)}`}>
                  {profileAudit.overall_score}<span className="text-sm text-muted-foreground">/100</span>
                </div>
              </CardTitle>
              <p className="text-sm text-muted-foreground pt-1">{profileAudit.verdict}</p>
            </CardHeader>
             <CardContent><AuditReport audit={profileAudit} /></CardContent>
          </Card>
        )}

        {ranked.length > 0 && (
          <Card className="mb-4 border-primary/40 surface-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Trophy className="w-5 h-5 text-primary" /> Fix this gig first
              </CardTitle>
              <p className="text-sm text-muted-foreground">Ranked by how much each fix can move impressions, clicks and orders.</p>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible defaultValue="gig-0" className="space-y-2">
                {ranked.map((g, idx) => (
                  <AccordionItem key={g.url} value={`gig-${idx}`} className="border border-border rounded-lg bg-card/40 px-3 md:px-4">
                    <AccordionTrigger className="hover:no-underline py-3">
                      <div className="flex items-center gap-3 flex-1 text-left">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold font-mono shrink-0 ${
                          g.rank === 1 ? "bg-destructive/20 text-destructive" :
                          g.rank === 2 ? "bg-warning/20 text-warning" : "bg-muted text-muted-foreground"
                        }`}>#{g.rank}</div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm truncate flex items-center gap-2">
                            {g.rank === 1 && <Flame className="w-4 h-4 text-destructive shrink-0" />}
                            {g.title}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {g.high > 0 && <span className="text-destructive">{g.high} big issue{g.high === 1 ? "" : "s"}</span>}
                            {g.high > 0 && g.med > 0 && " · "}
                            {g.med > 0 && <span className="text-warning">{g.med} medium</span>}
                          </div>
                        </div>
                        <div className={`text-xl font-bold font-mono ${scoreColor(g.score)} shrink-0`}>{g.score}</div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-2 pb-4">
                      <div className="mb-3 p-3 rounded-lg bg-gradient-to-br from-primary/5 to-secondary/5 border border-primary/20 flex items-center justify-between gap-3">
                        <p className="text-sm">{g.audit.verdict}</p>
                        <a href={g.url} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-primary hover:underline flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Open gig</a>
                      </div>
                       <AuditReport
                         audit={g.audit}
                         onImproveImage={(prompt) => generateImprovedImage(prompt, g.title)}
                       />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        )}

        {/* Saved audits — moved below so the page starts with the action */}
        {saved.length > 0 && (
          <Card className={`border-border/60 surface-card ${hasResults ? "" : "mt-2"}`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <History className="w-4 h-4 text-primary" /> Past audits ({saved.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 md:grid-cols-2">
                {saved.map((s) => (
                  <div key={s.id} className={`border rounded-lg p-3 flex items-center gap-2 bg-card/40 ${currentId === s.id ? "border-primary/60" : "border-border"}`}>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{s.label}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {new Date(s.created_at).toLocaleDateString()} · {isStaleAudit(s) ? "Incomplete" : s.status === "processing" ? "Checking…" : s.status === "error" ? "Failed" : "Complete"}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => openSaved(s)}><RefreshCw className="w-3.5 h-3.5 mr-1" />Open</Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteSaved(s.id)} className="text-destructive hover:text-destructive"><Trash2 className="w-4 h-4" /></Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
};

export default Audit;
