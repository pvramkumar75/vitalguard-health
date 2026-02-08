
import React, { useState, useRef, useEffect } from 'react';
import { AppStep, PatientInfo, Message, MedicalReport, ClinicalRecord, Attachment, Language, StructuredQuestion } from './types';
import { getChatResponse, getMedicalReport } from './services/geminiService';
import * as db from './db';
import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

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
  const langs: { id: Language; label: string; native: string }[] = [
    { id: 'en', label: 'English', native: 'English' },
    { id: 'hi', label: 'Hindi', native: 'हिन्दी' },
    { id: 'te', label: 'Telugu', native: 'తెలుగు' }
  ];

  return (
    <div className="flex gap-1 md:gap-2 bg-gradient-to-r from-slate-100 to-slate-50 p-1 md:p-1.5 rounded-xl md:rounded-2xl border-2 border-slate-200 shadow-md no-print relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-r from-blue-100/20 to-cyan-100/20 opacity-0 hover:opacity-100 transition-opacity pointer-events-none"></div>
      {langs.map((l) => (
        <button
          key={l.id}
          onClick={() => onChange(l.id)}
          className={`px-2 md:px-4 py-1.5 md:py-2 rounded-lg md:rounded-xl text-[8px] md:text-[10px] font-black uppercase tracking-wider md:tracking-widest transition-all relative z-10 group ${current === l.id
            ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-lg shadow-blue-300/50 scale-105'
            : 'text-slate-500 hover:text-slate-700 hover:bg-white/80 hover:shadow-sm'
            }`}
        >
          <span className="block">{l.label}</span>
          <span className="block text-[7px] md:text-[8px] opacity-70 font-medium hidden sm:block">{l.native}</span>
        </button>
      ))}
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onComplete(formData);
  };

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-[2.5rem] md:rounded-[2.5rem] rounded-3xl shadow-2xl p-5 md:p-10 border border-slate-100 animate-in fade-in slide-in-from-bottom-6 duration-700 relative overflow-hidden">
      {/* Decorative background gradient */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-blue-100 to-cyan-50 rounded-full blur-3xl opacity-30 -z-10"></div>
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-cyan-100 to-blue-50 rounded-full blur-3xl opacity-30 -z-10"></div>

      <div className="flex items-center justify-between mb-10">
        <div className="flex items-center gap-5">
          <div className="p-4 bg-gradient-to-br from-blue-600 to-cyan-500 rounded-2xl text-white shadow-xl shadow-blue-200/50 transform hover:scale-105 transition-transform">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <h2 className="text-3xl font-black bg-gradient-to-r from-slate-800 to-blue-900 bg-clip-text text-transparent tracking-tighter">Patient Registry</h2>
            <p className="text-sm text-slate-500 font-semibold">Complete profile for AI consultation</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            Patient Full Name
          </label>
          <input
            type="text"
            required
            className="w-full px-5 py-4 rounded-2xl border-2 border-slate-100 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 outline-none transition bg-gradient-to-b from-slate-50 to-white font-semibold text-slate-800 placeholder:text-slate-400"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g. Rajesh Kumar"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500"></span>
              Age
            </label>
            <input
              type="text"
              required
              className="w-full px-5 py-4 rounded-2xl border-2 border-slate-100 focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100 outline-none transition bg-gradient-to-b from-slate-50 to-white font-semibold text-slate-800 placeholder:text-slate-400"
              value={formData.age}
              onChange={(e) => setFormData({ ...formData, age: e.target.value })}
              placeholder="e.g. 35"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500"></span>
              Gender
            </label>
            <select
              required
              className="w-full px-5 py-4 rounded-2xl border-2 border-slate-100 focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100 outline-none transition bg-gradient-to-b from-slate-50 to-white font-semibold text-slate-800"
              value={formData.gender}
              onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
            >
              <option value="">Select</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowVitals(!showVitals)}
          className="text-blue-600 font-black text-sm uppercase tracking-wide hover:text-cyan-600 transition-colors flex items-center gap-2"
        >
          <svg className={`w-4 h-4 transition-transform ${showVitals ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
          Quick Vital Signs (Optional)
        </button>

        {showVitals && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-4 md:p-6 bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl border-2 border-blue-100 animate-in slide-in-from-top duration-300">
            <div>
              <label className="block text-[10px] font-black text-blue-700 uppercase tracking-[0.2em] mb-2">Weight (kg)</label>
              <input
                type="text"
                className="w-full px-5 py-3 rounded-xl border-2 border-blue-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition bg-white font-semibold text-slate-800 placeholder:text-slate-400"
                value={formData.weight}
                onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                placeholder="e.g. 70"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-blue-700 uppercase tracking-[0.2em] mb-2">Height (cm)</label>
              <input
                type="text"
                className="w-full px-5 py-3 rounded-xl border-2 border-blue-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition bg-white font-semibold text-slate-800 placeholder:text-slate-400"
                value={formData.height}
                onChange={(e) => setFormData({ ...formData, height: e.target.value })}
                placeholder="e.g. 175"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500"></span>
            Medical History & Allergies
          </label>
          <textarea
            className="w-full px-5 py-4 rounded-2xl border-2 border-slate-100 focus:border-violet-500 focus:ring-4 focus:ring-violet-100 outline-none transition h-28 bg-gradient-to-b from-slate-50 to-white font-medium text-slate-800 resize-none placeholder:text-slate-400"
            value={formData.history}
            onChange={(e) => setFormData({ ...formData, history: e.target.value })}
            placeholder="Known conditions or allergies..."
          ></textarea>
        </div>

        <div className="flex flex-col gap-4 pt-6 border-t-2 border-slate-100">
          <button
            type="submit"
            className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-black py-5 rounded-2xl shadow-2xl shadow-blue-200/50 transition-all active:scale-[0.98] text-sm uppercase tracking-widest group relative overflow-hidden"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              {pastRecordsCount > 0 ? 'Resume Medical Session' : 'Start AI Consultation'}
              <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-600 to-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          </button>

          {pastRecordsCount > 0 && (
            <button
              type="button"
              onClick={onViewHistory}
              className="w-full bg-white border-2 border-slate-200 text-slate-700 font-bold py-5 rounded-2xl hover:bg-slate-50 hover:border-blue-200 transition-all flex items-center justify-center gap-3 text-sm shadow-md hover:shadow-xl group"
            >
              <svg className="w-5 h-5 text-blue-600 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
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
  isProcessing: boolean;
  onFinish: () => void;
  patientName: string;
  language: Language;
}> = ({ messages, onSendMessage, isProcessing, onFinish, patientName, language }) => {
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
    <div className="flex flex-col h-[calc(100vh-8rem)] md:h-[780px] bg-white rounded-2xl md:rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-100 relative">
      <div className="bg-slate-900 text-white px-4 md:px-8 py-4 md:py-6 flex justify-between items-center relative z-10">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center font-black border-2 border-slate-800 text-lg shadow-inner">Dr</div>
          <div>
            <p className="font-bold text-sm tracking-tight">{patientName}</p>
            <p className="text-[9px] text-slate-400 uppercase tracking-widest font-black">Clinical Consultation Active</p>
          </div>
        </div>
        <button
          onClick={onFinish}
          disabled={messages.length < 2 || isProcessing}
          className="bg-blue-600 hover:bg-blue-500 px-6 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg disabled:opacity-50"
        >
          Finalize Assessment
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4 md:space-y-8 bg-slate-50/20">
        {messages.map((m, idx) => (
          <div key={idx} className="space-y-3">
            <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in duration-300`}>
              <div className={`max-w-[90%] md:max-w-[85%] rounded-[1.5rem] px-4 md:px-6 py-4 md:py-5 ${m.role === 'user'
                ? 'bg-blue-600 text-white rounded-tr-none shadow-xl shadow-blue-50/50'
                : 'bg-white text-slate-800 shadow-sm border border-slate-100 rounded-tl-none'
                }`}>
                {m.attachments && m.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-3 mb-4">
                    {m.attachments.map((at, i) => (
                      <div key={i} className="relative">
                        {at.mimeType.startsWith('image/') ? (
                          <img
                            src={`data:${at.mimeType};base64,${at.data}`}
                            className="max-h-48 rounded-xl border-2 border-white/20 shadow-md"
                            alt="Patient uploaded clinical media"
                          />
                        ) : (
                          <div className="bg-white/10 backdrop-blur-md p-3 rounded-xl border border-white/10 flex items-center gap-3 min-w-[120px]">
                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            <span className="text-[10px] font-black uppercase tracking-tighter truncate max-w-[100px] text-white">{at.name}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <p className={`whitespace-pre-wrap leading-relaxed text-sm ${m.role === 'model' ? 'font-bold' : 'font-medium'
                  }`}>
                  {m.text || (m.attachments?.length ? "Clinical documents attached." : "")}
                </p>
              </div>
            </div>
            {m.question && m.role === 'model' && m.question.options.length > 0 && (
              <div className="flex justify-start">
                <div className="max-w-[85%]">
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
            )}
          </div>
        ))}
        {isProcessing && (
          <div className="flex justify-start">
            <div className="bg-white rounded-2xl px-6 py-4 shadow-sm border border-slate-100 flex gap-2 items-center">
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce delay-75"></div>
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce delay-150"></div>
            </div>
          </div>
        )}
      </div>

      {showCamera && (
        <div className="fixed inset-0 bg-slate-950/95 z-[60] flex flex-col items-center justify-center p-8 transition-all">
          <div className={`relative max-w-2xl w-full rounded-[2.5rem] overflow-hidden shadow-2xl border-4 border-white/5 mb-8 ${isCapturing ? 'brightness-150 scale-[1.02]' : 'brightness-100 scale-100'} transition-all duration-150`}>
            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-64 border-2 border-dashed border-white/20 rounded-full"></div>
            </div>
            {isCapturing && (
              <div className="absolute inset-0 bg-white/40 flex items-center justify-center animate-pulse">
                <div className="bg-white p-6 rounded-full shadow-2xl">
                  <svg className="w-12 h-12 text-blue-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-6">
            <button
              onClick={capturePhoto}
              disabled={isCapturing}
              className="bg-white text-slate-900 px-12 py-5 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] shadow-2xl active:scale-95 disabled:opacity-50 transition-all flex items-center gap-3"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="3" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeWidth="3" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              Capture Frame
            </button>
            <button onClick={stopCamera} className="bg-white/10 text-white px-10 py-5 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] border border-white/10 backdrop-blur-md">Cancel</button>
          </div>
        </div>
      )}

      {showCamera && (
        <div className="fixed inset-0 bg-slate-950/95 z-[60] flex flex-col items-center justify-center p-8 transition-all">
          <div className={`relative max-w-2xl w-full rounded-[2.5rem] overflow-hidden shadow-2xl border-4 border-white/5 mb-8 ${isCapturing ? 'brightness-150 scale-[1.02]' : 'brightness-100 scale-100'} transition-all duration-150`}>
            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-64 border-2 border-dashed border-white/20 rounded-full"></div>
            </div>
            {isCapturing && (
              <div className="absolute inset-0 bg-white/40 flex items-center justify-center animate-pulse">
                <div className="bg-white p-6 rounded-full shadow-2xl">
                  <svg className="w-12 h-12 text-blue-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-6">
            <button
              onClick={capturePhoto}
              disabled={isCapturing}
              className="bg-white text-slate-900 px-12 py-5 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] shadow-2xl active:scale-95 disabled:opacity-50 transition-all flex items-center gap-3"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="3" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeWidth="3" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              Capture Frame
            </button>
            <button onClick={stopCamera} className="bg-white/10 text-white px-10 py-5 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] border border-white/10 backdrop-blur-md">Cancel</button>
          </div>
        </div>
      )}

      <div className="p-3 md:p-6 bg-white border-t space-y-3 md:space-y-5 shadow-inner relative z-20">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-4 mb-2 p-1 border-b border-slate-50 pb-4">
            {attachments.map((at, i) => (
              <div key={i} className="relative group animate-in zoom-in-50 duration-200">
                {at.mimeType.startsWith('image/') ? (
                  <img src={`data:${at.mimeType};base64,${at.data}`} className="w-20 h-20 object-cover rounded-2xl border-2 border-blue-100 shadow-md" />
                ) : (
                  <div className="w-20 h-20 bg-blue-50 flex flex-col items-center justify-center rounded-2xl border-2 border-blue-100 text-[8px] font-black text-center p-2 text-blue-600 uppercase tracking-tighter">
                    <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    {at.name}
                  </div>
                )}
                <button
                  onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                  className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full w-6 h-6 text-[10px] flex items-center justify-center shadow-xl border-2 border-white transition-transform hover:scale-110"
                >✕</button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSend} className="flex gap-2 md:gap-3 flex-wrap md:flex-nowrap">
          <button
            type="button"
            onClick={startCamera}
            className="p-4 bg-slate-50 rounded-[1.25rem] text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-all border border-slate-50"
            title="Camera Analysis"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeWidth="2.5" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-4 bg-slate-50 rounded-[1.25rem] text-slate-400 hover:bg-green-50 hover:text-green-600 transition-all border border-slate-50"
            title="Upload Documents (PDF, Word, PPT, Excel, Images & more)"
            disabled={isProcessing || isUploading}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.gif,.bmp,.tiff,.tif,.webp,.heic,.heif,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.md,.rtf,.xml,.html,.htm,.json,.log"
            onChange={handleFileUpload}
            className="hidden"
          />

          <button
            type="button"
            onClick={startListening}
            disabled={isProcessing}
            className={`p-4 rounded-[1.25rem] transition-all border ${isListening ? 'bg-red-100 text-red-600 border-red-200 animate-pulse' : 'bg-slate-50 text-slate-400 hover:bg-purple-50 hover:text-purple-600 border-slate-50'}`}
            title={isListening ? "Listening..." : "Voice Input"}
          >
            <svg className="w-6 h-6" fill={isListening ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4" /></svg>
          </button>

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isListening ? "Listening..." : attachments.length ? "Files attached..." : "Type message or use voice..."}
            className="flex-1 w-full md:w-auto px-4 md:px-6 py-3 md:py-4 rounded-[1.25rem] border border-slate-100 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-medium shadow-inner bg-slate-50"
            disabled={isProcessing || isUploading}
          />
          <button
            type="submit"
            disabled={(!input.trim() && attachments.length === 0) || isProcessing || isUploading}
            className="bg-blue-600 text-white px-10 rounded-[1.25rem] hover:bg-blue-700 transition-all disabled:opacity-50 font-black uppercase tracking-widest text-[10px] shadow-xl active:scale-95"
          >
            Send
          </button>
        </form>

        {micError && (
          <div className="px-6 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm font-medium">
            🎤 {micError}
          </div>
        )}

        {isUploading && (
          <div className="px-6 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm font-medium flex items-center gap-2">
            <div className="animate-spin">⟳</div> {uploadStatus || 'Processing documents...'}
          </div>
        )}
        {isProcessing && !isUploading && (
          <div className="px-6 py-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-700 text-sm font-medium flex items-center gap-2">
            <div className="animate-spin">⟳</div> Doctor is analyzing...
          </div>
        )}
      </div>
    </div>
  );
};

const HistoryView: React.FC<{
  records: ClinicalRecord[];
  onBack: () => void;
  onSelect: (record: ClinicalRecord) => void;
}> = ({ records, onBack, onSelect }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'patient' | 'diagnosis'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'diagnosis'>('date');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<Language | 'all'>('all');

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
    <div className="max-w-5xl mx-auto animate-in fade-in duration-500">
      <div className="flex items-center justify-between mb-8 px-4">
        <h2 className="text-3xl font-black text-slate-800 flex items-center gap-4 tracking-tight">
          <div className="p-3 bg-blue-600 rounded-2xl text-white shadow-xl shadow-blue-100">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="3" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          Clinical Memory Vault ({filteredRecords.length})
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExport}
            disabled={records.length === 0}
            className="bg-green-50 hover:bg-green-100 disabled:opacity-50 px-5 py-3 rounded-2xl border border-green-200 text-green-700 font-black text-[10px] uppercase tracking-widest shadow-sm transition-all"
            title="Export all records as JSON"
          >
            📥 Export
          </button>
          <label className="relative">
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
              className="bg-blue-50 hover:bg-blue-100 px-5 py-3 rounded-2xl border border-blue-200 text-blue-700 font-black text-[10px] uppercase tracking-widest shadow-sm transition-all"
              title="Import records from JSON file"
            >
              📤 Import
            </button>
          </label>
          <button onClick={onBack} className="bg-white px-6 py-3 rounded-2xl border border-slate-200 text-slate-500 hover:text-slate-800 font-black text-[10px] uppercase tracking-widest shadow-sm transition-all hover:shadow-md flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="3" d="M15 19l-7-7 7-7" /></svg>
            Back
          </button>
        </div>
      </div>

      <div className="space-y-4 mb-8">
        <div className="flex flex-col md:flex-row gap-3">
          <input
            type="text"
            placeholder="Search by patient name, diagnosis, or summary..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 px-5 py-4 rounded-2xl border border-slate-100 focus:ring-2 focus:ring-blue-500 outline-none transition bg-white font-medium text-slate-700 shadow-sm"
          />
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={`px-6 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all ${showAdvanced
              ? 'bg-blue-600 text-white shadow-lg'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200'
              }`}
          >
            ⚙️ Filters
          </button>
        </div>

        {showAdvanced && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 p-4 md:p-6 bg-blue-50 rounded-2xl border border-blue-200">
            <div>
              <label className="block text-[10px] font-black text-slate-600 uppercase mb-2">Search Type</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as any)}
                className="w-full px-4 py-3 rounded-xl border border-blue-200 bg-white font-medium text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="all">All Fields</option>
                <option value="patient">Patient Name Only</option>
                <option value="diagnosis">Diagnosis Only</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-600 uppercase mb-2">Sort By</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="w-full px-4 py-3 rounded-xl border border-blue-200 bg-white font-medium text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="date">Date (Newest)</option>
                <option value="name">Patient Name (A-Z)</option>
                <option value="diagnosis">Diagnosis (A-Z)</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-600 uppercase mb-2">Language</label>
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value as any)}
                className="w-full px-4 py-3 rounded-xl border border-blue-200 bg-white font-medium text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
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

      <div className="grid grid-cols-1 gap-4">
        {filteredRecords.length === 0 ? (
          <div className="bg-white p-24 rounded-[2rem] border border-slate-100 text-center text-slate-300 font-bold uppercase tracking-widest shadow-sm border-dashed">
            {records.length === 0 ? 'No Records Yet • Start Your First Consultation' : 'No Matching Records Found'}
          </div>
        ) : (
          filteredRecords.map((r) => (
            <button
              key={r.id}
              onClick={() => onSelect(r)}
              className="bg-white p-6 rounded-[1.5rem] border border-slate-100 shadow-sm hover:shadow-lg hover:border-blue-200 transition-all text-left group"
            >
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-[8px] bg-blue-50 text-blue-600 px-3 py-1 rounded-full font-black uppercase tracking-widest">
                      {new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                    <span className="text-[8px] text-slate-300 font-black uppercase">ID: {r.id}</span>
                    <span className={`text-[8px] px-2 py-1 rounded-full font-black uppercase tracking-widest ${r.language === 'en' ? 'bg-green-50 text-green-600' :
                      r.language === 'hi' ? 'bg-orange-50 text-orange-600' :
                        'bg-purple-50 text-purple-600'
                      }`}>
                      {r.language === 'en' ? '🇬🇧 EN' : r.language === 'hi' ? '🇮🇳 HI' : '🇮🇳 TE'}
                    </span>
                  </div>
                  <p className="text-lg font-black text-slate-800 uppercase tracking-tight group-hover:text-blue-600 transition-colors mb-1">
                    {r.report?.diagnosis || 'Medical Assessment'}
                  </p>
                  <p className="text-sm text-slate-600 line-clamp-1">👤 {r.patientInfo.name} • {r.patientInfo.age}y • {r.patientInfo.gender}</p>
                  <p className="text-xs text-slate-500 mt-2 line-clamp-1">"{r.report?.patientSummary}"</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-2xl group-hover:bg-blue-600 group-hover:text-white transition-all shrink-0">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="3" d="M9 5l7 7-7 7" /></svg>
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {filteredRecords.length > 0 && (
        <div className="mt-6 p-4 bg-slate-50 rounded-2xl border border-slate-100 text-center text-[10px] font-black text-slate-500 uppercase tracking-widest">
          Showing {filteredRecords.length} of {records.length} records
        </div>
      )}
    </div>
  );
};

const ReportView: React.FC<{ report: MedicalReport; patient: PatientInfo; onReset: () => void; }> = ({ report, patient, onReset }) => {
  return (
    <div className="max-w-4xl mx-auto space-y-6 md:space-y-10 pb-20 md:pb-40 animate-in fade-in zoom-in-95 duration-700">
      <div className="bg-white rounded-3xl md:rounded-[4rem] shadow-2xl overflow-hidden border border-slate-100">
        <div className="bg-slate-950 text-white p-8 md:p-16 border-b-4 md:border-b-[12px] border-blue-600 relative overflow-hidden">
          <div className="relative z-10 flex flex-col md:flex-row justify-between items-start gap-4 md:gap-0">
            <div>
              <h1 className="text-4xl md:text-6xl font-black tracking-tighter uppercase leading-[0.85]">Clinical<br />Assessment</h1>
              <p className="text-blue-400 font-black tracking-[0.3em] md:tracking-[0.5em] uppercase text-[8px] md:text-[9px] mt-4 md:mt-6">Secure Diagnostic Record • India Official</p>
            </div>
            <div className="bg-white/5 p-3 md:p-4 rounded-2xl border border-white/10 backdrop-blur-xl text-right">
              <p className="text-[8px] text-blue-300 font-black uppercase tracking-widest mb-1">Doc Ref</p>
              <p className="text-xs md:text-sm font-mono font-black uppercase tracking-widest">#{Math.random().toString(36).substr(2, 6).toUpperCase()}</p>
            </div>
          </div>
        </div>

        <div className="p-6 md:p-16 space-y-8 md:space-y-16">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 md:gap-12 border-b border-slate-50 pb-6 md:pb-12">
            <div>
              <p className="text-[9px] text-slate-300 font-black uppercase tracking-[0.3em] mb-3">Patient Profile</p>
              <p className="text-2xl font-black text-slate-900 tracking-tighter uppercase">{patient.name}</p>
            </div>
            <div>
              <p className="text-[9px] text-slate-300 font-black uppercase tracking-[0.3em] mb-3">Vitals Context</p>
              <p className="text-2xl font-black text-slate-900 tracking-tighter uppercase">{patient.age}Y • {patient.gender}</p>
            </div>
            <div className="md:text-right">
              <p className="text-[9px] text-slate-300 font-black uppercase tracking-[0.3em] mb-3">Examination Date</p>
              <p className="text-2xl font-black text-slate-900 tracking-tighter uppercase">{new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
            </div>
          </div>

          <section className="bg-slate-50/50 p-6 md:p-12 rounded-2xl md:rounded-[3.5rem] border border-slate-100 shadow-inner">
            <h3 className="text-[9px] font-black text-slate-300 mb-4 md:mb-6 uppercase tracking-[0.4em]">Primary Clinical Diagnosis</h3>
            <p className="text-3xl md:text-5xl text-blue-900 font-black tracking-tighter leading-[1.1] mb-4 md:mb-8 uppercase">{report.diagnosis}</p>
            <p className="text-base md:text-xl text-slate-600 leading-relaxed font-black italic border-l-4 md:border-l-[6px] border-blue-100 pl-4 md:pl-10 tracking-tight">"{report.patientSummary}"</p>
          </section>

          <section>
            <div className="flex items-center gap-4 md:gap-6 mb-6 md:mb-10">
              <h3 className="text-[9px] font-black text-slate-300 uppercase tracking-[0.4em]">Therapeutic Intervention Plan</h3>
              <div className="h-px bg-slate-100 flex-1"></div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:gap-8">
              {report.prescriptions.map((p, i) => (
                <div key={i} className="p-6 md:p-10 border border-slate-100 rounded-2xl md:rounded-[3rem] bg-white shadow-sm border-l-4 md:border-l-[12px] border-l-blue-600 hover:shadow-xl transition-all">
                  <div className="flex justify-between items-start mb-8">
                    <p className="font-black text-slate-900 text-3xl uppercase tracking-tighter">{p.medication}</p>
                    <span className="bg-slate-950 text-white text-[10px] px-6 py-2 rounded-full font-black uppercase tracking-widest">{p.duration}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 md:gap-10">
                    <div className="bg-slate-50/50 p-6 rounded-2xl border border-slate-50">
                      <p className="text-slate-300 text-[9px] font-black uppercase mb-2">Clinical Dosage</p>
                      <p className="font-black text-slate-800 text-xl tracking-tight">{p.dosage}</p>
                    </div>
                    <div className="bg-slate-50/50 p-6 rounded-2xl border border-slate-50">
                      <p className="text-slate-300 text-[9px] font-black uppercase mb-2">Admin Frequency</p>
                      <p className="font-black text-slate-800 text-xl tracking-tight">{p.frequency}</p>
                    </div>
                  </div>
                  {p.notes && (
                    <div className="mt-8 flex gap-4 p-5 bg-blue-50/50 rounded-[1.5rem] border border-blue-100">
                      <svg className="w-5 h-5 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="3" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <p className="text-xs text-blue-700 font-black leading-relaxed uppercase tracking-wide">Physician Note: {p.notes}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {report.recommendedTests && report.recommendedTests.length > 0 && (
            <section>
              <div className="flex items-center gap-6 mb-10">
                <h3 className="text-[9px] font-black text-slate-300 uppercase tracking-[0.4em]">Recommended Investigations</h3>
                <div className="h-px bg-slate-100 flex-1"></div>
              </div>
              <div className="bg-gradient-to-br from-purple-50 via-violet-50 to-purple-50 p-10 rounded-[3rem] border-2 border-purple-200/60 shadow-lg relative overflow-hidden">
                {/* Decorative elements */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-purple-200/40 to-transparent rounded-full blur-2xl"></div>
                <div className="absolute bottom-0 left-0 w-24 h-24 bg-gradient-to-tr from-violet-200/40 to-transparent rounded-full blur-xl"></div>

                <div className="flex items-center gap-4 mb-8 relative z-10">
                  <div className="p-3 bg-gradient-to-br from-purple-600 to-violet-600 rounded-2xl shadow-lg">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeWidth="2.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-[9px] font-black text-purple-700 uppercase tracking-[0.3em]">Laboratory & Diagnostic Tests</h4>
                    <p className="text-xs text-purple-600 font-semibold">Essential investigations for accurate diagnosis</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative z-10">
                  {report.recommendedTests.map((test, i) => (
                    <div key={i} className="bg-white/80 backdrop-blur-sm p-5 rounded-2xl border-2 border-purple-200/50 hover:border-purple-400 hover:shadow-md transition-all group">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gradient-to-br from-purple-100 to-violet-100 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                          <span className="text-purple-700 font-black text-sm">{i + 1}</span>
                        </div>
                        <p className="font-bold text-slate-800 text-base tracking-tight flex-1">{test}</p>
                        <svg className="w-5 h-5 text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 p-4 bg-purple-100/50 rounded-2xl border border-purple-200 relative z-10">
                  <p className="text-xs text-purple-800 font-semibold flex items-center gap-2">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    Please get these tests done from an accredited laboratory and bring the results for review.
                  </p>
                </div>
              </div>
            </section>
          )}

          <section className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-12">
            <div className="bg-red-50 p-6 md:p-10 rounded-2xl md:rounded-[3rem] border border-red-100 shadow-sm">
              <h4 className="text-[9px] font-black text-red-600 uppercase mb-4 md:mb-6 tracking-[0.3em] flex items-center gap-3">
                <div className="w-2 h-2 bg-red-600 rounded-full animate-ping"></div>
                Urgent Warnings
              </h4>
              <p className="text-sm text-red-950 leading-relaxed font-black uppercase tracking-tight">{report.emergencyWarning}</p>
            </div>
            <div className="bg-blue-50 p-6 md:p-10 rounded-2xl md:rounded-[3rem] border border-blue-100 shadow-sm">
              <h4 className="text-[9px] font-black text-blue-700 uppercase mb-4 md:mb-6 tracking-[0.3em] flex items-center gap-3">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="3" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Next Clinical Steps
              </h4>
              <p className="text-sm text-blue-950 leading-relaxed font-black uppercase tracking-tight">{report.followUp}</p>
            </div>
          </section>
        </div>
      </div>

      <div className="flex flex-col md:flex-row justify-center gap-4 md:gap-8 no-print pb-10 md:pb-20">
        <button onClick={() => window.print()} className="bg-slate-950 text-white px-16 py-6 rounded-[2rem] font-black uppercase tracking-[0.3em] text-[10px] shadow-2xl active:scale-95 transition-all flex items-center gap-4">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="3" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
          Download Assessment
        </button>
        <button onClick={onReset} className="bg-white border-2 border-slate-100 text-slate-400 px-16 py-6 rounded-[2rem] font-black uppercase tracking-[0.3em] text-[10px] shadow-sm hover:bg-slate-50 transition-all">New Registry</button>
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
      const initTexts: Record<Language, string> = {
        en: `Registry Complete. Initializing assessment for ${data.name}. Ready to hear clinical concerns.`,
        hi: `पंजीकरण पूर्ण हुआ। ${data.name} के लिए मूल्यांकन शुरू किया जा रहा है। अपनी स्वास्थ्य समस्याओं के बारे में बताएं।`,
        te: `రిజిస్ట్రేషన్ పూర్తయింది. ${data.name} కోసం పరీక్ష ప్రారంభించబడుతోంది. మీ ఆరోగ్య సమస్యలను తెలియజేయండి.`
      };
      handleSendMessage(initTexts[language], []);
    }
  };

  const handleSendMessage = async (text: string, attachments: Attachment[] = []) => {
    const userMessage: Message = { role: 'user', text, attachments };
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

      setMessages(prev => [...prev, { role: 'model', text: responseText, question }]);
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage = error instanceof Error ? error.message : 'An error occurred. Please try again.';
      setMessages(prev => [...prev, { role: 'model', text: `Error: ${errorMessage}` }]);
    } finally {
      setIsProcessing(false);
    }
  };

  const getOptionsForQuestion = (question: string, conversationHistory: Message[]): Array<{ id: string; label: string }> => {
    // No checkbox options - users will type their responses
    return [];
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-cyan-50/30 font-sans selection:bg-blue-200 selection:text-blue-900 relative overflow-hidden">
      {/* Animated background elements */}
      <div className="fixed top-0 left-0 w-96 h-96 bg-gradient-to-br from-blue-200/20 to-cyan-200/20 rounded-full blur-3xl animate-pulse -z-10"></div>
      <div className="fixed bottom-0 right-0 w-96 h-96 bg-gradient-to-tl from-violet-200/20 to-blue-200/20 rounded-full blur-3xl animate-pulse delay-1000 -z-10"></div>

      <nav className="no-print bg-white/80 border-b-2 border-slate-200/50 px-4 md:px-8 py-4 md:py-5 flex items-center justify-between sticky top-0 z-50 backdrop-blur-xl shadow-lg relative">
        {/* Gradient accent bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-600 via-cyan-500 to-blue-600 opacity-80"></div>

        <div className="flex items-center gap-4">
          <button onClick={reset} className="w-14 h-14 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-[1.25rem] flex items-center justify-center text-white shadow-xl shadow-blue-200/50 transition-all hover:scale-110 hover:rotate-12 active:scale-95 group relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-tr from-cyan-600 to-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <svg className="w-7 h-7 relative z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </button>
          <div>
            <span className="text-xl md:text-3xl font-black tracking-tighter cursor-pointer bg-gradient-to-r from-slate-800 via-blue-700 to-cyan-600 bg-clip-text text-transparent hover:from-blue-700 hover:via-cyan-600 hover:to-blue-700 transition-all" onClick={reset}>
              VitalGuard <span className="text-cyan-600">Health</span>
            </span>
            <p className="text-[8px] md:text-[9px] text-slate-500 font-black uppercase tracking-[0.15em] md:tracking-[0.2em] mt-0.5 hidden sm:block">AI-Powered Medical Intelligence</p>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-6">
          <LanguageSwitcher current={language} onChange={setLanguage} />
          <button
            onClick={() => setStep(AppStep.HISTORY)}
            className={`px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all relative overflow-hidden group ${step === AppStep.HISTORY ? 'bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-2xl' : 'bg-gradient-to-r from-slate-100 to-slate-50 text-slate-600 hover:from-blue-50 hover:to-cyan-50 hover:text-blue-700 shadow-md border-2 border-slate-200 hover:border-blue-200'}`}
          >
            <span className="relative z-10 flex items-center gap-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4z" />
                <path fillRule="evenodd" d="M3 8h14v7a2 2 0 01-2 2H5a2 2 0 01-2-2V8zm5 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
              History Vault
            </span>
            {step !== AppStep.HISTORY && <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-cyan-600 opacity-0 group-hover:opacity-10 transition-opacity"></div>}
          </button>
        </div>
      </nav>

      <main className="container mx-auto px-4 md:px-6 py-6 md:py-12 max-w-7xl">
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
            <div className="bg-gradient-to-r from-blue-600 to-cyan-600 p-4 md:p-6 rounded-2xl md:rounded-[2.5rem] text-white flex items-start gap-3 md:gap-5 shadow-2xl shadow-blue-200/50 border-2 border-blue-400/30 relative overflow-hidden">
              {/* Accent decoration */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>
              <div className="absolute bottom-0 left-0 w-24 h-24 bg-cyan-400/20 rounded-full blur-xl"></div>

              <div className="p-3 bg-white/20 rounded-2xl shrink-0 backdrop-blur-sm relative z-10">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="3" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div className="space-y-1 relative z-10">
                <p className="text-base font-black uppercase tracking-widest">AI Diagnostic Session Active</p>
                <p className="text-[11px] text-blue-100 font-bold uppercase tracking-wide">6-10 questions for precision diagnosis • Medical terms in English</p>
              </div>
            </div>
            <ChatInterface
              messages={messages}
              onSendMessage={handleSendMessage}
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
      </main>

      <footer className="no-print mt-32 py-16 border-t-2 border-slate-200/50 text-center relative">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-300 to-transparent"></div>
        <p className="text-[9px] text-slate-400 font-black uppercase tracking-[0.4em] mb-2 bg-gradient-to-r from-slate-500 to-blue-500 bg-clip-text text-transparent">VitalGuard Health • AI Medical Platform v6.0</p>
        <p className="text-[8px] text-slate-300 font-semibold uppercase tracking-[0.3em]">Powered by Advanced Medical Intelligence</p>
      </footer>
    </div>
  );
}
