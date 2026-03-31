import { useState, useEffect, useRef } from "react";
import { Activity, CheckCircle, XCircle, Shield, Zap, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LogEntry } from "@/lib/neon";

interface ActivityLogsProps {
  accessKey: string;
}

export default function ActivityLogs({ accessKey }: ActivityLogsProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'hits' | 'declined'>('all');
  const logRef = useRef<HTMLDivElement>(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.functions.invoke("neon-admin", {
        body: { action: 'get_logs', adminKey: accessKey, limit: 50 },
      });
      if (data?.logs) {
        setLogs(data.logs as LogEntry[]);
      }
    } catch { /* silent */ }
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
    // Auto-refresh every 10 seconds
    const interval = setInterval(fetchLogs, 10000);
    return () => clearInterval(interval);
  }, []);

  const filteredLogs = filter === 'all' ? logs
    : filter === 'hits' ? logs.filter(l => ['live', 'charged', '3ds'].includes(l.status))
    : logs.filter(l => l.status === 'declined');

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'live': return <CheckCircle className="w-3 h-3 text-primary" />;
      case 'charged': return <Zap className="w-3 h-3 text-yellow-400" />;
      case '3ds': return <Shield className="w-3 h-3 text-blue-400" />;
      case 'declined': return <XCircle className="w-3 h-3 text-destructive" />;
      default: return <XCircle className="w-3 h-3 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'live': return 'text-primary';
      case 'charged': return 'text-yellow-400';
      case '3ds': return 'text-blue-400';
      case 'declined': return 'text-destructive';
      default: return 'text-muted-foreground';
    }
  };

  const hitCount = logs.filter(l => ['live', 'charged', '3ds'].includes(l.status)).length;
  const declineCount = logs.filter(l => l.status === 'declined').length;

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary">Activity Logs</h2>
          <span className="text-[10px] text-muted-foreground/50">{logs.length} entries</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {(['all', 'hits', 'declined'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[10px] px-2 py-1 rounded-lg font-bold uppercase tracking-wider transition-all ${
                  filter === f ? 'bg-primary/20 text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'
                }`}
              >
                {f === 'all' ? `All (${logs.length})` : f === 'hits' ? `Hits (${hitCount})` : `Dead (${declineCount})`}
              </button>
            ))}
          </div>
          <button onClick={fetchLogs} className="text-muted-foreground hover:text-primary transition-colors">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <div className="bg-background/40 rounded-lg px-2 py-1.5 text-center border border-border/20">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Total</div>
          <div className="text-sm font-black text-foreground">{logs.length}</div>
        </div>
        <div className="bg-background/40 rounded-lg px-2 py-1.5 text-center border border-border/20">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Hits</div>
          <div className="text-sm font-black text-primary">{hitCount}</div>
        </div>
        <div className="bg-background/40 rounded-lg px-2 py-1.5 text-center border border-border/20">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Dead</div>
          <div className="text-sm font-black text-destructive">{declineCount}</div>
        </div>
        <div className="bg-background/40 rounded-lg px-2 py-1.5 text-center border border-border/20">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Rate</div>
          <div className="text-sm font-black text-foreground">
            {logs.length > 0 ? `${((hitCount / logs.length) * 100).toFixed(1)}%` : '0%'}
          </div>
        </div>
      </div>

      {/* Log entries */}
      <div ref={logRef} className="h-56 overflow-y-auto rounded-xl bg-background/60 border border-border/30 p-3 space-y-1 font-mono text-[11px]">
        {filteredLogs.length === 0 && (
          <div className="text-muted-foreground/30 text-center py-8">
            {loading ? 'Loading...' : 'No activity logs yet. Run some checks to see results here.'}
          </div>
        )}
        {filteredLogs.map((l) => (
          <div key={l.id} className="flex items-center gap-2 py-0.5 hover:bg-background/30 rounded px-1 transition-colors">
            {getStatusIcon(l.status)}
            <span className="text-muted-foreground/40 w-14 shrink-0 text-[9px]">
              {new Date(l.created_at).toLocaleTimeString()}
            </span>
            <span className="text-muted-foreground truncate w-24 shrink-0">{l.card_masked}</span>
            <span className={`font-bold uppercase w-16 shrink-0 ${getStatusColor(l.status)}`}>{l.status}</span>
            <span className={`text-[9px] px-1 rounded font-bold shrink-0 ${
              l.mode === 'bypasser' ? 'bg-accent/20 text-accent-foreground' : 'bg-primary/10 text-primary'
            }`}>
              {l.mode === 'bypasser' ? 'BYP' : 'HIT'}
            </span>
            <span className="text-muted-foreground/50 truncate flex-1">{l.code}</span>
            <span className="text-muted-foreground/40 truncate max-w-[80px] shrink-0">{l.merchant}</span>
            {l.amount && <span className="text-primary/60 shrink-0 text-[10px]">{l.amount}</span>}
            <span className="text-muted-foreground/30 ml-auto shrink-0">{l.response_time?.toFixed(1)}s</span>
          </div>
        ))}
      </div>
    </div>
  );
}
