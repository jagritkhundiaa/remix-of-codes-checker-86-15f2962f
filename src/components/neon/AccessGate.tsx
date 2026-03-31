import { useState } from "react";
import { KeyRound, ArrowRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface AccessGateProps {
  onAuthenticated: (key: string) => void;
}

export default function AccessGate({ onAuthenticated }: AccessGateProps) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;

    setLoading(true);
    setError("");

    try {
      const { data, error: fnError } = await supabase.functions.invoke("neon-analyze", {
        body: { url: "https://example.com", accessKey: key.trim() },
      });

      if (fnError || data?.error === "Invalid access key") {
        setError("Invalid or expired access key");
        setLoading(false);
        return;
      }

      localStorage.setItem("neon_key", key.trim());
      onAuthenticated(key.trim());
    } catch {
      setError("Connection error. Try again.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0">
        <div className="mesh-dot w-[500px] h-[500px]" style={{ background: "hsl(var(--primary))", top: "-200px", right: "-100px" }} />
        <div className="mesh-dot w-[400px] h-[400px]" style={{ background: "hsl(var(--accent))", bottom: "-150px", left: "-100px", animationDelay: "-7s" }} />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-4 glow-primary">
            <KeyRound className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-4xl font-black tracking-tight mb-2">
            <span className="text-gradient-neon">NEON</span>
          </h1>
          <p className="text-muted-foreground text-sm">Enter your access key to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="glass rounded-2xl p-6 space-y-4">
          <div>
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="NEON-XXXX-XXXX"
              className="w-full h-12 px-4 rounded-xl bg-background/50 border border-border/50 text-foreground font-mono text-sm tracking-wider placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all"
              autoFocus
            />
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !key.trim()}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed glow-primary"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                Authenticate <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground/50 mt-6">
          Tool made by TalkNeon
        </p>
      </div>
    </div>
  );
}
