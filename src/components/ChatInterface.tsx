import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Send, Camera, Paperclip, Loader2, AlertTriangle, X, FileText, Check } from 'lucide-react';
import { Message, Attachment, Language } from '../../types';
import { extractDocumentText, GEMINI_SUPPORTED_INLINE_TYPES } from '../utils/documentUtils';
import { blobToBase64, formatTimestamp } from '../utils/formatUtils';
import { CheckboxQuestion } from './CheckboxQuestion';

interface ChatInterfaceProps {
  messages: Message[];
  onSendMessage: (msg: string, attachments?: Attachment[]) => void;
  onRetryMessage?: (text: string, attachments?: Attachment[]) => void;
  isProcessing: boolean;
  onFinish: () => void;
  patientName: string;
  language: Language;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, onSendMessage, onRetryMessage, isProcessing, onFinish, patientName, language }) => {
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
    <div className="flex flex-col h-[calc(100vh-8rem)] md:h-[780px] glass-panel rounded-2xl overflow-hidden relative shadow-2xl shadow-slate-200/50">
      
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-md border-b border-white/20 px-6 py-4 flex justify-between items-center z-10 sticky top-0">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center font-bold text-white text-sm shadow-lg shadow-blue-500/30">
              Pt
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>
          </div>
          <div>
            <p className="font-heading font-bold text-slate-800 tracking-tight">{patientName}</p>
            <p className="text-xs text-slate-500 font-medium tracking-wide">AI Consultation Active</p>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scroll-smooth">
        {messages.map((m, idx) => (
          <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in group`}>
            
            {/* Avatar for AI */}
            {m.role === 'model' && (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shrink-0 mr-3 mt-1 shadow-sm text-white sticky top-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              </div>
            )}

            <div className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-5 py-3.5 shadow-sm transition-all duration-200 hover:shadow-md ${m.role === 'user'
              ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-br-sm'
              : 'bg-white/80 backdrop-blur-sm text-slate-700 border border-white/40 rounded-bl-sm'
              }`}>
              {m.attachments && m.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {m.attachments.map((at, i) => (
                    <div key={i} className="relative group/att overflow-hidden rounded-xl">
                      {at.mimeType.startsWith('image/') ? (
                        <img
                          src={`data:${at.mimeType};base64,${at.data}`}
                          className="max-h-48 rounded-lg border border-white/10 object-cover"
                          alt="Attachment"
                        />
                      ) : (
                        <div className="bg-white/10 backdrop-blur-sm p-3 rounded-lg border border-white/10 flex items-center gap-2">
                          <FileText className="w-4 h-4 text-white" />
                          <span className="text-xs font-medium truncate max-w-[120px] text-white">{at.name}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p className={`whitespace-pre-wrap leading-relaxed text-[0.93rem] ${m.role === 'model' ? 'font-normal' : 'font-medium'}`}>
                {m.text || (m.attachments?.length ? "Attachments uploaded." : "")}
              </p>
              
              <div className={`text-[10px] mt-1.5 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${m.role === 'user' ? 'text-blue-100' : 'text-slate-400'}`}>
                {formatTimestamp(m.timestamp)}
              </div>
              
              {m.role === 'model' && m.text?.startsWith('Error:') && onRetryMessage && (
                <button
                  onClick={() => {
                    const prevMsg = messages[idx - 1];
                    if (prevMsg) onRetryMessage(prevMsg.text, prevMsg.attachments);
                  }}
                  className="mt-2 text-xs font-bold text-red-500 hover:text-red-600 flex items-center gap-1 bg-red-50 px-2 py-1 rounded-md"
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
             <div key={`q-${idx}`} className="flex justify-start animate-fade-in pl-11">
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
          <div className="flex justify-start pl-2">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl px-5 py-4 shadow-sm border border-white/50 flex items-center gap-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce delay-75"></div>
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce delay-150"></div>
              </div>
              <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Analyzing Symptoms...</span>
            </div>
          </div>
        )}
      </div>

      {showCamera && (
        <div className="absolute inset-0 bg-slate-900/95 z-50 flex flex-col backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative flex-1 m-4 rounded-3xl overflow-hidden border border-white/10 shadow-2xl">
            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-48 border-2 border-white/50 rounded-2xl relative">
                <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-white -mt-1 -ml-1 rounded-tl-sm"></div>
                <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-white -mt-1 -mr-1 rounded-tr-sm"></div>
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-white -mb-1 -ml-1 rounded-bl-sm"></div>
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-white -mb-1 -mr-1 rounded-br-sm"></div>
              </div>
            </div>
          </div>
          <div className="p-8 flex justify-center gap-12 items-center">
            <button
              onClick={stopCamera}
              className="px-6 py-3 rounded-full bg-white/10 text-white font-medium text-sm hover:bg-white/20 transition-colors backdrop-blur-md"
            >
              Cancel
            </button>
            <button
              onClick={capturePhoto}
              className="w-20 h-20 rounded-full bg-white border-[6px] border-slate-300/30 shadow-xl active:scale-90 transition-all duration-200 hover:shadow-white/20"
            ></button>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-4 md:p-5 bg-white/80 backdrop-blur-md border-t border-white/20">
        {attachments.length > 0 && (
          <div className="flex gap-3 mb-4 pb-3 border-b border-slate-200/50 overflow-x-auto px-1">
            {attachments.map((at, i) => (
              <div key={i} className="relative group shrink-0 animate-in zoom-in-95 duration-200">
                {at.mimeType.startsWith('image/') ? (
                   <img src={`data:${at.mimeType};base64,${at.data}`} className="w-16 h-16 object-cover rounded-xl border border-white shadow-sm" />
                ) : (
                  <div className="w-16 h-16 bg-blue-50 flex flex-col items-center justify-center rounded-xl border border-blue-100 shadow-sm">
                    <FileText className="w-6 h-6 text-blue-400" />
                  </div>
                )}
                <button
                  onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                  className="absolute -top-2 -right-2 bg-slate-800 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-lg border-2 border-white text-xs hover:bg-red-500 hover:scale-110 transition-all"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Action Bar */}
        <div className="flex flex-col gap-4">
          <form onSubmit={handleSend} className="flex items-end gap-3">
            {/* Buttons moved to bottom bar */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.gif,.bmp,.tiff,.tif,.webp,.heic,.heif,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.md,.rtf,.xml,.html,.htm,.json,.log"
              onChange={handleFileUpload}
              className="hidden"
            />

            <div className="flex-1 relative group">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(e);
                  }
                }}
                placeholder={isListening ? "Listening..." : "Describe your symptoms..."}
                rows={1}
                className="w-full px-5 py-3.5 bg-slate-100/50 hover:bg-white border-0 rounded-2xl focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-[0.95rem] pr-12 resize-none shadow-inner"
                disabled={isProcessing || isUploading}
                style={{ minHeight: '52px', maxHeight: '120px' }}
              />
              <button
                 type="button"
                 onClick={startListening}
                 className={`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-xl transition-all duration-200 ${isListening ? 'text-red-500 bg-red-50 animate-pulse' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`}
              >
                 {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
            </div>

            <button
              type="submit"
              disabled={(!input.trim() && attachments.length === 0) || isProcessing || isUploading}
              className="bg-slate-900 hover:bg-blue-600 text-white p-3.5 rounded-2xl disabled:opacity-50 disabled:bg-slate-300 transition-all duration-300 shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>

          <div className="flex items-center justify-between border-t border-slate-100 pt-1 px-1">
            <div className="flex items-center gap-1 md:gap-3">
              <div className="flex items-center gap-1 mr-2">
                <button
                  type="button"
                  onClick={startCamera}
                  className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  title="Open Camera"
                >
                  <Camera className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  title="Attach File"
                >
                  <Paperclip className="w-5 h-5" />
                </button>
              </div>

              <div className="hidden md:flex text-xs font-semibold text-slate-400 items-center gap-3 border-l border-slate-200 pl-3">
                {micError && <span className="text-red-500 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5"/> {micError}</span>}
                {isUploading && <span className="text-blue-600 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin"/> {uploadStatus}</span>}
                {!isUploading && !micError && <span className="flex items-center gap-1.5 hover:text-blue-500 transition-colors cursor-help"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div> AI Active</span>}
              </div>
            </div>
            
            <button
              onClick={onFinish}
              disabled={messages.length < 2 || isProcessing}
              className="group flex items-center gap-2 px-3 md:px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-600 hover:text-red-600 hover:bg-red-50 transition-all duration-300 disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-600"
            >
              <span className="hidden md:inline">End Consultation</span>
              <span className="md:hidden">End</span>
              <div className="w-5 h-5 rounded-full bg-slate-200 group-hover:bg-red-100 flex items-center justify-center transition-colors">
                 <Check className="w-3 h-3" />
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
