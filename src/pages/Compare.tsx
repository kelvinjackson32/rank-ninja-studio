import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Trophy, ExternalLink, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Row = {
  project: any;
  insights: any | null;
};

const Compare = () => {
  const { groupId } = useParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data: projects } = await supabase
      .from("projects").select("*").eq("bulk_group_id", groupId)
      .order("created_at", { ascending: true });
    const list: Row[] = [];
    for (const p of projects || []) {
      let insights: any = null;
      if (p.status === "complete") {
        const { data: r } = await supabase.from("research_results").select("insights").eq("project_id", p.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        insights = r?.insights || null;
      }
      list.push({ project: p, insights });
    }
    setRows(list);
    setLoading(false);
  };

  useEffect(() => { if (groupId) load(); }, [groupId]);

  useEffect(() => {
    if (!groupId) return;
    const ch = supabase.channel(`compare-${groupId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "projects", filter: `bulk_group_id=eq.${groupId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [groupId]);

  const best = [...rows]
    .filter(r => r.insights?.opportunity_score != null)
    .sort((a, b) => (b.insights.opportunity_score || 0) - (a.insights.opportunity_score || 0))[0];

  return (
    <AppShell>
      <div className="p-4 md:p-8 max-w-6xl">
        <Link to="/app" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary mb-4"><ArrowLeft className="w-4 h-4" />Dashboard</Link>
        <div className="mb-6">
          <div className="font-mono text-xs text-primary uppercase tracking-widest mb-1">// BULK COMPARISON</div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Niche Comparison</h1>
          <p className="text-muted-foreground text-sm mt-1">Side-by-side opportunity analysis across {rows.length} niches.</p>
        </div>

        {best && (
          <div className="surface-card rounded-lg p-5 mb-6 border-primary/30 bg-primary/5 flex items-start gap-3">
            <Trophy className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <div className="font-mono text-xs uppercase tracking-widest text-primary mb-1">Recommended pick</div>
              <div className="font-bold">{best.project.niche}</div>
              <div className="text-sm text-muted-foreground mt-1">Opportunity score {best.insights.opportunity_score}/100 — {best.insights.opportunity_reasoning}</div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
        ) : (
          <div className="surface-card rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Niche</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Opportunity</TableHead>
                  <TableHead>Competition</TableHead>
                  <TableHead>Avg Price</TableHead>
                  <TableHead>Avg Top Orders</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ project, insights }) => {
                  const score = insights?.opportunity_score;
                  const scoreColor = score == null ? "text-muted-foreground" : score >= 70 ? "text-success" : score >= 50 ? "text-warning" : "text-destructive";
                  return (
                    <TableRow key={project.id}>
                      <TableCell className="font-medium">{project.niche}</TableCell>
                      <TableCell><Badge variant="outline" className="font-mono text-xs">{project.status}</Badge></TableCell>
                      <TableCell className={`font-mono font-bold ${scoreColor}`}>{score != null ? `${score}/100` : "—"}</TableCell>
                      <TableCell className="capitalize">{insights?.competition_level || "—"}</TableCell>
                      <TableCell className="font-mono">{insights?.average_starting_price || "—"}</TableCell>
                      <TableCell className="text-sm">{insights?.average_top_orders || "—"}</TableCell>
                      <TableCell>
                        <Link to={`/app/projects/${project.id}`} className="text-primary hover:underline inline-flex items-center gap-1 text-sm">
                          Open <ExternalLink className="w-3 h-3" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default Compare;
