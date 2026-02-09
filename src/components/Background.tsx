import React from 'react';

export const GlobalBackground: React.FC = () => {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none -z-50 select-none">
      <div className="absolute inset-0 bg-slate-50/50"></div>
      
      {/* Animated Gradient Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-400/10 rounded-full blur-[100px] animate-blob mix-blend-multiply"></div>
      <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-400/10 rounded-full blur-[100px] animate-blob animation-delay-2000 mix-blend-multiply"></div>
      <div className="absolute bottom-[-20%] left-[20%] w-[40%] h-[40%] bg-violet-400/10 rounded-full blur-[100px] animate-blob animation-delay-4000 mix-blend-multiply"></div>
      
      {/* Grid Pattern */}
      <div 
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `radial-gradient(#64748b 1px, transparent 1px)`,
          backgroundSize: '32px 32px'
        }}
      ></div>
    </div>
  );
};
