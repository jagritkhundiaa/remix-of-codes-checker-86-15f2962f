import { useState, useEffect } from "react";
import { Globe, Search, Loader2, Trash2, Plus, Play, ExternalLink, CheckCircle, XCircle, AlertTriangle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Category {
  id: string;
  name: string;
  search_queries: string[];
  is_active: boolean;
}

interface ScrapedSite {
  id: string;
  url: string;
  domain: string;
  payment_gateway: string;
  status: string;
  requires_login: boolean;
  requires_phone: boolean;
  stripe_pk: string | null;
  telegram_notified: boolean;
  last_checked: string | null;
  notes: string | null;
  created_at: string;
  gateway_details: { gateType?: string; gateDetails?: string; stripePk?: string } | null;
}

export default function SiteScraper({ accessKey }: { accessKey: string }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [sites, setSites] = useState<ScrapedSite[]>([]);
  const [loading, setLoading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatQueries, setNewCatQueries] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [showAddCat, setShowAddCat] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const [catRes, siteRes] = await Promise.all([
      supabase.from("scraper_categories").select("*").order("created_at", { ascending: false }),
      supabase.from("scraped_sites").select("*").order("created_at", { ascending: false }).limit(100),
    ]);
    if (catRes.data) setCategories(catRes.data as Category[]);
    if (siteRes.data) setSites(siteRes.data as ScrapedSite[]);
    setLoading(false);
  };

  const addCategory = async () => {
    if (!newCatName.trim()) return;
    const queries = newCatQueries.split("\n").map(q => q.trim()).filter(Boolean);
    if (queries.length === 0) queries.push(newCatName);

    await supabase.from("scraper_categories").insert({
      name: newCatName.trim(),
      search_queries: queries,
    });
    setNewCatName("");
    setNewCatQueries("");
    setShowAddCat(false);
    loadData();
  };

  const deleteCategory = async (id: string) => {
    await supabase.from("scraper_categories").delete().eq("id", id);
    loadData();
  };

  const runScraper = async (categoryId?: string) => {
    setScraping(true);
    try {
      const { data, error } = await supabase.functions.invoke("site-scraper", {
        body: categoryId ? { category_id: categoryId } : {},
      });
      if (error) console.error("Scraper error:", error);
      else console.log("Scraper results:", data);
      await loadData();
    } catch (e) {
      console.error("Scraper failed:", e);
    }
    setScraping(false);
  };

  const deleteSite = async (id: string) => {
    await supabase.from("scraped_sites").delete().eq("id", id);
    setSites(prev => prev.filter(s => s.id !== id));
  };

  const filteredSites = sites.filter(s => {
    if (filter === "all") return true;
    if (filter === "stripe") return s.payment_gateway === "stripe";
    if (filter === "adyen") return s.payment_gateway === "adyen";
    if (filter === "2d") return (s.gateway_details as any)?.gateType === '2d';
    if (filter === "3d") return (s.gateway_details as any)?.gateType === '3d';
    if (filter === "confirmed") return s.status === "confirmed";
    if (filter === "pending") return s.status === "pending" || s.status === "analyzed";
    return true;
  });

  const gatewayIcon = (gw: string) => {
    if (gw === "stripe" || gw === "adyen") return <CheckCircle className="w-3.5 h-3.5 text-primary" />;
    if (gw === "unknown") return <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />;
    return <XCircle className="w-3.5 h-3.5 text-muted-foreground" />;
  };

  const stats = {
    total: sites.length,
    stripe: sites.filter(s => s.payment_gateway === "stripe").length,
    adyen: sites.filter(s => s.payment_gateway === "adyen").length,
    confirmed: sites.filter(s => s.status === "confirmed").length,
  };

  return (
    <div className="glass rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary">Site Scraper</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={() => loadData()} className="p-2 rounded-lg bg-background/40 hover:bg-background/60 transition-all" disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => runScraper()}
            disabled={scraping || categories.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-all disabled:opacity-40"
          >
            {scraping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {scraping ? "Scraping..." : "Run Now"}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        <StatChip label="Total" value={stats.total} />
        <StatChip label="Stripe" value={stats.stripe} highlight />
        <StatChip label="Adyen" value={stats.adyen} highlight />
        <StatChip label="Confirmed" value={stats.confirmed} />
      </div>

      {/* Categories */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Categories</span>
          <button onClick={() => setShowAddCat(!showAddCat)} className="text-xs text-primary hover:opacity-80">
            <Plus className="w-3.5 h-3.5 inline" /> Add
          </button>
        </div>

        {showAddCat && (
          <div className="bg-background/40 rounded-xl p-3 border border-border/30 mb-3 space-y-2">
            <input
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              placeholder="Category name (e.g., AI Tools)"
              className="w-full h-9 px-3 rounded-lg bg-background/50 border border-border/50 text-sm font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <textarea
              value={newCatQueries}
              onChange={e => setNewCatQueries(e.target.value)}
              placeholder={"Search queries (one per line):\nAI reels maker with payment\nauto content creator stripe checkout"}
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border/50 text-xs font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
            <button onClick={addCategory} className="w-full h-8 rounded-lg bg-primary text-primary-foreground text-xs font-bold">
              Add Category
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {categories.map(cat => (
            <div key={cat.id} className="flex items-center gap-1.5 bg-background/40 rounded-lg px-2.5 py-1.5 border border-border/30 text-xs">
              <span className="font-medium">{cat.name}</span>
              <span className="text-muted-foreground">({cat.search_queries.length}q)</span>
              <button onClick={() => runScraper(cat.id)} disabled={scraping} className="text-primary hover:opacity-80 ml-1">
                <Play className="w-3 h-3" />
              </button>
              <button onClick={() => deleteCategory(cat.id)} className="text-destructive/60 hover:text-destructive">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          {categories.length === 0 && (
            <p className="text-xs text-muted-foreground">No categories yet. Add one to start scraping.</p>
          )}
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-1.5 flex-wrap">
        {["all", "stripe", "adyen", "2d", "3d", "confirmed", "pending"].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${filter === f ? "bg-primary text-primary-foreground" : "bg-background/40 text-muted-foreground hover:text-foreground"}`}
          >
            {f === '2d' ? '2D Gates' : f === '3d' ? '3D Gates' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Sites list */}
      <div className="space-y-1.5 max-h-80 overflow-y-auto">
        {filteredSites.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No sites found. Run the scraper to discover sites.</p>
        )}
        {filteredSites.map(site => (
          <div key={site.id} className="flex items-center gap-2 bg-background/40 rounded-xl px-3 py-2 border border-border/30">
            {gatewayIcon(site.payment_gateway)}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold truncate">{site.domain}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  site.payment_gateway === "stripe" ? "bg-primary/20 text-primary" :
                  site.payment_gateway === "adyen" ? "bg-blue-500/20 text-blue-400" :
                  "bg-muted text-muted-foreground"
                }`}>
                  {site.payment_gateway}
                </span>
                {(site.gateway_details as any)?.gateType === '2d' && <span className="text-[10px] px-1 rounded bg-green-500/20 text-green-400 font-bold">2D</span>}
                {(site.gateway_details as any)?.gateType === '3d' && <span className="text-[10px] px-1 rounded bg-blue-500/20 text-blue-400 font-bold">3D</span>}
                {site.requires_login && <span className="text-[10px] text-yellow-500">🔐</span>}
                {site.requires_phone && <span className="text-[10px] text-destructive">📱</span>}
                {site.telegram_notified && <span className="text-[10px]">✈️</span>}
              </div>
              <div className="text-[10px] text-muted-foreground truncate">{site.url}</div>
            </div>
            <a href={site.url} target="_blank" rel="noopener" className="p-1 text-muted-foreground hover:text-foreground">
              <ExternalLink className="w-3 h-3" />
            </a>
            <button onClick={() => deleteSite(site.id)} className="p-1 text-destructive/40 hover:text-destructive">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatChip({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="bg-background/40 rounded-xl px-3 py-2 border border-border/30 text-center">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold ${highlight ? "text-primary" : "text-foreground"}`}>{value}</div>
    </div>
  );
}
