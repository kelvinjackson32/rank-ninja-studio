import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Activity, Key, FolderKanban, LogOut, Radar, Menu, X, Stethoscope } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const items = [
  { to: "/app", label: "Dashboard", icon: Activity },
  { to: "/app/projects", label: "Projects", icon: FolderKanban },
  { to: "/app/audit", label: "Audit Account", icon: Stethoscope },
  { to: "/app/settings", label: "API Keys", icon: Key },
];

export const AppShell = ({ children }: { children: React.ReactNode }) => {
  const { signOut, user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  const SidebarInner = (
    <>
      <div className="p-6 border-b border-border flex items-center justify-between">
        <Link to="/app" onClick={() => setOpen(false)} className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-gradient-to-br from-primary to-secondary flex items-center justify-center glow-primary">
            <Radar className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <div className="font-bold tracking-tight">RankForge</div>
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Fiverr Intel</div>
          </div>
        </Link>
        <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          <X className="w-4 h-4" />
        </Button>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {items.map((it) => {
          const active = loc.pathname === it.to || (it.to !== "/app" && loc.pathname.startsWith(it.to));
          return (
            <Link key={it.to} to={it.to} onClick={() => setOpen(false)} className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
              active ? "bg-primary/10 text-primary border border-primary/20" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}>
              <it.icon className="w-4 h-4" />{it.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-border">
        <div className="px-3 py-2 text-xs text-muted-foreground font-mono truncate">{user?.email}</div>
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={async () => { await signOut(); nav("/"); }}>
          <LogOut className="w-4 h-4 mr-2" />Sign out
        </Button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 border-r border-border bg-sidebar flex-col">
        {SidebarInner}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 border-r border-border bg-sidebar flex flex-col">
            {SidebarInner}
          </aside>
        </div>
      )}

      <main className="flex-1 overflow-auto min-w-0">
        {/* Mobile header */}
        <div className="md:hidden flex items-center gap-2 p-3 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-30">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
              <Radar className="w-3 h-3 text-primary-foreground" />
            </div>
            <span className="font-bold text-sm">RankForge</span>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
};
