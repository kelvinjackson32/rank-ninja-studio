import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Stethoscope, Loader2, AlertTriangle, CheckCircle2, Wrench, Copy, Sparkles } from "lucide-react";

type Issue = { area: string; severity: string; problem: string; why_it_hurts: string; fix: string };
type Audit = {
  overall_score: number;
  verdict: string;
  strengths: string[];
  critical_issues: Issue[];
  rewrites: any;
  action_plan: { step: number; action: string; expected_impact: string; time_to_apply: string }[];
  image_prompts: { slot: string; prompt: string }[];
};

const sevColor = (s: string) =>
  s === "high" ? "bg-destructive/15 text-destructive border-destructive/30" :
  s === "medium" ? "bg-warning/15 text-warning border-warning/30" :
  "bg-muted text-muted-foreground border-border";

const copy = (v: any) => {
  navigator.clipboard.writeText(typeof v === "string" ? v : JSON.stringify(v, null, 2));
  toast({ title: "Copied" });
};

const Audit = () => {
  const [profileUrl, setProfileUrl] = useState("");
  const [gigUrl, setGigUrl] = useState("");
  const [niche, setNiche] = useState("");
  const [issue, setIssue] = useState("");
  const [loading, setLoading] = useState(false);
  const [audit, setAudit] = useState<Audit | null>(null);

  const run = async () => {
    if (!profileUrl && !gigUrl) {
      toast({ title: "Add a Fiverr URL", description: "Paste your profile and/or gig URL.", variant: "destructive" });
      return;
    }
    setLoading(true);
    setAudit(null);
    try {
      const { data, error } = await supabase.functions.invoke("audit-account", {
        body: { profileUrl, gigUrl, niche, issue },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setAudit(data.audit);
      toast({ title: "Audit complete", description: `Score: ${data.audit?.overall_score ?? "?"} / 100` });
    } catch (e: any) {
      toast({ title: "Audit failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <div className="p-4 md:p-8 max-w-5xl mx-auto">
        <div className="mb-6">
          <div className="font-mono text-xs text-primary uppercase tracking-widest mb-1">// ACCOUNT DOCTOR</div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Stethoscope className="w-7 h-7 text-primary" /> Fiverr Account Audit
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Paste your Fiverr profile or gig URL. We'll scrape it, compare it against top sellers, and tell you exactly what to fix to get impressions, clicks, and orders.
          </p>
        </div>

        <Card className="mb-6 border-primary/30">
          <CardHeader>
            <CardTitle className="text-lg">Account details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs font-mono uppercase text-muted-foreground">Profile URL</label>
              <Input placeholder="https://www.fiverr.com/yourusername" value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-mono uppercase text-muted-foreground">Gig URL</label>
              <Input placeholder="https://www.fiverr.com/yourusername/gig-slug" value={gigUrl} onChange={(e) => setGigUrl(e.target.value)} />
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Niche / Service (optional)</label>
                <Input placeholder="e.g. AI faceless YouTube shorts" value={niche} onChange={(e) => setNiche(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">What's the problem?</label>
                <Input placeholder="Low impressions, no orders…" value={issue} onChange={(e) => setIssue(e.target.value)} />
              </div>
            </div>
            <Button onClick={run} disabled={loading} className="w-full bg-gradient-to-r from-primary to-secondary text-primary-foreground">
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Auditing…</> : <><Sparkles className="w-4 h-4 mr-2" /> Run Audit & Fix</>}
            </Button>
          </CardContent>
        </Card>

        {audit && (
          <div className="space-y-5">
            {/* Score */}
            <Card className="border-primary/40 bg-gradient-to-br from-primary/5 to-secondary/5">
              <CardContent className="p-6 flex flex-col md:flex-row gap-6 items-start md:items-center">
                <div className="text-center">
                  <div className={`text-5xl font-bold font-mono ${audit.overall_score >= 70 ? "text-success" : audit.overall_score >= 40 ? "text-warning" : "text-destructive"}`}>
                    {audit.overall_score}
                  </div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground mt-1">/ 100</div>
                </div>
                <div className="flex-1">
                  <div className="font-mono text-xs uppercase text-primary mb-1">// DIAGNOSIS</div>
                  <p className="text-base">{audit.verdict}</p>
                </div>
              </CardContent>
            </Card>

            {/* Issues */}
            {audit.critical_issues?.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-lg flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-warning" /> What's hurting your account</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {audit.critical_issues.map((it, i) => (
                    <div key={i} className="border border-border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className={sevColor(it.severity)}>{it.severity}</Badge>
                        <span className="font-semibold">{it.area}</span>
                      </div>
                      <div className="text-sm text-foreground mb-1"><span className="text-muted-foreground">Problem:</span> {it.problem}</div>
                      <div className="text-sm text-muted-foreground mb-2">Why it hurts: {it.why_it_hurts}</div>
                      <div className="text-sm flex items-start gap-2"><Wrench className="w-4 h-4 text-primary mt-0.5 shrink-0" /><span><span className="font-medium">Fix:</span> {it.fix}</span></div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Action plan */}
            {audit.action_plan?.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-lg flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-success" /> Step-by-step fix plan</CardTitle></CardHeader>
                <CardContent>
                  <ol className="space-y-3">
                    {audit.action_plan.map((s) => (
                      <li key={s.step} className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 text-primary font-mono font-bold flex items-center justify-center shrink-0">{s.step}</div>
                        <div>
                          <div className="font-medium">{s.action}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">Impact: {s.expected_impact} · Time: {s.time_to_apply}</div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            )}

            {/* Rewrites */}
            {audit.rewrites && (
              <Card>
                <CardHeader><CardTitle className="text-lg">Copy-paste rewrites</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {Object.entries(audit.rewrites).map(([key, val]: [string, any]) => (
                    <div key={key} className="border border-border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-semibold capitalize">{key.replace(/_/g, " ")}</div>
                        <Button variant="ghost" size="sm" onClick={() => copy(val.improved ?? val)}><Copy className="w-3.5 h-3.5 mr-1" />Copy</Button>
                      </div>
                      {val.current && (
                        <div className="text-xs text-muted-foreground mb-2">
                          <span className="font-mono">CURRENT:</span> {Array.isArray(val.current) ? val.current.join(", ") : val.current}
                        </div>
                      )}
                      <pre className="text-sm whitespace-pre-wrap bg-muted/30 p-3 rounded font-sans">
                        {typeof val.improved === "string" ? val.improved : JSON.stringify(val.improved, null, 2)}
                      </pre>
                      {val.reason && <div className="text-xs text-muted-foreground mt-2">💡 {val.reason}</div>}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Image prompts */}
            {audit.image_prompts?.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-lg">New thumbnail prompts</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {audit.image_prompts.map((ip, i) => (
                    <div key={i} className="border border-border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="font-semibold text-sm">{ip.slot}</div>
                        <Button variant="ghost" size="sm" onClick={() => copy(ip.prompt)}><Copy className="w-3.5 h-3.5 mr-1" />Copy</Button>
                      </div>
                      <p className="text-sm text-muted-foreground">{ip.prompt}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {audit.strengths?.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-lg">What you're doing right</CardTitle></CardHeader>
                <CardContent>
                  <ul className="space-y-1 text-sm">
                    {audit.strengths.map((s, i) => <li key={i} className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />{s}</li>)}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default Audit;
