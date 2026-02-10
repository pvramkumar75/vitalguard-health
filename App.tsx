
import React, { useState, useEffect } from 'react';
import { History, Shield } from 'lucide-react';
import { AppStep, PatientInfo, Message, MedicalReport, ClinicalRecord, Attachment, Language, StructuredQuestion } from './types';
import { getChatResponse, getMedicalReport } from './services/geminiService';
import * as db from './db';
import { Logo } from './src/components/Logo';
import { GlobalBackground } from './src/components/Background';
import { VitalsForm } from './src/components/VitalsForm';
import { StepProgressIndicator } from './src/components/StepProgressIndicator';
import { LanguageSwitcher } from './src/components/LanguageSwitcher';
import { ChatInterface } from './src/components/ChatInterface';
import { HistoryView } from './src/components/HistoryView';
import { ReportView } from './src/components/ReportView';

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
      const initTexts: Record<Language, string> = {
        en: `Registry Complete. Initializing assessment for ${data.name}. Ready to hear clinical concerns.`,
        hi: `पंजीकरण पूर्ण हुआ। ${data.name} के लिए मूल्यांकन शुरू किया जा रहा है। अपनी स्वास्थ्य समस्याओं के बारे में बताएं।`,
        te: `రిజిస్ట్రేషన్ పూర్తయింది. ${data.name} కోసం పరీక్ష ప్రారంభించబడుతోంది. మీ ఆరోగ్య సమస్యలను తెలియజేయండి.`
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
    <div className="min-h-screen font-sans selection:bg-blue-200 selection:text-blue-900 relative overflow-hidden">
      {/* Animated background elements */}
      <GlobalBackground />

      <nav className="no-print bg-white/75 border-b border-gray-200/60 px-4 md:px-8 py-4 flex items-center justify-between sticky top-0 z-50 backdrop-blur-2xl saturate-150 transition-all duration-300">
        <div className="flex items-center gap-4">
          <button onClick={() => safeNavigate(reset)} className="group relative">
            <Logo className="w-10 h-10 md:w-11 md:h-11 transition-transform group-hover:scale-105" />
          </button>
          <div>
            <span className="text-xl font-bold tracking-tight cursor-pointer text-slate-900 group-hover:text-blue-600 transition-colors" onClick={() => safeNavigate(reset)}>
              VitalGuard <span className="text-blue-600">Health</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <LanguageSwitcher current={language} onChange={setLanguage} />
          <button
            onClick={() => safeNavigate(() => setStep(AppStep.HISTORY))}
            className={`px-5 py-2 rounded-full text-xs font-semibold tracking-wide transition-all flex items-center gap-2 border ${step === AppStep.HISTORY ? 'bg-slate-900 text-white border-slate-900 shadow-sm' : 'bg-white/50 text-slate-600 border-slate-200 hover:bg-white hover:text-blue-600 focus:ring-2 focus:ring-blue-100'}`}
          >
            <History className="w-4 h-4" />
            <span>History</span>
          </button>
        </div>
      </nav>

      <main className="container mx-auto px-4 md:px-8 py-6 md:py-12 max-w-7xl">
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

      <footer className="no-print mt-32 py-8 border-t border-slate-200/50 text-center relative">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-200 to-transparent"></div>
        <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest">© {new Date().getFullYear()} VitalGuard Health</p>
      </footer>
    </div>
  );
}
