import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Loader2, CheckCircle2, AlertCircle, Clock, Search, Trash2, Pencil, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";

import { toast } from "sonner";

const statusIcon = (s: string) => {
  if (s === "complete") return <CheckCircle2 className="w-4 h-4 text-success" />;
  if (s === "error") return <AlertCircle className="w-4 h-4 text-destructive" />;
  if (s === "pending") return <Clock className="w-4 h-4 text-muted-foreground" />;
  return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
};

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "complete", label: "Complete" },
  { key: "running", label: "Running" },
  { key: "error", label: "Failed" },
] as const;

const RUNNING = ["pending", "scraping", "analyzing"];

const Projects = () => {
  const [projects, setProjects] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [selected, setSelected] = useState<string[]>([]);

  const load = () => supabase.from("projects").select("*").order("created_at", { ascending: false }).then(({ data }) => {
    setProjects(data || []);
    setSelected([]);
  });
  useEffect(() => { load(); }, []);

  const del = async (id: string) => {
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Project deleted");
    load();
  };

  const delMany = async () => {
    const { error } = await supabase.from("projects").delete().in("id", selected);
    if (error) { toast.error(error.message); return; }
    toast.success(`${selected.length} project${selected.length > 1 ? "s" : ""} deleted`);
    load();
  };

  const rename = async (id: string, niche: string) => {
    const { error } = await supabase.from("projects").update({ niche }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Renamed");
    load();
  };

  const counts = {
    all: projects.length,
    complete: projects.filter((p) => p.status === "complete").length,
    running: projects.filter((p) => RUNNING.includes(p.status)).length,
    error: projects.filter((p) => p.status === "error").length,
  } as Record<string, number>;

  const filtered = projects.filter((p) => {
    const matchesQ = p.niche.toLowerCase().includes(q.toLowerCase());
    const matchesStatus =
      status === "all" ? true : status === "running" ? RUNNING.includes(p.status) : p.status === status;
    return matchesQ && matchesStatus;
  });

  const allShownSelected = filtered.length > 0 && filtered.every((p) => selected.includes(p.id));
  const toggleAll = () => setSelected(allShownSelected ? [] : filtered.map((p) => p.id));
  const toggleOne = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <AppShell>
      <div className="p-4 md:p-8 max-w-6xl">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
          <div>
            <div className="font-mono text-xs text-primary uppercase tracking-widest mb-1">// ARCHIVE</div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">All Projects</h1>
          </div>
          <Button asChild className="bg-gradient-to-r from-primary to-secondary text-primary-foreground"><Link to="/app/new"><Plus className="w-4 h-4 mr-1" />New</Link></Button>
        </div>

        <div className="relative mb-3">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects..." className="pl-9 bg-input/50" />
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatus(f.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-mono border transition-colors ${
                status === f.key
                  ? "bg-primary/15 text-primary border-primary/30"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/40"
              }`}
            >
              {f.label} <span className="opacity-60">{counts[f.key]}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 mb-3 min-h-9">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <Checkbox checked={allShownSelected} onCheckedChange={toggleAll} aria-label="Select all" />
            {selected.length > 0 ? `${selected.length} selected` : "Select all"}
          </label>
          {selected.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="border-destructive/40 text-destructive">
                  <Trash2 className="w-4 h-4 mr-1" />Delete {selected.length}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="surface-card">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {selected.length} project{selected.length > 1 ? "s" : ""}?</AlertDialogTitle>
                  <AlertDialogDescription>This permanently removes them and their research results.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={delMany} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>


        <div className="surface-card rounded-xl divide-y divide-border">
          {filtered.length === 0 && <div className="p-12 text-center text-muted-foreground">{projects.length === 0 ? "No projects yet" : "No matches"}</div>}
          {filtered.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-4 hover:bg-muted/30 transition-colors">
              <Link to={`/app/projects/${p.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                {statusIcon(p.status)}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{p.niche}</div>
                  <div className="text-xs text-muted-foreground font-mono">{new Date(p.created_at).toLocaleString()} · {p.status}</div>
                </div>
              </Link>
              {p.bulk_group_id && (
                <Link to={`/app/compare/${p.bulk_group_id}`} className="text-xs text-primary hover:underline inline-flex items-center gap-1 font-mono">
                  <Layers className="w-3 h-3" />Compare
                </Link>
              )}
              <RenameDialog project={p} onRename={rename} />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Delete"><Trash2 className="w-4 h-4 text-destructive" /></Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="surface-card">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete "{p.niche}"?</AlertDialogTitle>
                    <AlertDialogDescription>This permanently removes the project and its research results.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => del(p.id)} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
};

const RenameDialog = ({ project, onRename }: any) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.niche);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setName(project.niche); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Rename"><Pencil className="w-4 h-4" /></Button>
      </DialogTrigger>
      <DialogContent className="surface-card">
        <DialogHeader><DialogTitle>Rename project</DialogTitle></DialogHeader>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-input/50" />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => { if (name.trim()) { onRename(project.id, name.trim()); setOpen(false); } }} className="bg-gradient-to-r from-primary to-secondary text-primary-foreground">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default Projects;
