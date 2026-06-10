import { useState } from "react";
import { Loader2, Fingerprint, Copy as CopyIcon, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const OriginalityPanel = ({ projectId, initial, onUpdate }: { projectId: string; initial: any; onUpdate: () => void }) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(initial || null);

  const run = async () => {
    setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("originality-check", { body: { projectId } });
      if (error) throw error;
      if ((res as any)?.error) throw new Error((res as any).error);
      setData((res as any).originality);
      onUpdate?.();
      toast.success("Originality check complete");
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    } finally {
      setLoading(false);
    }
  };

  const copy = (t: string) => { navigator.clipboard.writeText(t); toast.success("Copied"); };

  if (!data) {
    return (
      <div className="surface-card rounded-lg p-8 text-center space-y-4">
        <Fingerprint className="w-10 h-10 text-primary mx-auto" />
        <div>
          <h3 className="font-semibold mb-1">Originality Engine</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">Scan your gig copy against actual competitor descriptions. Find copied phrasings and get unique rewrites — reduces Fiverr suspension risk.</p>
        </div>
        <Button onClick={run} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Fingerprint className="w-4 h-4 mr-1" />}
          Run Originality Check
        </Button>
      </div>
    );
  }

  const score = data.originality_score || 0;
  const scoreColor = score >= 75 ? "text-success" : score >= 50 ? "text-warning" : "text-destructive";

  return (
    <div className="space-y-4">
      <div className="surface-card rounded-lg p-5">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div>
            <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Originality Score</div>
            <div className={`text-4xl font-bold ${scoreColor}`}>{score}<span className="text-base text-muted-foreground">/100</span></div>
          </div>
          <Button size="sm" variant="outline" onClick={run} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Re-check
          </Button>
        </div>
        <div className="flex gap-3 text-xs">
          <Badge variant="outline">Title: {data.title_originality}/100</Badge>
          <Badge variant="outline">Description: {data.description_originality}/100</Badge>
        </div>
        {data.verdict && <p className="text-sm mt-3 italic text-muted-foreground">{data.verdict}</p>}
      </div>

      {data.matched_phrases?.length > 0 && (
        <div className="surface-card rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <h3 className="font-semibold text-sm uppercase tracking-wider font-mono">Copied / Cliché Phrasings</h3>
          </div>
          <div className="space-y-3">
            {data.matched_phrases.map((m: any, i: number) => (
              <div key={i} className="border-l-2 border-warning/40 pl-3 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-mono bg-warning/10 text-warning px-2 py-0.5 rounded">"{m.phrase}"</span>
                  <Badge variant="outline" className="text-xs">{m.severity}</Badge>
                  <span className="text-xs text-muted-foreground">found in {m.found_in_competitors || 0} competitors</span>
                </div>
                {m.rewrite && (
                  <div className="flex items-start gap-2 mt-1">
                    <span className="text-xs text-success shrink-0 mt-1">→</span>
                    <span className="text-sm flex-1">{m.rewrite}</span>
                    <Button size="sm" variant="ghost" onClick={() => copy(m.rewrite)}><CopyIcon className="w-3 h-3" /></Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.cliché_flags?.length > 0 && (
        <div className="surface-card rounded-lg p-5">
          <h3 className="font-semibold text-sm uppercase tracking-wider font-mono mb-2">Cliché Flags</h3>
          <div className="flex flex-wrap gap-2">
            {data.cliché_flags.map((f: string, i: number) => (
              <Badge key={i} variant="outline" className="bg-destructive/5 text-destructive border-destructive/30">{f}</Badge>
            ))}
          </div>
        </div>
      )}

      {(data.rewrite_title_suggestion || data.rewrite_intro_suggestion) && (
        <div className="surface-card rounded-lg p-5 space-y-3">
          <h3 className="font-semibold text-sm uppercase tracking-wider font-mono">Rewrite Suggestions</h3>
          {data.rewrite_title_suggestion && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">New title</div>
              <div className="flex items-start gap-2">
                <p className="text-sm flex-1">{data.rewrite_title_suggestion}</p>
                <Button size="sm" variant="outline" onClick={() => copy(data.rewrite_title_suggestion)}><CopyIcon className="w-3 h-3" /></Button>
              </div>
            </div>
          )}
          {data.rewrite_intro_suggestion && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">New intro</div>
              <div className="flex items-start gap-2">
                <p className="text-sm flex-1 whitespace-pre-wrap">{data.rewrite_intro_suggestion}</p>
                <Button size="sm" variant="outline" onClick={() => copy(data.rewrite_intro_suggestion)}><CopyIcon className="w-3 h-3" /></Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
