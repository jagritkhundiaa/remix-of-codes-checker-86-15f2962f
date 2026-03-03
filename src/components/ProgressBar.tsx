interface ProgressBarProps {
  current: number;
  total: number;
  status: string;
}

export function ProgressBar({ current, total, status }: ProgressBarProps) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  const barLen = 30;
  const filled = Math.round((percentage / 100) * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

  return (
    <div className="space-y-2 card-3d rounded-sm p-4 font-mono">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">&gt; {status}</span>
        <span className="text-primary">{current}/{total}</span>
      </div>
      <div className="text-xs text-foreground tracking-tight">
        [{bar}] {percentage}%
      </div>
    </div>
  );
}
