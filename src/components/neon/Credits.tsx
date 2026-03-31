import { Heart } from "lucide-react";

export default function Credits() {
  return (
    <footer className="text-center py-8 px-4 border-t border-border/20">
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">
          Special thanks to <span className="text-primary font-semibold">Naruto</span>
        </p>
        <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
          Tool made with <Heart className="w-3 h-3 text-destructive fill-destructive" /> by{" "}
          <span className="text-foreground font-bold">TalkNeon</span>
        </p>
      </div>
      <p className="text-[10px] text-muted-foreground/30 mt-3">
        NEON © {new Date().getFullYear()} — For educational purposes only.
      </p>
    </footer>
  );
}
