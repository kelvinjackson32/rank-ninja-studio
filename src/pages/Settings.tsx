import { useEffect, useState } from "react";
import { Plus, Trash2, KeyRound, CheckCircle2, AlertCircle, Pause, ClipboardPaste, Sparkles, Loader2, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

type Key = { id: string; name: string; api_key: string; actor_id: string | null; status: string; last_used_at: string | null; error_message: string | null };
type GeminiStatus = "unknown" | "testing" | "connected" | "invalid";

const Settings = () => {
  const { user } = useAuth();
  const [keys, setKeys] = useState<Key[]>([]);
  const [open, setOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkActor, setBulkActor] = useState("piotrv1001/fiverr-listings-scraper");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [actorId, setActorId] = useState("piotrv1001/fiverr-listings-scraper");

  // AI Generation (Gemini) settings
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus>("unknown");
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [savingGemini, setSavingGemini] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("api_keys").select("*").order("created_at", { ascending: false });
    setKeys((data as Key[]) || []);
    const { data: ai } = await supabase.from("user_ai_settings").select("gemini_api_key").maybeSingle();
    if (ai?.gemini_api_key) {
      setGeminiKey(ai.gemini_api_key);
      setGeminiStatus("connected");
    } else {
      setGeminiKey("");
      setGeminiStatus("unknown");
    }
  };
  useEffect(() => { if (user) load(); }, [user]);

  const saveGemini = async () => {
    const trimmed = geminiKey.trim();
    if (!trimmed) { toast.error("Paste your Gemini API key first"); return; }
    setSavingGemini(true);
    const { error } = await supabase
      .from("user_ai_settings")
      .upsert({ user_id: user!.id, gemini_api_key: trimmed }, { onConflict: "user_id" });
    setSavingGemini(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Gemini key saved");
    setGeminiStatus("unknown");
    setGeminiError(null);
    // auto-test right after save
    testGemini(trimmed);
  };

  const clearGemini = async () => {
    const { error } = await supabase
      .from("user_ai_settings")
      .upsert({ user_id: user!.id, gemini_api_key: null }, { onConflict: "user_id" });
    if (error) { toast.error(error.message); return; }
    setGeminiKey("");
    setGeminiStatus("unknown");
    setGeminiError(null);
    toast.success("Gemini key removed");
  };

  const testGemini = async (override?: string) => {
    const candidate = (override ?? geminiKey).trim();
    if (!candidate) { toast.error("Nothing to test — paste a key first"); return; }
    setGeminiStatus("testing");
    setGeminiError(null);
    const { data, error } = await supabase.functions.invoke("test-gemini-key", {
      body: { apiKey: candidate },
    });
    if (error) {
      setGeminiStatus("invalid");
      setGeminiError(error.message || "Test failed");
      return;
    }
    if (data?.ok) {
      setGeminiStatus("connected");
      toast.success("Gemini key works!");
    } else {
      setGeminiStatus("invalid");
      setGeminiError(data?.error || "Unknown error");
    }
  };


  const add = async () => {
    if (!name.trim() || !apiKey.trim()) { toast.error("Name and API key required"); return; }
    const { error } = await supabase.from("api_keys").insert({ user_id: user!.id, name: name.trim(), api_key: apiKey.trim(), actor_id: actorId.trim() || null, status: "active" });
    if (error) { toast.error(error.message); return; }
    toast.success("Key added");
    setName(""); setApiKey(""); setActorId("piotrv1001/fiverr-listings-scraper");
    setOpen(false); load();
  };

  const addBulk = async () => {
    const lines = bulkText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) { toast.error("Paste at least one key"); return; }
    const rows = lines.map((line, i) => {
      const m = line.match(/^([^:,]+)[:,]\s*(.+)$/);
      const [n, k] = m ? [m[1].trim(), m[2].trim()] : [`Key ${i + 1}`, line];
      return { user_id: user!.id, name: n, api_key: k, actor_id: bulkActor.trim() || null, status: "active" };
    });
    const { error } = await supabase.from("api_keys").insert(rows);
    if (error) { toast.error(error.message); return; }
    toast.success(`Added ${rows.length} key${rows.length > 1 ? "s" : ""}`);
    setBulkText(""); setBulkOpen(false); load();
  };

  const remove = async (id: string) => {
    await supabase.from("api_keys").delete().eq("id", id);
    toast.success("Key removed"); load();
  };

  const reactivate = async (id: string) => {
    await supabase.from("api_keys").update({ status: "active", error_message: null }).eq("id", id);
    load();
  };

  const statusBadge = (s: string) => {
    if (s === "active") return <Badge className="bg-success/15 text-success border-success/30 hover:bg-success/20"><CheckCircle2 className="w-3 h-3 mr-1" />Active</Badge>;
    if (s === "rate_limited") return <Badge className="bg-warning/15 text-warning border-warning/30 hover:bg-warning/20"><Pause className="w-3 h-3 mr-1" />Rate Limited</Badge>;
    return <Badge className="bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/20"><AlertCircle className="w-3 h-3 mr-1" />Error</Badge>;
  };

  const geminiBadge = () => {
    if (geminiStatus === "testing") return <Badge className="bg-muted text-muted-foreground border-border"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Testing</Badge>;
    if (geminiStatus === "connected") return <Badge className="bg-success/15 text-success border-success/30"><CheckCircle2 className="w-3 h-3 mr-1" />Connected</Badge>;
    if (geminiStatus === "invalid") return <Badge className="bg-destructive/15 text-destructive border-destructive/30"><AlertCircle className="w-3 h-3 mr-1" />Invalid</Badge>;
    return <Badge variant="outline">Not tested</Badge>;
  };

  return (
    <AppShell>
      <div className="p-8 max-w-5xl space-y-10">
        {/* === AI Generation Settings === */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="font-mono text-xs text-primary uppercase tracking-widest mb-1 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5" /> AI Generation Settings
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Google Gemini API Key</h2>
              <p className="text-muted-foreground text-sm mt-1">
                All AI text generation (profile, gig copy, FAQs, packages, insights) uses your own free Gemini key — no Lovable credits used. Scraping still uses Apify.
              </p>
            </div>
            {geminiBadge()}
          </div>

          <div className="surface-card rounded-xl p-5 space-y-4">
            <div>
              <Label className="font-mono text-xs uppercase tracking-wider">Gemini API Key</Label>
              <Input
                type="password"
                value={geminiKey}
                onChange={(e) => { setGeminiKey(e.target.value); setGeminiStatus("unknown"); setGeminiError(null); }}
                placeholder="AIza..."
                className="mt-1.5 font-mono bg-input/50"
              />
              <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                Get a free key at{" "}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                  aistudio.google.com/apikey <ExternalLink className="w-3 h-3" />
                </a>
              </p>
            </div>

            {geminiError && (
              <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md p-2.5 font-mono">
                {geminiError}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={saveGemini} disabled={savingGemini} className="bg-gradient-to-r from-primary to-secondary text-primary-foreground hover:opacity-90">
                {savingGemini ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                Save Key
              </Button>
              <Button variant="outline" onClick={() => testGemini()} disabled={geminiStatus === "testing" || !geminiKey.trim()}>
                {geminiStatus === "testing" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                Test Connection
              </Button>
              {geminiKey && (
                <Button variant="ghost" onClick={clearGemini} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                  <Trash2 className="w-4 h-4 mr-1" /> Remove
                </Button>
              )}
            </div>
          </div>
        </section>

        {/* === Apify (scraping) === */}
        <section>
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="font-mono text-xs text-primary uppercase tracking-widest mb-1">// CREDENTIALS</div>
            <h1 className="text-3xl font-bold tracking-tight">Apify API Keys</h1>
            <p className="text-muted-foreground text-sm mt-1">Add unlimited keys. RankForge auto-rotates on rate limits.</p>
          </div>
          <div className="flex gap-2">
            <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
              <DialogTrigger asChild>
                <Button variant="outline"><ClipboardPaste className="w-4 h-4 mr-1" />Bulk Add</Button>
              </DialogTrigger>
              <DialogContent className="surface-card">
                <DialogHeader><DialogTitle>Paste multiple API keys</DialogTitle></DialogHeader>
                <div className="space-y-3 pt-2">
                  <p className="text-xs text-muted-foreground">One per line. Format: <code className="text-primary">name:apify_api_xxx</code> or just <code className="text-primary">apify_api_xxx</code>.</p>
                  <Textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} rows={8} placeholder={"Account 1:apify_api_xxxxxxxxxx\nAccount 2:apify_api_yyyyyyyyyy\napify_api_zzzzzzzzzz"} className="font-mono bg-input/50 text-xs" />
                  <div>
                    <Label className="font-mono text-xs uppercase tracking-wider">Actor ID (applies to all)</Label>
                    <Input value={bulkActor} onChange={(e) => setBulkActor(e.target.value)} className="mt-1.5 font-mono bg-input/50" />
                  </div>
                  <Button onClick={addBulk} className="w-full bg-gradient-to-r from-primary to-secondary text-primary-foreground">Save All</Button>
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="bg-gradient-to-r from-primary to-secondary text-primary-foreground hover:opacity-90"><Plus className="w-4 h-4 mr-1" />Add Key</Button>
              </DialogTrigger>
              <DialogContent className="surface-card">
                <DialogHeader><DialogTitle>Add Apify API Key</DialogTitle></DialogHeader>
                <div className="space-y-4 pt-2">
                  <div>
                    <Label className="font-mono text-xs uppercase tracking-wider">Label</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Apify account" className="mt-1.5 font-mono bg-input/50" />
                  </div>
                  <div>
                    <Label className="font-mono text-xs uppercase tracking-wider">API Token</Label>
                    <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="apify_api_..." className="mt-1.5 font-mono bg-input/50" />
                  </div>
                  <div>
                    <Label className="font-mono text-xs uppercase tracking-wider">Actor ID</Label>
                    <Input value={actorId} onChange={(e) => setActorId(e.target.value)} placeholder="username/actor-name" className="mt-1.5 font-mono bg-input/50" />
                    <p className="text-xs text-muted-foreground mt-1.5">Fiverr scraper actor. Default: <code className="text-primary">piotrv1001/fiverr-listings-scraper</code></p>
                  </div>
                  <Button onClick={add} className="w-full bg-gradient-to-r from-primary to-secondary text-primary-foreground">Save Key</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="surface-card rounded-xl overflow-hidden">
          {keys.length === 0 ? (
            <div className="p-16 text-center">
              <KeyRound className="w-10 h-10 text-muted-foreground/50 mx-auto mb-4" />
              <p className="text-muted-foreground">No API keys yet. Get one at <a href="https://console.apify.com/account/integrations" target="_blank" rel="noreferrer" className="text-primary hover:underline">console.apify.com</a></p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {keys.map((k) => (
                <div key={k.id} className="p-4 flex items-center gap-4">
                  <KeyRound className="w-5 h-5 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{k.name}</div>
                    <div className="text-xs font-mono text-muted-foreground truncate">
                      {k.api_key.slice(0, 8)}••••{k.api_key.slice(-4)} · {k.actor_id || "piotrv1001/fiverr-listings-scraper"}
                    </div>
                    {k.error_message && <div className="text-xs text-destructive mt-1 truncate">{k.error_message}</div>}
                  </div>
                  {statusBadge(k.status)}
                  {k.status !== "active" && <Button size="sm" variant="outline" onClick={() => reactivate(k.id)}>Reactivate</Button>}
                  <Button size="icon" variant="ghost" onClick={() => remove(k.id)}><Trash2 className="w-4 h-4" /></Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
};

export default Settings;
