import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Radar, Loader2, CheckCircle2, AlertCircle, Clock, Key } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/AppShell";

type Project = { id: string; niche: string; status: string; created_at: string; secondary_keywords: string[] };

const statusIcon = (s: string) => {
  if (s === "complete") return <CheckCircle2 className="w-4 h-4 text-success" />;
  if (s === "error") return <AlertCircle className="w-4 h-4 text-destructive" />;
  if (s === "pending") return <Clock className="w-4 h-4 text-muted-foreground" />;
  return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
};

const Dashboard = () => {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [keyCount, setKeyCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    supabase.from("projects").select("*").order("created_at", { ascending: false }).limit(20).then(({ data }) => setProjects((data as Project[]) || []));
    supabase.from("api_keys").select("id", { count: "exact", head: true }).then(({ count }) => setKeyCount(count || 0));
  }, [user]);

  const showOnboarding = projects.length === 0;

  return (
    <AppShell>
      <div className="p-4 md:p-8 max-w-6xl">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-8">
          <div>
            <div className="font-mono text-xs text-primary uppercase tracking-widest mb-1">// COMMAND CENTER</div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard</h1>
          </div>
          <Button asChild className="bg-gradient-to-r from-primary to-secondary text-primary-foreground hover:opacity-90">
            <Link to="/app/new"><Plus className="w-4 h-4 mr-1" />New Research</Link>
          </Button>
        </div>

        {keyCount === 0 && (
          <div className="surface-card border-warning/40 bg-warning/5 rounded-lg p-4 mb-6 flex items-center gap-3">
            <Key className="w-5 h-5 text-warning" />
            <div className="flex-1">
              <div className="font-medium text-sm">No Apify API keys configured</div>
              <div className="text-xs text-muted-foreground">Add at least one key to start scraping Fiverr.</div>
            </div>
            <Button asChild variant="outline" size="sm"><Link to="/app/settings">Add keys</Link></Button>
          </div>
        )}

        {showOnboarding && keyCount > 0 && (
          <div className="surface-card border-primary/30 bg-primary/5 rounded-xl p-5 mb-6">
            <div className="font-mono text-xs uppercase tracking-widest text-primary mb-2">// GET STARTED IN 3 STEPS</div>
            <ol className="grid md:grid-cols-3 gap-4 text-sm">
              <li className="flex gap-3"><span className="font-mono text-primary">01</span><div><div className="font-semibold">Pick a niche</div><div className="text-muted-foreground text-xs">e.g. "AI music video"</div></div></li>
              <li className="flex gap-3"><span className="font-mono text-primary">02</span><div><div className="font-semibold">Run research</div><div className="text-muted-foreground text-xs">We scrape & analyze top sellers</div></div></li>
              <li className="flex gap-3"><span className="font-mono text-primary">03</span><div><div className="font-semibold">Copy to Fiverr</div><div className="text-muted-foreground text-xs">Title, tags, bio, packages — done</div></div></li>
            </ol>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 md:gap-4 mb-8">
          {[
            { label: "Projects", value: projects.length },
            { label: "Active Keys", value: keyCount },
            { label: "Completed", value: projects.filter(p => p.status === "complete").length },
          ].map((s) => (
            <div key={s.label} className="surface-card rounded-lg p-4 md:p-5">
              <div className="text-2xl md:text-3xl font-bold font-mono text-gradient">{s.value}</div>
              <div className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="surface-card rounded-xl overflow-hidden">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold">Recent Projects</h2>
          </div>
          {projects.length === 0 ? (
            <div className="p-12 text-center">
              <Radar className="w-10 h-10 text-muted-foreground/50 mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">No research projects yet.</p>
              <Button asChild className="bg-gradient-to-r from-primary to-secondary text-primary-foreground"><Link to="/app/new">Start your first analysis</Link></Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {projects.map((p) => (
                <Link key={p.id} to={`/app/projects/${p.id}`} className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors">
                  {statusIcon(p.status)}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.niche}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {new Date(p.created_at).toLocaleString()} · {p.status}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
};

export default Dashboard;
