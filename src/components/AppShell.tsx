import { Link, useLocation, useNavigate } from "react-router-dom";
import { Activity, Key, FolderKanban, LogOut, Radar } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const items = [
  { to: "/app", label: "Dashboard", icon: Activity },
  { to: "/app/projects", label: "Projects", icon: FolderKanban },
  { to: "/app/settings", label: "API Keys", icon: Key },
];

export const AppShell = ({ children }: { children: React.ReactNode }) => {
  const { signOut, user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-64 border-r border-border bg-sidebar flex flex-col">
        <div className="p-6 border-b border-border">
          <Link to="/app" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-gradient-to-br from-primary to-secondary flex items-center justify-center glow-primary">
              <Radar className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <div className="font-bold tracking-tight">RankForge</div>
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Fiverr Intel</div>
            </div>
          </Link>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {items.map((it) => {
            const active = loc.pathname === it.to || (it.to !== "/app" && loc.pathname.startsWith(it.to));
            return (
              <Link key={it.to} to={it.to} className={cn(
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
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
};
