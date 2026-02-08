
import { GoogleGenAI, Type } from "@google/genai";
import { MedicalReport, Message, PatientInfo, ClinicalRecord, Language } from "../types";

const getSystemInstruction = (lang: Language) => {
  const langNames: Record<Language, string> = {
    en: "English",
    hi: "Hindi",
    te: "Telugu"
  };

  return `You are an elite Senior Physician in India with decades of clinical experience. Your persona is formal, deeply empathetic, and scientifically rigorous.

LANGUAGE RULE:
- You must communicate primarily in ${langNames[lang]}.
- CRITICAL: Always keep specific medical terminology, diagnosis names, medication names, and dosages in ENGLISH. 
- The surrounding conversational text should be in ${langNames[lang]}.

Tone & Persona:
1. Empathy First: Reassure the patient immediately if they describe pain or anxiety.
2. Thorough Investigation: You MUST ask between 6 and 10 questions to ensure diagnostic safety.
3. Diagnostic Strategy:
   - Question 1-3: Primary symptom details (Onset, Location, Duration, Character, Aggravating/Relieving factors).
   - Question 4-5: Systemic review (Fever, weight changes, appetite, energy levels).
   - Question 6-7: Red Flags (Screen for neurological deficits, sudden severe changes, or emergency signs).
   - Question 8-10: Context (Lifestyle, diet, recent travel, family history, and stress levels).
4. One at a Time: Never ask more than one question per turn.
5. Evidence-Based: Base your reasoning on NMC (India) and global clinical standards.

Clinical Protocol:
- If an image or lab report is provided, analyze it clinically and explain the findings simply but professionally.
- Once you reach the question limit or feel certain, inform the patient that you are ready to compile their "Comprehensive Clinical Summary".`;
};

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

// Validate API key is set
if (!process.env.API_KEY || process.env.API_KEY === 'PLACEHOLDER_API_KEY' || process.env.API_KEY === 'YOUR_ACTUAL_GEMINI_API_KEY_HERE') {
  console.error('FATAL: GEMINI_API_KEY not configured. Please set GEMINI_API_KEY in .env.local with your actual API key from https://aistudio.google.com/app/apikey');
}

export const getMedicalReport = async (
  patient: PatientInfo,
  history: Message[],
  pastRecords: ClinicalRecord[],
  lang: Language
): Promise<MedicalReport> => {
  if (!process.env.API_KEY || process.env.API_KEY.includes('PLACEHOLDER') || process.env.API_KEY.includes('YOUR_ACTUAL')) {
    throw new Error('Gemini API key not configured. Please set GEMINI_API_KEY in .env.local');
  }

  const model = "gemini-3-pro-preview";

  const contextPrompt = pastRecords.length > 0
    ? `Patient Clinical History:\n${pastRecords.map(r => `Date: ${r.date}, Diagnosis: ${r.report?.diagnosis}`).join('\n')}\n\n`
    : "";

  const prompt = `${contextPrompt}Based on the following patient data and full consultation history, generate a comprehensive Indian clinical report.
  
  Patient: ${patient.name} (${patient.age}/${patient.gender})
  Consultation Log:
  ${history.map(m => `${m.role.toUpperCase()}: ${m.text}`).join('\n')}
  
  IMPORTANT: Include:
  1. A definitive diagnosis (or differential diagnosis)
  2. Prescription plan using generic and common Indian brand names
  3. **Recommended Blood Tests and Lab Investigations** - Based on the diagnosis, suggest specific tests like CBC, Blood Sugar, Lipid Profile, Liver Function Test, Kidney Function Test, Thyroid Profile, X-Ray, ECG, Ultrasound, or any other relevant diagnostic tests that would help confirm the diagnosis or monitor the condition
  
  The output must be valid JSON matching the schema provided.`;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
      config: {
        systemInstruction: getSystemInstruction(lang),
        thinkingConfig: { thinkingBudget: 32768 },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            patientSummary: { type: Type.STRING },
            observations: { type: Type.ARRAY, items: { type: Type.STRING } },
            diagnosis: { type: Type.STRING },
            prescriptions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  medication: { type: Type.STRING },
                  dosage: { type: Type.STRING },
                  frequency: { type: Type.STRING },
                  duration: { type: Type.STRING },
                  notes: { type: Type.STRING }
                },
                required: ["medication", "dosage", "frequency", "duration"]
              }
            },
            recommendedTests: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "List of recommended blood tests, lab investigations, or diagnostic tests (e.g., CBC, Blood Sugar, Lipid Profile, X-Ray, etc.)"
            },
            recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
            emergencyWarning: { type: Type.STRING },
            followUp: { type: Type.STRING }
          },
          required: ["patientSummary", "diagnosis", "prescriptions", "recommendedTests", "emergencyWarning"]
        }
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error('Gemini API error during report generation:', error);
    throw error;
  }
};

export const getChatResponse = async (
  patient: PatientInfo,
  history: Message[],
  pastRecords: ClinicalRecord[],
  lang: Language
): Promise<string> => {
  if (!process.env.API_KEY || process.env.API_KEY.includes('PLACEHOLDER') || process.env.API_KEY.includes('YOUR_ACTUAL')) {
    throw new Error('Gemini API key not configured. Please set GEMINI_API_KEY in .env.local');
  }

  const model = 'gemini-3-flash-preview';

  const historyContext = pastRecords.length > 0
    ? `Continuing care for ${patient.name}. History: ${pastRecords.map(r => r.report?.diagnosis).join(', ')}.`
    : `First session for ${patient.name}.`;

  const GEMINI_INLINE_TYPES = new Set([
    'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/bmp', 'image/tiff',
    'application/pdf',
    'text/plain', 'text/csv', 'text/html',
  ]);

  const contents = history.map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [
      { text: msg.text || "Clinical media provided." },
      ...(msg.attachments?.filter(at => at.data && GEMINI_INLINE_TYPES.has(at.mimeType)).map(at => ({
        inlineData: { data: at.data, mimeType: at.mimeType }
      })) || [])
    ]
  }));

  try {
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: `${getSystemInstruction(lang)}\n\nCONTEXT: ${historyContext}`,
        temperature: 0.4,
      }
    });

    return response.text || "I apologize, there was a minor interruption in the diagnostic feed. Could you please repeat that?";
  } catch (error) {
    console.error('Gemini API error:', error);
    throw error;
  }
};
