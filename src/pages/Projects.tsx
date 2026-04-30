import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Loader2, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

const statusIcon = (s: string) => {
  if (s === "complete") return <CheckCircle2 className="w-4 h-4 text-success" />;
  if (s === "error") return <AlertCircle className="w-4 h-4 text-destructive" />;
  if (s === "pending") return <Clock className="w-4 h-4 text-muted-foreground" />;
  return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
};

const Projects = () => {
  const [projects, setProjects] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("projects").select("*").order("created_at", { ascending: false }).then(({ data }) => setProjects(data || []));
  }, []);
  return (
    <AppShell>
      <div className="p-8 max-w-6xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="font-mono text-xs text-primary uppercase tracking-widest mb-1">// ARCHIVE</div>
            <h1 className="text-3xl font-bold tracking-tight">All Projects</h1>
          </div>
          <Button asChild className="bg-gradient-to-r from-primary to-secondary text-primary-foreground"><Link to="/app/new"><Plus className="w-4 h-4 mr-1" />New</Link></Button>
        </div>
        <div className="surface-card rounded-xl divide-y divide-border">
          {projects.length === 0 && <div className="p-12 text-center text-muted-foreground">No projects yet</div>}
          {projects.map((p) => (
            <Link key={p.id} to={`/app/projects/${p.id}`} className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors">
              {statusIcon(p.status)}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{p.niche}</div>
                <div className="text-xs text-muted-foreground font-mono">{new Date(p.created_at).toLocaleString()} · {p.status}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
};

export default Projects;
