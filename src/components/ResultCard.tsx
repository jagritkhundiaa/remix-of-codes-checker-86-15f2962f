import { useState, useRef, useMemo } from 'react';
import { Copy, Download, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useVirtualizer } from '@tanstack/react-virtual';

interface ResultCardProps {
  title: string;
  icon: React.ReactNode;
  items: string[];
  colorClass: string;
}

export function ResultCard({ title, icon, items, colorClass }: ResultCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);

  const shouldVirtualize = items.length > 100;

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 20,
  });

  const handleCopy = async () => {
    await navigator.clipboard.writeText(items.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([items.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '_').toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const displayedItems = useMemo(() => {
    if (shouldVirtualize) return items;
    return items.slice(0, 500);
  }, [items, shouldVirtualize]);

  if (items.length === 0) return null;

  return (
    <div className="rounded-sm overflow-hidden card-3d animate-scale-in">
      <div 
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-secondary/30 transition-colors border-b border-border"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <div className={`p-1.5 border border-border rounded-sm ${colorClass}`}>
            {icon}
          </div>
          <span className="font-bold text-xs tracking-widest uppercase">{title}</span>
          <span className="px-2 py-0.5 border border-border rounded-sm text-[10px] font-mono text-muted-foreground">
            {items.length.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-sm"
            onClick={(e) => { e.stopPropagation(); handleCopy(); }}>
            {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-sm"
            onClick={(e) => { e.stopPropagation(); handleDownload(); }}>
            <Download className="w-3 h-3 text-muted-foreground" />
          </Button>
          {isExpanded ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
        </div>
      </div>
      
      {isExpanded && (
        <div ref={parentRef} className="max-h-[250px] overflow-auto">
          {shouldVirtualize ? (
            <div className="p-3" style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map((virtualItem) => (
                <div key={virtualItem.key}
                  className="group flex items-center gap-2 py-1.5 px-2 hover:bg-secondary/30 transition-all font-mono text-xs absolute w-full left-0"
                  style={{ height: `${virtualItem.size}px`, transform: `translateY(${virtualItem.start}px)` }}>
                  <span className="text-muted-foreground w-6 text-right text-[10px] flex-shrink-0">
                    {(virtualItem.index + 1).toLocaleString()}
                  </span>
                  <span className="flex-1 break-all text-foreground/80 truncate">{items[virtualItem.index]}</span>
                  <Button variant="ghost" size="icon"
                    className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 rounded-sm"
                    onClick={() => navigator.clipboard.writeText(items[virtualItem.index])}>
                    <Copy className="w-2.5 h-2.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-3 space-y-0.5 font-mono text-xs">
              {displayedItems.map((item, index) => (
                <div key={index} className="group flex items-center gap-2 py-1.5 px-2 hover:bg-secondary/30 transition-all">
                  <span className="text-muted-foreground w-6 text-right text-[10px] flex-shrink-0">
                    {(index + 1).toLocaleString()}
                  </span>
                  <span className="flex-1 break-all text-foreground/80">{item}</span>
                  <Button variant="ghost" size="icon"
                    className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 rounded-sm"
                    onClick={() => navigator.clipboard.writeText(item)}>
                    <Copy className="w-2.5 h-2.5" />
                  </Button>
                </div>
              ))}
              {items.length > 500 && !shouldVirtualize && (
                <div className="text-center text-muted-foreground text-[10px] py-2 tracking-wider">
                  &gt; SHOWING 500/{items.length.toLocaleString()} — DOWNLOAD FOR FULL OUTPUT
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
