import { useEffect, useState } from "react";
import { Plus, Trash2, KeyRound, CheckCircle2, AlertCircle, Pause } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

type Key = { id: string; name: string; api_key: string; actor_id: string | null; status: string; last_used_at: string | null; error_message: string | null };

const Settings = () => {
  const { user } = useAuth();
  const [keys, setKeys] = useState<Key[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [actorId, setActorId] = useState("piotrv1001/fiverr-listings-scraper");

  const load = async () => {
    const { data } = await supabase.from("api_keys").select("*").order("created_at", { ascending: false });
    setKeys((data as Key[]) || []);
  };
  useEffect(() => { if (user) load(); }, [user]);

  const add = async () => {
    if (!name.trim() || !apiKey.trim()) { toast.error("Name and API key required"); return; }
    const { error } = await supabase.from("api_keys").insert({ user_id: user!.id, name: name.trim(), api_key: apiKey.trim(), actor_id: actorId.trim() || null, status: "active" });
    if (error) { toast.error(error.message); return; }
    toast.success("Key added");
    setName(""); setApiKey(""); setActorId("piotrv1001/fiverr-listings-scraper");
    setOpen(false); load();
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

  return (
    <AppShell>
      <div className="p-8 max-w-5xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="font-mono text-xs text-primary uppercase tracking-widest mb-1">// CREDENTIALS</div>
            <h1 className="text-3xl font-bold tracking-tight">Apify API Keys</h1>
            <p className="text-muted-foreground text-sm mt-1">Add unlimited keys. RankForge auto-rotates on rate limits.</p>
          </div>
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
