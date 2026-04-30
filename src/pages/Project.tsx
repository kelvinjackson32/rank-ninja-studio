import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Copy, Loader2, Sparkles, RefreshCw, Tag, MessageSquare, Package, User, Briefcase } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";

const Project = () => {
  const { id } = useParams();
  const [project, setProject] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
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

  // Realtime subscribe to project updates
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

  if (!project) return <AppShell><div className="p-8">Loading...</div></AppShell>;

  const isRunning = project.status === "scraping" || project.status === "analyzing" || project.status === "pending";

  return (
    <AppShell>
      <div className="p-8 max-w-6xl">
        <Link to="/app" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary mb-4"><ArrowLeft className="w-4 h-4" />Dashboard</Link>
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="font-mono text-xs text-primary uppercase tracking-widest mb-1">// PROJECT</div>
            <h1 className="text-3xl font-bold tracking-tight">{project.niche}</h1>
            {project.secondary_keywords?.length > 0 && (
              <div className="flex gap-2 mt-2">
                {project.secondary_keywords.map((k: string) => <Badge key={k} variant="outline" className="font-mono">{k}</Badge>)}
              </div>
            )}
          </div>
          <Badge className={
            project.status === "complete" ? "bg-success/15 text-success border-success/30" :
            project.status === "error" ? "bg-destructive/15 text-destructive border-destructive/30" :
            "bg-primary/15 text-primary border-primary/30"
          }>{project.status}</Badge>
        </div>

        {/* Progress log */}
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
                  <span className="text-foreground/90 whitespace-pre-wrap">{entry.msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {result && (
          <Tabs defaultValue="insights">
            <TabsList className="bg-muted/40 border border-border">
              <TabsTrigger value="insights"><Sparkles className="w-4 h-4 mr-1" />Insights</TabsTrigger>
              <TabsTrigger value="profile"><User className="w-4 h-4 mr-1" />Profile</TabsTrigger>
              <TabsTrigger value="gig"><Package className="w-4 h-4 mr-1" />Gig</TabsTrigger>
            </TabsList>

            <TabsContent value="insights" className="mt-6 space-y-4">
              <InsightsView insights={result.insights} scrapedCount={result.scraped_data?.count || 0} />
            </TabsContent>

            <TabsContent value="profile" className="mt-6 space-y-4">
              <ProfileView profile={result.profile_optimization} resultId={result.id} onUpdate={load} copy={copy} />
            </TabsContent>

            <TabsContent value="gig" className="mt-6 space-y-4">
              <GigView gig={result.gig_optimization} resultId={result.id} onUpdate={load} copy={copy} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppShell>
  );
};

const InsightsView = ({ insights, scrapedCount }: any) => {
  if (!insights) return null;
  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <div className="surface-card rounded-lg p-5">
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Gigs Analyzed</div>
          <div className="text-3xl font-bold text-gradient font-mono mt-1">{scrapedCount}</div>
        </div>
        <div className="surface-card rounded-lg p-5">
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Competition</div>
          <div className="text-2xl font-bold mt-1 capitalize">{insights.competition_level}</div>
        </div>
        <div className="surface-card rounded-lg p-5">
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Avg Starting Price</div>
          <div className="text-2xl font-bold text-primary mt-1">{insights.average_starting_price}</div>
        </div>
      </div>
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

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="surface-card rounded-lg p-5">
    <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-muted-foreground mb-3">{title}</h3>
    <div className="text-sm leading-relaxed">{children}</div>
  </div>
);

const Field = ({ label, value, resultId, section, fieldKey, onUpdate, copy, multiline = false }: any) => {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div className="surface-card rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-muted-foreground">{label}</h3>
        <div className="flex gap-1">
          <RegenButton resultId={resultId} section={section} fieldKey={fieldKey} onUpdate={onUpdate} />
          <Button size="icon" variant="ghost" onClick={() => copy(text)}><Copy className="w-4 h-4" /></Button>
        </div>
      </div>
      <div className={`text-sm leading-relaxed ${multiline ? "whitespace-pre-wrap" : ""} ${typeof value === "string" ? "" : "font-mono text-xs"}`}>
        {typeof value === "string" ? value : <pre className="overflow-x-auto">{text}</pre>}
      </div>
      {typeof value === "string" && <div className="text-xs text-muted-foreground font-mono mt-2">{value.length} chars</div>}
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

const ProfileView = ({ profile, resultId, onUpdate, copy }: any) => {
  if (!profile) return null;
  const f = (label: string, key: string, multi = false) => <Field label={label} value={profile[key]} resultId={resultId} section="profile" fieldKey={key} onUpdate={onUpdate} copy={copy} multiline={multi} />;
  return (
    <>
      {f("Display Name", "display_name")}
      {f("Profile Title", "profile_title")}
      {f("About / Bio", "about", true)}
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
      {f("Gig Title", "gig_title")}
      <div className="surface-card rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm uppercase tracking-wider font-mono text-muted-foreground"><Tag className="w-4 h-4 inline mr-1" />Search Tags</h3>
          <Button size="icon" variant="ghost" onClick={() => copy((gig.search_tags || []).join(", "))}><Copy className="w-4 h-4" /></Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {(gig.search_tags || []).map((t: string) => <Badge key={t} className="bg-secondary/10 text-secondary border-secondary/30">{t}</Badge>)}
        </div>
      </div>
      {f("Description", "description", true)}
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

export default Project;
