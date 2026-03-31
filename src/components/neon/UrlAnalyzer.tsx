import { useState } from "react";
import { Globe, Loader2, CheckCircle, XCircle, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { UrlAnalysis, PROVIDER_LABELS } from "@/lib/neon";

interface UrlAnalyzerProps {
  accessKey: string;
  onAnalyzed: (analysis: UrlAnalysis) => void;
  analysis: UrlAnalysis | null;
}

export default function UrlAnalyzer({ accessKey, onAnalyzed, analysis }: UrlAnalyzerProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleFetch = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError("");

    try {
      const { data, error: fnError } = await supabase.functions.invoke("neon-analyze", {
        body: { url: url.trim(), accessKey },
      });

      if (fnError) {
        setError("Failed to analyze URL");
        setLoading(false);
        return;
      }

      if (data.error && !data.success) {
        setError(data.error);
        setLoading(false);
        return;
      }

      onAnalyzed(data as UrlAnalysis);
    } catch {
      setError("Connection error");
    }
    setLoading(false);
  };

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Globe className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-bold uppercase tracking-wider text-primary">URL Analyzer</h2>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://checkout.stripe.com/..."
          className="flex-1 h-11 px-4 rounded-xl bg-background/50 border border-border/50 text-foreground text-sm font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          onKeyDown={(e) => e.key === "Enter" && handleFetch()}
        />
        <button
          onClick={handleFetch}
          disabled={loading || !url.trim()}
          className="h-11 px-6 rounded-xl bg-primary text-primary-foreground font-bold text-sm flex items-center gap-2 hover:opacity-90 transition-all disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          Fetch
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg mb-4">
          <XCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {analysis?.success && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <InfoChip label="Provider" value={PROVIDER_LABELS[analysis.provider] || analysis.provider} highlight />
            <InfoChip label="Merchant" value={analysis.merchant} />
            <InfoChip label="Product" value={analysis.product || "N/A"} />
            <InfoChip label="Amount" value={analysis.amount ? `${analysis.amount} ${analysis.currency}` : "N/A"} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <InfoChip
              label="Stripe PK"
              value={analysis.stripePk ? `${analysis.stripePk.slice(0, 12)}...` : "Not Found"}
              icon={analysis.stripePk ? <CheckCircle className="w-3 h-3 text-primary" /> : <XCircle className="w-3 h-3 text-destructive" />}
            />
            <InfoChip
              label="Client Secret"
              value={analysis.clientSecret ? "Found ✓" : "Not Found"}
              icon={analysis.clientSecret ? <CheckCircle className="w-3 h-3 text-primary" /> : <XCircle className="w-3 h-3 text-muted-foreground" />}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function InfoChip({ label, value, highlight, icon }: { label: string; value: string; highlight?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="bg-background/40 rounded-xl px-3 py-2.5 border border-border/30">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-sm font-semibold truncate flex items-center gap-1 ${highlight ? "text-primary" : "text-foreground"}`}>
        {icon} {value}
      </div>
    </div>
  );
}
