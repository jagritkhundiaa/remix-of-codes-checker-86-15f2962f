interface StatsCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  colorClass: string;
}

export function StatsCard({ label, value, icon, colorClass }: StatsCardProps) {
  return (
    <div className="card-3d rounded-xl p-5 animate-scale-in">
      <div className="flex items-center gap-4">
        <div className={`p-3 rounded-xl bg-secondary/80 ${colorClass}`}>
          {icon}
        </div>
        <div>
          <div className={`text-3xl font-bold ${colorClass}`}>{value}</div>
          <div className="text-sm text-muted-foreground font-medium">{label}</div>
        </div>
      </div>
    </div>
  );
}
