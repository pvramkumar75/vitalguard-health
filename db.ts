import { ClinicalRecord } from './types';

const DB_NAME = 'MedAI-Pro-DB';
const STORE_NAME = 'clinical_records';
const DB_VERSION = 1;

let db: IDBDatabase;

export const initializeDB = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve();
    };

    request.onupgradeneeded = (event) => {
      const target = event.target as IDBOpenDBRequest;
      const database = target.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('patientName', 'patientInfo.name', { unique: false });
        store.createIndex('diagnosis', 'report.diagnosis', { unique: false });
        store.createIndex('language', 'language', { unique: false });
      }
    };
  });
};

export const addRecord = (record: ClinicalRecord): Promise<string> => {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(record);

    request.onsuccess = () => resolve(record.id);
    request.onerror = () => reject(request.error);
  });
};

export const updateRecord = (record: ClinicalRecord): Promise<void> => {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(record);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getRecord = (id: string): Promise<ClinicalRecord | undefined> => {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const getAllRecords = (): Promise<ClinicalRecord[]> => {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result.reverse());
    request.onerror = () => reject(request.error);
  });
};

export const deleteRecord = (id: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const searchRecords = (query: string): Promise<ClinicalRecord[]> => {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const results = request.result.filter(record => {
        const lowerQuery = query.toLowerCase();
        return (
          record.patientInfo.name.toLowerCase().includes(lowerQuery) ||
          record.report?.diagnosis.toLowerCase().includes(lowerQuery) ||
          record.report?.patientSummary.toLowerCase().includes(lowerQuery) ||
          record.id.toLowerCase().includes(lowerQuery)
        );
      });
      resolve(results.reverse());
    };
    request.onerror = () => reject(request.error);
  });
};

export const searchByPatientName = (name: string): Promise<ClinicalRecord[]> => {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('patientName');
    const range = IDBKeyRange.only(name);
    const request = index.getAll(range);

    request.onsuccess = () => resolve(request.result.reverse());
    request.onerror = () => reject(request.error);
  });
};

export const searchByDiagnosis = (diagnosis: string): Promise<ClinicalRecord[]> => {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const results = request.result.filter(record =>
        record.report?.diagnosis.toLowerCase().includes(diagnosis.toLowerCase())
      );
      resolve(results.reverse());
    };
    request.onerror = () => reject(request.error);
  });
};

export const getRecordsByDateRange = (startDate: Date, endDate: Date): Promise<ClinicalRecord[]> => {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('date');
    const range = IDBKeyRange.bound(startDate.toISOString(), endDate.toISOString());
    const request = index.getAll(range);

    request.onsuccess = () => resolve(request.result.reverse());
    request.onerror = () => reject(request.error);
  });
};

export const getRecordsByLanguage = (language: string): Promise<ClinicalRecord[]> => {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('language');
    const request = index.getAll(language);

    request.onsuccess = () => resolve(request.result.reverse());
    request.onerror = () => reject(request.error);
  });
};

export const exportRecordsAsJSON = async (): Promise<string> => {
  const records = await getAllRecords();
  return JSON.stringify(records, null, 2);
};

export const importRecordsFromJSON = async (jsonData: string): Promise<number> => {
  try {
    const records = JSON.parse(jsonData) as ClinicalRecord[];
    let count = 0;

    for (const record of records) {
      await addRecord(record);
      count++;
    }

    return count;
  } catch (error) {
    throw new Error(`Failed to import records: ${error}`);
  }
};

export const clearAllRecords = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getRecordCount = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.count();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};
