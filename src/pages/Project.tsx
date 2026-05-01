import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Copy, Loader2, Sparkles, RefreshCw, Tag, MessageSquare, Package, User, Download, Trophy, Lightbulb, Star, RotateCw, Image as ImageIcon, Type, Search, Gauge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";

// Fiverr platform limits used for warnings
const LIMITS: Record<string, number> = {
  gig_title: 80,
  description: 1200,
  short_bio: 150,
  profile_title: 70,
};

const Project = () => {
  const { id } = useParams();
  const [project, setProject] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [rerunning, setRerunning] = useState(false);
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

  const rerun = async () => {
    setRerunning(true);
    try {
      const { error } = await supabase.functions.invoke("run-research", { body: { projectId: id } });
      if (error) throw error;
      toast.success("Research re-launched");
      load();
    } catch (e: any) { toast.error(e.message); } finally { setRerunning(false); }
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

  if (!project) return <AppShell><div className="p-8">Loading...</div></AppShell>;

  const isRunning = project.status === "scraping" || project.status === "analyzing" || project.status === "pending";
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
          <Tabs defaultValue="insights">
            <TabsList className="bg-muted/40 border border-border flex-wrap h-auto">
              <TabsTrigger value="insights"><Sparkles className="w-4 h-4 mr-1" />Insights</TabsTrigger>
              <TabsTrigger value="sellers"><Trophy className="w-4 h-4 mr-1" />Top Sellers</TabsTrigger>
              <TabsTrigger value="titles"><Type className="w-4 h-4 mr-1" />Titles</TabsTrigger>
              <TabsTrigger value="keywords"><Search className="w-4 h-4 mr-1" />Keywords</TabsTrigger>
              <TabsTrigger value="profile"><User className="w-4 h-4 mr-1" />Profile</TabsTrigger>
              <TabsTrigger value="gig"><Package className="w-4 h-4 mr-1" />Gig</TabsTrigger>
              <TabsTrigger value="thumbnails"><ImageIcon className="w-4 h-4 mr-1" />Thumbnails</TabsTrigger>
            </TabsList>

            <TabsContent value="insights" className="mt-6 space-y-4">
              <InsightsView insights={result.insights} scrapedCount={result.scraped_data?.count || 0} />
            </TabsContent>

            <TabsContent value="sellers" className="mt-6 space-y-4">
              <TopSellersView insights={result.insights} />
            </TabsContent>

            <TabsContent value="titles" className="mt-6 space-y-4">
              <TitleVariationsView gig={result.gig_optimization} copy={copy} />
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
          </Tabs>
        )}
      </div>
    </AppShell>
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

const TitleVariationsView = ({ gig, copy }: any) => {
  const variations = gig?.title_variations || [];
  if (variations.length === 0) return <div className="surface-card rounded-lg p-8 text-center text-muted-foreground">No title variations yet. Re-run research to generate them.</div>;
  return (
    <div className="space-y-3">
      <div className="surface-card rounded-lg p-5 bg-primary/5 border-primary/30">
        <div className="flex items-center gap-2 mb-1">
          <Type className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-primary">{variations.length} competitive title angles</h3>
        </div>
        <p className="text-sm text-muted-foreground">Each one models a real winning pattern from your scraped top sellers. Pick the angle that fits your style.</p>
      </div>
      {variations.map((v: any, i: number) => {
        const len = (v.title || "").length;
        const over = len > 80;
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
            <div className={`text-xs font-mono mt-2 ${over ? "text-destructive" : "text-muted-foreground"}`}>{len}/80 chars{over ? " — exceeds Fiverr limit" : ""}</div>
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
  lines.push(`\n**About:**\n${p.about}\n`);
  if (p.skills?.length) lines.push(`**Skills:** ${p.skills.join(", ")}\n`);
  lines.push(`## Gig`);
  lines.push(`- **Title (${(g.gig_title || "").length}/80):** ${g.gig_title}`);
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
  return lines.join("\n");
}

export default Project;
