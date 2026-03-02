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

  // Use virtualization for large lists (>100 items)
  const shouldVirtualize = items.length > 100;

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44, // Estimated row height
    overscan: 20, // Render extra items above/below viewport
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

  // Memoize displayed items for non-virtualized view (limit to 500)
  const displayedItems = useMemo(() => {
    if (shouldVirtualize) return items;
    return items.slice(0, 500);
  }, [items, shouldVirtualize]);

  if (items.length === 0) return null;

  return (
    <div className="rounded-xl overflow-hidden card-3d animate-scale-in">
      <div 
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-secondary/30 transition-colors border-b border-border/50"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg bg-secondary ${colorClass}`}>
            {icon}
          </div>
          <span className="font-semibold">{title}</span>
          <span className="px-2.5 py-0.5 rounded-full bg-secondary text-xs font-medium text-muted-foreground">
            {items.length.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => { e.stopPropagation(); handleCopy(); }}
          >
            {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => { e.stopPropagation(); handleDownload(); }}
          >
            <Download className="w-4 h-4 text-muted-foreground" />
          </Button>
          {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>
      
      {isExpanded && (
        <div 
          ref={parentRef}
          className="max-h-[280px] overflow-auto"
        >
          {shouldVirtualize ? (
            // Virtualized list for large datasets
            <div
              className="p-4"
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualItem) => (
                <div
                  key={virtualItem.key}
                  className="group flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-secondary/50 transition-all font-mono text-sm absolute w-full left-0 right-0"
                  style={{
                    height: `${virtualItem.size}px`,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <span className="text-muted-foreground w-8 text-right text-xs flex-shrink-0">
                    {(virtualItem.index + 1).toLocaleString()}
                  </span>
                  <span className="flex-1 break-all text-foreground/90 truncate">
                    {items[virtualItem.index]}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    onClick={() => navigator.clipboard.writeText(items[virtualItem.index])}
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            // Regular list for small datasets
            <div className="p-4 space-y-1 font-mono text-sm">
              {displayedItems.map((item, index) => (
                <div 
                  key={index} 
                  className="group flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-secondary/50 transition-all"
                >
                  <span className="text-muted-foreground w-8 text-right text-xs flex-shrink-0">
                    {(index + 1).toLocaleString()}
                  </span>
                  <span className="flex-1 break-all text-foreground/90">{item}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    onClick={() => navigator.clipboard.writeText(item)}
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              ))}
              {items.length > 500 && !shouldVirtualize && (
                <div className="text-center text-muted-foreground text-xs py-2">
                  Showing first 500 items. Use download to get all {items.length.toLocaleString()} items.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
