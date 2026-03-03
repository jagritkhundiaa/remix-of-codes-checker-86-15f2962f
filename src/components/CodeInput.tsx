import { useState, useCallback } from 'react';
import { Upload, FileText, X } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

interface CodeInputProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  icon?: React.ReactNode;
}

export function CodeInput({ label, placeholder, value, onChange, icon }: CodeInputProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleFileRead = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      onChange(text);
    };
    reader.readAsText(file);
  }, [onChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'text/plain') {
      handleFileRead(file);
    }
  }, [handleFileRead]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileRead(file);
    }
  }, [handleFileRead]);

  const lineCount = value.split('\n').filter(line => line.trim()).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs font-bold text-foreground tracking-widest uppercase">
          {icon}
          {label}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground px-2 py-0.5 border border-border rounded-sm font-mono">
            {lineCount} entries
          </span>
          {value && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-muted-foreground hover:text-destructive rounded-sm"
              onClick={() => onChange('')}
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>
      
      <div
        className={`relative rounded-sm transition-all duration-300 card-3d ${
          isDragging ? 'ring-1 ring-primary shadow-glow' : ''
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="min-h-[200px] border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-xs resize-none text-foreground placeholder:text-muted-foreground rounded-sm"
        />
        
        <div className="absolute bottom-2 right-2">
          <label>
            <input type="file" accept=".txt" className="hidden" onChange={handleFileSelect} />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="cursor-pointer rounded-sm text-xs border border-border"
              asChild
            >
              <span className="flex items-center gap-1.5">
                <Upload className="w-3 h-3" />
                UPLOAD
              </span>
            </Button>
          </label>
        </div>
        
        {isDragging && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/95 rounded-sm">
            <div className="flex items-center gap-2 text-primary font-mono text-sm">
              <FileText className="w-6 h-6" />
              <span>&gt; DROP FILE_</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
