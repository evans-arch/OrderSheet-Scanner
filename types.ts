
export interface InvoiceItem {
  id: string;
  description: string;
  vendor: string;
  inStock: number;
  par: number;
  order: number;
  price: number;
}

export interface InvoiceRecord {
  id: string;
  date: string;
  items: InvoiceItem[];
  totalItems: number;
  status: 'Draft' | 'Uploaded';
}

export interface AppSettings {
  googleSheetUrl: string;
  scriptUrl: string; // Webhook URL for Google Apps Script
  autoExport: boolean;
}

export enum AppView {
  DASHBOARD = 'DASHBOARD',
  SCAN = 'SCAN',
  REVIEW = 'REVIEW',
  HISTORY = 'HISTORY',
  SETTINGS = 'SETTINGS'
}
