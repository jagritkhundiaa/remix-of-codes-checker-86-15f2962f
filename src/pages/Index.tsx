import { useState, useEffect } from "react";
import { Download, Shield, Zap, Eye, Chrome, Lock, ArrowRight, Sparkles, CheckCircle, Star } from "lucide-react";
import { Button } from "@/components/ui/button";

const FEATURES = [
  { icon: Zap, title: "Auto-Hit Engine", desc: "Stripe, Braintree, Authorize.net — all gateways handled automatically with intelligent form detection." },
  { icon: Shield, title: "Anti-Detection", desc: "Built-in header modification and fingerprint spoofing keeps you under the radar at all times." },
  { icon: Eye, title: "Smart Autofill", desc: "Automatically detects and fills payment forms across thousands of checkout pages." },
  { icon: Lock, title: "hCaptcha Bypass", desc: "Integrated captcha handling so your flow never gets interrupted." },
];

const STATS = [
  { value: "50K+", label: "Hits Processed" },
  { value: "99.2%", label: "Success Rate" },
  { value: "0.3s", label: "Avg Speed" },
  { value: "24/7", label: "Uptime" },
];

const STEPS = [
  { step: "01", title: "Download", desc: "Get the extension ZIP" },
  { step: "02", title: "Unpack", desc: "Extract the ZIP file" },
  { step: "03", title: "Load", desc: "chrome://extensions → Load unpacked" },
  { step: "04", title: "Dominate", desc: "Open any checkout & hit" },
];

export default function Index() {
  const [downloaded, setDownloaded] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, []);

  const handleDownload = () => {
    fetch("/narutox-extension.zip")
      .then((res) => {
        if (!res.ok) throw new Error("Download failed");
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "narutox-extension.zip";
        a.click();
        URL.revokeObjectURL(a.href);
        setDownloaded(true);
      })
      .catch(() => alert("Download failed. Try again."));
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Mesh gradient blobs */}
      <div className="mesh-dot w-[600px] h-[600px]" style={{ background: "hsl(168 76% 36%)", top: "-200px", left: "-100px", animationDelay: "0s" }} />
      <div className="mesh-dot w-[500px] h-[500px]" style={{ background: "hsl(217 91% 60%)", top: "40%", right: "-150px", animationDelay: "-5s" }} />
      <div className="mesh-dot w-[400px] h-[400px]" style={{ background: "hsl(270 76% 55%)", bottom: "-100px", left: "30%", animationDelay: "-10s" }} />

      {/* Cursor glow */}
      <div
        className="fixed pointer-events-none z-50 w-[300px] h-[300px] rounded-full opacity-[0.07]"
        style={{
          background: "radial-gradient(circle, hsl(168 76% 50%), transparent 70%)",
          left: mousePos.x - 150,
          top: mousePos.y - 150,
          transition: "left 0.15s ease, top 0.15s ease",
        }}
      />

      {/* Hero */}
      <section className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 text-center">
        <div className="animate-float mb-8">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-[hsl(217_91%_60%)] flex items-center justify-center shadow-2xl glow-teal">
            <Sparkles className="w-10 h-10 text-primary-foreground" />
          </div>
        </div>

        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass mb-6 text-xs font-medium tracking-wider uppercase text-muted-foreground">
          <Star className="w-3 h-3 text-primary" />
          v1.0 — Premium Release
          <Star className="w-3 h-3 text-primary" />
        </div>

        <h1 className="text-6xl sm:text-7xl md:text-8xl font-black tracking-tight mb-4">
          <span className="text-gradient-teal">NARUTO</span>
          <span className="text-gradient-fire">X</span>
        </h1>

        <p className="text-lg sm:text-xl text-muted-foreground max-w-xl mb-10 leading-relaxed">
          The most advanced checkout automation extension.
          <br />
          <span className="text-foreground font-medium">Hit. Autofill. Dominate.</span>
        </p>

        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <Button
            onClick={handleDownload}
            size="lg"
            className="h-14 px-10 text-base font-bold rounded-xl bg-gradient-to-r from-primary to-[hsl(217_91%_60%)] hover:opacity-90 transition-all glow-teal group"
          >
            {downloaded ? (
              <>
                <CheckCircle className="w-5 h-5 mr-2" />
                Downloaded
              </>
            ) : (
              <>
                <Download className="w-5 h-5 mr-2 group-hover:animate-bounce" />
                Download Extension
              </>
            )}
          </Button>

          <a
            href="#features"
            className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 text-sm"
          >
            Learn more <ArrowRight className="w-4 h-4" />
          </a>
        </div>

        <div className="mt-16 flex items-center gap-2 text-xs text-muted-foreground">
          <Chrome className="w-4 h-4" />
          Compatible with Chrome, Edge, Brave, Arc & Opera
        </div>
      </section>

      {/* Stats */}
      <section className="relative z-10 py-16 px-4">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
          {STATS.map((s) => (
            <div key={s.label} className="glass rounded-2xl p-6 text-center group hover:glow-teal-subtle transition-all duration-300">
              <div className="text-3xl sm:text-4xl font-black text-gradient-teal mb-1">{s.value}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-widest">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-black text-center mb-4">
            Built <span className="text-gradient-teal">Different</span>
          </h2>
          <p className="text-muted-foreground text-center mb-14 max-w-md mx-auto">
            Every feature engineered for speed, stealth, and success.
          </p>

          <div className="grid sm:grid-cols-2 gap-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="feature-card glass rounded-2xl p-7 group hover:bg-card/90 transition-all duration-300 hover:glow-teal-subtle">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <f.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-bold mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Install Steps */}
      <section className="relative z-10 py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-black text-center mb-14">
            Get Started in <span className="text-gradient-fire">Seconds</span>
          </h2>

          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-5">
            {STEPS.map((s, i) => (
              <div key={s.step} className="glass rounded-2xl p-6 text-center relative group hover:glow-teal-subtle transition-all duration-300">
                <div className="text-5xl font-black text-primary/15 mb-3 font-mono">{s.step}</div>
                <h3 className="text-base font-bold mb-1">{s.title}</h3>
                <p className="text-xs text-muted-foreground">{s.desc}</p>
                {i < STEPS.length - 1 && (
                  <ArrowRight className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground/30" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 py-24 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <div className="glass-strong rounded-3xl p-10 glow-teal">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">
              Ready to <span className="text-gradient-teal">Hit</span>?
            </h2>
            <p className="text-muted-foreground mb-8">
              Join the elite. Download NARUTOX now.
            </p>
            <Button
              onClick={handleDownload}
              size="lg"
              className="h-14 px-12 text-base font-bold rounded-xl bg-gradient-to-r from-primary to-[hsl(217_91%_60%)] hover:opacity-90 transition-all"
            >
              <Download className="w-5 h-5 mr-2" />
              {downloaded ? "Download Again" : "Download Now"}
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 py-8 px-4 text-center text-xs text-muted-foreground border-t border-border/30">
        NARUTOX © {new Date().getFullYear()} — For educational purposes only.
      </footer>
    </div>
  );
}
