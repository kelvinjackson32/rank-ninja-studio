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
  Plus, X, Flame, TrendingUp, ExternalLink, Trophy, History, Trash2, RefreshCw, Target, Pencil, Image as ImageIcon,
} from "lucide-react";
import { SourceEvidencePanel, type EvidenceItem } from "@/components/SourceEvidencePanel";

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

const AuditReport = ({ audit }: { audit: Audit }) => (
  <div className="space-y-5">
    <SourceEvidencePanel evidence={audit.source_evidence} />

    {audit.top_issues_summary && audit.top_issues_summary.length > 0 && (
      <div>
        <div className="font-mono text-xs uppercase text-destructive mb-2 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Issues affecting this account</div>
        <div className="flex flex-wrap gap-1.5">
          {audit.top_issues_summary.map((t, i) => (
            <Badge key={i} variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 whitespace-normal text-left leading-snug py-1">{t}</Badge>
          ))}
        </div>
      </div>
    )}

    {audit.critical_issues?.length > 0 && (
      <div>
        <div className="font-mono text-xs uppercase text-warning mb-2 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Critical issues (with fixes)</div>
        <div className="space-y-2">
          {audit.critical_issues.map((it, i) => (
            <div key={i} className="border border-border rounded-lg p-3 bg-card/40">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className={sevColor(it.severity)}>{it.severity}</Badge>
                <span className="font-semibold text-sm">{it.area}</span>
              </div>
              <div className="text-sm mb-1"><span className="text-muted-foreground">Problem:</span> {it.problem}</div>
              <div className="text-xs text-muted-foreground mb-1.5">Why: {it.why_it_hurts}</div>
              <div className="text-sm flex items-start gap-2"><Wrench className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" /><span><span className="font-medium">Fix:</span> {it.fix}</span></div>
            </div>
          ))}
        </div>
      </div>
    )}

    {audit.account_edits && audit.account_edits.length > 0 && (
      <div>
        <div className="font-mono text-xs uppercase text-primary mb-2 flex items-center gap-2"><Target className="w-4 h-4" /> Where to edit inside Fiverr</div>
        <div className="space-y-2">
          {audit.account_edits.map((e, i) => (
            <div key={i} className="border border-border rounded-lg p-3 bg-card/40 flex gap-2 items-start">
              <Badge variant="outline" className={sevColor(e.priority)}>{e.priority}</Badge>
              <div className="flex-1">
                <div className="font-mono text-xs text-primary">{e.where_to_edit}</div>
                <div className="text-sm mt-0.5">{e.what_to_change}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )}

    {audit.rewrites && (
      <div>
        <div className="font-mono text-xs uppercase text-primary mb-2">Copy-paste rewrites</div>
        <div className="space-y-2">
          {audit.rewrites.gig_title?.improved && (
            <RewriteBlock label="Gig title (new)" current={audit.rewrites.gig_title.current} improved={audit.rewrites.gig_title.improved} reason={audit.rewrites.gig_title.reason} />
          )}
          {audit.rewrites.gig_description?.improved && (
            <RewriteBlock label="Gig description" current={audit.rewrites.gig_description.current_snippet} improved={audit.rewrites.gig_description.improved} reason={audit.rewrites.gig_description.reason} />
          )}
          {audit.rewrites.profile_description?.improved && (
            <RewriteBlock label="Profile description" current={audit.rewrites.profile_description.current_snippet} improved={audit.rewrites.profile_description.improved} reason={audit.rewrites.profile_description.reason} />
          )}
          {audit.rewrites.buyer_requirements?.improved && (
            <div className="border border-border rounded-lg p-3 bg-card/40">
              <div className="flex items-center justify-between mb-1.5">
                <div className="font-semibold text-sm flex items-center gap-2"><Pencil className="w-3.5 h-3.5 text-primary" />Buyer requirements</div>
                <Button variant="ghost" size="sm" onClick={() => copy((audit.rewrites.buyer_requirements.improved || []).map((q: string, i: number) => `${i + 1}. ${q}`).join("\n"))}><Copy className="w-3.5 h-3.5 mr-1" />Copy</Button>
              </div>
              <ol className="text-sm space-y-1 list-decimal pl-5">
                {(audit.rewrites.buyer_requirements.improved as string[]).map((q, i) => <li key={i}>{q}</li>)}
              </ol>
              {audit.rewrites.buyer_requirements.reason && <div className="text-xs text-muted-foreground mt-2">💡 {audit.rewrites.buyer_requirements.reason}</div>}
            </div>
          )}
          {audit.rewrites.search_tags?.improved && (
            <div className="border border-border rounded-lg p-3 bg-card/40">
              <div className="flex items-center justify-between mb-1.5">
                <div className="font-semibold text-sm">Search tags</div>
                <Button variant="ghost" size="sm" onClick={() => copy((audit.rewrites.search_tags.improved || []).join(", "))}><Copy className="w-3.5 h-3.5 mr-1" />Copy</Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(audit.rewrites.search_tags.improved as string[]).map((t, i) => <Badge key={i} variant="outline" className="bg-primary/10 text-primary border-primary/30">{t}</Badge>)}
              </div>
              {audit.rewrites.search_tags.reason && <div className="text-xs text-muted-foreground mt-2">💡 {audit.rewrites.search_tags.reason}</div>}
            </div>
          )}
          {audit.rewrites.packages?.improved && (
            <div className="border border-border rounded-lg p-3 bg-card/40">
              <div className="flex items-center justify-between mb-1.5">
                <div className="font-semibold text-sm">Packages</div>
                <Button variant="ghost" size="sm" onClick={() => copy(audit.rewrites.packages.improved)}><Copy className="w-3.5 h-3.5 mr-1" />Copy</Button>
              </div>
              <pre className="text-xs whitespace-pre-wrap bg-muted/30 p-2.5 rounded font-mono leading-relaxed">{JSON.stringify(audit.rewrites.packages.improved, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>
    )}

    {audit.ranking_tips && audit.ranking_tips.length > 0 && (
      <div>
        <div className="font-mono text-xs uppercase text-secondary mb-2 flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Ranking tips</div>
        <ul className="space-y-1 text-sm">
          {audit.ranking_tips.map((t, i) => <li key={i} className="flex gap-2"><TrendingUp className="w-3.5 h-3.5 text-secondary mt-0.5 shrink-0" />{t}</li>)}
        </ul>
      </div>
    )}

    {audit.action_plan?.length > 0 && (
      <div>
        <div className="font-mono text-xs uppercase text-success mb-2 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Step-by-step fix plan</div>
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
      </div>
    )}

    {audit.image_prompts?.length > 0 && (
      <div>
        <div className="font-mono text-xs uppercase text-secondary mb-2 flex items-center gap-2"><ImageIcon className="w-4 h-4" /> Premium thumbnail prompts (1280×769)</div>
        <div className="space-y-2">
          {audit.image_prompts.map((ip, i) => (
            <div key={i} className="border border-border rounded-lg p-3 bg-card/40">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold text-sm">{ip.slot}</div>
                <Button variant="ghost" size="sm" onClick={() => copy(ip.prompt)}><Copy className="w-3.5 h-3.5 mr-1" />Copy</Button>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{ip.prompt}</p>
            </div>
          ))}
        </div>
      </div>
    )}

    {audit.strengths?.length > 0 && (
      <div>
        <div className="font-mono text-xs uppercase text-success mb-2">What you're doing right</div>
        <ul className="space-y-1 text-sm">
          {audit.strengths.map((s, i) => <li key={i} className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />{s}</li>)}
        </ul>
      </div>
    )}
  </div>
);

const Audit = () => {
  const [profileUrl, setProfileUrl] = useState("");
  const [gigUrls, setGigUrls] = useState<string[]>([""]);
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

  const updateGig = (i: number, v: string) => setGigUrls((arr) => arr.map((u, idx) => (idx === i ? v : u)));
  const addGig = () => setGigUrls((arr) => [...arr, ""]);
  const removeGig = (i: number) => setGigUrls((arr) => arr.filter((_, idx) => idx !== i));

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
    setProfileUrl(s.profile_url || "");
    setGigUrls(s.gig_urls?.length ? s.gig_urls : [""]);
    setNiche(s.niche || "");
    setIssue(s.issue || "");
    setProfileAudit(s.profile_audit || null);
    setRanked(s.gig_audits || []);
    setFailedGigs(s.failed_gigs || []);
    setBlockedNote(s.blocked_note || null);
    if (isStaleAudit(s)) {
      toast({ title: "Incomplete audit", description: "This older audit was interrupted before results were saved. Run it again to use the fixed deep-audit flow.", variant: "destructive" });
    } else if (s.status === "processing") {
      toast({ title: "Audit still running", description: "The live pages are still being checked. Results will appear here when complete." });
    } else if (s.status === "error") {
      toast({ title: "Audit failed", description: s.error_message || "Please run this audit again.", variant: "destructive" });
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const waitForAudit = async (id: string) => {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 2500));
      const { data, error } = await (supabase as any)
        .from("saved_audits")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw new Error(error.message);
      const audit = data as SavedAudit;
      if (audit.status === "error") throw new Error(audit.error_message || "The audit could not be completed.");
      if (audit.status === "complete") return audit;
    }
    throw new Error("The deep audit is still processing. Open it from Saved audits in a moment to see the results.");
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
    const cleanGigs = gigUrls.map((u) => u.trim()).filter(Boolean);
    if (!profileUrl && cleanGigs.length === 0) {
      toast({ title: "Add a Fiverr URL", description: "Paste your profile URL and/or one or more gig URLs.", variant: "destructive" });
      return;
    }
    setLoading(true); setProfileAudit(null); setRanked([]); setFailedGigs([]); setBlockedNote(null); setCurrentId(null);
    try {
      const reportedIssue = [issue.trim(), performanceSummary].filter(Boolean).join("\n").slice(0, 2000);
      const { data, error } = await supabase.functions.invoke("audit-account", {
        body: { profileUrl, gigUrls: cleanGigs, niche, issue: reportedIssue, pastedGig, pastedProfile },
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
      toast({ title: "Deep audit complete & saved", description: `${(completed.gig_audits || []).length} gig${(completed.gig_audits || []).length === 1 ? "" : "s"} checked and ranked.` });
    } catch (e: any) {
      toast({ title: "Audit failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <div className="p-4 md:p-8 max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8 relative">
          <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5 blur-3xl" />
          <div className="font-mono text-xs text-primary uppercase tracking-widest mb-2">// ACCOUNT DOCTOR</div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center glow-primary">
              <Stethoscope className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className="text-gradient">Fiverr Account Audit</span>
          </h1>
          <p className="text-sm md:text-base text-muted-foreground mt-3 max-w-2xl">
            Paste your Fiverr username, profile URL, or gig URLs. Apify inspects the live setup, then AI gives you a brand-new gig title, gig description, profile bio, buyer requirements, ranking tips and premium 1280×769 thumbnail prompts — <span className="text-primary font-semibold">every audit is saved</span> so you can reopen it later.
          </p>
        </div>

        {/* Saved audits */}
        {saved.length > 0 && (
          <Card className="mb-6 border-border/60 surface-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <History className="w-5 h-5 text-primary" /> Saved audits ({saved.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 md:grid-cols-2">
                {saved.map((s) => (
                  <div key={s.id} className={`border rounded-lg p-3 flex items-center gap-2 bg-card/40 ${currentId === s.id ? "border-primary/60" : "border-border"}`}>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{s.label}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {new Date(s.created_at).toLocaleString()} · {s.gig_urls?.length || 0} gig{(s.gig_urls?.length || 0) === 1 ? "" : "s"} · {isStaleAudit(s) ? "Incomplete — run again" : s.status === "processing" ? "Checking…" : s.status === "error" ? "Failed" : "Complete"}
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

        {/* Input panel */}
        <Card className="mb-6 border-primary/30 surface-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <span className="w-1.5 h-5 rounded bg-primary" /> Account details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs font-mono uppercase text-muted-foreground mb-1.5 block">Fiverr username or profile URL</label>
              <Input placeholder="yourusername or https://www.fiverr.com/yourusername" value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-mono uppercase text-muted-foreground">Gig URLs ({gigUrls.filter(Boolean).length})</label>
                <Button variant="ghost" size="sm" onClick={addGig}><Plus className="w-3.5 h-3.5 mr-1" /> Add gig</Button>
              </div>
              <div className="space-y-2">
                {gigUrls.map((u, i) => (
                  <div key={i} className="flex gap-2">
                    <div className="w-7 h-9 rounded bg-muted/40 text-muted-foreground font-mono text-xs flex items-center justify-center shrink-0">{i + 1}</div>
                    <Input
                      placeholder="https://www.fiverr.com/yourusername/gig-slug"
                      value={u}
                      onChange={(e) => updateGig(i, e.target.value)}
                    />
                    {gigUrls.length > 1 && (
                      <Button variant="ghost" size="icon" onClick={() => removeGig(i)} className="shrink-0"><X className="w-4 h-4" /></Button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">Tip: add known gig links, or paste only the profile and Apify will try to discover public gigs automatically.</p>
            </div>

            <div>
              <label className="text-xs font-mono uppercase text-muted-foreground mb-1.5 block">What have you noticed?</label>
              <Textarea
                rows={3}
                maxLength={1500}
                placeholder="Describe what is going wrong, when it started, what you changed, and what result you expected…"
                value={issue}
                onChange={(e) => setIssue(e.target.value)}
              />
              <div className="text-[11px] text-muted-foreground text-right mt-1">{issue.length}/1500</div>
            </div>

            <div className="border border-border rounded-lg p-3 bg-muted/20">
              <div className="flex flex-col gap-1 mb-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-xs font-mono uppercase text-primary">// Performance numbers</div>
                  <p className="text-xs text-muted-foreground mt-1">Use the same date range from Fiverr Analytics. These numbers help diagnose visibility, click-through and conversion.</p>
                </div>
                <select
                  value={performancePeriod}
                  onChange={(e) => setPerformancePeriod(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  aria-label="Performance period"
                >
                  <option>7 days</option>
                  <option>30 days</option>
                  <option>90 days</option>
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="text-xs font-mono uppercase text-muted-foreground mb-1.5 block">Impressions</label>
                  <Input inputMode="numeric" placeholder="e.g. 1,250" value={impressions} onChange={(e) => setImpressions(e.target.value.replace(/[^0-9,]/g, "").slice(0, 12))} />
                </div>
                <div>
                  <label className="text-xs font-mono uppercase text-muted-foreground mb-1.5 block">Clicks</label>
                  <Input inputMode="numeric" placeholder="e.g. 32" value={clicks} onChange={(e) => setClicks(e.target.value.replace(/[^0-9,]/g, "").slice(0, 12))} />
                </div>
                <div>
                  <label className="text-xs font-mono uppercase text-muted-foreground mb-1.5 block">Orders</label>
                  <Input inputMode="numeric" placeholder="e.g. 1" value={orders} onChange={(e) => setOrders(e.target.value.replace(/[^0-9,]/g, "").slice(0, 12))} />
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-1 gap-3">
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground mb-1.5 block">Niche / Service (optional)</label>
                <Input placeholder="e.g. AI faceless YouTube shorts" value={niche} onChange={(e) => setNiche(e.target.value)} />
              </div>
            </div>

            <div className="border border-border rounded-lg p-3 bg-muted/20 space-y-3">
              <div>
                <div className="text-xs font-mono uppercase text-primary">// Paste your current setup (most accurate)</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Fiverr often blocks bots. If a page can't be read, the audit will use the text you paste here instead — that gives a 100% accurate, no-guessing audit.
                </p>
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground mb-1.5 block">Your gig (title, tags, description, packages, requirements)</label>
                <Textarea
                  rows={5}
                  placeholder={"Title: I will...\nTags: ...\nDescription: ...\nPackages: Basic $10 / Standard $25 / Premium $50..."}
                  value={pastedGig}
                  onChange={(e) => setPastedGig(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground mb-1.5 block">Your profile (title, bio/description, skills, languages)</label>
                <Textarea
                  rows={4}
                  placeholder={"Profile title: ...\nBio: ...\nSkills: ..."}
                  value={pastedProfile}
                  onChange={(e) => setPastedProfile(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <Button onClick={run} disabled={loading} size="lg" className="w-full bg-gradient-to-r from-primary to-secondary text-primary-foreground font-semibold animate-pulse-glow">
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Deep audit running · {Math.floor(loadingSeconds / 60)}:{String(loadingSeconds % 60).padStart(2, "0")}</> : <><Sparkles className="w-4 h-4 mr-2" /> Run live audit & save</>}
            </Button>
            {loading && <p className="text-xs text-muted-foreground text-center">Reading the live pages first, then comparing your reported performance and preparing exact fixes. The audit is saved automatically even if you leave this page.</p>}
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
               <span className="font-semibold text-destructive">Could not read these Fiverr pages:</span>{" "}
              <span className="text-muted-foreground break-all">{failedGigs.join(", ")}</span>
               <div className="text-xs text-muted-foreground mt-1">These are marked as unreadable instead of guessing. Check that each link is public and spelled correctly.</div>
            </CardContent>
          </Card>
        )}

        {/* Profile audit */}
        {profileAudit && (
          <Card className="mb-6 border-secondary/40 surface-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between">
                <span className="flex items-center gap-2"><span className="w-1.5 h-5 rounded bg-secondary" /> Profile audit</span>
                <div className={`text-3xl font-bold font-mono ${scoreColor(profileAudit.overall_score)}`}>
                  {profileAudit.overall_score}<span className="text-sm text-muted-foreground">/100</span>
                </div>
              </CardTitle>
              <p className="text-sm text-muted-foreground pt-1">{profileAudit.verdict}</p>
            </CardHeader>
            <CardContent><AuditReport audit={profileAudit} /></CardContent>
          </Card>
        )}

        {/* Ranked gigs */}
        {ranked.length > 0 && (
          <Card className="border-primary/40 surface-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Trophy className="w-5 h-5 text-primary" /> Fix-priority ranking
              </CardTitle>
              <p className="text-sm text-muted-foreground">Sorted by severity × impact. Start with #1 — biggest revenue unlock.</p>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible defaultValue={`gig-0`} className="space-y-2">
                {ranked.map((g, idx) => (
                  <AccordionItem key={g.url} value={`gig-${idx}`} className="border border-border rounded-lg bg-card/40 px-4">
                    <AccordionTrigger className="hover:no-underline py-3">
                      <div className="flex items-center gap-3 flex-1 text-left">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold font-mono shrink-0 ${
                          g.rank === 1 ? "bg-destructive/20 text-destructive" :
                          g.rank === 2 ? "bg-warning/20 text-warning" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          #{g.rank}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm truncate flex items-center gap-2">
                            {g.rank === 1 && <Flame className="w-4 h-4 text-destructive shrink-0" />}
                            {g.title}
                          </div>
                          <div className="text-xs text-muted-foreground truncate font-mono">{g.url}</div>
                        </div>
                        <div className="hidden md:flex items-center gap-2 shrink-0">
                          {g.high > 0 && <Badge variant="outline" className={sevColor("high")}>{g.high} high</Badge>}
                          {g.med > 0 && <Badge variant="outline" className={sevColor("medium")}>{g.med} med</Badge>}
                          {g.low > 0 && <Badge variant="outline" className={sevColor("low")}>{g.low} low</Badge>}
                          <div className={`text-xl font-bold font-mono ${scoreColor(g.score)} w-12 text-right`}>{g.score}</div>
                          <div className="flex items-center gap-1 text-xs text-primary"><TrendingUp className="w-3.5 h-3.5" />{g.priority}</div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-2 pb-4">
                      <div className="mb-3 p-3 rounded-lg bg-gradient-to-br from-primary/5 to-secondary/5 border border-primary/20">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm">{g.audit.verdict}</p>
                          <a href={g.url} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-primary hover:underline flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Open gig</a>
                        </div>
                      </div>
                      <AuditReport audit={g.audit} />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
};

export default Audit;
