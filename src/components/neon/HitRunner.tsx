import { useState, useRef, useEffect } from "react";
import { Play, Square, Loader2, CheckCircle, XCircle, Shield, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CardData, CheckResult, HitStats, UrlAnalysis } from "@/lib/neon";

interface HitRunnerProps {
  accessKey: string;
  analysis: UrlAnalysis | null;
  cards: CardData[];
}

export default function HitRunner({ accessKey, analysis, cards }: HitRunnerProps) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [current, setCurrent] = useState(0);
  const [stats, setStats] = useState<HitStats>({ total: 0, hits: 0, declines: 0, errors: 0, avgTime: 0 });
  const stopRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [results]);

  const canStart = analysis?.success && analysis?.stripePk && cards.length > 0 && !running;

  const handleStart = async () => {
    if (!canStart || !analysis) return;
    setRunning(true);
    stopRef.current = false;
    setResults([]);
    setCurrent(0);
    setStats({ total: 0, hits: 0, declines: 0, errors: 0, avgTime: 0 });

    let totalTime = 0;
    let hits = 0;
    let declines = 0;
    let errors = 0;

    for (let i = 0; i < cards.length; i++) {
      if (stopRef.current) break;
      setCurrent(i + 1);

      try {
        const { data } = await supabase.functions.invoke("neon-check", {
          body: {
            card: cards[i],
            provider: analysis.provider,
            stripePk: analysis.stripePk,
            clientSecret: analysis.clientSecret,
            merchant: analysis.merchant,
            amount: analysis.amount,
            accessKey,
          },
        });

        if (data && !data.error) {
          const result = data as CheckResult;
          setResults((prev) => [...prev, result]);
          totalTime += result.responseTime;

          if (result.status === "live" || result.status === "charged" || result.status === "3ds") {
            hits++;
          } else if (result.status === "declined") {
            declines++;
          } else {
            errors++;
          }

          setStats({
            total: i + 1,
            hits,
            declines,
            errors,
            avgTime: totalTime / (i + 1),
          });
        } else {
          errors++;
          setResults((prev) => [...prev, {
            card: `${cards[i].number.slice(0, 6)}...${cards[i].number.slice(-4)}`,
            status: "error",
            code: "fn_error",
            message: data?.error || "Function error",
            responseTime: 0,
            bin: cards[i].number.slice(0, 6),
            brand: "UNK",
          }]);
          setStats({
            total: i + 1,
            hits,
            declines,
            errors,
            avgTime: totalTime / (i + 1),
          });
        }
      } catch {
        errors++;
        setStats((s) => ({ ...s, total: i + 1, errors }));
      }

      // Small delay between checks
      if (i < cards.length - 1 && !stopRef.current) {
        await new Promise((r) => setTimeout(r, 800 + Math.random() * 400));
      }
    }

    setRunning(false);
  };

  const handleStop = () => {
    stopRef.current = true;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "live": return <CheckCircle className="w-3 h-3 text-primary" />;
      case "charged": return <Zap className="w-3 h-3 text-yellow-400" />;
      case "3ds": return <Shield className="w-3 h-3 text-blue-400" />;
      case "declined": return <XCircle className="w-3 h-3 text-destructive" />;
      default: return <XCircle className="w-3 h-3 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "live": return "text-primary";
      case "charged": return "text-yellow-400";
      case "3ds": return "text-blue-400";
      case "declined": return "text-destructive";
      default: return "text-muted-foreground";
    }
  };

  const progress = cards.length > 0 ? (current / cards.length) * 100 : 0;

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary">Engine</h2>
        </div>

        <div className="flex gap-2">
          {!running ? (
            <button
              onClick={handleStart}
              disabled={!canStart}
              className="h-9 px-5 rounded-xl bg-primary text-primary-foreground font-bold text-xs flex items-center gap-1.5 hover:opacity-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed glow-primary"
            >
              <Play className="w-3 h-3" /> Start
            </button>
          ) : (
            <button
              onClick={handleStop}
              className="h-9 px-5 rounded-xl bg-destructive text-destructive-foreground font-bold text-xs flex items-center gap-1.5 hover:opacity-90 transition-all"
            >
              <Square className="w-3 h-3" /> Stop
            </button>
          )}
        </div>
      </div>

      {!canStart && !running && (
        <div className="text-xs text-muted-foreground bg-background/30 rounded-xl px-3 py-2 mb-4">
          {!analysis?.success ? "Fetch a URL first" : !analysis?.stripePk ? "No Stripe key found on page" : cards.length === 0 ? "Load cards first" : ""}
        </div>
      )}

      {/* Progress */}
      {(running || results.length > 0) && (
        <>
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-muted-foreground">
                {running && <Loader2 className="w-3 h-3 inline animate-spin mr-1" />}
                {current}/{cards.length}
              </span>
              <span className="text-muted-foreground">{progress.toFixed(0)}%</span>
            </div>
            <div className="h-2 rounded-full bg-background/50 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            <StatBox label="Total" value={stats.total} />
            <StatBox label="Hits" value={stats.hits} color="text-primary" />
            <StatBox label="Declined" value={stats.declines} color="text-destructive" />
            <StatBox label="Avg Time" value={`${stats.avgTime.toFixed(1)}s`} />
          </div>

          {/* Live log */}
          <div
            ref={logRef}
            className="h-48 overflow-y-auto rounded-xl bg-background/60 border border-border/30 p-3 space-y-1 font-mono text-[11px]"
          >
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-muted-foreground/50 w-8 shrink-0">{String(i + 1).padStart(3, "0")}</span>
                {getStatusIcon(r.status)}
                <span className="text-muted-foreground">{r.card}</span>
                <span className={`font-bold uppercase ${getStatusColor(r.status)}`}>{r.status}</span>
                <span className="text-muted-foreground/50 truncate">{r.code}</span>
                <span className="text-muted-foreground/30 ml-auto shrink-0">{r.responseTime.toFixed(1)}s</span>
              </div>
            ))}
            {results.length === 0 && running && (
              <div className="text-muted-foreground/30 text-center py-8">Processing...</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-background/40 rounded-xl px-3 py-2 text-center border border-border/20">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-lg font-black ${color || "text-foreground"}`}>{value}</div>
    </div>
  );
}
