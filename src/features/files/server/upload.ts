import Papa from 'papaparse';

export type ParsedFile = {
  filename: string;
  size: number;
  mimeType: string;
  extractedText: string;
};

function normalizeText(text: string) {
  return text.trim();
}

export async function extractTextFromBuffer(buffer: Buffer, mimeType: string, filename: string) {
  let extractedText = '';
  const lowerName = filename.toLowerCase();

  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
    try {
      const pdfParseModule = await import('pdf-parse');
      const pdfParse = ((pdfParseModule as { default?: unknown } & Record<string, unknown>).default || pdfParseModule) as (
        input: Buffer
      ) => Promise<{ text: string }>;
      const data = await pdfParse(buffer);
      extractedText = data.text;
    } catch (error) {
      console.error(`PDF parsing is unavailable for ${filename}:`, error);
      extractedText =
        `PDF attachment: ${filename}. CheapChat stored the file, but PDF text extraction is unavailable ` +
        `in the current deployment runtime.`;
    }
  } else if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lowerName.endsWith('.docx')
  ) {
    const mammoth = (await import('mammoth')).default;
    const { value } = await mammoth.extractRawText({ buffer });
    extractedText = value;
  } else if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel' ||
    lowerName.endsWith('.xlsx') ||
    lowerName.endsWith('.xls')
  ) {
    const xlsx = await import('xlsx');
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    extractedText = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      return `--- Sheet: ${sheetName} ---\n${xlsx.utils.sheet_to_csv(sheet)}`;
    }).join('\n\n');
  } else if (mimeType === 'text/csv' || lowerName.endsWith('.csv')) {
    const text = buffer.toString('utf-8');
    const parsed = Papa.parse<string[]>(text);
    extractedText = parsed.data.map((row) => row.join(',')).join('\n');
  } else if (mimeType === 'application/json' || lowerName.endsWith('.json')) {
    extractedText = buffer.toString('utf-8');
  } else if (mimeType.startsWith('image/')) {
    extractedText = `Image attachment: ${filename}. OCR is not enabled for this image, so only the file name and image presence are available.`;
  } else if (mimeType.startsWith('text/') || lowerName.endsWith('.txt') || lowerName.endsWith('.md')) {
    extractedText = buffer.toString('utf-8');
  } else {
    throw new Error(`Unsupported file type: ${mimeType || lowerName}`);
  }

  const normalized = normalizeText(extractedText);
  if (!normalized) {
    throw new Error('Could not extract text from the file.');
  }

  return normalized;
}

export async function parseUploadedFile(params: {
  filename: string;
  size: number;
  mimeType: string;
  downloadUrl: string;
}) {
  const response = await fetch(params.downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch uploaded file (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const extractedText = await extractTextFromBuffer(buffer, params.mimeType, params.filename);

  return {
    filename: params.filename,
    size: params.size,
    mimeType: params.mimeType || 'application/octet-stream',
    extractedText,
  } satisfies ParsedFile;
}
