interface ProgressBarProps {
  current: number;
  total: number;
  status: string;
}

export function ProgressBar({ current, total, status }: ProgressBarProps) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="space-y-3 card-3d rounded-xl p-5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground font-medium">{status}</span>
        <span className="text-foreground font-mono font-semibold">
          {current}/{total} <span className="text-primary">({percentage}%)</span>
        </span>
      </div>
      <div className="h-2.5 bg-secondary rounded-full overflow-hidden shadow-inner-3d">
        <div 
          className="h-full gradient-primary transition-all duration-500 ease-out rounded-full relative"
          style={{ width: `${percentage}%` }}
        >
          <div className="absolute inset-0 shimmer" />
        </div>
      </div>
    </div>
  );
}
