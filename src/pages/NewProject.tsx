import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Rocket, Plus, X, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

const MAX_BULK = 5;

const NewProject = () => {
  const { user } = useAuth();
  const nav = useNavigate();
  const [bulk, setBulk] = useState(false);
  const [niche, setNiche] = useState("");
  const [secondary, setSecondary] = useState<string[]>([""]);
  const [bulkNiches, setBulkNiches] = useState<string[]>(["", ""]);
  const [loading, setLoading] = useState(false);

  const launchResearch = async (projectId: string) => {
    const { error } = await supabase.functions.invoke("run-research", { body: { projectId } });
    if (error) {
      await supabase.from("projects").update({
        status: "error",
        progress_log: [{ ts: new Date().toISOString(), msg: `❌ Research failed to start: ${error.message}` }],
      }).eq("id", projectId);
      throw error;
    }
  };

  const launch = async () => {
    setLoading(true);
    try {
      const { data: keys } = await supabase.from("api_keys").select("id").limit(1);
      if (!keys || keys.length === 0) {
        toast.error("Add an Apify API key first in Settings");
        nav("/app/settings"); return;
      }

      if (bulk) {
        const niches = bulkNiches.map(n => n.trim()).filter(Boolean).slice(0, MAX_BULK);
        if (niches.length < 2) { toast.error("Enter at least 2 niches for bulk mode"); return; }
        const groupId = crypto.randomUUID();
        const inserts = niches.map(n => ({ user_id: user!.id, niche: n, secondary_keywords: [], status: "pending", bulk_group_id: groupId }));
        const { data: created, error } = await supabase.from("projects").insert(inserts).select();
        if (error) throw error;
        const launched = await Promise.allSettled((created || []).map((p: any) => launchResearch(p.id)));
        const failed = launched.filter((r) => r.status === "rejected").length;
        if (failed) toast.error(`${failed} research job${failed > 1 ? "s" : ""} failed to start`);
        else toast.success(`Launched ${niches.length} niches in parallel`);
        nav(`/app/compare/${groupId}`);
        return;
      }

      if (!niche.trim()) { toast.error("Enter your main niche"); return; }
      const sec = secondary.map(s => s.trim()).filter(Boolean).slice(0, 2);
      const { data: project, error } = await supabase.from("projects").insert({
        user_id: user!.id, niche: niche.trim(), secondary_keywords: sec, status: "pending",
      }).select().single();
      if (error) throw error;
      await launchResearch(project.id);
      toast.success("Research launched!");
      nav(`/app/projects/${project.id}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally { setLoading(false); }
  };

  return (
    <AppShell>
      <div className="p-4 md:p-8 max-w-3xl">
        <div className="mb-8">
          <div className="font-mono text-xs text-primary uppercase tracking-widest mb-1">// NEW MISSION</div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Start Deep Research</h1>
          <p className="text-muted-foreground text-sm mt-1">Pages 1–3 scraped. Top Rated, Fiverr's Choice & high-queue gigs prioritized.</p>
        </div>

        <div className="surface-card rounded-xl p-6 space-y-6 scan-line">
          <div className="flex items-center justify-between border border-border rounded-lg p-3 bg-muted/20">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              <div>
                <div className="text-sm font-semibold">Bulk Research Mode</div>
                <div className="text-xs text-muted-foreground">Compare up to {MAX_BULK} niches side-by-side</div>
              </div>
            </div>
            <Switch checked={bulk} onCheckedChange={setBulk} />
          </div>

          {!bulk && (
            <>
              <div>
                <Label className="font-mono text-xs uppercase tracking-wider">Main Niche / Service Keyword</Label>
                <Input
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  placeholder="e.g. YouTube thumbnail design"
                  className="mt-1.5 text-lg h-12 font-mono bg-input/50"
                  maxLength={120}
                />
              </div>
              <div>
                <Label className="font-mono text-xs uppercase tracking-wider">Secondary Keywords <span className="text-muted-foreground normal-case">(optional, max 2)</span></Label>
                <div className="space-y-2 mt-1.5">
                  {secondary.map((s, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={s}
                        onChange={(e) => setSecondary(secondary.map((v, j) => i === j ? e.target.value : v))}
                        placeholder={i === 0 ? "e.g. gaming thumbnail" : "e.g. minimalist thumbnail"}
                        className="font-mono bg-input/50"
                        maxLength={80}
                      />
                      {secondary.length > 1 && (
                        <Button variant="ghost" size="icon" onClick={() => setSecondary(secondary.filter((_, j) => j !== i))}>
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {secondary.length < 2 && (
                    <Button variant="ghost" size="sm" onClick={() => setSecondary([...secondary, ""])}>
                      <Plus className="w-4 h-4 mr-1" />Add another
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}

          {bulk && (
            <div>
              <Label className="font-mono text-xs uppercase tracking-wider">Niches to Compare (2-{MAX_BULK})</Label>
              <div className="space-y-2 mt-1.5">
                {bulkNiches.map((n, i) => (
                  <div key={i} className="flex gap-2">
                    <div className="font-mono text-xs text-muted-foreground w-6 self-center">{String(i + 1).padStart(2, "0")}</div>
                    <Input
                      value={n}
                      onChange={(e) => setBulkNiches(bulkNiches.map((v, j) => i === j ? e.target.value : v))}
                      placeholder={`e.g. ${["AI music video", "logo design", "voiceover", "video editing", "thumbnail design"][i] || "niche"}`}
                      className="font-mono bg-input/50"
                      maxLength={120}
                    />
                    {bulkNiches.length > 2 && (
                      <Button variant="ghost" size="icon" onClick={() => setBulkNiches(bulkNiches.filter((_, j) => j !== i))}>
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {bulkNiches.length < MAX_BULK && (
                  <Button variant="ghost" size="sm" onClick={() => setBulkNiches([...bulkNiches, ""])}>
                    <Plus className="w-4 h-4 mr-1" />Add niche
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-3">Each niche runs a full deep research in parallel. You'll land on a comparison table to pick the winner.</p>
            </div>
          )}

          <Button onClick={launch} disabled={loading} size="lg" className="w-full h-14 text-base bg-gradient-to-r from-primary to-secondary text-primary-foreground hover:opacity-90 animate-pulse-glow">
            <Rocket className="w-5 h-5 mr-2" />
            {loading ? "Launching..." : bulk ? "Launch Bulk Research & Compare" : "Start Deep Research & Generate Everything"}
          </Button>
        </div>
      </div>
    </AppShell>
  );
};

export default NewProject;
