import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Copy, Loader2, Sparkles, RefreshCw, Tag, MessageSquare, Package, User, Download, Trophy, Lightbulb, Star, RotateCw, Image as ImageIcon, Type, Search, Gauge, ExternalLink, Rocket, Video, Film, FileText, Users } from "lucide-react";
import { jsPDF } from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { SafetyReportPanel } from "@/components/SafetyReportPanel";


// Fiverr platform limits used for warnings
const LIMITS: Record<string, number> = {
  gig_title: 80,
  description: 1200,
  short_bio: 150,
  about: 500,
  profile_title: 70,
};

const RUNNING_STATUSES = ["pending", "scraping", "analyzing"];
const STUCK_AFTER_MS = 10 * 60 * 1000;

const Project = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [project, setProject] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [rerunning, setRerunning] = useState(false);
  const [building, setBuilding] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const { data: p } = await supabase.from("projects").select("*").eq("id", id).single();
    setProject(p);
    if (p?.status === "complete") {
      const { data: r } = await supabase.from("research_results").select("*").eq("project_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      setResult(r);
    }
  };

  useEffect(() => { if (id) load(); }, [id]);

  useEffect(() => {
    if (!id) return;
    const ch = supabase.channel(`project-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "projects", filter: `id=eq.${id}` }, (payload) => {
        setProject(payload.new);
        if (payload.new.status === "complete") load();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id]);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [project?.progress_log]);

  const copy = (text: string) => { navigator.clipboard.writeText(text); toast.success("Copied"); };

  const launchResearch = async (projectId: string, failureLog?: any[]) => {
    const { error } = await supabase.functions.invoke("run-research", { body: { projectId } });
    if (error) {
      await supabase.from("projects").update({
        status: "error",
        progress_log: failureLog || [{ ts: new Date().toISOString(), msg: `❌ Research failed to start: ${error.message}` }],
      }).eq("id", projectId);
      throw error;
    }
  };

  const rerun = async () => {
    setRerunning(true);
    try {
      await launchResearch(id!, project ? [...(project.progress_log || []), { ts: new Date().toISOString(), msg: "❌ Research failed to restart. Please try again." }] : undefined);
      toast.success("Research re-launched");
      load();
    } catch (e: any) { toast.error(e.message); } finally { setRerunning(false); }
  };

  const buildFromAngle = async (angleTitle: string, primaryKeyword?: string) => {
    if (!user || !angleTitle) return;
    setBuilding(angleTitle);
    try {
      const sec = primaryKeyword && primaryKeyword !== angleTitle ? [primaryKeyword] : [];
      const { data: created, error } = await supabase.from("projects").insert({
        user_id: user.id, niche: angleTitle, secondary_keywords: sec, status: "pending",
      }).select().single();
      if (error) throw error;
      await launchResearch(created.id);
      toast.success("New gig research launched");
      nav(`/app/projects/${created.id}`);
    } catch (e: any) { toast.error(e.message); } finally { setBuilding(null); }
  };

  const markdown = useMemo(() => result ? buildMarkdown(project, result) : "", [project, result]);

  const exportMd = () => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(project?.niche || "rankforge").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!project || !id || !RUNNING_STATUSES.includes(project.status)) return;
    const lastActivity = Date.parse(project.updated_at || project.created_at || "");
    if (!Number.isFinite(lastActivity) || Date.now() - lastActivity < STUCK_AFTER_MS) return;
    const log = [...(project.progress_log || []), {
      ts: new Date().toISOString(),
      msg: "❌ Research timed out before finishing. Use Re-run to start a fresh faster scan.",
    }];
    supabase.from("projects").update({ status: "error", progress_log: log }).eq("id", id).then(() => load());
  }, [project, id]);

  if (!project) return <AppShell><div className="p-8">Loading...</div></AppShell>;

  const isRunning = RUNNING_STATUSES.includes(project.status);
  const canRerun = project.status === "complete" || project.status === "error";

  return (
    <AppShell>
      <div className="p-4 md:p-8 max-w-6xl">
        <Link to="/app" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary mb-4"><ArrowLeft className="w-4 h-4" />Dashboard</Link>
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
          <div className="min-w-0">
            <div className="font-mono text-xs text-primary uppercase tracking-widest mb-1">// PROJECT</div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight break-words">{project.niche}</h1>
            {project.secondary_keywords?.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {project.secondary_keywords.map((k: string) => <Badge key={k} variant="outline" className="font-mono">{k}</Badge>)}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={
              project.status === "complete" ? "bg-success/15 text-success border-success/30" :
              project.status === "error" ? "bg-destructive/15 text-destructive border-destructive/30" :
              "bg-primary/15 text-primary border-primary/30"
            }>{project.status}</Badge>
            {result && (
              <>
                <Button size="sm" variant="outline" onClick={() => copy(markdown)}><Copy className="w-4 h-4 mr-1" />Copy all</Button>
                <Button size="sm" variant="outline" onClick={exportMd}><Download className="w-4 h-4 mr-1" />Export .md</Button>
              </>
            )}
            {canRerun && (
              <Button size="sm" variant="outline" onClick={rerun} disabled={rerunning}>
                {rerunning ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RotateCw className="w-4 h-4 mr-1" />}
                Re-run
              </Button>
            )}
          </div>
        </div>

        {(isRunning || project.status === "error") && (
          <div className="surface-card rounded-xl p-5 mb-6 scan-line">
            <div className="flex items-center gap-2 mb-3">
              {isRunning && <Loader2 className="w-4 h-4 text-primary animate-spin" />}
              <h2 className="font-semibold text-sm uppercase tracking-wider font-mono">Research Console</h2>
            </div>
            <div ref={logRef} className="bg-background/60 rounded-md p-4 font-mono text-xs space-y-1 max-h-80 overflow-y-auto">
              {(project.progress_log || []).length === 0 && <div className="text-muted-foreground">Initializing...</div>}
              {(project.progress_log || []).map((entry: any, i: number) => (
                <div key={i} className="flex gap-3">
                  <span className="text-muted-foreground/60 shrink-0">{new Date(entry.ts).toLocaleTimeString()}</span>
                  <span className="text-foreground/90 whitespace-pre-wrap break-words">{entry.msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {result && (
          <div className="mb-4">
            <SafetyReportPanel
              profile={result.profile_optimization?.safety_report}
              gig={result.gig_optimization?.safety_report}
            />
          </div>
        )}

        {result && (
          <Tabs defaultValue="insights">

            <TabsList className="bg-muted/40 border border-border flex-wrap h-auto">
              <TabsTrigger value="insights"><Sparkles className="w-4 h-4 mr-1" />Insights</TabsTrigger>
              <TabsTrigger value="sellers"><Trophy className="w-4 h-4 mr-1" />Top Sellers</TabsTrigger>
              <TabsTrigger value="titles"><Type className="w-4 h-4 mr-1" />Titles</TabsTrigger>
              <TabsTrigger value="keywords"><Search className="w-4 h-4 mr-1" />Keywords</TabsTrigger>
              <TabsTrigger value="profile"><User className="w-4 h-4 mr-1" />Profile</TabsTrigger>
              <TabsTrigger value="gig"><Package className="w-4 h-4 mr-1" />Gig</TabsTrigger>
              <TabsTrigger value="thumbnails"><ImageIcon className="w-4 h-4 mr-1" />Thumbnails</TabsTrigger>
              {result.gig_optimization?.is_video_gig && (
                <TabsTrigger value="video"><Film className="w-4 h-4 mr-1" />Video Concepts</TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="insights" className="mt-6 space-y-4">
              <NicheAnglesView insights={result.insights} copy={copy} onBuild={buildFromAngle} building={building} />
              <InsightsView insights={result.insights} scrapedCount={result.scraped_data?.count || 0} />
            </TabsContent>

            <TabsContent value="sellers" className="mt-6 space-y-4">
              <TopSellersView insights={result.insights} />
            </TabsContent>

            <TabsContent value="titles" className="mt-6 space-y-4">
              <TitleVariationsView gig={result.gig_optimization} copy={copy} onBuild={buildFromAngle} building={building} />
            </TabsContent>

            <TabsContent value="keywords" className="mt-6 space-y-4">
              <KeywordsView insights={result.insights} copy={copy} />
            </TabsContent>

            <TabsContent value="profile" className="mt-6 space-y-4">
              <ProfileView profile={result.profile_optimization} resultId={result.id} onUpdate={load} copy={copy} />
            </TabsContent>

            <TabsContent value="gig" className="mt-6 space-y-4">
              <GigView gig={result.gig_optimization} resultId={result.id} onUpdate={load} copy={copy} />
            </TabsContent>

            <TabsContent value="thumbnails" className="mt-6 space-y-4">
              <ThumbnailsView gig={result.gig_optimization} copy={copy} />
            </TabsContent>

            {result.gig_optimization?.is_video_gig && (
              <TabsContent value="video" className="mt-6 space-y-4">
                <VideoConceptsView gig={result.gig_optimization} niche={project.niche} copy={copy} />
              </TabsContent>
            )}
          </Tabs>
        )}
      </div>
    </AppShell>
  );
};

const NicheAnglesView = ({ insights, copy, onBuild, building }: any) => {
  const angles = insights?.niche_angles || [];
  if (angles.length === 0) return null;
  return (
    <div className="surface-card rounded-lg p-5 border-primary/40 bg-primary/5">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-primary">Pick your winning angle</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">3 refined sub-niches with proven demand but lower competition than the head term. Click <b>Build this gig</b> to generate a full profile + gig package on the chosen angle.</p>
      <div className="grid md:grid-cols-3 gap-3">
        {angles.slice(0, 3).map((a: any, i: number) => (
          <div key={i} className="rounded-lg border border-border bg-background/40 p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-primary">#{i + 1}</span>
              {a.estimated_competition && (
                <Badge variant="outline" className={`font-mono text-[10px] capitalize ${a.estimated_competition === "low" ? "border-success/40 text-success" : "border-warning/40 text-warning"}`}>{a.estimated_competition} comp</Badge>
              )}
            </div>
            <div className="font-bold text-sm leading-snug">{a.title}</div>
            {a.primary_keyword && (
              <div className="text-[11px] font-mono text-muted-foreground">kw: <span className="text-secondary">{a.primary_keyword}</span></div>
            )}
            {a.demand_signal && <div className="text-xs text-foreground/80"><span className="text-success">Demand:</span> {a.demand_signal}</div>}
            {a.competition_signal && <div className="text-xs text-foreground/80"><span className="text-primary">Gap:</span> {a.competition_signal}</div>}
            {a.why_pick_this && <div className="text-xs text-muted-foreground border-l-2 border-primary/40 pl-2 mt-1">{a.why_pick_this}</div>}
            <div className="flex gap-2 mt-2">
              <Button size="sm" className="flex-1 h-8 bg-gradient-to-r from-primary to-secondary text-primary-foreground" disabled={building === a.title} onClick={() => onBuild(a.title, a.primary_keyword)}>
                {building === a.title ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Rocket className="w-3 h-3 mr-1" />}
                Build this gig
              </Button>
              <Button size="sm" variant="outline" className="h-8" onClick={() => copy(`${a.title}\nKeyword: ${a.primary_keyword || ""}`)}>
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const InsightsView = ({ insights, scrapedCount }: any) => {
  if (!insights) return null;
  const score = insights.opportunity_score;
  const scoreColor = score == null ? "text-muted-foreground" : score >= 70 ? "text-success" : score >= 50 ? "text-warning" : "text-destructive";
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="surface-card rounded-lg p-5">
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Gigs Analyzed</div>
          <div className="text-3xl font-bold text-gradient font-mono mt-1">{scrapedCount}</div>
        </div>
        <div className="surface-card rounded-lg p-5 border-primary/30">
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Opportunity</div>
          <div className={`text-3xl font-bold font-mono mt-1 ${scoreColor}`}>{score != null ? `${score}` : "—"}<span className="text-base text-muted-foreground">/100</span></div>
        </div>
        <div className="surface-card rounded-lg p-5">
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Competition</div>
          <div className="text-2xl font-bold mt-1 capitalize">{insights.competition_level}</div>
        </div>
        <div className="surface-card rounded-lg p-5">
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Avg Top Orders</div>
          <div className="text-base font-bold text-primary mt-1">{insights.average_top_orders || "—"}</div>
        </div>
      </div>

      {insights.opportunity_reasoning && (
        <div className="surface-card rounded-lg p-5 border-primary/20">
          <div className="flex items-center gap-2 mb-2">
            <Gauge className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-primary">Opportunity Reasoning</h3>
          </div>
          <p className="text-sm leading-relaxed">{insights.opportunity_reasoning}</p>
        </div>
      )}

      <div className="surface-card rounded-lg p-5 inline-flex items-center gap-3">
        <span className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Avg Starting Price</span>
        <span className="text-xl font-bold text-primary">{insights.average_starting_price}</span>
      </div>

      {insights.key_learnings?.length > 0 && (
        <div className="surface-card rounded-lg p-5 border-primary/30">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-primary">What you should learn from this research</h3>
          </div>
          <ul className="space-y-2 text-sm">
            {insights.key_learnings.map((p: string, i: number) => (
              <li key={i} className="flex gap-3">
                <span className="text-primary font-mono shrink-0">{String(i + 1).padStart(2, "0")}</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Section title="Competition Summary">{insights.competition_summary}</Section>
      <Section title="Top Keywords (Real Top Sellers)">
        <div className="flex flex-wrap gap-2">
          {(insights.top_keywords || []).map((k: string) => <Badge key={k} variant="outline" className="font-mono bg-primary/5 border-primary/30 text-primary">{k}</Badge>)}
        </div>
      </Section>
      <Section title="Winning Patterns">
        <ul className="space-y-2 text-sm">
          {(insights.winning_patterns || []).map((p: string, i: number) => <li key={i} className="flex gap-2"><span className="text-primary font-mono shrink-0">{String(i+1).padStart(2,'0')}</span>{p}</li>)}
        </ul>
      </Section>
      <Section title="Top-Rated Differentiators">
        <ul className="space-y-2 text-sm">
          {(insights.top_rated_differentiators || []).map((p: string, i: number) => <li key={i} className="flex gap-2"><span className="text-secondary">→</span>{p}</li>)}
        </ul>
      </Section>
      <Section title="Common Package Structure">{insights.common_package_structure}</Section>
    </>
  );
};

const TopSellersView = ({ insights }: any) => {
  const sellers = insights?.top_sellers || [];
  if (sellers.length === 0) return <div className="surface-card rounded-lg p-8 text-center text-muted-foreground">No top-seller data available. Try re-running the research.</div>;
  return (
    <div className="space-y-4">
      <div className="surface-card rounded-lg p-5 bg-primary/5 border-primary/30">
        <div className="flex items-center gap-2 mb-1">
          <Trophy className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-primary">Sellers ranking #1 for your niche</h3>
        </div>
        <p className="text-sm text-muted-foreground">Here's exactly who's winning, why, and what tactics you should copy.</p>
      </div>
      {sellers.map((s: any, i: number) => (
        <div key={i} className="surface-card rounded-lg p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-xs text-primary">#{i + 1}</span>
                <span className="font-bold">{s.seller_name || "Unknown seller"}</span>
                {s.level && <Badge className="bg-secondary/15 text-secondary border-secondary/30 text-xs">{s.level}</Badge>}
              </div>
              <div className="text-sm text-foreground/80">"{s.gig_title}"</div>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground">
              {s.rating && <span className="flex items-center gap-1"><Star className="w-3 h-3 text-warning" />{s.rating}</span>}
              {s.reviews && <span>{s.reviews} reviews</span>}
              {s.starting_price && <span className="text-primary">{s.starting_price}</span>}
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-3 mt-3">
            <div className="rounded-md bg-muted/30 p-3">
              <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">Why they rank</div>
              <div className="text-sm">{s.why_ranking}</div>
            </div>
            <div className="rounded-md bg-primary/5 border border-primary/20 p-3">
              <div className="text-[10px] uppercase tracking-wider font-mono text-primary mb-1">Steal this</div>
              <div className="text-sm">{s.what_to_copy}</div>
            </div>
          </div>
          {(s.gig_url || s.seller_url || s.source_search_url) && (
            <div className="mt-3 pt-3 border-t border-border/50 flex flex-wrap items-center gap-3 text-xs font-mono">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Sources:</span>
              {s.gig_url && (
                <a href={s.gig_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                  View gig <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {s.seller_url && (
                <a href={s.seller_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                  Seller profile <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {s.source_search_url && (
                <a href={s.source_search_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary inline-flex items-center gap-1">
                  Search results <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="surface-card rounded-lg p-5">
    <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-muted-foreground mb-3">{title}</h3>
    <div className="text-sm leading-relaxed">{children}</div>
  </div>
);

const Field = ({ label, value, resultId, section, fieldKey, onUpdate, copy, multiline = false }: any) => {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const limit = LIMITS[fieldKey];
  const len = typeof value === "string" ? value.length : 0;
  const over = limit && len > limit;
  const near = limit && !over && len > limit * 0.9;
  return (
    <div className="surface-card rounded-lg p-5">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-muted-foreground">{label}</h3>
        <div className="flex gap-1">
          <RegenButton resultId={resultId} section={section} fieldKey={fieldKey} onUpdate={onUpdate} />
          <Button size="icon" variant="ghost" onClick={() => copy(text)}><Copy className="w-4 h-4" /></Button>
        </div>
      </div>
      <div className={`text-sm leading-relaxed ${multiline ? "whitespace-pre-wrap" : ""} ${typeof value === "string" ? "" : "font-mono text-xs"}`}>
        {typeof value === "string" ? value : <pre className="overflow-x-auto">{text}</pre>}
      </div>
      {typeof value === "string" && (
        <div className={`text-xs font-mono mt-2 ${over ? "text-destructive" : near ? "text-warning" : "text-muted-foreground"}`}>
          {len}{limit ? ` / ${limit}` : ""} chars{over ? " — exceeds Fiverr limit, regenerate" : limit ? " (Fiverr limit)" : ""}
        </div>
      )}
    </div>
  );
};

const RegenButton = ({ resultId, section, fieldKey, onUpdate }: any) => {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.functions.invoke("regenerate-section", { body: { resultId, section, field: fieldKey, instruction } });
      if (error) throw error;
      toast.success("Regenerated");
      setOpen(false); setInstruction(""); onUpdate();
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="icon" variant="ghost"><RefreshCw className="w-4 h-4" /></Button></DialogTrigger>
      <DialogContent className="surface-card">
        <DialogHeader><DialogTitle>Regenerate {fieldKey}</DialogTitle></DialogHeader>
        <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. Make it more confident, add more keywords" className="bg-input/50" />
        <Button onClick={run} disabled={loading} className="bg-gradient-to-r from-primary to-secondary text-primary-foreground">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Regenerate"}
        </Button>
      </DialogContent>
    </Dialog>
  );
};

const ProfileStrengthCard = ({ strength }: any) => {
  if (!strength) return null;
  const s = strength.score ?? 0;
  const color = s >= 80 ? "text-success" : s >= 60 ? "text-warning" : "text-destructive";
  const bar = s >= 80 ? "bg-success" : s >= 60 ? "bg-warning" : "bg-destructive";
  return (
    <div className="surface-card rounded-lg p-5 border-primary/30">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-primary">Profile Strength</h3>
        </div>
        <div className={`text-3xl font-mono font-bold ${color}`}>{s}<span className="text-base text-muted-foreground">/100</span></div>
      </div>
      <div className="w-full h-2 rounded-full bg-muted/40 overflow-hidden mb-4">
        <div className={`h-full ${bar} transition-all`} style={{ width: `${Math.min(100, Math.max(0, s))}%` }} />
      </div>
      {strength.breakdown && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
          {Object.entries(strength.breakdown).map(([k, v]: any) => (
            <div key={k} className="rounded-md bg-muted/30 p-2 text-center">
              <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground truncate">{k.replace(/_/g, " ")}</div>
              <div className="font-mono font-bold text-sm mt-1">{v}/20</div>
            </div>
          ))}
        </div>
      )}
      {strength.tips?.length > 0 && (
        <ul className="space-y-2 text-sm">
          {strength.tips.map((t: string, i: number) => (
            <li key={i} className="flex gap-2"><span className="text-primary shrink-0">→</span>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

const TitleVariationsView = ({ gig, copy, onBuild, building }: any) => {
  const variations = gig?.title_variations || [];
  if (variations.length === 0) return <div className="surface-card rounded-lg p-8 text-center text-muted-foreground">No title variations yet. Re-run research to generate them.</div>;
  return (
    <div className="space-y-3">
      <div className="surface-card rounded-lg p-5 bg-primary/5 border-primary/30">
        <div className="flex items-center gap-2 mb-1">
          <Type className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-primary">{variations.length} competitive title angles</h3>
        </div>
        <p className="text-sm text-muted-foreground">Each one models a real winning pattern from your scraped top sellers. Click <b>Build this gig</b> to spin up a brand-new gig + profile package built around that exact title.</p>
      </div>
      {variations.map((v: any, i: number) => {
        const len = (v.title || "").length;
        const over = len > 80;
        const isBuilding = building === v.title;
        return (
          <div key={i} className="surface-card rounded-lg p-5">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-mono text-xs text-primary">#{String(i + 1).padStart(2, "0")}</span>
                  {v.angle && <Badge variant="outline" className="font-mono text-[10px]">{v.angle}</Badge>}
                </div>
                <div className="font-bold text-base break-words">{v.title}</div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => copy(v.title)}><Copy className="w-4 h-4" /></Button>
            </div>
            {v.why_it_works && <div className="text-sm text-muted-foreground mt-2 border-l-2 border-primary/40 pl-3">{v.why_it_works}</div>}
            <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
              <div className={`text-xs font-mono ${over ? "text-destructive" : "text-muted-foreground"}`}>{len}/80 chars{over ? " — exceeds Fiverr limit" : ""}</div>
              <Button size="sm" className="bg-gradient-to-r from-primary to-secondary text-primary-foreground" disabled={isBuilding} onClick={() => onBuild(v.title)}>
                {isBuilding ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Rocket className="w-3 h-3 mr-1" />}
                Build this gig
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const KeywordsView = ({ insights, copy }: any) => {
  const top = insights?.top_keywords || [];
  const expansion = insights?.keyword_expansion || [];
  if (top.length === 0 && expansion.length === 0) return <div className="surface-card rounded-lg p-8 text-center text-muted-foreground">No keyword data.</div>;
  return (
    <>
      <div className="surface-card rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-muted-foreground">Top Ranking Keywords</h3>
          <Button size="icon" variant="ghost" onClick={() => copy(top.join(", "))}><Copy className="w-4 h-4" /></Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {top.map((k: string) => <Badge key={k} variant="outline" className="font-mono bg-primary/5 border-primary/30 text-primary">{k}</Badge>)}
        </div>
      </div>
      <div className="surface-card rounded-lg p-5 border-secondary/30">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-secondary">Keyword Expansion (long-tail / lower competition)</h3>
          <Button size="icon" variant="ghost" onClick={() => copy(expansion.join(", "))}><Copy className="w-4 h-4" /></Button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">Use these as secondary keywords or to spawn additional gigs.</p>
        <div className="flex flex-wrap gap-2">
          {expansion.map((k: string) => <Badge key={k} className="bg-secondary/10 text-secondary border-secondary/30">{k}</Badge>)}
        </div>
      </div>
    </>
  );
};

const ThumbnailsView = ({ gig, copy }: any) => {
  const prompts = gig?.thumbnail_prompts || [];
  if (prompts.length === 0) return <div className="surface-card rounded-lg p-8 text-center text-muted-foreground">No thumbnail prompts yet. Re-run research to generate them.</div>;
  return (
    <div className="space-y-4">
      <div className="surface-card rounded-lg p-5 bg-primary/5 border-primary/30">
        <div className="flex items-center gap-2 mb-1">
          <ImageIcon className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-primary">Thumbnail prompts for Midjourney / Flux</h3>
        </div>
        <p className="text-sm text-muted-foreground">Paste any prompt into your image generator to produce gallery-ready Fiverr thumbnails.</p>
      </div>
      {prompts.map((p: any, i: number) => (
        <div key={i} className="surface-card rounded-lg p-5">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <span className="font-mono text-xs text-primary">#{i + 1}</span>
              <div className="font-bold mt-1">{p.style}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => copy(p.prompt)}><Copy className="w-4 h-4 mr-1" />Copy</Button>
          </div>
          <pre className="text-xs font-mono whitespace-pre-wrap bg-background/60 rounded-md p-3 mt-2 leading-relaxed">{p.prompt}</pre>
        </div>
      ))}
    </div>
  );
};

const STAGE_META: { key: string; label: string; hint: string }[] = [
  { key: "stage_1_ideas", label: "Stage 1 — Get 15 trending ideas", hint: "Paste into Gemini / Grok / ChatGPT to brainstorm latest sub-ideas." },
  { key: "stage_2_lyrics_or_script", label: "Stage 2 — Generate lyrics / script", hint: "After picking your favorite idea, use this to get the full lyrics or talking script (no audio yet)." },
  { key: "stage_3_video_scene_script", label: "Stage 3 — Second-by-second scene script", hint: "Once you've made the audio (e.g. on Suno), break it into a timed scene plan." },
  { key: "stage_4_scene_image_prompts", label: "Stage 4 — Per-scene image prompts", hint: "Get a Midjourney / Flux / Nano Banana prompt for every scene." },
  { key: "stage_5_character_prompts", label: "Stage 5 — Character lock-in prompts", hint: "Generate consistent character sheets so they look the same across every scene." },
  { key: "stage_6_final_scene_assembly", label: "Stage 6 — Google Flow / Veo video prompts", hint: "Combine your characters into final 5s text-to-video prompts per scene." },
];

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function stagePromptToPdf(filename: string, title: string, subtitle: string, body: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxW = pageW - margin * 2;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(doc.splitTextToSize(title, maxW), margin, y);
  y += 24;
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(110);
    const sub = doc.splitTextToSize(subtitle, maxW);
    doc.text(sub, margin, y);
    y += sub.length * 12 + 8;
    doc.setTextColor(0);
  }

  doc.setFont("courier", "normal");
  doc.setFontSize(10);
  const lines = doc.splitTextToSize(body, maxW);
  for (const line of lines) {
    if (y > pageH - margin) { doc.addPage(); y = margin; }
    doc.text(line, margin, y);
    y += 14;
  }
  doc.save(filename);
}

const slugify = (s: string) => (s || "concept").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

const VideoConceptsView = ({ gig, niche, copy }: any) => {
  const concepts = gig?.video_concepts || [];
  if (concepts.length === 0) {
    return (
      <div className="surface-card rounded-lg p-8 text-center text-muted-foreground">
        No video demo concepts for this niche. (Only generated for video-based gigs.)
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="surface-card rounded-lg p-5 border-primary/30 bg-primary/5">
        <div className="flex items-center gap-2 mb-1">
          <Video className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-primary">Demo video workflow for "{niche}"</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Each stage below has its own <b>Copy</b>, <b>.md</b>, and <b>.pdf</b> export so you can hand a clean file to Gemini / Suno / Google Flow at every step.
        </p>
      </div>

      {concepts.map((c: any, idx: number) => {
        const conceptSlug = slugify(c.concept_title) || `concept-${idx + 1}`;
        return (
          <div key={idx} className="surface-card rounded-lg p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="font-mono text-xs text-secondary uppercase tracking-wider">Concept #{idx + 1}{c.duration_seconds ? ` · ${c.duration_seconds}s` : ""}</div>
                <div className="font-bold text-lg mt-1">{c.concept_title}</div>
                {c.concept_summary && <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{c.concept_summary}</p>}
                {c.visual_style && <div className="text-xs mt-2"><span className="text-muted-foreground">Visual style: </span><span className="font-mono">{c.visual_style}</span></div>}
              </div>
              {Array.isArray(c.tools_suggested) && c.tools_suggested.length > 0 && (
                <div className="flex flex-wrap gap-1.5 max-w-xs justify-end">
                  {c.tools_suggested.map((t: string) => (
                    <Badge key={t} variant="outline" className="text-[10px] font-mono">{t}</Badge>
                  ))}
                </div>
              )}
            </div>

            {c.character_appearance_sheet && (
              <div className="border border-primary/30 bg-primary/5 rounded-md p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" />
                    <div>
                      <div className="font-semibold text-sm">Character Appearance Sheet (locked)</div>
                      <div className="text-xs text-muted-foreground">Every scene & video prompt below references these characters by name so they stay 100% consistent.</div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => copy(c.character_appearance_sheet)}>
                      <Copy className="w-3.5 h-3.5 mr-1" />Copy
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => downloadBlob(`${conceptSlug}-characters.md`, c.character_appearance_sheet, "text/markdown")}>
                      <FileText className="w-3.5 h-3.5 mr-1" />.md
                    </Button>
                  </div>
                </div>
                <pre className="text-xs font-mono whitespace-pre-wrap bg-background/60 rounded-md p-3 leading-relaxed">{c.character_appearance_sheet}</pre>
              </div>
            )}

            <div className="space-y-3">
              {STAGE_META.map((s) => {
                const prompt = c.stage_prompts?.[s.key];
                if (!prompt) return null;
                const fileBase = `${conceptSlug}-${s.key}`;
                const subtitle = `${c.concept_title} · ${c.duration_seconds || ""}s · ${s.label}`;
                return (
                  <div key={s.key} className="border border-border rounded-md p-3 bg-muted/10">
                    <div className="flex items-start justify-between gap-2 mb-1 flex-wrap">
                      <div>
                        <div className="font-semibold text-sm">{s.label}</div>
                        <div className="text-xs text-muted-foreground">{s.hint}</div>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => copy(prompt)}>
                          <Copy className="w-3.5 h-3.5 mr-1" />Copy
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => downloadBlob(`${fileBase}.md`, `# ${s.label}\n\n_${subtitle}_\n\n\`\`\`\n${prompt}\n\`\`\`\n`, "text/markdown")}>
                          <FileText className="w-3.5 h-3.5 mr-1" />.md
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => stagePromptToPdf(`${fileBase}.pdf`, s.label, subtitle, prompt)}>
                          <Download className="w-3.5 h-3.5 mr-1" />.pdf
                        </Button>
                      </div>
                    </div>
                    <pre className="text-xs font-mono whitespace-pre-wrap bg-background/60 rounded-md p-3 mt-2 leading-relaxed">{prompt}</pre>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const ProfileView = ({ profile, resultId, onUpdate, copy }: any) => {
  if (!profile) return null;
  const f = (label: string, key: string, multi = false) => <Field label={label} value={profile[key]} resultId={resultId} section="profile" fieldKey={key} onUpdate={onUpdate} copy={copy} multiline={multi} />;
  return (
    <>
      <ProfileStrengthCard strength={profile.profile_strength} />
      {f("Display Name", "display_name")}
      {f("Profile Title", "profile_title")}
      {profile.short_bio !== undefined && f("Short Bio (≤150 chars)", "short_bio", true)}
      {f("About / Long Bio", "about", true)}
      <div className="surface-card rounded-lg p-5">
        <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-muted-foreground mb-3">Skills & Expertise</h3>
        <div className="flex flex-wrap gap-2">
          {(profile.skills || []).map((s: string) => <Badge key={s} className="bg-primary/10 text-primary border-primary/30">{s}</Badge>)}
        </div>
      </div>
      {f("Work Experience", "work_experience")}
      {f("Education", "education")}
      {f("Certifications", "certifications")}
      {f("Languages", "languages")}
    </>
  );
};

const GigView = ({ gig, resultId, onUpdate, copy }: any) => {
  if (!gig) return null;
  const f = (label: string, key: string, multi = false) => <Field label={label} value={gig[key]} resultId={resultId} section="gig" fieldKey={key} onUpdate={onUpdate} copy={copy} multiline={multi} />;
  return (
    <>
      {gig.category && (
        <div className="surface-card rounded-lg p-5 border-primary/30">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-primary">Category & Service Type</h3>
            <Button size="icon" variant="ghost" onClick={() => copy(`${gig.category.category} > ${gig.category.subcategory} > ${gig.category.service_type}`)}><Copy className="w-4 h-4" /></Button>
          </div>
          <div className="grid sm:grid-cols-3 gap-3 text-sm">
            <div><div className="text-[10px] uppercase font-mono text-muted-foreground">Category</div><div className="font-semibold">{gig.category.category}</div></div>
            <div><div className="text-[10px] uppercase font-mono text-muted-foreground">Sub-category</div><div className="font-semibold">{gig.category.subcategory}</div></div>
            <div><div className="text-[10px] uppercase font-mono text-muted-foreground">Service type</div><div className="font-semibold">{gig.category.service_type}</div></div>
          </div>
          {gig.category.why && <div className="text-xs text-muted-foreground mt-3 border-l-2 border-primary/40 pl-3">{gig.category.why}</div>}
        </div>
      )}
      {Array.isArray(gig.gig_metadata) && gig.gig_metadata.length > 0 && (
        <div className="surface-card rounded-lg p-5">
          <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-muted-foreground mb-3">Gig Metadata (top-seller picks)</h3>
          <div className="space-y-3">
            {gig.gig_metadata.map((m: any, i: number) => (
              <div key={i} className="border-l-2 border-secondary/40 pl-3">
                <div className="font-medium text-sm">{m.field}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(m.recommended_values || []).map((v: string, j: number) => <Badge key={j} className="bg-secondary/10 text-secondary border-secondary/30 text-[11px]">{v}</Badge>)}
                </div>
                {m.why && <div className="text-xs text-muted-foreground mt-1">{m.why}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
      {f("Gig Title (≤80 chars)", "gig_title")}
      <div className="surface-card rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-muted-foreground"><Tag className="w-4 h-4 inline mr-1" />Search Tags</h3>
          <Button size="icon" variant="ghost" onClick={() => copy((gig.search_tags || []).join(", "))}><Copy className="w-4 h-4" /></Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {(gig.search_tags || []).map((t: string) => <Badge key={t} className="bg-secondary/10 text-secondary border-secondary/30">{t}</Badge>)}
        </div>
      </div>
      {f("Description (≤1200 chars)", "description", true)}
      {Array.isArray(gig.buyer_requirements) && gig.buyer_requirements.length > 0 && (
        <div className="surface-card rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-muted-foreground">Buyer Requirements (order start questions)</h3>
            <Button size="icon" variant="ghost" onClick={() => copy((gig.buyer_requirements || []).map((r: any, i: number) => `${i + 1}. ${r.question} [${r.type}${r.required ? ", required" : ""}]${r.options?.length ? ` — options: ${r.options.join(", ")}` : ""}`).join("\n"))}><Copy className="w-4 h-4" /></Button>
          </div>
          <ol className="space-y-3 text-sm">
            {gig.buyer_requirements.map((r: any, i: number) => (
              <li key={i} className="border-l-2 border-secondary/40 pl-3">
                <div className="font-medium">{i + 1}. {r.question}</div>
                <div className="text-[11px] font-mono text-muted-foreground mt-0.5">
                  {r.type}{r.required ? " · required" : " · optional"}
                </div>
                {r.options?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {r.options.map((o: string, j: number) => <Badge key={j} variant="outline" className="text-[10px] font-mono">{o}</Badge>)}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="surface-card rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-muted-foreground"><MessageSquare className="w-4 h-4 inline mr-1" />FAQs</h3>
          <RegenButton resultId={resultId} section="gig" fieldKey="faqs" onUpdate={onUpdate} />
        </div>
        <div className="space-y-3">
          {(gig.faqs || []).map((q: any, i: number) => (
            <div key={i} className="border-l-2 border-primary/40 pl-3">
              <div className="font-medium text-sm">{q.q}</div>
              <div className="text-sm text-muted-foreground mt-1">{q.a}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="surface-card rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-muted-foreground"><Package className="w-4 h-4 inline mr-1" />Pricing Packages</h3>
          <RegenButton resultId={resultId} section="gig" fieldKey="packages" onUpdate={onUpdate} />
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {["basic", "standard", "premium"].map((tier) => {
            const p = gig.packages?.[tier];
            if (!p) return null;
            return (
              <div key={tier} className={`rounded-lg p-4 border ${tier === "premium" ? "border-primary/40 bg-primary/5" : "border-border bg-muted/20"}`}>
                <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{tier}</div>
                <div className="font-bold mt-1">{p.name}</div>
                <div className="text-2xl font-bold text-gradient font-mono mt-2">{p.price}</div>
                <div className="text-xs text-muted-foreground mt-1">{p.delivery_days}d delivery · {p.revisions} revisions</div>
                <ul className="text-xs space-y-1 mt-3">
                  {(p.features || []).map((feat: string, i: number) => <li key={i} className="flex gap-2"><span className="text-primary">✓</span>{feat}</li>)}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

function buildMarkdown(project: any, result: any): string {
  const i = result.insights || {};
  const p = result.profile_optimization || {};
  const g = result.gig_optimization || {};
  const lines: string[] = [];
  lines.push(`# ${project.niche} — Fiverr Blueprint`);
  lines.push(`_Generated by RankForge · ${new Date().toLocaleString()}_\n`);
  lines.push(`## Market Intel`);
  lines.push(`- Competition: **${i.competition_level}**`);
  if (i.opportunity_score != null) lines.push(`- Opportunity score: **${i.opportunity_score}/100**`);
  if (i.opportunity_reasoning) lines.push(`- Why: ${i.opportunity_reasoning}`);
  lines.push(`- Avg starting price: **${i.average_starting_price}**`);
  if (i.average_top_orders) lines.push(`- Avg top orders: **${i.average_top_orders}**`);
  lines.push(`- Gigs analyzed: **${result.scraped_data?.count || 0}**\n`);
  if (i.key_learnings?.length) {
    lines.push(`### Key Learnings`);
    i.key_learnings.forEach((l: string, n: number) => lines.push(`${n + 1}. ${l}`));
    lines.push("");
  }
  if (i.competition_summary) lines.push(`### Summary\n${i.competition_summary}\n`);
  if (i.top_keywords?.length) lines.push(`### Top Keywords\n${i.top_keywords.map((k: string) => `\`${k}\``).join(" · ")}\n`);
  if (i.keyword_expansion?.length) lines.push(`### Keyword Expansion (long-tail)\n${i.keyword_expansion.map((k: string) => `\`${k}\``).join(" · ")}\n`);
  if (i.winning_patterns?.length) { lines.push(`### Winning Patterns`); i.winning_patterns.forEach((x: string) => lines.push(`- ${x}`)); lines.push(""); }
  if (i.top_sellers?.length) {
    lines.push(`## Top Sellers To Learn From`);
    i.top_sellers.forEach((s: any, n: number) => {
      lines.push(`### ${n + 1}. ${s.seller_name} ${s.level ? `(${s.level})` : ""}`);
      lines.push(`> "${s.gig_title}"`);
      lines.push(`- Rating: ${s.rating || "?"} · Reviews: ${s.reviews || "?"} · Price: ${s.starting_price || "?"}`);
      lines.push(`- **Why ranking:** ${s.why_ranking}`);
      lines.push(`- **Steal this:** ${s.what_to_copy}\n`);
    });
  }
  lines.push(`## Profile`);
  lines.push(`- **Display name:** ${p.display_name}`);
  lines.push(`- **Profile title:** ${p.profile_title}`);
  if (p.short_bio) lines.push(`- **Short bio (${p.short_bio.length}/150):** ${p.short_bio}`);
  if (p.profile_strength?.score != null) {
    lines.push(`- **Profile strength:** ${p.profile_strength.score}/100`);
    if (p.profile_strength.tips?.length) {
      lines.push(`  - Tips:`);
      p.profile_strength.tips.forEach((t: string) => lines.push(`    - ${t}`));
    }
  }
  lines.push(`\n**About:**\n${p.about}\n`);
  if (p.skills?.length) lines.push(`**Skills:** ${p.skills.join(", ")}\n`);
  lines.push(`## Gig`);
  lines.push(`- **Title (${(g.gig_title || "").length}/80):** ${g.gig_title}`);
  if (g.title_variations?.length) {
    lines.push(`\n### Title Variations`);
    g.title_variations.forEach((v: any, n: number) => {
      lines.push(`${n + 1}. **${v.title}** _(${v.angle})_ — ${v.why_it_works}`);
    });
    lines.push("");
  }
  if (g.search_tags?.length) lines.push(`- **Tags:** ${g.search_tags.join(", ")}`);
  lines.push(`\n**Description (${(g.description || "").length}/1200):**\n${g.description}\n`);
  if (g.faqs?.length) {
    lines.push(`### FAQs`);
    g.faqs.forEach((q: any) => lines.push(`- **Q:** ${q.q}\n  **A:** ${q.a}`));
    lines.push("");
  }
  if (g.packages) {
    lines.push(`### Packages`);
    ["basic", "standard", "premium"].forEach((t) => {
      const pk = g.packages[t]; if (!pk) return;
      lines.push(`**${t.toUpperCase()} — ${pk.name} · ${pk.price}** (${pk.delivery_days}d, ${pk.revisions} rev)`);
      (pk.features || []).forEach((f: string) => lines.push(`  - ${f}`));
    });
  }
  if (g.thumbnail_prompts?.length) {
    lines.push(`\n## Thumbnail Prompts (Midjourney / Flux)`);
    g.thumbnail_prompts.forEach((tp: any, n: number) => {
      lines.push(`\n### ${n + 1}. ${tp.style}\n\n\`\`\`\n${tp.prompt}\n\`\`\``);
    });
  }
  if (g.is_video_gig && Array.isArray(g.video_concepts) && g.video_concepts.length) {
    lines.push(`\n## Demo Video Concepts (Fiverr requires a video upload for this gig)`);
    g.video_concepts.forEach((c: any, n: number) => {
      lines.push(`\n### Concept ${n + 1}: ${c.concept_title}${c.duration_seconds ? ` (${c.duration_seconds}s)` : ""}`);
      if (c.concept_summary) lines.push(c.concept_summary);
      if (c.visual_style) lines.push(`- Visual style: ${c.visual_style}`);
      if (c.tools_suggested?.length) lines.push(`- Tools: ${c.tools_suggested.join(", ")}`);
      if (c.character_appearance_sheet) {
        lines.push(`\n**Character Appearance Sheet (locked — reuse in every scene):**\n\n${c.character_appearance_sheet}\n`);
      }
      const stages: [string, string][] = [
        ["Stage 1 — 15 trending ideas", c.stage_prompts?.stage_1_ideas],
        ["Stage 2 — Lyrics / script", c.stage_prompts?.stage_2_lyrics_or_script],
        ["Stage 3 — Scene-by-scene script", c.stage_prompts?.stage_3_video_scene_script],
        ["Stage 4 — Per-scene image prompts", c.stage_prompts?.stage_4_scene_image_prompts],
        ["Stage 5 — Character lock-in prompts", c.stage_prompts?.stage_5_character_prompts],
        ["Stage 6 — Google Flow / Veo video prompts", c.stage_prompts?.stage_6_final_scene_assembly],
      ];
      stages.forEach(([label, val]) => { if (val) lines.push(`\n**${label}:**\n\n\`\`\`\n${val}\n\`\`\``); });
    });
  }
  return lines.join("\n");
}

export default Project;
