import React from 'react';

export const Logo: React.FC<{ className?: string }> = ({ className = "w-10 h-10" }) => {
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full drop-shadow-lg"
      >
        <defs>
          <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#2563EB" />
            <stop offset="100%" stopColor="#06B6D4" />
          </linearGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        
        {/* Abstract Shield/V Shape */}
        <path
          d="M50 88C25 75 15 55 15 30V15L50 5L85 15V30C85 55 75 75 50 88Z"
          fill="url(#logoGradient)"
          opacity="0.1"
        />
        <path
          d="M50 80C30 70 20 52 20 32V20L50 12L80 20V32C80 52 70 70 50 80Z"
          stroke="url(#logoGradient)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        
        {/* Central Pulse Line */}
        <path
          d="M35 50H42L47 40L53 60L58 50H65"
          stroke="url(#logoGradient)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="animate-pulse"
        />
        
        {/* Dot Accent */}
        <circle cx="75" cy="25" r="3" fill="#06B6D4" className="animate-ping" />
      </svg>
    </div>
  );
};
