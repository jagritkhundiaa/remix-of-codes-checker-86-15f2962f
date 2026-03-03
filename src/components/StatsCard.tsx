interface StatsCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  colorClass: string;
}

export function StatsCard({ label, value, icon, colorClass }: StatsCardProps) {
  return (
    <div className="card-3d rounded-sm p-4 animate-scale-in font-mono">
      <div className="flex items-center gap-3">
        <div className={`p-2 border border-border rounded-sm ${colorClass}`}>
          {icon}
        </div>
        <div>
          <div className={`text-2xl font-bold ${colorClass}`}>{value}</div>
          <div className="text-[10px] text-muted-foreground tracking-widest uppercase">{label}</div>
        </div>
      </div>
    </div>
  );
}
