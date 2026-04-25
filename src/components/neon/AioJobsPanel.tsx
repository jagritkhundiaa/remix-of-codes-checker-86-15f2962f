import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CheckCircle2, XCircle, AlertTriangle, Mail, Loader2, Trash2, Download } from "lucide-react";

interface AioJob {
  id: string;
  status: string;
  total: number;
  processed: number;
  hits: number;
  bads: number;
  twofa: number;
  valid_mail: number;
  errors: number;
  label: string | null;
  created_at: string;
}

interface AioResult {
  id: string;
  email: string;
  password: string;
  status: string;
  capture: string | null;
  created_at: string;
}

export default function AioJobsPanel({ accessKey }: { accessKey: string }) {
  const [jobs, setJobs] = useState<AioJob[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [results, setResults] = useState<AioResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Load jobs
  const loadJobs = async () => {
    const { data } = await supabase
      .from("aio_jobs")
      .select("*")
      .eq("access_key", accessKey)
      .order("created_at", { ascending: false })
      .limit(20);
    setJobs((data as AioJob[]) || []);
  };

  useEffect(() => {
    loadJobs();
    const ch = supabase
      .channel("aio_jobs_panel")
      .on("postgres_changes", { event: "*", schema: "public", table: "aio_jobs" }, () => loadJobs())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [accessKey]);

  // Load results for selected job + realtime subscribe
  useEffect(() => {
    if (!selected) { setResults([]); return; }
    let alive = true;
    setLoading(true);
    supabase.from("aio_results").select("*").eq("job_id", selected)
      .order("created_at", { ascending: false }).limit(500)
      .then(({ data }) => { if (alive) { setResults((data as AioResult[]) || []); setLoading(false); } });
    const ch = supabase
      .channel(`aio_results_${selected}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "aio_results", filter: `job_id=eq.${selected}` },
        (payload) => setResults(prev => [payload.new as AioResult, ...prev].slice(0, 500))
      )
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [selected]);

  const deleteJob = async (id: string) => {
    if (!confirm("Delete this job and all its results?")) return;
    await supabase.from("aio_jobs").delete().eq("id", id);
    if (selected === id) setSelected(null);
    toast.success("Job deleted");
  };

  const downloadHits = async (jobId: string) => {
    const { data } = await supabase.from("aio_results")
      .select("email,password,status,capture")
      .eq("job_id", jobId)
      .in("status", ["hit", "twofa", "valid_mail"])
      .limit(10000);
    const lines = (data || []).map((r: AioResult) =>
      `[${r.status.toUpperCase()}] ${r.email}:${r.password}${r.capture ? ` | ${r.capture}` : ""}`
    );
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `aio-${jobId.slice(0, 8)}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  const statusColor = (s: string) =>
    s === "hit" ? "text-green-400"
    : s === "twofa" ? "text-yellow-400"
    : s === "valid_mail" ? "text-cyan-400"
    : s === "error" ? "text-orange-400"
    : "text-muted-foreground";

  const statusIcon = (s: string) =>
    s === "hit" ? <CheckCircle2 className="w-3 h-3" />
    : s === "twofa" ? <AlertTriangle className="w-3 h-3" />
    : s === "valid_mail" ? <Mail className="w-3 h-3" />
    : <XCircle className="w-3 h-3" />;

  return (
    <div className="grid md:grid-cols-2 gap-3">
      {/* Jobs list */}
      <div className="glass-card p-3 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold">Check Jobs</h3>
          <span className="text-[10px] text-muted-foreground">{jobs.length} jobs</span>
        </div>
        <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
          {jobs.length === 0 && <p className="text-xs text-muted-foreground py-4 text-center">No jobs yet. Check combos to start.</p>}
          {jobs.map(j => {
            const pct = j.total ? Math.round((j.processed / j.total) * 100) : 0;
            const isSel = selected === j.id;
            return (
              <div key={j.id}
                onClick={() => setSelected(j.id)}
                className={`p-2 rounded border cursor-pointer transition-colors ${isSel ? "border-primary bg-primary/5" : "border-border/30 hover:border-border/60"}`}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <div className="flex items-center gap-1.5">
                    {j.status === "running" && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
                    {j.status === "done" && <CheckCircle2 className="w-3 h-3 text-green-400" />}
                    <span className="font-mono">{j.label || j.id.slice(0, 8)}</span>
                    <span className="text-[9px] text-muted-foreground uppercase">{j.status}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={(e) => { e.stopPropagation(); downloadHits(j.id); }}
                      className="p-1 hover:bg-foreground/10 rounded"><Download className="w-3 h-3" /></button>
                    <button onClick={(e) => { e.stopPropagation(); deleteJob(j.id); }}
                      className="p-1 hover:bg-destructive/20 rounded"><Trash2 className="w-3 h-3" /></button>
                  </div>
                </div>
                <div className="w-full h-1 bg-foreground/5 rounded overflow-hidden mb-1">
                  <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex gap-2 text-[10px]">
                  <span className="text-green-400">✓ {j.hits}</span>
                  <span className="text-yellow-400">2FA {j.twofa}</span>
                  <span className="text-cyan-400">VM {j.valid_mail}</span>
                  <span className="text-muted-foreground">✗ {j.bads}</span>
                  <span className="ml-auto text-muted-foreground">{j.processed}/{j.total}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Results */}
      <div className="glass-card p-3 rounded-lg">
        <h3 className="text-sm font-bold mb-2">Live Results</h3>
        {!selected && <p className="text-xs text-muted-foreground py-4 text-center">Select a job to see results</p>}
        {selected && (
          <div className="space-y-1 max-h-[400px] overflow-y-auto font-mono text-[10px]">
            {loading && <p className="text-muted-foreground">Loading…</p>}
            {results.map(r => (
              <div key={r.id} className={`flex items-start gap-1.5 py-0.5 ${statusColor(r.status)}`}>
                {statusIcon(r.status)}
                <span className="truncate">{r.email}:{r.password}</span>
                {r.capture && <span className="text-muted-foreground/60 truncate">| {r.capture}</span>}
              </div>
            ))}
            {!loading && results.length === 0 && <p className="text-muted-foreground">No results yet…</p>}
          </div>
        )}
      </div>
    </div>
  );
}
