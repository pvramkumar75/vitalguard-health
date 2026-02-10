import React from 'react';

export const GlobalBackground: React.FC = () => {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none -z-50 select-none bg-slate-50">
      {/* Noise Texture for Premium Feel */}
      <div 
        className="absolute inset-0 opacity-[0.015] mix-blend-overlay z-[1]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      ></div>

      {/* Animated Gradient Orbs - Slow & Elegant */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-400/20 rounded-full blur-[120px] animate-blob mix-blend-multiply"></div>
      <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-cyan-400/20 rounded-full blur-[120px] animate-blob animation-delay-2000 mix-blend-multiply"></div>
      <div className="absolute bottom-[-20%] left-[20%] w-[50%] h-[50%] bg-indigo-400/20 rounded-full blur-[120px] animate-blob animation-delay-4000 mix-blend-multiply"></div>
      
      {/* Subtle Grid - Low Opacity */}
      <div 
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(#64748b 1px, transparent 1px), linear-gradient(90deg, #64748b 1px, transparent 1px)`,
          backgroundSize: '40px 40px'
        }}
      ></div>
    </div>
  );
};
