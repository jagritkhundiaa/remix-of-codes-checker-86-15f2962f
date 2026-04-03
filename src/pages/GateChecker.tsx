import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { Zap, Copy, Check, Loader2, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { UrlAnalysis, CardData, NeonSettings, loadSettings, parseCardLine, generateCards } from "@/lib/neon";
import AccessGate from "@/components/neon/AccessGate";
import CardInput from "@/components/neon/CardInput";
import HitRunner from "@/components/neon/HitRunner";
import Settings from "@/components/neon/Settings";

export default function GateChecker() {
  const { id } = useParams<{ id: string }>();
  const [accessKey, setAccessKey] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [gate, setGate] = useState<any>(null);
  const [analysis, setAnalysis] = useState<UrlAnalysis | null>(null);
  const [cards, setCards] = useState<CardData[]>([]);
  const [settings, setSettings] = useState<NeonSettings>(loadSettings());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("neon_key");
    const admin = localStorage.getItem("neon_admin");
    if (saved) {
      setAccessKey(saved);
      setIsAdmin(admin === "1");
    }
  }, []);

  useEffect(() => {
    if (!id) return;
    loadGate();
  }, [id]);

  const loadGate = async () => {
    setLoading(true);
    setError("");
    const { data, error: err } = await supabase
      .from("custom_gates")
      .select("*")
      .eq("id", id!)
      .eq("is_active", true)
      .single();

    if (err || !data) {
      setError("Gate not found or inactive");
      setLoading(false);
      return;
    }

    setGate(data);
    const a: UrlAnalysis = {
      url: data.site_url,
      provider: data.provider,
      merchant: data.merchant || "",
      product: data.product || "",
      productUrl: null,
      amount: data.amount,
      currency: data.currency || "USD",
      stripePk: data.stripe_pk,
      clientSecret: data.client_secret,
      success: true,
      logs: [`[GATE] Loaded: ${data.name}`],
    };
    setAnalysis(a);
    setLoading(false);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAuth = (key: string, admin: boolean) => {
    setAccessKey(key);
    setIsAdmin(admin);
  };

  if (!accessKey) {
    return <AccessGate onAuthenticated={handleAuth} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !gate || !analysis) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-destructive font-bold">{error || "Gate not found"}</p>
        <Link to="/" className="text-xs text-primary hover:underline flex items-center gap-1">
          <ArrowLeft className="w-3 h-3" /> Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="mesh-dot w-[600px] h-[600px]" style={{ background: "hsl(var(--primary))", top: "-250px", right: "-150px" }} />

      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-border/20">
        <div className="flex items-center gap-2">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Zap className="w-4 h-4 text-primary" />
          </div>
          <span className="text-lg font-black tracking-tight text-gradient-neon">NEON</span>
          <span className="text-[10px] text-muted-foreground/50 uppercase tracking-widest ml-1">gate</span>
        </div>
        <button
          onClick={handleCopyLink}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          {copied ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
          {copied ? "Copied!" : "Share Link"}
        </button>
      </header>

      <main className="relative z-10 max-w-3xl mx-auto px-4 py-6 space-y-4">
        {/* Gate info card */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-black uppercase tracking-wider text-primary">{gate.name}</h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold uppercase">
              {gate.provider}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <span className="text-muted-foreground">Merchant</span>
              <p className="font-mono font-bold text-foreground truncate">{gate.merchant || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Amount</span>
              <p className="font-mono font-bold text-foreground">{gate.amount || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Stripe PK</span>
              <p className="font-mono font-bold text-foreground truncate">
                {gate.stripe_pk ? gate.stripe_pk.slice(0, 20) + "..." : "—"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Currency</span>
              <p className="font-mono font-bold text-foreground">{gate.currency || "USD"}</p>
            </div>
          </div>
        </div>

        <CardInput cards={cards} onCardsChange={setCards} />
        <HitRunner accessKey={accessKey} analysis={analysis} cards={cards} settings={settings} />
      </main>

      <Settings settings={settings} onSettingsChange={setSettings} />
    </div>
  );
}
