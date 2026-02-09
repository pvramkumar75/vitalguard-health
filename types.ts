
export type Language = 'en' | 'hi' | 'te';

export interface PatientInfo {
  name: string;
  age: string;
  gender: string;
  weight: string;
  height: string;
  history: string;
  allergies: string;
}

export interface Attachment {
  data: string; // base64
  mimeType: string;
  name: string;
  extractedText?: string; // Hidden text content extracted from documents for AI context
}

export interface QuestionOption {
  id: string;
  label: string;
}

export interface StructuredQuestion {
  id: string;
  questionText: string;
  options: QuestionOption[];
}

export interface Message {
  role: 'user' | 'model';
  text: string;
  attachments?: Attachment[];
  question?: StructuredQuestion;
  timestamp?: string; // ISO timestamp for when message was sent
}

export interface ClinicalRecord {
  id: string;
  date: string;
  patientInfo: PatientInfo;
  messages: Message[];
  report?: MedicalReport;
  language: Language;
}

export interface MedicalReport {
  patientSummary: string;
  observations: string[];
  diagnosis: string;
  prescriptions: Array<{
    medication: string;
    dosage: string;
    frequency: string;
    duration: string;
    notes: string;
  }>;
  recommendedTests: string[];
  recommendations: string[];
  emergencyWarning: string;
  followUp: string;
}

export enum AppStep {
  VITALS = 'vitals',
  CONSULTATION = 'consultation',
  REPORT = 'report',
  HISTORY = 'history'
}
