import { useState } from 'react';
import { User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface UsernameModalProps {
  onSubmit: (username: string) => void;
}

export function UsernameModal({ onSubmit }: UsernameModalProps) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const trimmed = username.trim();
    if (!trimmed) {
      setError('Username is required');
      return;
    }
    
    if (trimmed.length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }
    
    if (trimmed.length > 20) {
      setError('Username must be less than 20 characters');
      return;
    }
    
    // Save to localStorage
    localStorage.setItem('checker_username', trimmed);
    onSubmit(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4">
        <div className="card-3d rounded-2xl p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
              <User className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Welcome</h1>
            <p className="text-muted-foreground">Enter your username to continue</p>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="text"
                placeholder="Enter username..."
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setError('');
                }}
                className="h-12 text-center text-lg bg-secondary/50 border-0 focus-visible:ring-2 focus-visible:ring-primary"
                autoFocus
              />
              {error && (
                <p className="text-sm text-destructive text-center">{error}</p>
              )}
            </div>
            
            <Button 
              type="submit" 
              className="w-full h-12 text-lg font-semibold shadow-glow"
            >
              Continue
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
