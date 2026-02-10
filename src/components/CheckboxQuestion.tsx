import React, { useState } from 'react';
import { StructuredQuestion } from '../../types';

interface CheckboxQuestionProps {
  question: StructuredQuestion;
  onSelectionChange: (selectedOptions: string[]) => void;
}

export const CheckboxQuestion: React.FC<CheckboxQuestionProps> = ({ question, onSelectionChange }) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const handleToggle = (optionId: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(optionId)) {
      newSelected.delete(optionId);
    } else {
      newSelected.add(optionId);
    }
    setSelected(newSelected);
    onSelectionChange(Array.from(newSelected));
  };

  return (
    <div className="bg-gradient-to-br from-blue-50 via-cyan-50/50 to-blue-50 border-2 border-blue-200/60 rounded-3xl p-6 mb-4 shadow-lg hover:shadow-xl transition-shadow relative overflow-hidden">
      {/* Decorative elements */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-cyan-100/40 to-transparent rounded-full blur-2xl"></div>
      <div className="absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr from-blue-100/40 to-transparent rounded-full blur-xl"></div>

      <p className="text-sm font-bold text-slate-800 mb-4 relative z-10 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 animate-pulse"></span>
        {question.questionText}
      </p>

      <div className="space-y-3 relative z-10">
        {question.options.map((option) => (
          <label
            key={option.id}
            className={`flex items-center gap-4 p-4 rounded-2xl cursor-pointer transition-all transform hover:scale-[1.02] active:scale-[0.98] group ${selected.has(option.id)
              ? 'bg-gradient-to-r from-white to-blue-50 border-2 border-blue-500 shadow-md shadow-blue-200/50'
              : 'bg-white/80 backdrop-blur-sm border-2 border-slate-200/60 hover:border-blue-300 hover:shadow-md'
              }`}
          >
            <div className="relative">
              <input
                type="checkbox"
                checked={selected.has(option.id)}
                onChange={() => handleToggle(option.id)}
                className="w-5 h-5 cursor-pointer accent-blue-600 transition-transform checked:scale-110"
              />
              {selected.has(option.id) && (
                <div className="absolute inset-0 rounded bg-blue-500/20 animate-ping"></div>
              )}
            </div>
            <span className={`text-sm font-semibold transition-colors ${selected.has(option.id) ? 'text-blue-900' : 'text-slate-700 group-hover:text-slate-900'
              }`}>
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
};
