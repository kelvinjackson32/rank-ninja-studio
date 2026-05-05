import { Link } from "react-router-dom";
import { ArrowRight, Radar, Target, Brain, Layers, Zap, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

const Landing = () => {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-sm sticky top-0 z-50 bg-background/70">
        <div className="container flex items-center justify-between py-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-md bg-gradient-to-br from-primary to-secondary flex items-center justify-center glow-primary">
              <Radar className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <div className="font-bold tracking-tight">RankForge</div>
              <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Fiverr Intel</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost"><Link to="/auth">Sign in</Link></Button>
            <Button asChild className="bg-gradient-to-r from-primary to-secondary text-primary-foreground hover:opacity-90">
              <Link to={user ? "/app" : "/auth"}>{user ? "Open Studio" : "Get Started"}<ArrowRight className="w-4 h-4 ml-1" /></Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="container relative py-24 md:py-32 text-center max-w-4xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/5 font-mono text-xs text-primary mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            COMPETITIVE INTELLIGENCE ENGINE
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter mb-6 leading-[1.05]">
            Reverse-engineer the <span className="text-gradient">top 1%</span><br />of Fiverr sellers.
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            RankForge scrapes real Top Rated and Fiverr Choice gigs, decodes the patterns that win, and forges a profile + gig built to rank — even with zero reviews.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="bg-gradient-to-r from-primary to-secondary text-primary-foreground hover:opacity-90 text-base px-8 h-12 animate-pulse-glow">
              <Link to={user ? "/app" : "/auth"}>Start Deep Research<ArrowRight className="w-4 h-4 ml-2" /></Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="text-base px-8 h-12 border-border">
              <Link to="/auth">See How It Works</Link>
            </Button>
          </div>
          <div className="mt-16 grid grid-cols-3 max-w-2xl mx-auto gap-6 text-left">
            {[["Pages Analyzed","Top 1-3"],["Top Sellers", "Decoded"],["AI Generation","Realtime"]].map(([k,v]) => (
              <div key={k as string} className="surface-card rounded-lg p-4">
                <div className="text-2xl font-bold text-gradient font-mono">{v}</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider mt-1">{k}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="container py-24">
        <div className="text-center mb-16">
          <div className="font-mono text-xs text-primary uppercase tracking-widest mb-3">// THE STACK</div>
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Built like a <span className="text-gradient">SOC for sellers</span></h2>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {[
            { i: Radar, t: "Live Fiverr Scraping", d: "Apify-powered, multi-key rotation. Pulls Pages 1–3 of real search results — Top Rated, Fiverr Choice, high-volume gigs." },
            { i: Brain, t: "Pattern Recognition", d: "Lovable AI decodes title structures, keyword density, FAQ tactics, and pricing strategies that drive orders." },
            { i: Target, t: "Profile Forge", d: "Display name, headline, bio, skills, work history, certifications — all generated to maximize trust + algorithm signals." },
            { i: Layers, t: "Gig Optimizer", d: "1000–1150 char description, 8–10 ranking tags, 10 buyer-objection FAQs, and Basic/Standard/Premium pricing modeled on top sellers." },
            { i: Zap, t: "Key Rotation", d: "Drop in unlimited Apify keys. We auto-rotate on rate limits and surface every key's status in real time." },
            { i: Shield, t: "Algorithm-Safe Copy", d: "Natural, persuasive, human-sounding text. Keyword-rich without stuffing. Built around current Fiverr ranking signals." },
          ].map(({ i: Icon, t, d }) => (
            <div key={t} className="surface-card rounded-xl p-6 hover:border-primary/40 transition-all group">
              <div className="w-10 h-10 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">{t}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="container py-24">
        <div className="surface-card rounded-2xl p-12 text-center relative overflow-hidden">
          <div className="absolute inset-0 grid-bg opacity-30" />
          <div className="relative">
            <h2 className="text-4xl font-bold mb-4">Stop guessing. <span className="text-gradient">Start ranking.</span></h2>
            <p className="text-muted-foreground max-w-xl mx-auto mb-8">Bring your own Apify key. Pick a niche. Get a competitive blueprint in minutes.</p>
            <Button asChild size="lg" className="bg-gradient-to-r from-primary to-secondary text-primary-foreground hover:opacity-90">
              <Link to={user ? "/app" : "/auth"}>Launch Studio<ArrowRight className="w-4 h-4 ml-2" /></Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground font-mono">
        RANKFORGE // FIVERR COMPETITIVE INTELLIGENCE
      </footer>
    </div>
  );
};

export default Landing;
