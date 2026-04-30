import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Radar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { z } from "zod";

const schema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(6).max(72),
});

const Auth = () => {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/app` },
        });
        if (error) throw error;
        toast.success("Account created. Welcome aboard.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      nav("/app");
    } catch (e: any) {
      toast.error(e.message || "Auth failed");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center grid-bg px-4">
      <div className="w-full max-w-md surface-card rounded-2xl p-8 scan-line">
        <Link to="/" className="flex items-center gap-2 mb-8">
          <div className="w-9 h-9 rounded-md bg-gradient-to-br from-primary to-secondary flex items-center justify-center glow-primary">
            <Radar className="w-5 h-5 text-primary-foreground" />
          </div>
          <div className="font-bold">RankForge</div>
        </Link>
        <h1 className="text-2xl font-bold mb-1">{mode === "signin" ? "Sign in" : "Create account"}</h1>
        <p className="text-sm text-muted-foreground mb-6 font-mono">{mode === "signin" ? "Access your studio" : "Start forging in seconds"}</p>
        <form onSubmit={handle} className="space-y-4">
          <div>
            <Label htmlFor="email" className="font-mono text-xs uppercase tracking-wider">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-1.5 bg-input/50 font-mono" />
          </div>
          <div>
            <Label htmlFor="password" className="font-mono text-xs uppercase tracking-wider">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="mt-1.5 bg-input/50 font-mono" />
          </div>
          <Button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-primary to-secondary text-primary-foreground hover:opacity-90">
            {loading ? "..." : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>
        <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="mt-6 text-sm text-muted-foreground hover:text-primary transition-colors w-full text-center">
          {mode === "signin" ? "Need an account? Sign up →" : "Have an account? Sign in →"}
        </button>
      </div>
    </div>
  );
};

export default Auth;
