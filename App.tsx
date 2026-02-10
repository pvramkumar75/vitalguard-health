
import React, { useState, useRef, useEffect } from 'react';
import { AppStep, PatientInfo, Message, MedicalReport, ClinicalRecord, Attachment, Language, StructuredQuestion } from './types';
import { getChatResponse, getMedicalReport } from './services/geminiService';
import * as db from './db';
import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

import { 
  Activity, AlertTriangle, ArrowLeft, ArrowRight, Calendar, Camera, Check, 
  ChevronDown, ChevronRight, ClipboardCheck, Download, FileText, Filter, 
  History, Languages, Loader2, MessageSquare, Mic, MicOff, Paperclip, 
  Printer, RefreshCw, Search, Send, Trash2, Upload, User, X, Globe, Shield 
} from 'lucide-react';
import { Logo } from './src/components/Logo';
import { GlobalBackground } from './src/components/Background';

// --- Utilities ---
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// Format timestamp for display
const formatTimestamp = (isoString?: string): string => {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

// MIME types that Gemini supports for inlineData
const GEMINI_SUPPORTED_INLINE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/bmp', 'image/tiff',
  'application/pdf',
  'text/plain', 'text/csv', 'text/html',
]);

// --- Document Text Extraction Utilities ---

const extractPdfText = async (file: File): Promise<string> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = (textContent.items as any[]).map((item: any) => item.str).join(' ');
      if (pageText.trim()) fullText += `[Page ${i}] ${pageText}\n`;
    }

    if (fullText.trim()) return fullText.trim();

    // Fallback: render scanned PDF pages to images and OCR them
    const ocrTexts: string[] = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport }).promise;

      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/png')
      );
      const { data: { text } } = await Tesseract.recognize(blob, 'eng');
      if (text.trim()) ocrTexts.push(`[Page ${i}] ${text.trim()}`);
    }

    return ocrTexts.join('\n\n');
  } catch (err) {
    console.error('PDF extraction failed:', err);
    return '';
  }
};

const extractDocxText = async (file: File): Promise<string> => {
  try {
    const mammoth = await import('mammoth');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  } catch (err) {
    console.error('DOCX extraction failed:', err);
    return '';
  }
};

const extractPptxText = async (file: File): Promise<string> => {
  try {
    const JSZip = (await import('jszip')).default;
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    const texts: string[] = [];
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /ppt\/slides\/slide\d+\.xml/.test(name))
      .sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0');
        const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0');
        return numA - numB;
      });

    for (const slidePath of slideFiles) {
      const content = await zip.file(slidePath)?.async('text');
      if (content) {
        const textElements = content.match(/<a:t>([^<]*)<\/a:t>/g) || [];
        const slideText = textElements.map((t) => t.replace(/<[^>]+>/g, '')).join(' ');
        if (slideText.trim()) {
          const slideNum = slidePath.match(/slide(\d+)/)?.[1];
          texts.push(`[Slide ${slideNum}] ${slideText.trim()}`);
        }
      }
    }

    return texts.join('\n');
  } catch (err) {
    console.error('PPTX extraction failed:', err);
    return '';
  }
};

const extractXlsxText = async (file: File): Promise<string> => {
  try {
    const JSZip = (await import('jszip')).default;
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // Get shared strings
    const sharedStringsFile = zip.file('xl/sharedStrings.xml');
    let sharedStrings: string[] = [];
    if (sharedStringsFile) {
      const content = await sharedStringsFile.async('text');
      const matches = content.match(/<t[^>]*>([^<]+)<\/t>/g) || [];
      sharedStrings = matches.map((m) => m.replace(/<[^>]+>/g, ''));
    }

    const sheetFiles = Object.keys(zip.files)
      .filter((name) => /xl\/worksheets\/sheet\d+\.xml/.test(name))
      .sort();

    const rows: string[] = [];
    for (const sheetPath of sheetFiles) {
      const content = await zip.file(sheetPath)?.async('text');
      if (content) {
        const rowMatches = content.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
        for (const row of rowMatches) {
          const cellValues = row.match(/<v>([^<]+)<\/v>/g) || [];
          const values = cellValues.map((c) => {
            const val = c.replace(/<[^>]+>/g, '');
            const idx = parseInt(val);
            return !isNaN(idx) && sharedStrings[idx] ? sharedStrings[idx] : val;
          });
          if (values.length) rows.push(values.join('\t'));
        }
      }
    }

    return rows.join('\n') || sharedStrings.join(' ');
  } catch (err) {
    console.error('XLSX extraction failed:', err);
    return '';
  }
};

const extractBinaryDocText = async (file: File): Promise<string> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const chunks: string[] = [];
    let current = '';

    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      if (byte >= 32 && byte <= 126) {
        current += String.fromCharCode(byte);
      } else if (byte === 10 || byte === 13) {
        current += ' ';
      } else {
        if (current.trim().length > 3) {
          chunks.push(current.trim());
        }
        current = '';
      }
    }
    if (current.trim().length > 3) chunks.push(current.trim());

    return chunks.join(' ').replace(/\s+/g, ' ').substring(0, 15000);
  } catch (err) {
    console.error('Binary text extraction failed:', err);
    return '';
  }
};

const extractDocumentText = async (file: File): Promise<string> => {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';

  try {
    // Plain text files
    if (
      ['txt', 'csv', 'md', 'json', 'xml', 'html', 'htm', 'log', 'rtf'].includes(ext) ||
      file.type.startsWith('text/')
    ) {
      return await file.text();
    }

    // Images - Tesseract OCR
    if (file.type.startsWith('image/')) {
      const { data: { text } } = await Tesseract.recognize(file, 'eng');
      return text;
    }

    // PDF - text layer extraction with OCR fallback for scanned docs
    if (ext === 'pdf' || file.type === 'application/pdf') {
      return await extractPdfText(file);
    }

    // DOCX
    if (ext === 'docx' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return await extractDocxText(file);
    }

    // PPTX
    if (ext === 'pptx' || file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      return await extractPptxText(file);
    }

    // XLSX
    if (ext === 'xlsx' || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      return await extractXlsxText(file);
    }

    // Old binary formats (doc, ppt, xls) - best effort text extraction
    if (['doc', 'ppt', 'xls'].includes(ext)) {
      return await extractBinaryDocText(file);
    }

    return '';
  } catch (err) {
    console.error(`Document extraction failed for ${file.name}:`, err);
    return '';
  }
};

