import { useState, useEffect } from "react";
import { Globe, Plus, Trash2, Loader2, Zap, CheckCircle, XCircle, Database, ChevronDown, Copy, Check, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CustomGate, UrlAnalysis, PROVIDER_LABELS } from "@/lib/neon";

interface GateManagerProps {
  accessKey: string;
  onGateSelected: (analysis: UrlAnalysis) => void;
  analysis: UrlAnalysis | null;
}

export default function GateManager({ accessKey, onGateSelected, analysis }: GateManagerProps) {
  const [gates, setGates] = useState<CustomGate[]>([]);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    loadGates();
  }, []);

  const loadGates = async () => {
    const { data } = await supabase
      .from("custom_gates")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (data) setGates(data as unknown as CustomGate[]);
  };

  const handleCreate = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError("");

    try {
      // First analyze the URL
      const { data, error: fnError } = await supabase.functions.invoke("neon-analyze", {
        body: { url: url.trim(), accessKey },
      });

      if (fnError || !data?.success) {
        setError(data?.error || "Failed to analyze site");
        setLoading(false);
        return;
      }

      const gateName = name.trim() || data.merchant || new URL(url.trim()).hostname;

      // Save as gate
      const { error: insertErr } = await supabase.from("custom_gates").insert({
        name: gateName,
        site_url: url.trim(),
        provider: data.provider,
        stripe_pk: data.stripePk,
        client_secret: data.clientSecret,
        merchant: data.merchant,
        product: data.product,
        amount: data.amount,
        currency: data.currency,
        created_by: accessKey,
      } as any);

      if (insertErr) {
        setError("Failed to save gate");
      } else {
        setUrl("");
        setName("");
        loadGates();
      }
    } catch {
      setError("Connection error");
    }
    setLoading(false);
  };

  const handleSelect = (gate: CustomGate) => {
    const analysis: UrlAnalysis = {
      url: gate.site_url,
      provider: gate.provider,
      merchant: gate.merchant || "",
      product: gate.product || "",
      productUrl: null,
      amount: gate.amount,
      currency: gate.currency || "USD",
      stripePk: gate.stripe_pk,
      clientSecret: gate.client_secret,
      success: true,
      logs: [`[GATE] Loaded saved gate: ${gate.name}`],
    };
    onGateSelected(analysis);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("custom_gates").delete().eq("id", id);
    loadGates();
  };

  return (
    <div className="glass rounded-2xl p-5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full"
      >
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary">Auto Gates</h2>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold">
            {gates.length}
          </span>
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          {/* Create new gate */}
          <div className="space-y-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Gate name (optional)"
              className="w-full h-9 px-3 rounded-lg bg-background/50 border border-border/50 text-foreground text-xs font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://site.com/checkout..."
                className="flex-1 h-9 px-3 rounded-lg bg-background/50 border border-border/50 text-foreground text-xs font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/50"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <button
                onClick={handleCreate}
                disabled={loading || !url.trim()}
                className="h-9 px-4 rounded-lg bg-primary text-primary-foreground font-bold text-xs flex items-center gap-1.5 hover:opacity-90 transition-all disabled:opacity-40"
              >
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                Create
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
              <XCircle className="w-3 h-3 shrink-0" /> {error}
            </div>
          )}

          {/* Saved gates list */}
          {gates.length > 0 ? (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {gates.map((gate) => (
                <div
                  key={gate.id}
                  className="flex items-center gap-2 bg-background/40 rounded-xl px-3 py-2 border border-border/20 group"
                >
                  <button
                    onClick={() => handleSelect(gate)}
                    className="flex-1 flex items-center gap-2 text-left hover:opacity-80 transition-opacity"
                  >
                    <Globe className="w-3 h-3 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-foreground truncate">{gate.name}</div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                        <span className="text-primary font-semibold">{PROVIDER_LABELS[gate.provider] || gate.provider}</span>
                        {gate.stripe_pk && <CheckCircle className="w-2.5 h-2.5 text-primary" />}
                        {gate.merchant && <span>· {gate.merchant}</span>}
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => handleDelete(gate.id)}
                    className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-all p-1"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground/50 text-center py-3">
              No saved gates yet. Paste any checkout URL to auto-detect & save.
            </div>
          )}
        </div>
      )}
    </div>
  );
}