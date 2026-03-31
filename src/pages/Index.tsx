import { useState, useEffect } from "react";
import { LogOut, Zap } from "lucide-react";
import AccessGate from "@/components/neon/AccessGate";
import UrlAnalyzer from "@/components/neon/UrlAnalyzer";
import CardInput from "@/components/neon/CardInput";
import HitRunner from "@/components/neon/HitRunner";
import Credits from "@/components/neon/Credits";
import { UrlAnalysis, CardData } from "@/lib/neon";

export default function Index() {
  const [accessKey, setAccessKey] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<UrlAnalysis | null>(null);
  const [cards, setCards] = useState<CardData[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("neon_key");
    if (saved) setAccessKey(saved);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("neon_key");
    setAccessKey(null);
    setAnalysis(null);
    setCards([]);
  };

  if (!accessKey) {
    return <AccessGate onAuthenticated={setAccessKey} />;
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background effects */}
      <div className="mesh-dot w-[600px] h-[600px]" style={{ background: "hsl(var(--primary))", top: "-250px", right: "-150px" }} />
      <div className="mesh-dot w-[400px] h-[400px]" style={{ background: "hsl(var(--accent))", bottom: "-100px", left: "-100px", animationDelay: "-8s" }} />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-border/20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Zap className="w-4 h-4 text-primary" />
          </div>
          <span className="text-lg font-black tracking-tight text-gradient-neon">NEON</span>
          <span className="text-[10px] text-muted-foreground/50 uppercase tracking-widest ml-1">v2.0</span>
        </div>
        <button
          onClick={handleLogout}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          <LogOut className="w-3 h-3" /> Logout
        </button>
      </header>

      {/* Main content */}
      <main className="relative z-10 max-w-3xl mx-auto px-4 py-6 space-y-4">
        <UrlAnalyzer accessKey={accessKey} onAnalyzed={setAnalysis} analysis={analysis} />
        <CardInput cards={cards} onCardsChange={setCards} />
        <HitRunner accessKey={accessKey} analysis={analysis} cards={cards} />
      </main>

      <Credits />
    </div>
  );
}
