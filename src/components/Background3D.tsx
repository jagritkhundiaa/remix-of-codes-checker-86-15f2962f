export function Background3D() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {/* Gradient orbs */}
      <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px] float-animation" />
      <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px] float-animation" style={{ animationDelay: '-3s' }} />
      
      {/* Grid pattern */}
      <div 
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `
            linear-gradient(hsl(var(--primary)) 1px, transparent 1px),
            linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />
      
      {/* Floating shapes */}
      <div className="absolute top-20 right-20 w-20 h-20 border border-primary/10 rounded-2xl rotate-12 float-animation" style={{ animationDelay: '-1s' }} />
      <div className="absolute bottom-40 left-20 w-16 h-16 border border-primary/10 rounded-full float-animation" style={{ animationDelay: '-2s' }} />
      <div className="absolute top-1/2 right-10 w-12 h-12 border border-primary/10 rounded-lg rotate-45 float-animation" style={{ animationDelay: '-4s' }} />
      
      {/* Glow lines */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
    </div>
  );
}
