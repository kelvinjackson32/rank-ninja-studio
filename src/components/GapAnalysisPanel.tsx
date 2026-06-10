import { useState } from "react";
import { Loader2, Target, TrendingUp, AlertTriangle, Lightbulb, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const GapAnalysisPanel = ({ projectId, initial, onUpdate }: { projectId: string; initial: any; onUpdate: () => void }) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(initial || null);

  const run = async () => {
    setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("analyze-gaps", { body: { projectId } });
      if (error) throw error;
      if ((res as any)?.error) throw new Error((res as any).error);
      setData((res as any).gap_analysis);
      onUpdate?.();
      toast.success("Gap analysis complete");
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  };

  if (!data) {
    return (
      <div className="surface-card rounded-lg p-8 text-center space-y-4">
        <Target className="w-10 h-10 text-primary mx-auto" />
        <div>
          <h3 className="font-semibold mb-1">Competitor Gap Analysis</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">Compare your gig against the top sellers to find features they don't offer, untapped angles, and pricing gaps.</p>
        </div>
        <Button onClick={run} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Target className="w-4 h-4 mr-1" />}
          Run Gap Analysis
        </Button>
      </div>
    );
  }

  const score = data.differentiation_score || 0;
  const scoreColor = score >= 70 ? "text-success" : score >= 40 ? "text-warning" : "text-destructive";

  return (
    <div className="space-y-4">
      <div className="surface-card rounded-lg p-5 flex items-center justify-between gap-4">
        <div>
          <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Differentiation Score</div>
          <div className={`text-4xl font-bold ${scoreColor}`}>{score}<span className="text-base text-muted-foreground">/100</span></div>
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Re-analyze
        </Button>
      </div>

      {data.top_recommendations?.length > 0 && (
        <Section icon={<Lightbulb className="w-4 h-4 text-primary" />} title="Top Recommendations">
          <ul className="space-y-2">
            {data.top_recommendations.map((r: string, i: number) => (
              <li key={i} className="flex gap-2 text-sm"><span className="text-primary font-mono shrink-0">{String(i+1).padStart(2,'0')}</span>{r}</li>
            ))}
          </ul>
        </Section>
      )}

      {data.missing_features?.length > 0 && (
        <Section icon={<TrendingUp className="w-4 h-4 text-success" />} title="Missing Features (opportunities)">
          <div className="space-y-3">
            {data.missing_features.map((m: any, i: number) => (
              <div key={i} className="border-l-2 border-success/40 pl-3">
                <div className="font-semibold text-sm">{m.feature}</div>
                <div className="text-xs text-muted-foreground mt-1">{m.why_it_matters}</div>
                <Badge variant="outline" className="mt-1 text-xs">{m.how_many_competitors_offer_it || 0} competitors offer this</Badge>
              </div>
            ))}
          </div>
        </Section>
      )}

      {data.untapped_angles?.length > 0 && (
        <Section icon={<Lightbulb className="w-4 h-4 text-primary" />} title="Untapped Angles">
          <div className="space-y-3">
            {data.untapped_angles.map((a: any, i: number) => (
              <div key={i} className="border-l-2 border-primary/40 pl-3">
                <div className="font-semibold text-sm">{a.angle}</div>
                <div className="text-xs text-muted-foreground mt-1">{a.evidence}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {data.overcrowded_features?.length > 0 && (
        <Section icon={<AlertTriangle className="w-4 h-4 text-warning" />} title="Overcrowded — don't lead with these">
          <ul className="space-y-1 text-sm">
            {data.overcrowded_features.map((o: any, i: number) => (
              <li key={i}><span className="font-semibold">{o.feature}</span> — <span className="text-muted-foreground">{o.note}</span></li>
            ))}
          </ul>
        </Section>
      )}

      {data.price_gap && (
        <Section icon={<DollarSign className="w-4 h-4 text-primary" />} title="Pricing Gap">
          <div className="flex gap-4 text-sm mb-2">
            <div><span className="text-muted-foreground">Competitor avg:</span> <span className="font-bold">${data.price_gap.competitor_avg}</span></div>
            <div><span className="text-muted-foreground">Your starting:</span> <span className="font-bold">${data.price_gap.your_starting}</span></div>
          </div>
          <p className="text-sm">{data.price_gap.recommendation}</p>
        </Section>
      )}
    </div>
  );
};

const Section = ({ icon, title, children }: any) => (
  <div className="surface-card rounded-lg p-5">
    <div className="flex items-center gap-2 mb-3">
      {icon}
      <h3 className="font-semibold text-sm uppercase tracking-wider font-mono">{title}</h3>
    </div>
    {children}
  </div>
);
