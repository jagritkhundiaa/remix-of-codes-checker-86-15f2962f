import { Terminal, LogOut, User, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface HeaderProps {
  username?: string;
  onLogout?: () => void;
}

export function Header({ username, onLogout }: HeaderProps) {
  return (
    <header className="relative border-b border-border glass">
      <div className="container mx-auto px-4 py-4 relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 border border-primary/50 rounded-sm shadow-glow">
              <Terminal className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-primary tracking-widest uppercase glitch" data-text="AUTIZMENS">
                AUTIZMENS
              </h1>
              <p className="text-xs text-muted-foreground tracking-[0.3em] uppercase">
                sys://token.validator
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {username && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 px-3 py-1 border border-border rounded-sm bg-secondary/30">
                  <User className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs text-foreground tracking-wider">{username}</span>
                </div>
                {onLogout && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onLogout}
                    className="h-7 px-2 text-muted-foreground hover:text-destructive rounded-sm"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5 px-2 py-1 border border-border rounded-sm bg-secondary/30">
              <Shield className="w-3 h-3 text-primary" />
              <span className="text-[10px] text-muted-foreground tracking-widest">v2.0</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
