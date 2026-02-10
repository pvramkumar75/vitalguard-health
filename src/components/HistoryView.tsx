import React, { useState } from 'react';
import { AlertTriangle, History, Download, Upload, ArrowLeft, Search, Filter, Trash2, ChevronRight } from 'lucide-react';
import { ClinicalRecord, Language } from '../../types';
import * as db from '../../db';

interface HistoryViewProps {
  records: ClinicalRecord[];
  onBack: () => void;
  onSelect: (record: ClinicalRecord) => void;
  onDelete: (recordId: string) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ records, onBack, onSelect, onDelete }) => {
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
      // const updatedRecords = await db.getAllRecords(); // Parent will handle refresh via onBack
      onBack(); // This will trigger a refresh when returning to main view
    } catch (error) {
      alert('Import failed: ' + error);
    }
  };

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[100] animate-in fade-in duration-200">
          <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-sm mx-4 animate-in zoom-in-95 duration-200 border border-white/20">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-red-100 rounded-xl">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900">Delete Record?</h3>
            </div>
            <p className="text-slate-600 text-[0.95rem] mb-8 leading-relaxed">This action cannot be undone. The medical record will be permanently removed from your vault.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-all text-sm uppercase tracking-wide"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all text-sm uppercase tracking-wide shadow-lg shadow-red-200"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
        <h2 className="text-3xl font-bold text-slate-900 flex items-center gap-4 tracking-tight font-heading">
          <div className="p-2.5 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl text-white shadow-lg shadow-blue-500/30">
            <History className="w-6 h-6" />
          </div>
          <div>
            Clinical History <span className="text-slate-400 text-xl font-medium ml-2">({filteredRecords.length})</span>
          </div>
        </h2>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            onClick={handleExport}
            disabled={records.length === 0}
            className="flex-1 sm:flex-none bg-white hover:bg-blue-50 disabled:opacity-50 px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider shadow-sm transition-all hover:-translate-y-0.5 flex items-center gap-2 justify-center"
            title="Export all records as JSON"
          >
            <Download className="w-4 h-4" />
            Export Vault
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
              className="w-full bg-white hover:bg-blue-50 px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs uppercase tracking-wider shadow-sm transition-all hover:-translate-y-0.5 flex items-center gap-2 justify-center"
              title="Import records from JSON file"
            >
              <Upload className="w-4 h-4" />
              Import
            </button>
          </label>
          <button onClick={onBack} className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider shadow-lg shadow-slate-900/20 transition-all hover:-translate-y-0.5 flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        </div>
      </div>

      <div className="space-y-6 mb-8">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative group">
            <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 group-focus-within:text-blue-500 transition-colors" />
            <input
              type="text"
              placeholder="Search patients, diagnoses..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3.5 rounded-xl border-0 bg-white/60 backdrop-blur-sm focus:bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 shadow-sm transition-all text-[0.95rem]"
            />
          </div>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={`px-6 py-3.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 shadow-sm ${showAdvanced
              ? 'bg-blue-600 text-white ring-2 ring-blue-600 shadow-blue-200'
              : 'bg-white text-slate-600 hover:bg-slate-50 ring-1 ring-slate-200 hover:ring-slate-300'
              }`}
          >
            <Filter className="w-4 h-4" />
            Filters
          </button>
        </div>

        {showAdvanced && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 p-6 bg-white/60 backdrop-blur-md rounded-2xl border border-white/50 shadow-sm animate-in slide-in-from-top-2 duration-200">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5 ml-1">Search Field</label>
              <div className="relative">
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as any)}
                  className="w-full pl-4 pr-10 py-2.5 rounded-xl border-0 bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 text-sm font-medium shadow-sm appearance-none cursor-pointer"
                >
                  <option value="all">All Fields</option>
                  <option value="patient">Patient Name</option>
                  <option value="diagnosis">Diagnosis</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5 ml-1">Sort Order</label>
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="w-full pl-4 pr-10 py-2.5 rounded-xl border-0 bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 text-sm font-medium shadow-sm appearance-none cursor-pointer"
                >
                  <option value="date">Date (Newest)</option>
                  <option value="name">Name (A-Z)</option>
                  <option value="diagnosis">Diagnosis (A-Z)</option>
                </select>
                 <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5 ml-1">Language</label>
              <div className="relative">
                <select
                  value={selectedLanguage}
                  onChange={(e) => setSelectedLanguage(e.target.value as any)}
                  className="w-full pl-4 pr-10 py-2.5 rounded-xl border-0 bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-500 text-sm font-medium shadow-sm appearance-none cursor-pointer"
                >
                  <option value="all">All Languages</option>
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                  <option value="te">Telugu</option>
                </select>
                 <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4">
        {filteredRecords.length === 0 ? (
          <div className="bg-white/50 backdrop-blur-sm p-16 rounded-3xl border border-dashed border-slate-300 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
              <Search className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">No Records Found</h3>
            <p className="text-slate-500 text-sm">
              {records.length === 0 ? 'Your vault is empty.' : 'Try adjusting your search or filters.'}
            </p>
          </div>
        ) : (
          filteredRecords.map((r, i) => (
            <div
              key={r.id}
              className="glass-panel p-5 rounded-2xl shadow-sm hover:shadow-xl hover:-translate-y-1 hover:border-blue-300 transition-all duration-300 group cursor-pointer relative overflow-hidden"
              onClick={() => onSelect(r)}
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-blue-500 to-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs font-bold text-slate-500 flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded-md">
                      <History className="w-3 h-3" />
                      {new Date(r.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                    <span className={`text-[10px] px-2 py-1 rounded-md font-black uppercase tracking-wider border ${
                      r.language === 'en' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                      r.language === 'hi' ? 'bg-orange-50 text-orange-600 border-orange-100' :
                      'bg-purple-50 text-purple-600 border-purple-100'
                    }`}>
                      {r.language === 'en' ? 'EN' : r.language === 'hi' ? 'HI' : 'TE'}
                    </span>
                  </div>
                  
                  <h3 className="text-lg font-bold text-slate-900 group-hover:text-blue-600 transition-colors mb-1 font-heading">
                    {r.report?.diagnosis || 'Medical Assessment'}
                  </h3>
                  
                  <div className="flex items-center gap-3 text-sm text-slate-600">
                    <span className="font-semibold text-slate-900">{r.patientInfo.name}</span>
                    <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                    <span>{r.patientInfo.age} years</span>
                    <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                    <span>{r.patientInfo.gender}</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 self-center">
                  <button
                    onClick={(e) => handleDeleteClick(e, r.id)}
                    className="p-2.5 text-slate-400 hover:bg-red-50 hover:text-red-600 rounded-xl transition-all opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 duration-200"
                    title="Delete record"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                  <div className="p-2 bg-slate-50 rounded-full group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                     <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-blue-500 transition-colors" />
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {filteredRecords.length > 0 && (
        <div className="mt-6 text-center text-xs text-slate-400 font-bold uppercase tracking-widest bg-white/50 py-3 rounded-full inline-block px-6 mx-auto w-max backdrop-blur-sm border border-slate-100">
          Viewing {filteredRecords.length} of {records.length} records
        </div>
      )}
    </div>
  );
};
