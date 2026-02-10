import React, { useState } from 'react';
import { Globe, ChevronDown, Check } from 'lucide-react';
import { Language } from '../../types';

interface LanguageSwitcherProps {
  current: Language;
  onChange: (l: Language) => void;
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ current, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const langs: { id: Language; label: string; native: string }[] = [
    { id: 'en', label: 'English', native: 'English' },
    { id: 'hi', label: 'Hindi', native: 'हिन्दी' },
    { id: 'te', label: 'Telugu', native: 'తెలుగు' }
  ];

  const currentLang = langs.find(l => l.id === current) || langs[0];

  return (
    <div className="relative no-print z-50">
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur-md border border-slate-200 rounded-xl shadow-sm hover:border-blue-300 hover:shadow-md transition-all group"
        >
          <Globe className="w-4 h-4 text-slate-500 group-hover:text-blue-600 transition-colors" />
          <span className="text-sm font-semibold text-slate-700 group-hover:text-slate-900">{currentLang.label}</span>
          <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        
        {isOpen && (
          <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
            {langs.map((l) => (
              <button
                key={l.id}
                onClick={() => { onChange(l.id); setIsOpen(false); }}
                className={`w-full px-4 py-3 text-left text-sm font-medium flex items-center justify-between transition-colors ${
                  current === l.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div className="flex flex-col">
                  <span>{l.label}</span>
                  <span className="text-xs text-slate-400 font-normal">{l.native}</span>
                </div>
                {current === l.id && <Check className="w-4 h-4 text-blue-600" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
