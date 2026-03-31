import { useState } from "react";
import { CreditCard, Dices, Trash2 } from "lucide-react";
import { CardData, generateCards, parseCardLine } from "@/lib/neon";

interface CardInputProps {
  cards: CardData[];
  onCardsChange: (cards: CardData[]) => void;
}

export default function CardInput({ cards, onCardsChange }: CardInputProps) {
  const [mode, setMode] = useState<"cards" | "bin">("cards");
  const [cardText, setCardText] = useState("");
  const [binInput, setBinInput] = useState("");
  const [binCount, setBinCount] = useState(10);

  const handleParseCards = () => {
    const lines = cardText.split("\n").filter((l) => l.trim());
    const parsed = lines.map(parseCardLine).filter(Boolean) as CardData[];
    onCardsChange(parsed);
  };

  const handleGenerate = () => {
    if (!binInput.trim()) return;
    const generated = generateCards(binInput.trim(), binCount);
    onCardsChange(generated);
  };

  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-primary">Card Source</h2>
        </div>
        {cards.length > 0 && (
          <button
            onClick={() => { onCardsChange([]); setCardText(""); }}
            className="text-xs text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      {/* Mode toggle */}
      <div className="flex rounded-xl bg-background/50 border border-border/40 p-1 mb-4">
        <button
          onClick={() => setMode("cards")}
          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${mode === "cards" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Paste Cards
        </button>
        <button
          onClick={() => setMode("bin")}
          className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${mode === "bin" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Dices className="w-3 h-3" /> BIN Generator
        </button>
      </div>

      {mode === "cards" ? (
        <div className="space-y-3">
          <textarea
            value={cardText}
            onChange={(e) => setCardText(e.target.value)}
            placeholder={"4242424242424242|12|26|123\n4111111111111111|06|27|456\n..."}
            rows={5}
            className="w-full px-4 py-3 rounded-xl bg-background/50 border border-border/40 text-foreground text-xs font-mono placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none transition-all"
          />
          <button
            onClick={handleParseCards}
            disabled={!cardText.trim()}
            className="w-full h-10 rounded-xl bg-secondary text-secondary-foreground font-bold text-xs hover:bg-secondary/80 transition-all disabled:opacity-40"
          >
            Load Cards
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <input
            type="text"
            value={binInput}
            onChange={(e) => setBinInput(e.target.value)}
            placeholder="424242 or 424242|MM|YY|CVV"
            className="w-full h-11 px-4 rounded-xl bg-background/50 border border-border/40 text-foreground text-sm font-mono placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
          />
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1 block">Count</label>
              <input
                type="number"
                min={1}
                max={100}
                value={binCount}
                onChange={(e) => setBinCount(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
                className="w-full h-10 px-3 rounded-xl bg-background/50 border border-border/40 text-foreground text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={!binInput.trim()}
              className="h-10 px-6 rounded-xl bg-accent text-accent-foreground font-bold text-xs mt-auto hover:opacity-90 transition-all disabled:opacity-40 flex items-center gap-1"
            >
              <Dices className="w-3 h-3" /> Generate
            </button>
          </div>
        </div>
      )}

      {cards.length > 0 && (
        <div className="mt-4 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-xs text-primary font-semibold">
          {cards.length} card{cards.length !== 1 ? "s" : ""} loaded
        </div>
      )}
    </div>
  );
}
