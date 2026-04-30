import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Rocket, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const NewProject = () => {
  const { user } = useAuth();
  const nav = useNavigate();
  const [niche, setNiche] = useState("");
  const [secondary, setSecondary] = useState<string[]>([""]);
  const [loading, setLoading] = useState(false);

  const launch = async () => {
    if (!niche.trim()) { toast.error("Enter your main niche"); return; }
    setLoading(true);
    try {
      const { data: keys } = await supabase.from("api_keys").select("id").limit(1);
      if (!keys || keys.length === 0) { toast.error("Add an Apify API key first in Settings"); nav("/app/settings"); return; }

      const sec = secondary.map(s => s.trim()).filter(Boolean).slice(0, 2);
      const { data: project, error } = await supabase.from("projects").insert({
        user_id: user!.id, niche: niche.trim(), secondary_keywords: sec, status: "pending",
      }).select().single();
      if (error) throw error;

      // Fire and forget — research runs in background
      supabase.functions.invoke("run-research", { body: { projectId: project.id } }).catch(console.error);
      toast.success("Research launched!");
      nav(`/app/projects/${project.id}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally { setLoading(false); }
  };

  return (
    <AppShell>
      <div className="p-8 max-w-3xl">
        <div className="mb-8">
          <div className="font-mono text-xs text-primary uppercase tracking-widest mb-1">// NEW MISSION</div>
          <h1 className="text-3xl font-bold tracking-tight">Start Deep Research</h1>
          <p className="text-muted-foreground text-sm mt-1">RankForge will scrape Pages 1–3 of Fiverr, analyze top performers, and generate your blueprint.</p>
        </div>

        <div className="surface-card rounded-xl p-6 space-y-6 scan-line">
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

          <Button onClick={launch} disabled={loading} size="lg" className="w-full h-14 text-base bg-gradient-to-r from-primary to-secondary text-primary-foreground hover:opacity-90 animate-pulse-glow">
            <Rocket className="w-5 h-5 mr-2" />
            {loading ? "Launching..." : "Start Deep Research & Generate Everything"}
          </Button>
        </div>
      </div>
    </AppShell>
  );
};

export default NewProject;
