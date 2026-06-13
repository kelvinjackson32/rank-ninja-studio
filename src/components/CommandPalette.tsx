import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Activity, FolderKanban, Key, Plus, Stethoscope, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export const CommandPalette = () => {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const { signOut } = useAuth();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (path: string) => { setOpen(false); nav(path); };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => go("/app")}><Activity className="w-4 h-4 mr-2" />Dashboard</CommandItem>
          <CommandItem onSelect={() => go("/app/projects")}><FolderKanban className="w-4 h-4 mr-2" />Projects</CommandItem>
          <CommandItem onSelect={() => go("/app/audit")}><Stethoscope className="w-4 h-4 mr-2" />Audit Account</CommandItem>
          <CommandItem onSelect={() => go("/app/settings")}><Key className="w-4 h-4 mr-2" />API Keys</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => go("/app/projects/new")}><Plus className="w-4 h-4 mr-2" />New Project</CommandItem>
          <CommandItem onSelect={async () => { setOpen(false); await signOut(); nav("/"); }}><LogOut className="w-4 h-4 mr-2" />Sign Out</CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};
