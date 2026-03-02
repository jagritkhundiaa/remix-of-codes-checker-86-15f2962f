import { Sparkles, Zap, LogOut, User } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface HeaderProps {
  username?: string;
  onLogout?: () => void;
}

export function Header({ username, onLogout }: HeaderProps) {
  return (
    <header className="relative border-b border-border/50 glass">
      {/* Glow effect */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent" />
      
      <div className="container mx-auto px-4 py-5 relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="absolute inset-0 gradient-primary blur-xl opacity-50" />
              <div className="relative p-3 rounded-xl gradient-primary shadow-glow">
                <Zap className="w-6 h-6 text-primary-foreground" />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gradient tracking-tight">
                Code Checker
              </h1>
              <p className="text-sm text-muted-foreground">
                Microsoft Token Validator
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {username && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/50 border border-border/50">
                  <User className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">{username}</span>
                </div>
                {onLogout && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onLogout}
                    className="h-8 px-2 text-muted-foreground hover:text-destructive"
                  >
                    <LogOut className="w-4 h-4" />
                  </Button>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/50 border border-border/50">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium text-muted-foreground">v2.0</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
