import React from 'react';
import { User, MessageSquare, FileText, Check } from 'lucide-react';
import { AppStep } from '../../types';

interface StepProgressIndicatorProps {
  currentStep: AppStep;
}

export const StepProgressIndicator: React.FC<StepProgressIndicatorProps> = ({ currentStep }) => {
  const steps = [
    { id: AppStep.VITALS, label: 'Patient Info', icon: User },
    { id: AppStep.CONSULTATION, label: 'Consultation', icon: MessageSquare },
    { id: AppStep.REPORT, label: 'Report', icon: FileText }
  ];

  const getStepStatus = (stepId: AppStep): 'completed' | 'current' | 'upcoming' => {
    const stepOrder = [AppStep.VITALS, AppStep.CONSULTATION, AppStep.REPORT];
    const currentIndex = stepOrder.indexOf(currentStep);
    const stepIndex = stepOrder.indexOf(stepId);
    
    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return 'current';
    return 'upcoming';
  };

  // Don't show on history view
  if (currentStep === AppStep.HISTORY) return null;

  return (
    <div className="w-full max-w-2xl mx-auto mb-6 md:mb-8 px-4">
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl md:rounded-3xl p-4 md:p-6 shadow-lg border border-slate-100">
        <div className="flex items-center justify-between relative">
          {/* Progress line background */}
          <div className="absolute top-1/2 left-0 right-0 h-1 bg-slate-100 -translate-y-1/2 mx-12 md:mx-16 rounded-full"></div>
          
          {/* Active progress line */}
          <div 
            className="absolute top-1/2 left-0 h-1 bg-gradient-to-r from-blue-600 to-cyan-600 -translate-y-1/2 rounded-full transition-all duration-500"
            style={{ 
              marginLeft: '3rem',
              width: currentStep === AppStep.VITALS ? '0%' : 
                     currentStep === AppStep.CONSULTATION ? 'calc(50% - 3rem)' : 
                     'calc(100% - 6rem)'
            }}
          ></div>

          {steps.map((step, index) => {
            const status = getStepStatus(step.id);
            const Icon = step.icon;
            return (
              <div key={step.id} className="flex flex-col items-center relative z-10">
                <div className={`
                  w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center text-lg md:text-xl
                  transition-all duration-300 border-2
                  ${status === 'completed' 
                    ? 'bg-gradient-to-br from-green-500 to-emerald-600 text-white border-green-400 shadow-lg shadow-green-200/50' 
                    : status === 'current'
                    ? 'bg-gradient-to-br from-blue-600 to-cyan-600 text-white border-blue-400 shadow-xl shadow-blue-200/50 scale-110 animate-pulse'
                    : 'bg-white text-slate-400 border-slate-200'
                  }
                `}>
                  {status === 'completed' ? (
                    <Check className="w-5 h-5 md:w-6 md:h-6" />
                  ) : (
                    <Icon className="w-5 h-5 md:w-6 md:h-6" />
                  )}
                </div>
                <span className={`
                  mt-2 text-[10px] font-bold uppercase tracking-wider
                  ${status === 'current' ? 'text-blue-600' : status === 'completed' ? 'text-green-600' : 'text-slate-400'}
                `}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
