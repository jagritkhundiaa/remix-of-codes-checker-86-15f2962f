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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {icon}
          {label}
        </label>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground px-2 py-1 rounded-md bg-secondary/50">
            {lineCount} lines
          </span>
          {value && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground hover:text-destructive"
              onClick={() => onChange('')}
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>
      
      <div
        className={`relative rounded-xl transition-all duration-300 card-3d ${
          isDragging 
            ? 'ring-2 ring-primary shadow-glow' 
            : 'hover:shadow-glow'
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="min-h-[220px] border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-sm resize-none"
        />
        
        <div className="absolute bottom-3 right-3 flex gap-2">
          <label>
            <input
              type="file"
              accept=".txt"
              className="hidden"
              onChange={handleFileSelect}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="cursor-pointer shadow-3d hover:shadow-glow transition-all"
              asChild
            >
              <span className="flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5" />
                Upload File
              </span>
            </Button>
          </label>
        </div>
        
        {isDragging && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/90 rounded-xl backdrop-blur-sm">
            <div className="flex items-center gap-3 text-primary animate-pulse">
              <FileText className="w-8 h-8" />
              <span className="font-medium">Drop file here</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
