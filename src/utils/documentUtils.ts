import * as pdfjsLib from 'pdfjs-dist';
import Tesseract from 'tesseract.js';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// MIME types that Gemini supports for inlineData
export const GEMINI_SUPPORTED_INLINE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/bmp', 'image/tiff',
  'application/pdf',
  'text/plain', 'text/csv', 'text/html',
]);

export const extractPdfText = async (file: File): Promise<string> => {
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

export const extractDocxText = async (file: File): Promise<string> => {
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

export const extractPptxText = async (file: File): Promise<string> => {
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

export const extractXlsxText = async (file: File): Promise<string> => {
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

export const extractBinaryDocText = async (file: File): Promise<string> => {
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

export const extractDocumentText = async (file: File): Promise<string> => {
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
