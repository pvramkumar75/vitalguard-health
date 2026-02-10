import React from 'react';
import { MessageSquare, Activity, AlertTriangle, ArrowRight, Printer, RefreshCw } from 'lucide-react';
import { MedicalReport, PatientInfo } from '../../types';

interface ReportViewProps {
  report: MedicalReport;
  patient: PatientInfo;
  onReset: () => void;
}

export const ReportView: React.FC<ReportViewProps> = ({ report, patient, onReset }) => {
  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="glass-panel rounded-2xl overflow-hidden shadow-2xl shadow-slate-200/50 relative print:shadow-none print:border-none">
        
        {/* Header */}
        <div className="bg-slate-900 text-white p-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/20 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl -ml-12 -mb-12 pointer-events-none"></div>
          
          <div className="relative z-10 flex flex-col md:flex-row justify-between items-start gap-6">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-blue-500/20 backdrop-blur-md rounded-lg border border-white/10">
                  <Activity className="w-5 h-5 text-blue-300" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight font-heading">Clinical Assessment</h1>
              </div>
              <p className="text-blue-200/80 font-medium text-xs uppercase tracking-widest pl-1">Official Medical Record • Confidential</p>
            </div>
            <div className="bg-white/5 backdrop-blur-md px-5 py-3 rounded-xl border border-white/10 shadow-lg">
              <p className="text-[10px] text-blue-200 font-bold uppercase tracking-widest mb-1 opacity-70">Reference ID</p>
              <p className="text-lg font-mono font-bold tracking-wider text-white">#{Math.random().toString(36).substr(2, 6).toUpperCase()}</p>
            </div>
          </div>
        </div>

        <div className="p-8 md:p-10 space-y-10 bg-white/50 backdrop-blur-sm">
          {/* Patient Header */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 pb-8 border-b border-slate-200/60">
            <div>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-2">Patient</p>
              <p className="text-xl font-bold text-slate-900 font-heading">{patient.name}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-2">Demographics</p>
              <p className="text-xl font-bold text-slate-900 font-heading">{patient.age} Years • {patient.gender}</p>
            </div>
            <div className="sm:text-right">
              <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mb-2">Date</p>
              <p className="text-xl font-bold text-slate-900 font-heading">{new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
            </div>
          </div>

          <section className="bg-white/60 backdrop-blur-sm p-8 rounded-2xl border border-white/50 shadow-sm relative overflow-hidden group hover:shadow-md transition-all duration-300">
            <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
              Primary Diagnosis
            </h3>
            <p className="text-3xl text-slate-900 font-bold mb-4 font-heading tracking-tight">{report.diagnosis}</p>
            <div className="relative pl-6">
              <div className="absolute left-0 top-1 bottom-1 w-0.5 bg-blue-200 rounded-full"></div>
              <p className="text-slate-600 leading-relaxed italic text-lg opacity-90">"{report.patientSummary}"</p>
            </div>
          </section>

          <section>
            <div className="flex items-center gap-4 mb-6">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                Treatment Plan
              </h3>
              <div className="h-px bg-slate-200/60 flex-1"></div>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {report.prescriptions.map((p, i) => (
                <div key={i} className="p-6 border border-slate-200/60 rounded-xl bg-white/70 shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 group relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-blue-400 to-indigo-500"></div>
                  
                  <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-6">
                    <p className="font-bold text-slate-900 text-xl font-heading group-hover:text-blue-700 transition-colors">{p.medication}</p>
                    <span className="bg-blue-50 text-blue-700 text-xs px-3 py-1.5 rounded-full font-bold uppercase tracking-wide border border-blue-100">{p.duration}</span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-8 mb-5">
                    <div>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1.5">Dosage</p>
                      <p className="font-semibold text-slate-700">{p.dosage}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1.5">Frequency</p>
                      <p className="font-semibold text-slate-700">{p.frequency}</p>
                    </div>
                  </div>
                  
                  {p.notes && (
                    <div className="flex gap-3 p-4 bg-blue-50/50 rounded-xl border border-blue-100/50 items-start">
                      <MessageSquare className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                      <p className="text-sm text-blue-800 font-medium leading-relaxed">{p.notes}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {report.recommendedTests && report.recommendedTests.length > 0 && (
            <section>
              <div className="flex items-center gap-4 mb-6">
                 <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                  Recommended Tests
                </h3>
                <div className="h-px bg-slate-200/60 flex-1"></div>
              </div>
              <div className="bg-white/40 backdrop-blur-sm p-6 rounded-2xl border border-slate-200/60 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {report.recommendedTests.map((test, i) => (
                    <div key={i} className="flex items-center gap-3 p-4 bg-white/80 rounded-xl border border-slate-100 shadow-sm hover:border-purple-200 transition-colors">
                      <div className="p-2 bg-gradient-to-br from-purple-100 to-fuchsia-100 text-purple-600 rounded-lg shadow-inner">
                        <Activity className="w-4 h-4" />
                      </div>
                      <span className="font-semibold text-slate-700">{test}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-red-50/80 backdrop-blur-sm p-6 rounded-2xl border border-red-100/60 shadow-sm hover:shadow-md transition-shadow">
              <h4 className="text-xs font-black text-red-600 uppercase mb-4 tracking-widest flex items-center gap-2 opacity-80">
                <AlertTriangle className="w-4 h-4" />
                Urgent Warnings
              </h4>
              <p className="text-sm text-red-900 font-medium leading-relaxed">{report.emergencyWarning || "None reported."}</p>
            </div>
            <div className="bg-blue-50/80 backdrop-blur-sm p-6 rounded-2xl border border-blue-100/60 shadow-sm hover:shadow-md transition-shadow">
              <h4 className="text-xs font-black text-blue-600 uppercase mb-4 tracking-widest flex items-center gap-2 opacity-80">
                <ArrowRight className="w-4 h-4" />
                Next Steps
              </h4>
              <p className="text-sm text-blue-900 font-medium leading-relaxed">{report.followUp}</p>
            </div>
          </section>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row justify-center gap-4 no-print sm:max-w-xl mx-auto pt-4">
        <button 
          onClick={() => window.print()} 
          className="flex-1 bg-slate-900 text-white px-8 py-4 rounded-2xl font-bold text-sm shadow-lg shadow-slate-900/20 hover:bg-slate-800 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-2.5"
        >
          <Printer className="w-5 h-5" />
          Print Official Report
        </button>
        <button 
          onClick={onReset} 
          className="flex-1 bg-white border border-slate-200 text-slate-700 px-8 py-4 rounded-2xl font-bold text-sm hover:bg-slate-50 hover:border-slate-300 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-2.5"
        >
          <RefreshCw className="w-4 h-4" />
          Start New Consultation
        </button>
      </div>
    </div>
  );
};
