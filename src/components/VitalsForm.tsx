import React, { useState, useEffect } from 'react';
import { Activity, ChevronRight, Loader2, ArrowRight, CheckCircle2 } from 'lucide-react';
import { PatientInfo } from '../../types';

interface VitalsFormProps {
  onComplete: (data: PatientInfo) => void;
  initialData: PatientInfo;
  pastRecordsCount: number;
  onViewHistory: () => void;
}

export const VitalsForm: React.FC<VitalsFormProps> = ({ onComplete, initialData, pastRecordsCount, onViewHistory }) => {
  const [formData, setFormData] = useState<PatientInfo>(initialData);
  const [showVitals, setShowVitals] = useState(false);
  const [errors, setErrors] = useState<{[key: string]: string}>({});
  const [touched, setTouched] = useState<{[key: string]: boolean}>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [savedPatientInfo, setSavedPatientInfo] = useState<PatientInfo | null>(null);

  // Load saved patient info from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('vitalguard_last_patient');
      if (saved) {
        const parsed = JSON.parse(saved) as PatientInfo;
        if (parsed.name && parsed.age && parsed.gender) {
          setSavedPatientInfo(parsed);
        }
      }
    } catch (e) {
      console.error('Failed to load saved patient info:', e);
    }
  }, []);

  // Quick fill with saved patient info
  const handleQuickFill = () => {
    if (savedPatientInfo) {
      setFormData(savedPatientInfo);
      setTouched({});
      setErrors({});
    }
  };

  const validateField = (field: string, value: string): string => {
    switch (field) {
      case 'name':
        if (!value.trim()) return 'Patient name is required';
        if (value.trim().length < 2) return 'Name must be at least 2 characters';
        if (value.length > 100) return 'Name is too long (max 100 characters)';
        return '';
      case 'age':
        if (!value.trim()) return 'Age is required';
        const ageNum = parseInt(value);
        if (isNaN(ageNum)) return 'Please enter a valid number';
        if (ageNum < 0 || ageNum > 150) return 'Please enter a valid age (0-150)';
        return '';
      case 'gender':
        if (!value) return 'Please select a gender';
        return '';
      case 'weight':
        if (value && isNaN(parseFloat(value))) return 'Please enter a valid number';
        if (value && (parseFloat(value) < 0 || parseFloat(value) > 500)) return 'Please enter a valid weight';
        return '';
      case 'height':
        if (value && isNaN(parseFloat(value))) return 'Please enter a valid number';
        if (value && (parseFloat(value) < 0 || parseFloat(value) > 300)) return 'Please enter a valid height';
        return '';
      default:
        return '';
    }
  };

  const handleBlur = (field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));
    const error = validateField(field, formData[field as keyof PatientInfo] || '');
    setErrors(prev => ({ ...prev, [field]: error }));
  };

  const handleChange = (field: string, value: string) => {
    setFormData({ ...formData, [field]: value });
    if (touched[field]) {
      const error = validateField(field, value);
      setErrors(prev => ({ ...prev, [field]: error }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: {[key: string]: string} = {};
    const requiredFields = ['name', 'age', 'gender'];
    
    requiredFields.forEach(field => {
      const error = validateField(field, formData[field as keyof PatientInfo] || '');
      if (error) newErrors[field] = error;
    });

    // Validate optional fields if they have values
    if (formData.weight) {
      const error = validateField('weight', formData.weight);
      if (error) newErrors['weight'] = error;
    }
    if (formData.height) {
      const error = validateField('height', formData.height);
      if (error) newErrors['height'] = error;
    }

    setErrors(newErrors);
    setTouched({ name: true, age: true, gender: true, weight: true, height: true });
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    console.log("Submit clicked");
    e.preventDefault();
    if (!validateForm()) return;
    
    setIsSubmitting(true);
    // Simulate brief loading state for UX feedback
    await new Promise(resolve => setTimeout(resolve, 600));
    
    // Save patient info to localStorage for future quick-fill
    try {
      localStorage.setItem('vitalguard_last_patient', JSON.stringify(formData));
    } catch (e) {
      console.error('Failed to save patient info:', e);
    }
    
    setIsSubmitting(false);
    onComplete(formData);
  };

  const getInputClassName = (field: string) => {
    const hasError = touched[field] && errors[field];
    const isValid = touched[field] && !errors[field] && formData[field as keyof PatientInfo];
    
    return `w-full px-4 py-3.5 bg-white/50 backdrop-blur-sm border rounded-xl text-[0.95rem] text-slate-800 transition-all duration-200 outline-none placeholder:text-slate-400
      ${hasError 
        ? 'border-red-300 focus:border-red-500 focus:ring-4 focus:ring-red-500/10' 
        : isValid 
          ? 'border-green-300 focus:border-green-500 focus:ring-4 focus:ring-green-500/10'
          : 'border-slate-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 hover:border-blue-300'
      }`;
  };

  const ErrorMessage: React.FC<{field: string}> = ({ field }) => {
    if (!touched[field] || !errors[field]) return null;
    return (
      <p className="mt-1.5 text-[0.8rem] font-medium text-red-500 flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
        <span className="w-1 h-1 rounded-full bg-red-500 inline-block" />
        {errors[field]}
      </p>
    );
  };

  return (
    <div className="max-w-2xl mx-auto glass-panel rounded-2xl p-8 md:p-10 animate-fade-in relative overflow-hidden shadow-xl shadow-slate-200/50">
      
      {/* Header Section */}
      <div className="flex items-start justify-between mb-10">
        <div className="flex items-center gap-5">
          <div className="p-3.5 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl text-white shadow-lg shadow-blue-500/20">
            <Activity className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight font-heading">Patient Registry</h2>
            <p className="text-[0.95rem] text-slate-500 font-medium">Complete profile for AI consultation</p>
          </div>
        </div>
        
        {/* Quick Fill Button */}
        {savedPatientInfo && !formData.name && (
          <button
            type="button"
            onClick={handleQuickFill}
            className="hidden sm:flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-700 font-semibold text-xs hover:bg-emerald-100 transition-colors uppercase tracking-wide"
          >
            <CheckCircle2 className="w-4 h-4" />
            Continue as {savedPatientInfo.name.split(' ')[0]}
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-8" noValidate>
        {/* Name Field */}
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5 ml-1">
            Patient Full Name
          </label>
          <input
            type="text"
            className={getInputClassName('name')}
            value={formData.name}
            onChange={(e) => handleChange('name', e.target.value)}
            onBlur={() => handleBlur('name')}
            placeholder="e.g. Rajesh Kumar"
            maxLength={100}
          />
          <ErrorMessage field="name" />
        </div>

        {/* Age & Gender Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5 ml-1">
              Age
            </label>
            <input
              type="number"
              min="0"
              max="150"
              className={getInputClassName('age')}
              value={formData.age}
              onChange={(e) => handleChange('age', e.target.value)}
              onBlur={() => handleBlur('age')}
              placeholder="e.g. 35"
            />
            <ErrorMessage field="age" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5 ml-1">
              Gender
            </label>
            <div className="relative">
              <select
                className={`${getInputClassName('gender')} appearance-none cursor-pointer`}
                value={formData.gender}
                onChange={(e) => handleChange('gender', e.target.value)}
                onBlur={() => handleBlur('gender')}
              >
                <option value="">Select Gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
              </div>
            </div>
            <ErrorMessage field="gender" />
          </div>
        </div>

        {/* Optional Vitals Toggle */}
        <div className="py-2">
          <button
            type="button"
            onClick={() => setShowVitals(!showVitals)}
            className="group flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors"
          >
            <div className={`p-1 rounded-full bg-blue-50 group-hover:bg-blue-100 transition-colors duration-300 ${showVitals ? 'rotate-90' : ''}`}>
               <ChevronRight className="w-4 h-4 transition-transform" />
            </div>
            <span>Add Vital Signs (Optional)</span>
            <div className="h-px flex-1 bg-gradient-to-r from-blue-100 to-transparent ml-2"></div>
          </button>
        </div>

        {/* Vitals Section */}
        {showVitals && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 p-6 bg-slate-50/50 rounded-2xl border border-slate-100 animate-in slide-in-from-top-2 fade-in duration-300">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5 ml-1">Weight (kg)</label>
              <input
                type="number"
                min="0"
                max="500"
                step="0.1"
                className={getInputClassName('weight')}
                value={formData.weight}
                onChange={(e) => handleChange('weight', e.target.value)}
                onBlur={() => handleBlur('weight')}
                placeholder="e.g. 70"
              />
              <ErrorMessage field="weight" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5 ml-1">Height (cm)</label>
              <input
                type="number"
                min="0"
                max="300"
                step="0.1"
                className={getInputClassName('height')}
                value={formData.height}
                onChange={(e) => handleChange('height', e.target.value)}
                onBlur={() => handleBlur('height')}
                placeholder="e.g. 175"
              />
              <ErrorMessage field="height" />
            </div>
          </div>
        )}

        {/* Medical History */}
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5 ml-1">
            Medical History & Allergies
          </label>
          <textarea
            className={`${getInputClassName('history')} min-h-[120px] resize-none leading-relaxed`}
            value={formData.history}
            onChange={(e) => setFormData({ ...formData, history: e.target.value })}
            placeholder="Please describe any known conditions, allergies, or previous surgeries..."
            maxLength={2000}
          ></textarea>
        </div>

        {/* Form Actions */}
        <div className="pt-6 flex flex-col gap-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-slate-900 text-white font-bold text-[0.95rem] py-4 rounded-xl shadow-lg shadow-slate-900/10 hover:shadow-slate-900/20 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-300 flex items-center justify-center gap-2 group disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin opacity-70" />
                <span>Processing Profile...</span>
              </>
            ) : (
              <>
                <span>{pastRecordsCount > 0 ? 'Resume Medical Session' : 'Start AI Consultation'}</span>
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>

          {pastRecordsCount > 0 && (
            <button
              type="button"
              onClick={onViewHistory}
              className="w-full bg-white border border-slate-200 text-slate-600 font-semibold text-[0.9rem] py-3.5 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all duration-200 flex items-center justify-center gap-2"
            >
              <svg className="w-4.5 h-4.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              View Clinical History Vault <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-xs ml-1">{pastRecordsCount}</span>
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
