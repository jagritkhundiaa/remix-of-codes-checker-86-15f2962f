import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Server, Zap, Users, Sparkles } from "lucide-react";
import UrlAnalyzer from "@/components/neon/UrlAnalyzer";
import CardInput from "@/components/neon/CardInput";
import HitRunner from "@/components/neon/HitRunner";
import Credits from "@/components/neon/Credits";
import Settings from "@/components/neon/Settings";
import AdminPanel from "@/components/neon/AdminPanel";
import { UrlAnalysis, CardData, NeonSettings, loadSettings } from "@/lib/neon";

// License gate removed — site is open to everyone.
// Backend functions still expect an accessKey, so we use the
// built-in master key for all requests transparently.
const OPEN_KEY = "NEONISTHEGOAT";

export default function Index() {
  const [analysis, setAnalysis] = useState<UrlAnalysis | null>(null);
  const [cards, setCards] = useState<CardData[]>([]);
  const [settings, setSettings] = useState<NeonSettings>(loadSettings());
  const [showAdmin, setShowAdmin] = useState(false);

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="mesh-dot w-[600px] h-[600px]" style={{ background: "hsl(var(--primary))", top: "-250px", right: "-150px" }} />
      <div className="mesh-dot w-[400px] h-[400px]" style={{ background: "hsl(var(--accent))", bottom: "-100px", left: "-100px", animationDelay: "-8s" }} />

      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-border/20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Zap className="w-4 h-4 text-primary" />
          </div>
          <span className="text-lg font-black tracking-tight text-gradient-neon">NEON</span>
          <span className="text-[10px] text-muted-foreground/50 uppercase tracking-widest ml-1">v2.0</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/combo-cleaner"
            className="text-xs text-accent hover:text-accent/80 transition-colors flex items-center gap-1 font-bold"
          >
            <Sparkles className="w-3 h-3" /> AIO Checker
          </Link>
          <button
            onClick={() => setShowAdmin(true)}
            className="text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1 font-bold"
          >
            <Users className="w-3 h-3" /> Admin
          </button>
        </div>
      </header>

      <main className="relative z-10 max-w-3xl mx-auto px-4 py-6 space-y-4">
        <Link
          to="/combo-cleaner"
          className="glass rounded-xl p-4 flex items-center justify-between gap-3 border border-accent/30 hover:border-accent/60 hover:bg-accent/5 transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
              <Server className="w-5 h-5 text-accent" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-black text-foreground">AIO Combo Checker</div>
              <div className="text-[11px] text-muted-foreground truncate">Clean combos, queue checks, manage proxies, and save results.</div>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-accent shrink-0" />
        </Link>
        <UrlAnalyzer accessKey={OPEN_KEY} onAnalyzed={setAnalysis} analysis={analysis} />
        <CardInput cards={cards} onCardsChange={setCards} />
        <HitRunner accessKey={OPEN_KEY} analysis={analysis} cards={cards} settings={settings} />
      </main>

      <Settings settings={settings} onSettingsChange={setSettings} />
      <Credits />

      {showAdmin && (
        <AdminPanel adminKey={OPEN_KEY} onClose={() => setShowAdmin(false)} />
      )}
    </div>
  );
}
