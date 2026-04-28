import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Upload, Download, Trash2, FileText, Layers, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { parseAll, dedupe, dedupeByEmail, toText, downloadText } from "@/lib/comboTools";

type LoadedFile = { name: string; size: number; lines: number; combos: number };

export default function ComboCombiner() {
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [rawChunks, setRawChunks] = useState<string[]>([]);
  const [merged, setMerged] = useState<string>("");
  const [stats, setStats] = useState<{ total: number; unique: number; uniqueEmails: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailOnly, setEmailOnly] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setBusy(true);
    const newFiles: LoadedFile[] = [];
    const newChunks: string[] = [];
    for (const f of Array.from(list)) {
      try {
        const txt = await f.text();
        const parsed = parseAll(txt);
        newChunks.push(txt);
        newFiles.push({
          name: f.name,
          size: f.size,
          lines: txt.split(/\r?\n/).length,
          combos: parsed.length,
        });
      } catch {
        toast.error(`Failed to read ${f.name}`);
      }
    }
    setFiles((prev) => [...prev, ...newFiles]);
    setRawChunks((prev) => [...prev, ...newChunks]);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    toast.success(`Loaded ${newFiles.length} file(s)`);
  }

  function combine() {
    if (rawChunks.length === 0) {
      toast.error("Add some files first");
      return;
    }
    setBusy(true);
    const all = parseAll(rawChunks.join("\n"));
    const unique = emailOnly ? dedupeByEmail(all) : dedupe(all);
    const out = toText(unique);
    setMerged(out);
    setStats({
      total: all.length,
      unique: dedupe(all).length,
      uniqueEmails: dedupeByEmail(all).length,
    });
    setBusy(false);
    toast.success(`Combined ${unique.length.toLocaleString()} clean combos`);
  }

  function clearAll() {
    setFiles([]);
    setRawChunks([]);
    setMerged("");
    setStats(null);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setRawChunks((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="mesh-dot w-[600px] h-[600px]" style={{ background: "hsl(var(--primary))", top: "-250px", right: "-150px" }} />
      <div className="mesh-dot w-[400px] h-[400px]" style={{ background: "hsl(var(--accent))", bottom: "-100px", left: "-100px", animationDelay: "-8s" }} />

      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-border/20">
        <Link to="/" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="w-3 h-3" /> Back
        </Link>
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          <span className="text-lg font-black tracking-tight text-gradient-neon">COMBO COMBINER</span>
        </div>
        <div className="w-12" />
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-4 py-8 space-y-6">
        <section className="rounded-xl border border-border/30 bg-card/40 backdrop-blur-sm p-6">
          <h2 className="text-sm font-bold text-foreground mb-1">Merge multiple combo files</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Drop any messy files (URL:user:pass, ULP, plain combos) — we extract <code>email:pass</code>, dedupe & clean.
          </p>

          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => inputRef.current?.click()}
              className="px-4 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary text-xs font-bold hover:bg-primary/20 transition flex items-center gap-2"
            >
              <Upload className="w-3 h-3" /> Add Files
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".txt,.csv,.log,text/plain"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <button
              onClick={combine}
              disabled={busy || files.length === 0}
              className="px-4 py-2 rounded-lg bg-accent/10 border border-accent/30 text-accent text-xs font-bold hover:bg-accent/20 transition disabled:opacity-40 flex items-center gap-2"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Layers className="w-3 h-3" />} Combine
            </button>
            <button
              onClick={clearAll}
              disabled={files.length === 0 && !merged}
              className="px-4 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs font-bold hover:bg-destructive/20 transition disabled:opacity-40 flex items-center gap-2"
            >
              <Trash2 className="w-3 h-3" /> Clear
            </button>
            <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={emailOnly}
                onChange={(e) => setEmailOnly(e.target.checked)}
                className="accent-primary"
              />
              Dedupe by email only
            </label>
          </div>

          {files.length > 0 && (
            <div className="space-y-1 mb-4 max-h-60 overflow-auto">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-background/40 border border-border/20">
                  <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="font-mono truncate flex-1">{f.name}</span>
                  <span className="text-muted-foreground tabular-nums">{f.combos.toLocaleString()} combos</span>
                  <span className="text-muted-foreground/60 tabular-nums">{(f.size / 1024).toFixed(1)} KB</span>
                  <button
                    onClick={() => removeFile(i)}
                    className="text-destructive/70 hover:text-destructive"
                    aria-label="Remove file"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {stats && (
            <div className="grid grid-cols-3 gap-2 mb-4">
              <Stat label="Extracted" value={stats.total} />
              <Stat label="Unique combos" value={stats.unique} />
              <Stat label="Unique emails" value={stats.uniqueEmails} />
            </div>
          )}

          {merged && (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Result preview</span>
                <button
                  onClick={() => downloadText(`combined_${Date.now()}.txt`, merged)}
                  className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition flex items-center gap-2"
                >
                  <Download className="w-3 h-3" /> Download
                </button>
              </div>
              <textarea
                readOnly
                value={merged.slice(0, 50_000)}
                className="w-full h-64 p-3 rounded-lg bg-background/60 border border-border/30 text-xs font-mono text-foreground resize-none"
              />
              {merged.length > 50_000 && (
                <p className="text-[10px] text-muted-foreground mt-1">Preview truncated — full result is in the download.</p>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-background/40 border border-border/20 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-black text-foreground tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}