// --- Sub-components ---

const CheckboxQuestion: React.FC<{
  question: StructuredQuestion;
  onSelectionChange: (selectedOptions: string[]) => void;
}> = ({ question, onSelectionChange }) => {
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

const LanguageSwitcher: React.FC<{ current: Language; onChange: (l: Language) => void }> = ({ current, onChange }) => {
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

const StepProgressIndicator: React.FC<{ currentStep: AppStep }> = ({ currentStep }) => {
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

const VitalsForm: React.FC<{
  onComplete: (data: PatientInfo) => void;
  initialData: PatientInfo;
  pastRecordsCount: number;
  onViewHistory: () => void;
}> = ({ onComplete, initialData, pastRecordsCount, onViewHistory }) => {
  const [formData, setFormData] = useState<PatientInfo>(initialData);
  const [showVitals, setShowVitals] = useState(false);
  const [errors, setErrors] = useState<{[key: string]: string}>({});
  const [touched, setTouched] = useState<{[key: string]: boolean}>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [savedPatientInfo, setSavedPatientInfo] = useState<PatientInfo | null>(null);
  const [heightUnit, setHeightUnit] = useState<'cm' | 'ft'>('cm');
  const [heightFeet, setHeightFeet] = useState('');
  const [heightInches, setHeightInches] = useState('');

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
        if (heightUnit === 'ft') {
          // In feet mode, validate feet and inches separately
          if (heightFeet || heightInches) {
            const ft = parseFloat(heightFeet || '0');
            const inches = parseFloat(heightInches || '0');
            if (isNaN(ft) || isNaN(inches)) return 'Please enter valid numbers';
            if (ft < 0 || ft > 9) return 'Feet must be between 0-9';
            if (inches < 0 || inches >= 12) return 'Inches must be between 0-11';
          }
          return '';
        }
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
    e.preventDefault();
    if (!validateForm()) return;
    
    setIsSubmitting(true);
    // Simulate brief loading state for UX feedback
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Save patient info to localStorage for future quick-fill
    try {
      localStorage.setItem('vitalguard_last_patient', JSON.stringify(formData));
    } catch (e) {
      console.error('Failed to save patient info:', e);
    }
    
    setIsSubmitting(false);
    onComplete(formData);
  };

  const getInputClassName = (field: string, baseClasses: string) => {
    const hasError = touched[field] && errors[field];
    const isValid = touched[field] && !errors[field] && formData[field as keyof PatientInfo];
    
    return `${baseClasses} ${
      hasError 
        ? 'border-red-400 focus:border-red-500 focus:ring-red-100' 
        : isValid 
          ? 'border-green-400 focus:border-green-500 focus:ring-green-100'
          : ''
    }`;
  };

  const ErrorMessage: React.FC<{field: string}> = ({ field }) => {
    if (!touched[field] || !errors[field]) return null;
    return (
      <p className="mt-1.5 text-xs font-semibold text-red-500 flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
        {errors[field]}
      </p>
    );
  };

  return (

    <div className="max-w-2xl mx-auto card-premium rounded-xl p-8 animate-fade-in relative overflow-hidden">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-600/10 rounded-xl text-blue-600">
            <Activity className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Patient Registry</h2>
            <p className="text-sm text-slate-500">Complete profile for AI consultation</p>
          </div>
        </div>
        
        {/* Quick Fill Button for Returning Users */}
        {savedPatientInfo && !formData.name && (
          <button
            type="button"
            onClick={handleQuickFill}
            className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg text-green-700 font-semibold text-sm hover:bg-green-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
            Continue as {savedPatientInfo.name}
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            Patient Full Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            className={getInputClassName('name', "input-premium")}
            value={formData.name}
            onChange={(e) => handleChange('name', e.target.value)}
            onBlur={() => handleBlur('name')}
            placeholder="e.g. Rajesh Kumar"
            maxLength={100}
            aria-invalid={!!errors['name']}
            aria-describedby={errors['name'] ? 'name-error' : undefined}
          />
          <ErrorMessage field="name" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Age <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min="0"
              max="150"
              className={getInputClassName('age', "input-premium")}
              value={formData.age}
              onChange={(e) => handleChange('age', e.target.value)}
              onBlur={() => handleBlur('age')}
              placeholder="e.g. 35"
              aria-invalid={!!errors['age']}
            />
            <ErrorMessage field="age" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Gender <span className="text-red-500">*</span>
            </label>
            <select
              className={getInputClassName('gender', "input-premium")}
              value={formData.gender}
              onChange={(e) => handleChange('gender', e.target.value)}
              onBlur={() => handleBlur('gender')}
              aria-invalid={!!errors['gender']}
            >
              <option value="">Select Gender</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
            <ErrorMessage field="gender" />
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowVitals(!showVitals)}
            className="text-blue-600 font-semibold text-sm hover:text-blue-700 transition-colors flex items-center gap-2"
          >
            <ChevronRight className={`w-4 h-4 transition-transform ${showVitals ? 'rotate-90' : ''}`} />
            Add Vital Signs (Optional)
          </button>
        </div>

        {showVitals && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-6 bg-slate-50 rounded-lg border border-slate-200 animate-fade-in">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Weight (kg)</label>
              <input
                type="number"
                min="0"
                max="500"
                step="0.1"
                className={getInputClassName('weight', "input-premium")}
                value={formData.weight}
                onChange={(e) => handleChange('weight', e.target.value)}
                onBlur={() => handleBlur('weight')}
                placeholder="e.g. 70"
              />
              <ErrorMessage field="weight" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-semibold text-slate-700">Height</label>
                <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                  <button
                    type="button"
                    onClick={() => {
                      setHeightUnit('cm');
                      setHeightFeet('');
                      setHeightInches('');
                      handleChange('height', '');
                    }}
                    className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                      heightUnit === 'cm'
                        ? 'bg-white text-blue-700 shadow-sm border border-blue-200'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    cm
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHeightUnit('ft');
                      handleChange('height', '');
                    }}
                    className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                      heightUnit === 'ft'
                        ? 'bg-white text-blue-700 shadow-sm border border-blue-200'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    ft · in
                  </button>
                </div>
              </div>
              {heightUnit === 'cm' ? (
                <input
                  type="number"
                  min="0"
                  max="300"
                  step="0.1"
                  className={getInputClassName('height', "input-premium")}
                  value={formData.height}
                  onChange={(e) => handleChange('height', e.target.value)}
                  onBlur={() => handleBlur('height')}
                  placeholder="e.g. 175"
                />
              ) : (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        max="9"
                        step="1"
                        className={getInputClassName('height', "input-premium pr-10")}
                        value={heightFeet}
                        onChange={(e) => {
                          const ft = e.target.value;
                          setHeightFeet(ft);
                          const inches = parseFloat(heightInches || '0');
                          const totalCm = ((parseFloat(ft || '0') * 12) + inches) * 2.54;
                          handleChange('height', totalCm > 0 ? totalCm.toFixed(1) : '');
                        }}
                        onBlur={() => handleBlur('height')}
                        placeholder="5"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">ft</span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        max="11"
                        step="1"
                        className={getInputClassName('height', "input-premium pr-10")}
                        value={heightInches}
                        onChange={(e) => {
                          const inches = e.target.value;
                          setHeightInches(inches);
                          const ft = parseFloat(heightFeet || '0');
                          const totalCm = ((ft * 12) + parseFloat(inches || '0')) * 2.54;
                          handleChange('height', totalCm > 0 ? totalCm.toFixed(1) : '');
                        }}
                        onBlur={() => handleBlur('height')}
                        placeholder="8"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">in</span>
                    </div>
                  </div>
                </div>
              )}
              {formData.height && heightUnit === 'ft' && (
                <p className="mt-1.5 text-xs text-slate-400 font-medium">
                  ≈ {formData.height} cm
                </p>
              )}
              <ErrorMessage field="height" />
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            Medical History
          </label>
          <textarea
            className="input-premium min-h-[100px] resize-none"
            value={formData.history}
            onChange={(e) => setFormData({ ...formData, history: e.target.value })}
            placeholder="e.g. Diabetes since 2018, Hypertension, previous knee surgery in 2020..."
            maxLength={2000}
          ></textarea>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            Known Allergies
          </label>
          <textarea
            className="input-premium min-h-[80px] resize-none"
            value={formData.allergies}
            onChange={(e) => setFormData({ ...formData, allergies: e.target.value })}
            placeholder="e.g. Penicillin, Sulfa drugs, Peanuts, Latex..."
            maxLength={1000}
          ></textarea>
        </div>

        <div className="pt-6 border-t border-slate-100 flex flex-col gap-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full btn-primary flex justify-center items-center gap-2 group disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin opacity-70" />
                Processing...
              </>
            ) : (
              <>
                {pastRecordsCount > 0 ? 'Resume Medical Session' : 'Start AI Consultation'}
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>

          {pastRecordsCount > 0 && (
            <button
              type="button"
              onClick={onViewHistory}
              className="w-full btn-outline flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              View Clinical History Vault ({pastRecordsCount})
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

const ChatInterface: React.FC<{
  messages: Message[];
  onSendMessage: (msg: string, attachments?: Attachment[]) => void;
  onRetryMessage?: (text: string, attachments?: Attachment[]) => void;
  isProcessing: boolean;
  onFinish: () => void;
  patientName: string;
  language: Language;
}> = ({ messages, onSendMessage, onRetryMessage, isProcessing, onFinish, patientName, language }) => {
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [selectedCheckboxOptions, setSelectedCheckboxOptions] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [showCamera, setShowCamera] = useState(false);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const startListening = () => {
    setMicError(null);
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMicError("Speech recognition not supported.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      const langMap: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' };
      recognition.lang = langMap[language];
      recognition.continuous = false;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsListening(true);
        setMicError(null);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (event.results[0].isFinal) {
          setInput(prev => (prev.trim() + ' ' + transcript).trim());
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'no-speech') {
          setMicError("No speech detected. Please speak clearly.");
        } else if (event.error === 'not-allowed') {
          setMicError("Microphone permission denied.");
        } else {
          setMicError(`Voice input error: ${event.error}`);
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
    } catch (err) {
      setMicError("Microphone failed to start.");
      setIsListening(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadStatus('Reading files...');
    const newAttachments: Attachment[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadStatus(`Processing ${file.name} (${i + 1}/${files.length})...`);

      const base64 = await blobToBase64(file);
      const mimeType = file.type || 'application/octet-stream';

      // Extract text from documents (this will be passed to AI invisibly)
      let extractedText = '';
      try {
        setUploadStatus(`Extracting text from ${file.name}...`);
        extractedText = await extractDocumentText(file);
      } catch (err) {
        console.error(`Text extraction failed for ${file.name}:`, err);
      }

      // Only attach as inlineData if Gemini supports this MIME type
      if (GEMINI_SUPPORTED_INLINE_TYPES.has(mimeType) || file.type.startsWith('image/')) {
        newAttachments.push({ 
          data: base64, 
          mimeType, 
          name: file.name,
          extractedText: extractedText.trim() || undefined
        });
      } else {
        // For unsupported types, attach a placeholder so the user sees it in the UI
        newAttachments.push({ 
          data: '', 
          mimeType: 'text/plain', 
          name: file.name,
          extractedText: extractedText.trim() || undefined
        });
      }
    }

    setAttachments(prev => [...prev, ...newAttachments]);
    setIsUploading(false);
    setUploadStatus('');
    e.target.value = '';
  };

  const capturePhoto = async () => {
    if (!videoRef.current) return;
    setIsCapturing(true);

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(videoRef.current, 0, 0);
    const base64 = canvas.toDataURL('image/jpeg').split(',')[1];

    const newPhoto: Attachment = {
      data: base64,
      mimeType: 'image/jpeg',
      name: `exam_capture_${Date.now()}.jpg`
    };

    setTimeout(() => {
      setAttachments(prev => [...prev, newPhoto]);
      setIsCapturing(false);
      stopCamera();
    }, 400);
  };

  const startCamera = async () => {
    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      alert("Unable to access camera.");
      setShowCamera(false);
    }
  };

  const stopCamera = () => {
    const stream = videoRef.current?.srcObject as MediaStream;
    stream?.getTracks().forEach(t => t.stop());
    setShowCamera(false);
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && attachments.length === 0 && selectedCheckboxOptions.length === 0) || isProcessing || isUploading) return;

    let messageToSend = input.trim();
    if (selectedCheckboxOptions.length > 0 && !messageToSend) {
      messageToSend = selectedCheckboxOptions.join(', ');
    }

    onSendMessage(messageToSend, attachments);
    setInput('');
    setAttachments([]);
    setSelectedCheckboxOptions([]);
    setMicError(null);
  };

  return (

    <div className="flex flex-col h-[calc(100vh-8rem)] md:h-[780px] card-premium rounded-xl overflow-hidden relative">
      <div className="bg-slate-900 text-white px-6 py-4 flex justify-between items-center z-10">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center font-bold border border-slate-700 text-sm">
            Pt
          </div>
          <div>
            <p className="font-bold text-sm tracking-wide">{patientName}</p>
            <p className="text-xs text-slate-400">Clinical Consultation Active</p>
          </div>
        </div>
        {/* 'Finalize' button removed from here, moved to bottom */}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 bg-slate-50">
        {messages.map((m, idx) => (
          <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
            <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-5 py-4 shadow-sm ${m.role === 'user'
              ? 'bg-blue-600 text-white rounded-br-none'
              : 'bg-white text-slate-800 border border-slate-200 rounded-bl-none'
              }`}>
              {m.attachments && m.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {m.attachments.map((at, i) => (
                    <div key={i} className="relative">
                      {at.mimeType.startsWith('image/') ? (
                        <img
                          src={`data:${at.mimeType};base64,${at.data}`}
                          className="max-h-40 rounded-lg border border-white/20"
                          alt="Attachment"
                        />
                      ) : (
                        <div className="bg-white/10 backdrop-blur-sm p-3 rounded-lg border border-white/10 flex items-center gap-2">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                          <span className="text-xs font-medium truncate max-w-[120px] text-white">{at.name}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p className={`whitespace-pre-wrap leading-relaxed text-sm ${m.role === 'model' ? 'font-medium' : ''}`}>
                {m.text || (m.attachments?.length ? "Attachments uploaded." : "")}
              </p>
              
              <div className={`text-[10px] mt-2 flex items-center justify-end gap-1 ${m.role === 'user' ? 'text-blue-100' : 'text-slate-400'}`}>
                {formatTimestamp(m.timestamp)}
              </div>
              
              {m.role === 'model' && m.text?.startsWith('Error:') && onRetryMessage && (
                <button
                  onClick={() => {
                    const prevMsg = messages[idx - 1];
                    if (prevMsg) onRetryMessage(prevMsg.text, prevMsg.attachments);
                  }}
                  className="mt-2 text-xs font-bold text-red-500 hover:text-red-600 flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  Retry
                </button>
              )}
            </div>
          </div>
        ))}
        
        {messages.map((m, idx) => (
           m.question && m.role === 'model' && m.question.options.length > 0 && (
             <div key={`q-${idx}`} className="flex justify-start animate-fade-in">
               <div className="max-w-[85%] md:max-w-[75%]">
                 <CheckboxQuestion
                   question={m.question}
                   onSelectionChange={(selectedOptions) => {
                     const selectedLabels = m.question!.options
                       .filter(opt => selectedOptions.includes(opt.id))
                       .map(opt => opt.label);
                     setSelectedCheckboxOptions(selectedLabels);
                     setInput(selectedLabels.join(', '));
                   }}
                 />
               </div>
             </div>
           )
        ))}

        {isProcessing && (
          <div className="flex justify-start">
            <div className="bg-white rounded-2xl px-4 py-3 shadow-sm border border-slate-200 flex items-center gap-2">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"></div>
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce delay-75"></div>
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce delay-150"></div>
              </div>
              <span className="text-xs text-slate-500 font-medium">Analyzing...</span>
            </div>
          </div>
        )}
      </div>

      {showCamera && (
        <div className="absolute inset-0 bg-black z-50 flex flex-col">
          <div className="relative flex-1">
            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-48 border-2 border-white/30 rounded-lg"></div>
            </div>
          </div>
          <div className="p-6 bg-slate-900 flex justify-center gap-8">
            <button
              onClick={stopCamera}
              className="px-6 py-3 rounded-full bg-slate-800 text-white font-semibold text-sm"
            >
              Cancel
            </button>
            <button
              onClick={capturePhoto}
              className="w-16 h-16 rounded-full bg-white border-4 border-slate-300 shadow-lg active:scale-95 transition-transform"
            ></button>
          </div>
        </div>
      )}

      <div className="p-4 bg-white border-t border-slate-200">
        {attachments.length > 0 && (
          <div className="flex gap-3 mb-3 pb-3 border-b border-slate-100 overflow-x-auto">
            {attachments.map((at, i) => (
              <div key={i} className="relative group shrink-0">
                {at.mimeType.startsWith('image/') ? (
                   <img src={`data:${at.mimeType};base64,${at.data}`} className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                ) : (
                  <div className="w-16 h-16 bg-slate-50 flex flex-col items-center justify-center rounded-lg border border-slate-200">
                    <FileText className="w-6 h-6 text-slate-400" />
                  </div>
                )}
                <button
                  onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-sm text-xs hover:bg-red-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Action Bar */}
        <div className="flex flex-col gap-3">
          <form onSubmit={handleSend} className="flex gap-2">
            <button
              type="button"
              onClick={startCamera}
              className="p-3 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              title="Open Camera"
            >
              <Camera className="w-6 h-6" />
            </button>
            
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-3 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
              title="Attach File"
            >
              <Paperclip className="w-6 h-6" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.gif,.bmp,.tiff,.tif,.webp,.heic,.heif,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.md,.rtf,.xml,.html,.htm,.json,.log"
              onChange={handleFileUpload}
              className="hidden"
            />

            <div className="flex-1 relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={isListening ? "Listening..." : "Type your symptoms..."}
                className="w-full px-4 py-3 bg-slate-100 border-0 rounded-xl focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-sm pr-10"
                disabled={isProcessing || isUploading}
              />
              <button
                 type="button"
                 onClick={startListening}
                 className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg ${isListening ? 'text-red-500 animate-pulse' : 'text-slate-400 hover:text-blue-600'}`}
              >
                 {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
            </div>

            <button
              type="submit"
              disabled={(!input.trim() && attachments.length === 0) || isProcessing || isUploading}
              className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-xl disabled:opacity-50 transition-colors shadow-sm"
            >
              <Send className="w-6 h-6" />
            </button>
          </form>

          {/* Moved Finalize Button Here */}
          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <div className="text-xs font-medium text-slate-500 flex items-center gap-2">
              {micError && <span className="text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> {micError}</span>}
              {isUploading && <span className="text-blue-600 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin"/> {uploadStatus}</span>}
              {isProcessing && !isUploading && <span className="text-blue-600 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin"/> AI is thinking...</span>}
            </div>
            
            <button
              onClick={onFinish}
              disabled={messages.length < 2 || isProcessing}
              className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors disabled:opacity-50 disabled:bg-slate-300 shadow-sm hover:shadow-red-200 flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              Finalize Consultation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const HistoryView: React.FC<{
  records: ClinicalRecord[];
  onBack: () => void;
  onSelect: (record: ClinicalRecord) => void;
  onDelete: (recordId: string) => void;
}> = ({ records, onBack, onSelect, onDelete }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'patient' | 'diagnosis'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'diagnosis'>('date');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<Language | 'all'>('all');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  let filteredRecords = records;

  // Apply search
  if (searchTerm.trim()) {
    const query = searchTerm.toLowerCase();
    filteredRecords = filteredRecords.filter(r => {
      const matchName = r.patientInfo.name.toLowerCase().includes(query);
      const matchDiagnosis = r.report?.diagnosis.toLowerCase().includes(query);
      const matchSummary = r.report?.patientSummary.toLowerCase().includes(query);

      if (filterType === 'patient') return matchName;
      if (filterType === 'diagnosis') return matchDiagnosis;
      return matchName || matchDiagnosis || matchSummary;
    });
  }

  // Apply language filter
  if (selectedLanguage !== 'all') {
    filteredRecords = filteredRecords.filter(r => r.language === selectedLanguage);
  }

  // Apply sorting
  if (sortBy === 'name') {
    filteredRecords = [...filteredRecords].sort((a, b) =>
      a.patientInfo.name.localeCompare(b.patientInfo.name)
    );
  } else if (sortBy === 'diagnosis') {
    filteredRecords = [...filteredRecords].sort((a, b) =>
      (a.report?.diagnosis || '').localeCompare(b.report?.diagnosis || '')
    );
  }

  const handleDeleteClick = (e: React.MouseEvent, recordId: string) => {
    e.stopPropagation();
    setDeleteConfirmId(recordId);
  };

  const confirmDelete = () => {
    if (deleteConfirmId) {
      onDelete(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  };

  const handleExport = async () => {
    try {
      const jsonData = await db.exportRecordsAsJSON();
      const element = document.createElement('a');
      element.setAttribute('href', 'data:text/json;charset=utf-8,' + encodeURIComponent(jsonData));
      element.setAttribute('download', `medai-records-${new Date().toISOString().split('T')[0]}.json`);
      element.style.display = 'none';
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    } catch (error) {
      alert('Export failed: ' + error);
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const importedCount = await db.importRecordsFromJSON(text);
      alert(`Successfully imported ${importedCount} records!`);

      // Reload records
      const updatedRecords = await db.getAllRecords();
      onBack(); // This will trigger a refresh when returning to main view
    } catch (error) {
      alert('Import failed: ' + error);
    }
  };

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-[100] animate-fade-in">
          <div className="bg-white p-6 rounded-xl shadow-xl max-w-sm mx-4 animate-scale-in">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-100 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Delete Record?</h3>
            </div>
            <p className="text-slate-600 text-sm mb-6">This action cannot be undone. The medical record will be permanently removed.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-3 tracking-tight">
          <div className="p-2 bg-blue-600 rounded-lg text-white shadow-sm">
            <History className="w-5 h-5" />
          </div>
          Clinical History <span className="text-slate-400 text-lg font-normal">({filteredRecords.length})</span>
        </h2>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={handleExport}
            disabled={records.length === 0}
            className="flex-1 sm:flex-none bg-white hover:bg-slate-50 disabled:opacity-50 px-4 py-2 rounded-lg border border-slate-200 text-slate-700 font-semibold text-xs uppercase tracking-wide shadow-sm transition-colors flex items-center gap-2 justify-center"
            title="Export all records as JSON"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
          <label className="flex-1 sm:flex-none relative">
            <input
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
            <button
              onClick={(e) => {
                e.currentTarget.parentElement?.querySelector('input')?.click();
              }}
              className="w-full bg-white hover:bg-slate-50 px-4 py-2 rounded-lg border border-slate-200 text-slate-700 font-semibold text-xs uppercase tracking-wide shadow-sm transition-colors flex items-center gap-2 justify-center"
              title="Import records from JSON file"
            >
              <Upload className="w-4 h-4" />
              Import
            </button>
          </label>
          <button onClick={onBack} className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg font-semibold text-xs uppercase tracking-wide shadow-sm transition-colors flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        </div>
      </div>

      <div className="space-y-4 mb-8">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search patients, diagnoses..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm font-medium"
            />
          </div>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={`px-4 py-2.5 rounded-lg font-semibold text-sm transition-colors flex items-center gap-2 ${showAdvanced
              ? 'bg-blue-50 text-blue-700 border border-blue-200'
              : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
              }`}
          >
            <Filter className="w-4 h-4" />
            Filters
          </button>
        </div>

        {showAdvanced && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200 animate-fade-in">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Search Field</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="all">All Fields</option>
                <option value="patient">Patient Name</option>
                <option value="diagnosis">Diagnosis</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Sort Order</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="date">Date (Newest)</option>
                <option value="name">Name (A-Z)</option>
                <option value="diagnosis">Diagnosis (A-Z)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Language</label>
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="all">All Languages</option>
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="te">Telugu</option>
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3">
        {filteredRecords.length === 0 ? (
          <div className="bg-white p-12 rounded-xl border border-dashed border-slate-200 text-center">
            <div className="w-12 h-12 mx-auto mb-3 bg-slate-50 rounded-full flex items-center justify-center">
              <Search className="w-6 h-6 text-slate-400" />
            </div>
            <p className="text-slate-500 font-medium text-sm">
              {records.length === 0 ? 'No records found' : 'No matching records'}
            </p>
          </div>
        ) : (
          filteredRecords.map((r) => (
            <div
              key={r.id}
              className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-300 transition-all group cursor-pointer"
              onClick={() => onSelect(r)}
            >
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-slate-500">
                      {new Date(r.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                    <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide border ${
                      r.language === 'en' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                      r.language === 'hi' ? 'bg-orange-50 text-orange-600 border-orange-100' :
                      'bg-purple-50 text-purple-600 border-purple-100'
                    }`}>
                      {r.language === 'en' ? 'EN' : r.language === 'hi' ? 'HI' : 'TE'}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900 group-hover:text-blue-600 transition-colors mb-0.5">
                    {r.report?.diagnosis || 'Medical Assessment'}
                  </h3>
                  <div className="text-sm text-slate-600 flex items-center gap-2">
                    <span className="font-medium text-slate-900">{r.patientInfo.name}</span>
                    <span className="text-slate-300">|</span>
                    <span>{r.patientInfo.age}y</span>
                    <span className="text-slate-300">|</span>
                    <span>{r.patientInfo.gender}</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => handleDeleteClick(e, r.id)}
                    className="p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    title="Delete record"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                  <ChevronRight className="w-5 h-5 text-slate-300" />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {filteredRecords.length > 0 && (
        <div className="mt-4 text-center text-xs text-slate-400 font-medium">
          Showing {filteredRecords.length} of {records.length} records
        </div>
      )}
    </div>
  );
};

const ReportView: React.FC<{ report: MedicalReport; patient: PatientInfo; onReset: () => void; }> = ({ report, patient, onReset }) => {
  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 animate-fade-in">
      <div className="card-premium rounded-xl overflow-hidden shadow-lg border border-slate-200">
        <div className="bg-slate-900 text-white p-8 border-b-4 border-blue-500 relative overflow-hidden">
          <div className="relative z-10 flex flex-col md:flex-row justify-between items-start gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-2">Clinical Assessment</h1>
              <p className="text-blue-300 font-medium text-xs uppercase tracking-wider">Official Medical Record</p>
            </div>
            <div className="bg-white/10 px-4 py-2 rounded-lg border border-white/10 backdrop-blur-sm">
              <p className="text-[10px] text-blue-200 font-semibold uppercase tracking-wider mb-0.5">Reference ID</p>
              <p className="text-sm font-mono font-bold">#{Math.random().toString(36).substr(2, 6).toUpperCase()}</p>
            </div>
          </div>
        </div>

        <div className="p-8 space-y-8 bg-white">
          {/* Patient Header */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pb-6 border-b border-slate-100">
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-1">Patient</p>
              <p className="text-xl font-bold text-slate-900">{patient.name}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-1">Details</p>
              <p className="text-xl font-bold text-slate-900">{patient.age} Y • {patient.gender}</p>
            </div>
            <div className="sm:text-right">
              <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-1">Date</p>
              <p className="text-xl font-bold text-slate-900">{new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
            </div>
          </div>

          <section className="bg-slate-50 p-6 rounded-xl border border-slate-200">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Primary Diagnosis</h3>
            <p className="text-2xl text-blue-900 font-bold mb-3">{report.diagnosis}</p>
            <p className="text-slate-700 leading-relaxed italic border-l-4 border-blue-300 pl-4">"{report.patientSummary}"</p>
          </section>

          <section>
            <div className="flex items-center gap-4 mb-6">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Treatment Plan</h3>
              <div className="h-px bg-slate-200 flex-1"></div>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {report.prescriptions.map((p, i) => (
                <div key={i} className="p-6 border border-slate-200 rounded-xl bg-white shadow-sm hover:shadow-md transition-shadow border-l-4 border-l-blue-500 group">
                  <div className="flex justify-between items-start mb-4">
                    <p className="font-bold text-slate-900 text-lg group-hover:text-blue-700 transition-colors">{p.medication}</p>
                    <span className="bg-slate-100 text-slate-600 text-xs px-3 py-1 rounded-full font-semibold">{p.duration}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-6 mb-4">
                    <div>
                      <p className="text-xs text-slate-500 font-semibold mb-1">Dosage</p>
                      <p className="font-medium text-slate-800">{p.dosage}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 font-semibold mb-1">Frequency</p>
                      <p className="font-medium text-slate-800">{p.frequency}</p>
                    </div>
                  </div>
                  {p.notes && (
                    <div className="flex gap-3 p-3 bg-blue-50/50 rounded-lg border border-blue-100 items-start">
                      <MessageSquare className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                      <p className="text-sm text-blue-800 font-medium">{p.notes}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {report.recommendedTests && report.recommendedTests.length > 0 && (
            <section>
              <div className="flex items-center gap-4 mb-6">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Recommended Tests</h3>
                <div className="h-px bg-slate-200 flex-1"></div>
              </div>
              <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
                <div className="flex flex-col gap-3">
                  {report.recommendedTests.map((test, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-white rounded-lg border border-slate-100 shadow-sm">
                      <div className="p-2 bg-purple-100 text-purple-600 rounded-lg">
                        <Activity className="w-5 h-5" />
                      </div>
                      <span className="font-medium text-slate-800">{test}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-red-50 p-6 rounded-xl border border-red-100">
              <h4 className="text-xs font-bold text-red-600 uppercase mb-3 tracking-wide flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 animate-pulse" />
                Urgent Warnings
              </h4>
              <p className="text-sm text-red-900 font-medium leading-relaxed">{report.emergencyWarning || "None reported."}</p>
            </div>
            <div className="bg-blue-50 p-6 rounded-xl border border-blue-100">
              <h4 className="text-xs font-bold text-blue-700 uppercase mb-3 tracking-wide flex items-center gap-2">
                <ArrowRight className="w-4 h-4 text-blue-600" />
                Next Steps
              </h4>
              <p className="text-sm text-blue-900 font-medium leading-relaxed">{report.followUp}</p>
            </div>
          </section>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row justify-center gap-4 no-print sm:max-w-md mx-auto">
        <button onClick={() => window.print()} className="flex-1 bg-slate-900 text-white px-8 py-4 rounded-xl font-bold text-sm shadow-lg hover:bg-slate-800 hover:shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2">
          <Printer className="w-5 h-5" />
          Print Report
        </button>
        <button onClick={onReset} className="flex-1 bg-white border border-slate-200 text-slate-600 hover:text-slate-900 px-8 py-4 rounded-xl font-bold text-sm hover:bg-slate-50 transition-all shadow-sm flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4" />
          New Consultation
        </button>
      </div>
    </div>
  );
};

// --- Main App Component ---

export default function App() {
  const [step, setStep] = useState<AppStep>(AppStep.VITALS);
  const [language, setLanguage] = useState<Language>('en');
  const [patient, setPatient] = useState<PatientInfo>({
    name: '', age: '', gender: '', weight: '', height: '', history: '', allergies: ''
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [report, setReport] = useState<MedicalReport | null>(null);
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [pastRecords, setPastRecords] = useState<ClinicalRecord[]>([]);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // Check if there's an active session that could be lost
  const hasActiveSession = step === AppStep.CONSULTATION && messages.length > 0;

  // Browser beforeunload handler to warn about losing data
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasActiveSession) {
        e.preventDefault();
        e.returnValue = 'You have an active consultation in progress. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasActiveSession]);

  // Safe navigation handler that shows confirmation for active sessions
  const safeNavigate = (action: () => void) => {
    if (hasActiveSession) {
      setPendingAction(() => action);
      setShowExitConfirm(true);
    } else {
      action();
    }
  };

  const confirmExit = () => {
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
    setShowExitConfirm(false);
  };

  const cancelExit = () => {
    setPendingAction(null);
    setShowExitConfirm(false);
  };

  useEffect(() => {
    const loadRecords = async () => {
      try {
        await db.initializeDB();
        const savedRecords = await db.getAllRecords();
        if (savedRecords && savedRecords.length > 0) {
          setPastRecords(savedRecords);
        }
      } catch (error) {
        console.error('Failed to load records from database:', error);
      }
    };

    loadRecords();
  }, []);

  const saveToVault = async (finalReport: MedicalReport) => {
    const record: ClinicalRecord = {
      id: Math.random().toString(36).substr(2, 6).toUpperCase(),
      date: new Date().toISOString(),
      patientInfo: patient,
      messages: messages,
      report: finalReport,
      language: language
    };
    const updated = [record, ...pastRecords];
    setPastRecords(updated);

    try {
      await db.addRecord(record);
    } catch (error) {
      console.error('Failed to save record to database:', error);
    }
  };

  const startConsultation = (data: PatientInfo) => {
    setPatient(data);
    setStep(AppStep.CONSULTATION);
    if (messages.length === 0) {
      // Build a rich context string with all available patient info
      const contextParts: string[] = [];
      contextParts.push(`Patient: ${data.name}, Age: ${data.age}, Gender: ${data.gender}`);
      if (data.weight) contextParts.push(`Weight: ${data.weight} kg`);
      if (data.height) contextParts.push(`Height: ${data.height} cm`);
      if (data.weight && data.height) {
        const bmi = (parseFloat(data.weight) / ((parseFloat(data.height) / 100) ** 2)).toFixed(1);
        contextParts.push(`BMI: ${bmi}`);
      }
      if (data.history?.trim()) contextParts.push(`Medical History: ${data.history.trim()}`);
      if (data.allergies?.trim()) contextParts.push(`Known Allergies: ${data.allergies.trim()}`);

      const patientContext = contextParts.join('. ');

      const initTexts: Record<Language, string> = {
        en: `Registry Complete. ${patientContext}. Initializing assessment. Ready to hear clinical concerns.`,
        hi: `पंजीकरण पूर्ण हुआ। ${patientContext}. मूल्यांकन शुरू किया जा रहा है। अपनी स्वास्थ्य समस्याओं के बारे में बताएं।`,
        te: `రిజిస్ట్రేషన్ పూర్తయింది. ${patientContext}. పరీక్ష ప్రారంభించబడుతోంది. మీ ఆరోగ్య సమస్యలను తెలియజేయండి.`
      };
      handleSendMessage(initTexts[language], []);
    }
  };

  const handleSendMessage = async (text: string, attachments: Attachment[] = []) => {
    const timestamp = new Date().toISOString();
    const userMessage: Message = { role: 'user', text, attachments, timestamp };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setIsProcessing(true);

    try {
      const relevantRecords = pastRecords.filter(r => r.patientInfo.name.toLowerCase() === patient.name.toLowerCase());
      const responseText = await getChatResponse(patient, updatedMessages, relevantRecords, language);

      // Generate relevant checkbox options based on the question content and conversation history
      let options = getOptionsForQuestion(responseText, updatedMessages);

      const question: StructuredQuestion = {
        id: `q_${Date.now()}`,
        questionText: responseText,
        options: options
      };

      setMessages(prev => [...prev, { role: 'model', text: responseText, question, timestamp: new Date().toISOString() }]);
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage = error instanceof Error ? error.message : 'An error occurred. Please try again.';
      setMessages(prev => [...prev, { role: 'model', text: `Error: ${errorMessage}`, timestamp: new Date().toISOString() }]);
    } finally {
      setIsProcessing(false);
    }
  };

  const getOptionsForQuestion = (question: string, conversationHistory: Message[]): Array<{ id: string; label: string }> => {
    // No checkbox options - users will type their responses
    return [];
  };

  // Retry failed messages by removing the error and resending
  const handleRetryMessage = async (text: string, attachments?: Attachment[]) => {
    // Remove the last two messages (user message + error response) and retry
    setMessages(prev => prev.slice(0, -2));
    await new Promise(resolve => setTimeout(resolve, 100)); // Brief delay for state update
    handleSendMessage(text, attachments || []);
  };

  const generateReport = async () => {
    setIsLoadingReport(true);
    try {
      const relevantRecords = pastRecords.filter(r => r.patientInfo.name.toLowerCase() === patient.name.toLowerCase());
      const reportData = await getMedicalReport(patient, messages, relevantRecords, language);
      setReport(reportData);
      await saveToVault(reportData);
      setStep(AppStep.REPORT);
    } catch (error) {
      alert("Diagnostic compilation failed.");
    } finally {
      setIsLoadingReport(false);
    }
  };

  const reset = () => {
    setStep(AppStep.VITALS);
    setMessages([]);
    setReport(null);
  };

  const showPastReport = (record: ClinicalRecord) => {
    setPatient(record.patientInfo);
    setMessages(record.messages);
    setReport(record.report || null);
    setLanguage(record.language || 'en');
    setStep(AppStep.REPORT);
  };

  const deleteRecord = async (recordId: string) => {
    try {
      await db.deleteRecord(recordId);
      setPastRecords(prev => prev.filter(r => r.id !== recordId));
    } catch (error) {
      console.error('Failed to delete record:', error);
      alert('Failed to delete record. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-cyan-50/30 font-sans selection:bg-blue-200 selection:text-blue-900 relative overflow-hidden">
      {/* Animated background elements */}
      <GlobalBackground />

      <nav className="no-print bg-white/80 border-b border-slate-200/50 px-4 md:px-8 py-4 md:py-5 flex items-center justify-between sticky top-0 z-50 backdrop-blur-xl shadow-sm relative">
        <div className="flex items-center gap-4">
          <button onClick={() => safeNavigate(reset)} className="group relative">
            <Logo className="w-12 h-12 md:w-14 md:h-14 transition-transform group-hover:scale-105" />
          </button>
          <div>
            <span className="text-xl md:text-3xl font-black tracking-tight cursor-pointer text-slate-900 group-hover:text-blue-600 transition-colors" onClick={() => safeNavigate(reset)}>
              VitalGuard <span className="text-blue-600">Health</span>
            </span>
            <div className="flex items-center gap-2 mt-0.5">
               <span className="h-0.5 w-8 bg-blue-500 rounded-full"></span>
               <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest hidden sm:block">AI Medical Intelligence</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-6">
          <LanguageSwitcher current={language} onChange={setLanguage} />
          <button
            onClick={() => safeNavigate(() => setStep(AppStep.HISTORY))}
            className={`px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 border ${step === AppStep.HISTORY ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'}`}
          >
            <History className="w-4 h-4" />
            <span>History Vault</span>
          </button>
        </div>
      </nav>

      <main className="container mx-auto px-4 md:px-6 py-6 md:py-12 max-w-7xl">
        <StepProgressIndicator currentStep={step} />
        
        {step === AppStep.VITALS && (
          <VitalsForm
            onComplete={startConsultation}
            initialData={patient}
            pastRecordsCount={pastRecords.length}
            onViewHistory={() => setStep(AppStep.HISTORY)}
          />
        )}

        {step === AppStep.CONSULTATION && (
          <div className="max-w-4xl mx-auto space-y-4 md:space-y-8">
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-6 md:p-8 rounded-3xl text-white flex items-start gap-6 shadow-2xl shadow-blue-200/50 border border-blue-400/20 relative overflow-hidden animate-float">
              {/* Accent decoration */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
              <div className="absolute bottom-0 left-0 w-32 h-32 bg-cyan-400/20 rounded-full blur-2xl"></div>

              <div className="p-4 bg-white/10 rounded-2xl shrink-0 backdrop-blur-md border border-white/20 relative z-10">
                <Shield className="w-8 h-8 text-blue-100" />
              </div>
              <div className="space-y-1 relative z-10">
                <p className="text-base font-black uppercase tracking-widest">AI Diagnostic Session Active</p>
                <p className="text-[11px] text-blue-100 font-bold uppercase tracking-wide">6-10 questions for precision diagnosis • Medical terms in English</p>
              </div>
            </div>
            <ChatInterface
              messages={messages}
              onSendMessage={handleSendMessage}
              onRetryMessage={handleRetryMessage}
              isProcessing={isProcessing}
              onFinish={generateReport}
              patientName={patient.name}
              language={language}
            />
          </div>
        )}

        {step === AppStep.REPORT && report && (
          <ReportView report={report} patient={patient} onReset={reset} />
        )}

        {step === AppStep.HISTORY && (
          <HistoryView
            records={pastRecords}
            onBack={reset}
            onSelect={showPastReport}
            onDelete={deleteRecord}
          />
        )}

        {isLoadingReport && (
          <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-2xl flex items-center justify-center z-[100]">
            <div className="bg-white p-16 rounded-[4rem] shadow-2xl text-center max-w-lg border-t-[12px] border-gradient-to-r from-blue-600 to-cyan-600 animate-in zoom-in-95 relative overflow-hidden">
              {/* Animated gradient background */}
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-600 via-cyan-500 to-blue-600 animate-pulse"></div>

              <div className="w-24 h-24 border-8 border-blue-100 border-t-blue-600 rounded-full animate-spin mx-auto mb-10 shadow-2xl"></div>
              <h3 className="text-4xl font-black bg-gradient-to-r from-slate-800 to-blue-900 bg-clip-text text-transparent tracking-tighter uppercase mb-4">Finalizing Assessment</h3>
              <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.3em] leading-relaxed px-10">Compiling AI-powered diagnostic summary...</p>
            </div>
          </div>
        )}

        {/* Exit Confirmation Modal */}
        {showExitConfirm && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center z-[100] animate-in fade-in duration-200">
            <div className="bg-white p-8 md:p-12 rounded-[2.5rem] shadow-2xl max-w-md mx-4 animate-in zoom-in-95 duration-300">
              <div className="flex items-center gap-4 mb-6">
                <div className="p-4 bg-amber-100 rounded-2xl">
                  <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-800 tracking-tight">Leave Consultation?</h3>
                  <p className="text-sm text-slate-500 font-medium">Your progress will be lost</p>
                </div>
              </div>
              
              <p className="text-slate-600 mb-8 leading-relaxed">
                You have an active medical consultation in progress. If you leave now, all conversation data and any pending diagnosis will be permanently lost.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={cancelExit}
                  className="flex-1 px-6 py-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-2xl transition-all text-sm uppercase tracking-wider"
                >
                  Continue Session
                </button>
                <button
                  onClick={confirmExit}
                  className="flex-1 px-6 py-4 bg-red-500 hover:bg-red-600 text-white font-bold rounded-2xl transition-all text-sm uppercase tracking-wider"
                >
                  Leave Anyway
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="no-print mt-32 py-16 border-t-2 border-slate-200/50 text-center relative">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-300 to-transparent"></div>
        <p className="text-[9px] text-slate-400 font-black uppercase tracking-[0.4em] mb-2 bg-gradient-to-r from-slate-500 to-blue-500 bg-clip-text text-transparent">VitalGuard Health • AI Medical Platform v6.0</p>
        <p className="text-[8px] text-slate-300 font-semibold uppercase tracking-[0.3em]">Powered by Advanced Medical Intelligence</p>
      </footer>
    </div>
  );
}

