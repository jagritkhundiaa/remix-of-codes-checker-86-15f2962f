import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Trash2, Loader2, Plus, Power } from "lucide-react";

interface AioProxy {
  id: string;
  proxy: string;
  protocol: string;
  is_active: boolean;
  success_count: number;
  fail_count: number;
  last_status: string | null;
  last_checked: string | null;
}

export default function AioProxyPanel({ adminKey }: { adminKey: string }) {
  const [proxies, setProxies] = useState<AioProxy[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  const call = async (action: string, params: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke("aio-proxies", {
      body: { action, adminKey, ...params },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const load = async () => {
    setLoading(true);
    try {
      const r = await call("list");
      setProxies(r.proxies || []);
    } catch (e) { toast.error((e as Error).message); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const onAdd = async () => {
    if (!input.trim()) return;
    setAdding(true);
    try {
      const r = await call("add", { proxies: input });
      toast.success(`Added ${r.added}/${r.total} (validated ${r.validated})`);
      setInput("");
      await load();
    } catch (e) { toast.error((e as Error).message); }
    setAdding(false);
  };

  const onDelete = async (id: string) => {
    try { await call("delete", { id }); await load(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const onDeleteAll = async () => {
    if (!confirm("Delete ALL AIO proxies?")) return;
    try { await call("delete_all"); await load(); toast.success("Cleared"); }
    catch (e) { toast.error((e as Error).message); }
  };

  const onToggle = async (id: string, is_active: boolean) => {
    try { await call("toggle", { id, is_active }); await load(); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="glass-card p-3 rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">AIO Proxy Pool</h3>
        <span className="text-[10px] text-muted-foreground">
          {proxies.filter(p => p.is_active).length} active / {proxies.length} total
        </span>
      </div>

      <div>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="ip:port&#10;ip:port:user:pass&#10;http://user:pass@ip:port&#10;socks5://ip:port"
          rows={4}
          className="w-full bg-background/40 border border-border/40 rounded p-2 text-xs font-mono"
        />
        <div className="flex gap-2 mt-2">
          <button onClick={onAdd} disabled={adding}
            className="flex-1 px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-1.5">
            {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            Validate & Add
          </button>
          <button onClick={onDeleteAll}
            className="px-3 py-1.5 rounded bg-destructive/20 text-destructive text-xs font-bold hover:bg-destructive/30">
            Clear All
          </button>
        </div>
      </div>

      <div className="max-h-[300px] overflow-y-auto space-y-1">
        {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!loading && proxies.length === 0 && (
          <p className="text-xs text-muted-foreground py-2 text-center">No proxies yet</p>
        )}
        {proxies.map(p => (
          <div key={p.id} className="flex items-center gap-2 p-1.5 rounded bg-background/30 text-xs">
            <button onClick={() => onToggle(p.id, !p.is_active)}
              className={p.is_active ? "text-green-400" : "text-muted-foreground"}>
              <Power className="w-3 h-3" />
            </button>
            <span className="font-mono flex-1 truncate">{p.proxy}</span>
            <span className="text-[10px] text-green-400">✓{p.success_count}</span>
            <span className="text-[10px] text-red-400">✗{p.fail_count}</span>
            <button onClick={() => onDelete(p.id)} className="text-destructive hover:bg-destructive/20 p-1 rounded">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
