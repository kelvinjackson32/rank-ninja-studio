import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Rocket, Plus, X, Layers, Search, Tag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

const MAX_BULK = 5;

const DURATIONS = [15, 30, 60];

const NewProject = () => {
  const { user } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<"niche" | "title" | "bulk">("niche");
  const bulk = mode === "bulk";
  const [gigTitle, setGigTitle] = useState("");
  const [niche, setNiche] = useState("");
  const [secondary, setSecondary] = useState<string[]>([""]);
  const [bulkNiches, setBulkNiches] = useState<string[]>(["", ""]);
  const [loading, setLoading] = useState(false);
  const [targetDuration, setTargetDuration] = useState<number>(30);
  const [characterLock, setCharacterLock] = useState<boolean>(true);

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
      if (bulk) {
        const niches = bulkNiches.map(n => n.trim()).filter(Boolean).slice(0, MAX_BULK);
        if (niches.length < 2) { toast.error("Enter at least 2 niches for bulk mode"); return; }
        const groupId = crypto.randomUUID();
        const inserts = niches.map(n => ({ user_id: user!.id, niche: n, secondary_keywords: [], status: "pending", bulk_group_id: groupId, target_duration_seconds: targetDuration, character_lock: characterLock }));
        const { data: created, error } = await supabase.from("projects").insert(inserts).select();
        if (error) throw error;
        const launched = await Promise.allSettled((created || []).map((p: any) => launchResearch(p.id)));
        const failed = launched.filter((r) => r.status === "rejected").length;
        if (failed) toast.error(`${failed} research job${failed > 1 ? "s" : ""} failed to start`);
        else toast.success(`Launched ${niches.length} niches in parallel`);
        nav(`/app/compare/${groupId}`);
        return;
      }

      if (mode === "title") {
        const title = gigTitle.trim().slice(0, 80);
        if (title.length < 10) { toast.error("Paste your full gig title (at least 10 characters)"); return; }
        const derivedNiche = title.replace(/^i\s+will\s+/i, "").replace(/\s+for\s+.*$/i, "").trim().slice(0, 120) || title;
        const { data: p, error: e1 } = await supabase.from("projects").insert({
          user_id: user!.id, niche: derivedNiche, provided_gig_title: title, secondary_keywords: [], status: "pending",
          target_duration_seconds: targetDuration, character_lock: characterLock,
        } as any).select().single();
        if (e1) throw e1;
        await launchResearch(p.id);
        toast.success("Researching setup for your existing gig title!");
        nav(`/app/projects/${p.id}`);
        return;
      }

      if (!niche.trim()) { toast.error("Enter your main niche"); return; }
      const sec = secondary.map(s => s.trim()).filter(Boolean).slice(0, 2);
      const { data: project, error } = await supabase.from("projects").insert({
        user_id: user!.id, niche: niche.trim(), secondary_keywords: sec, status: "pending",
        target_duration_seconds: targetDuration, character_lock: characterLock,
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
          <div>
            <Label className="font-mono text-xs uppercase tracking-wider">How do you want to start?</Label>
            <div className="grid sm:grid-cols-3 gap-2 mt-2">
              {([
                { key: "niche", icon: Search, title: "New niche", sub: "Research a service keyword" },
                { key: "title", icon: Tag, title: "I have a gig title", sub: "Generate its full setup" },
                { key: "bulk", icon: Layers, title: "Bulk compare", sub: `Up to ${MAX_BULK} niches` },
              ] as const).map((m) => {
                const Icon = m.icon;
                const active = mode === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setMode(m.key)}
                    className={`text-left rounded-lg border p-3 transition-colors ${active ? "border-primary bg-primary/10" : "border-border bg-muted/20 hover:border-primary/40"}`}
                  >
                    <Icon className={`w-4 h-4 mb-1.5 ${active ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="text-sm font-semibold">{m.title}</div>
                    <div className="text-xs text-muted-foreground">{m.sub}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {mode === "title" && (
            <div>
              <Label className="font-mono text-xs uppercase tracking-wider">Your existing gig title</Label>
              <p className="text-xs text-muted-foreground mt-1">Paste the exact title you already have. We keep it word-for-word and research + generate everything around it: category, search tags, description, buyer requirements, FAQs, packages, thumbnails{" "}and video concepts.</p>
              <Input
                value={gigTitle}
                onChange={(e) => setGigTitle(e.target.value.slice(0, 80))}
                placeholder="I will create cinematic AI video ads for your brand"
                className="mt-2 h-12 font-mono bg-input/50"
                maxLength={80}
              />
              <div className="text-xs font-mono text-muted-foreground mt-1">{gigTitle.length}/80 chars</div>
            </div>
          )}

          {mode === "niche" && (
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

          <div className="border border-border rounded-lg p-4 bg-muted/10 space-y-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-primary">// Video Demo Settings</span>
            </div>
            <div>
              <Label className="font-mono text-xs uppercase tracking-wider">Target Video Duration</Label>
              <p className="text-xs text-muted-foreground mt-1">Stage prompts and per-scene timestamps will auto-match this length.</p>
              <div className="flex gap-2 mt-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setTargetDuration(d)}
                    className={`px-4 py-2 rounded-md font-mono text-sm border transition-colors ${targetDuration === d ? "bg-gradient-to-r from-primary to-secondary text-primary-foreground border-transparent" : "bg-input/40 border-border hover:border-primary/40"}`}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="font-mono text-xs uppercase tracking-wider">Character Lock</Label>
                <p className="text-xs text-muted-foreground mt-1">Forces every scene prompt to reuse the same character names, outfits & art style via an "appearance sheet".</p>
              </div>
              <Switch checked={characterLock} onCheckedChange={setCharacterLock} />
            </div>
          </div>

          <Button onClick={launch} disabled={loading} size="lg" className="w-full h-14 text-base bg-gradient-to-r from-primary to-secondary text-primary-foreground hover:opacity-90 animate-pulse-glow">
            <Rocket className="w-5 h-5 mr-2" />
            {loading ? "Launching..." : bulk ? "Launch Bulk Research & Compare" : mode === "title" ? "Research & Build This Gig Title" : "Start Deep Research & Generate Everything"}
          </Button>
        </div>
      </div>
    </AppShell>
  );
};

export default NewProject;
