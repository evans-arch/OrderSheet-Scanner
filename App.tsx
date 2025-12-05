import React, { useState, useEffect, useRef } from 'react';
import { extractInvoiceData } from './services/geminiService';
import { InvoiceItem, InvoiceRecord, AppView, AppSettings } from './types';
import { Button, Input, Card, Badge, Toast, Modal } from './components/UI';
import { 
  Camera, 
  FileText, 
  Plus, 
  Trash2, 
  ArrowLeft, 
  Copy,
  History,
  Home,
  Loader2,
  Settings,
  ExternalLink,
  Sheet,
  Upload,
  ArrowDownAZ
} from 'lucide-react';

const STORAGE_KEY = 'ordersheet_history';
const SETTINGS_KEY = 'ordersheet_settings';

// The specific sheet URL provided by the user
const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1c9qt5RejeAZ_tn-gXhFaDwVSIgZdmgRPojKD1LqhRYc/edit?gid=0#gid=0';

const App: React.FC = () => {
  const [view, setView] = useState<AppView>(AppView.DASHBOARD);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [history, setHistory] = useState<InvoiceRecord[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
  // New state to control whether we are starting fresh or adding to existing
  const [scanMode, setScanMode] = useState<'new' | 'append'>('new');
  const [showExportModal, setShowExportModal] = useState(false);

  const [settings, setSettings] = useState<AppSettings>({
    googleSheetUrl: DEFAULT_SHEET_URL,
    scriptUrl: ''
  });
  
  // File input refs
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // Load history and settings on mount
  useEffect(() => {
    const savedHistory = localStorage.getItem(STORAGE_KEY);
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }

    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    if (savedSettings) {
      try {
        setSettings(JSON.parse(savedSettings));
      } catch (e) {
        console.error("Failed to parse settings", e);
      }
    } else {
      setSettings(prev => ({ ...prev, googleSheetUrl: DEFAULT_SHEET_URL }));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  // Handler for triggering a scan
  const triggerScan = (mode: 'new' | 'append', source: 'camera' | 'upload') => {
    setScanMode(mode);
    const ref = source === 'camera' ? cameraInputRef : uploadInputRef;
    
    if (ref.current) {
      ref.current.value = ''; // Reset to allow re-selecting same file
      ref.current.click();
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setView(AppView.SCAN);
    setStatusMessage(scanMode === 'append' ? "Processing next page..." : "Analyzing invoice...");

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64Raw = e.target?.result as string;
        const base64Data = base64Raw.split(',')[1];
        
        try {
          const extractedItems = await extractInvoiceData(base64Data, file.type);
          
          setItems(prev => {
            if (scanMode === 'append') {
              return [...prev, ...extractedItems];
            } else {
              return extractedItems;
            }
          });
          
          if (scanMode === 'append') {
            const count = extractedItems.length;
            setToastMessage(`Added ${count} items`);
          } else {
            const count = extractedItems.length;
            const vendor = extractedItems[0]?.vendor || "Unknown Vendor";
            setToastMessage(`Scanned ${count} items for ${vendor}`);
          }

          setView(AppView.REVIEW);
        } catch (error) {
          alert("Failed to extract data. Please try again with a clearer image.");
          // If append failed, go back to review with old items
          if (scanMode === 'append') setView(AppView.REVIEW);
          else setView(AppView.DASHBOARD);
        } finally {
          setIsProcessing(false);
          setStatusMessage(null);
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error(error);
      setIsProcessing(false);
      alert("Error reading file.");
    }
  };

  const updateItem = (id: string, field: keyof InvoiceItem, value: any) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      
      const updated = { ...item, [field]: value };
      
      if (field === 'inStock' || field === 'par') {
        const inStock = field === 'inStock' ? Number(value) : item.inStock;
        const par = field === 'par' ? Number(value) : item.par;
        updated.order = Math.max(0, par - inStock);
      }
      return updated;
    }));
  };

  const deleteItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const addItem = () => {
    const newItem: InvoiceItem = {
      id: `manual-${Date.now()}`,
      description: '',
      vendor: '',
      inStock: 0,
      par: 10,
      order: 10,
      price: 0
    };
    setItems([...items, newItem]);
  };

  const sortItems = () => {
    setItems(prev => [...prev].sort((a, b) => 
      a.description.toLowerCase().localeCompare(b.description.toLowerCase())
    ));
    setToastMessage("Sorted by Description");
  };

  // Helper to get sorted items for export without affecting view if not desired
  const getSortedExportData = () => {
    return [...items]
      .sort((a, b) => a.description.toLowerCase().localeCompare(b.description.toLowerCase()))
      .map(i => ({
        inStock: i.inStock,
        par: i.par,
        order: i.order,
        description: i.description,
        vendor: i.vendor,
        price: i.price
      }));
  };

  const copyToClipboard = async () => {
    const exportData = getSortedExportData();
    // Google Sheets format: Tab separated (Vendor | Description | In Stock | PAR | Order | Price)
    const tsvContent = exportData.map(i => `${i.vendor}\t${i.description}\t${i.inStock}\t${i.par}\t${i.order}\t${i.price}`).join('\n');
    try {
      await navigator.clipboard.writeText(tsvContent);
      setToastMessage("Data copied! (Sorted by name)");
      return true;
    } catch (err) {
      console.error("Clipboard failed", err);
      setToastMessage("Clipboard access denied. Please allow permissions.");
      return false;
    }
  };

  const handleExport = async () => {
    // 1. Save history
    const newRecord: InvoiceRecord = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      items: items, 
      totalItems: items.length,
      status: 'Uploaded'
    };
    setHistory(prev => [newRecord, ...prev]);

    // 2. Prepare Data (Always Sorted)
    const exportData = getSortedExportData();

    // 3. Try Auto-Upload if configured
    if (settings.scriptUrl && settings.scriptUrl.startsWith('https://script.google.com')) {
      setStatusMessage("Sending to Sheet...");
      setIsProcessing(true);
      
      try {
        await fetch(settings.scriptUrl, {
          method: 'POST',
          mode: 'no-cors', 
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: exportData })
        });
        
        setToastMessage("Sent to Sheet! (Sorted by name)");
        
        // Optional: Still copy to clipboard just in case
        copyToClipboard();
        
        setTimeout(() => {
          setIsProcessing(false);
          setView(AppView.DASHBOARD);
        }, 1500);
        return;

      } catch (e) {
        console.error(e);
        setIsProcessing(false);
        setToastMessage("Auto-upload failed. Switching to manual.");
      }
    }

    // 4. Manual Fallback
    await copyToClipboard();
    setShowExportModal(true);
  };

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-green-600 to-emerald-600 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
        <div className="relative z-10">
          <h1 className="text-3xl font-bold mb-2">Inventory Scanner</h1>
          <p className="opacity-90 mb-6 max-w-xs">Scan invoices to extract items & calculate orders.</p>
          
          <div className="grid grid-cols-2 gap-3">
             <Button 
              onClick={() => triggerScan('new', 'camera')}
              className="bg-white text-green-800 hover:bg-green-50 border-none shadow-md flex flex-col items-center justify-center py-6 h-32 gap-3"
            >
              <div className="bg-green-100 p-3 rounded-full">
                <Camera className="w-8 h-8 text-green-700" />
              </div>
              <span className="font-bold text-sm">Take Photo</span>
            </Button>

            <Button 
              onClick={() => triggerScan('new', 'upload')}
              className="bg-green-700 text-white hover:bg-green-800 border-none shadow-md flex flex-col items-center justify-center py-6 h-32 gap-3"
            >
              <div className="bg-green-600 p-3 rounded-full border border-green-500">
                <Upload className="w-8 h-8 text-green-50" />
              </div>
              <span className="font-bold text-sm">Upload File</span>
            </Button>
          </div>
        </div>
        <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white opacity-10 rounded-full blur-2xl"></div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <History className="w-5 h-5 text-gray-500" /> Recent Scans
          </h2>
          <Button variant="ghost" onClick={() => setView(AppView.SETTINGS)} className="text-gray-500">
            <Settings className="w-5 h-5" />
          </Button>
        </div>

        {history.length === 0 ? (
          <div className="text-center py-10 text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
            <FileText className="w-12 h-12 mx-auto mb-2 opacity-20" />
            <p>No invoices scanned yet.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {history.map(record => (
              <Card key={record.id} className="p-4 flex justify-between items-center hover:shadow-md transition-shadow cursor-pointer" >
                 <div onClick={() => {
                   setItems(record.items);
                   setView(AppView.REVIEW);
                 }} className="flex-1">
                   <div className="font-semibold text-gray-800">
                     Invoice #{record.id.slice(-6)}
                   </div>
                   <div className="text-xs text-gray-500">
                     {new Date(record.date).toLocaleString()} • {record.totalItems} Items
                   </div>
                 </div>
                 <Badge type="success">Saved</Badge>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderScan = () => (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center px-4">
      {isProcessing ? (
        <>
          <Loader2 className="w-16 h-16 text-green-600 animate-spin mb-6" />
          <h2 className="text-2xl font-bold text-gray-800 mb-2">{statusMessage}</h2>
          <p className="text-gray-500 animate-pulse">This usually takes 5-10 seconds.</p>
        </>
      ) : (
         <p>Preparing...</p>
      )}
    </div>
  );

  const renderSettings = () => (
    <div className="space-y-6 pb-20">
       <div className="flex items-center gap-2 mb-6">
          <Button variant="ghost" onClick={() => setView(AppView.DASHBOARD)} className="pl-0">
            <ArrowLeft className="w-5 h-5" /> Back
          </Button>
          <h2 className="text-2xl font-bold">Settings</h2>
       </div>

       <Card className="p-5 space-y-4">
          <h3 className="font-bold text-lg border-b pb-2">Target Sheet</h3>
          <Input 
            label="Google Sheet URL" 
            value={settings.googleSheetUrl}
            onChange={(e) => setSettings({...settings, googleSheetUrl: e.target.value})}
          />
       </Card>

       <Card className="p-5 space-y-4 border-blue-100 bg-blue-50">
          <div className="flex justify-between items-center border-b border-blue-200 pb-2">
            <h3 className="font-bold text-lg text-blue-900">One-Click Automation</h3>
            <Badge type={settings.scriptUrl ? 'success' : 'warning'}>{settings.scriptUrl ? 'Active' : 'Inactive'}</Badge>
          </div>
          
          <div className="text-xs bg-white p-3 rounded border border-blue-200 space-y-2">
            <p>To enable 1-click upload (no copy/paste), you must add this script to your Google Sheet:</p>
            <ol className="list-decimal pl-4 space-y-1">
              <li>In your Sheet, go to <strong>Extensions {'>'} Apps Script</strong>.</li>
              <li>Paste the code below (replace everything).</li>
              <li>Click <strong>Deploy {'>'} New Deployment</strong>.</li>
              <li><strong>Crucial:</strong> Set "Who has access" to <strong>"Anyone"</strong>.</li>
              <li>Copy the "Web App URL" and paste it below.</li>
            </ol>
            <pre className="bg-gray-100 p-2 rounded overflow-x-auto text-[10px]">{`function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  data.items.forEach(function(item) {
    // Columns: Vendor, Description, In Stock, PAR, Order, Price
    sheet.appendRow([item.vendor, item.description, item.inStock, item.par, item.order, item.price]);
  });
  return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT);
}`}</pre>
          </div>

          <Input 
            label="Script Web App URL" 
            placeholder="https://script.google.com/macros/s/..."
            value={settings.scriptUrl}
            onChange={(e) => setSettings({...settings, scriptUrl: e.target.value})}
          />
       </Card>
    </div>
  );

  const renderReview = () => {
    const totalOrder = items.reduce((sum, item) => sum + item.order, 0);

    return (
      <div className="flex flex-col h-full relative pb-28">
        <div className="flex items-center justify-between mb-4 sticky top-0 bg-gray-50 z-10 py-2">
          <div className="flex items-center">
             <Button variant="ghost" onClick={() => setView(AppView.DASHBOARD)} className="pl-0 pr-2">
               <ArrowLeft className="w-5 h-5" />
             </Button>
             <h2 className="text-lg font-bold">Review ({items.length})</h2>
          </div>
          <div className="flex gap-1">
             <Button variant="secondary" onClick={sortItems} className="px-2" title="Sort by Name">
                <ArrowDownAZ className="w-5 h-5 text-gray-600" />
             </Button>
             <Button variant="ghost" onClick={addItem} className="px-2">
               <Plus className="w-5 h-5" />
             </Button>
          </div>
        </div>

        {/* Scan More Buttons */}
        <div className="grid grid-cols-2 gap-2 mb-4">
           <Button variant="secondary" onClick={() => triggerScan('append', 'camera')} className="border-dashed border-2">
              <Camera className="w-4 h-4" /> Snap Page
           </Button>
           <Button variant="secondary" onClick={() => triggerScan('append', 'upload')} className="border-dashed border-2">
              <Upload className="w-4 h-4" /> Upload Page
           </Button>
        </div>

        {/* Column Headers */}
        <div className="grid grid-cols-12 gap-1 mb-2 px-1 text-xs font-bold text-gray-500 uppercase tracking-wider">
           <div className="col-span-3">Vendor</div>
           <div className="col-span-3">Desc.</div>
           <div className="col-span-1 text-center">Stk</div>
           <div className="col-span-1 text-center">Par</div>
           <div className="col-span-1 text-center">Ord</div>
           <div className="col-span-3 text-center">Price</div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2">
          {items.map((item) => (
            <Card key={item.id} className="p-3">
              <div className="grid grid-cols-12 gap-1 items-center">
                 <div className="col-span-3">
                   <input 
                    className="w-full text-xs text-gray-500 bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none"
                    value={item.vendor} 
                    onChange={(e) => updateItem(item.id, 'vendor', e.target.value)}
                    placeholder="Vendor"
                  />
                </div>
                <div className="col-span-3">
                   <input 
                    className="w-full font-medium text-gray-800 bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none text-sm"
                    value={item.description} 
                    onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                    placeholder="Item"
                  />
                </div>
                <div className="col-span-1">
                   <input 
                    type="number"
                    className="w-full text-center bg-gray-50 rounded p-1 border border-gray-200 focus:border-blue-500 focus:outline-none text-sm px-0"
                    value={item.inStock} 
                    onChange={(e) => updateItem(item.id, 'inStock', e.target.value)}
                  />
                </div>
                <div className="col-span-1">
                  <input 
                    type="number"
                    className="w-full text-center bg-gray-50 rounded p-1 border border-gray-200 focus:border-blue-500 focus:outline-none text-sm px-0"
                    value={item.par} 
                    onChange={(e) => updateItem(item.id, 'par', e.target.value)}
                  />
                </div>
                <div className="col-span-1">
                   <div className={`w-full flex items-center justify-center rounded font-bold text-sm ${item.order > 0 ? 'text-red-700' : 'text-green-700'}`}>
                     <input 
                      type="number"
                      className="w-full text-center bg-transparent focus:outline-none p-0"
                      value={item.order}
                      onChange={(e) => updateItem(item.id, 'order', Number(e.target.value))}
                     />
                   </div>
                </div>
                <div className="col-span-3 flex justify-center relative items-center gap-1">
                  <span className="text-gray-400 text-xs">$</span>
                  <input 
                    type="number"
                    step="0.01"
                    className="w-full text-center bg-gray-50 rounded p-1 border border-gray-200 focus:border-blue-500 focus:outline-none text-sm"
                    value={item.price || ''} 
                    onChange={(e) => updateItem(item.id, 'price', e.target.value)}
                    placeholder="0.00"
                  />
                  <button onClick={() => deleteItem(item.id)} className="text-gray-300 hover:text-red-500 p-1 flex-shrink-0">
                      <Trash2 className="w-4 h-4" />
                   </button>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 z-20 max-w-2xl mx-auto shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
           <div className="flex items-center justify-between mb-3 text-sm">
              <span className="text-gray-500">Total Items: {items.length}</span>
              <div className="flex items-center gap-2">
                 <span className="text-gray-500">Total Order:</span>
                 <span className="font-bold text-lg text-gray-900">{totalOrder}</span>
              </div>
           </div>
           
           <Button onClick={handleExport} className="w-full bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-200 py-3 text-lg">
              Export to Google Sheet <Sheet className="w-5 h-5 ml-2" />
           </Button>
        </div>

        {/* Export Modal */}
        <Modal 
          isOpen={showExportModal} 
          onClose={() => setShowExportModal(false)}
          title="Manual Export Required"
        >
          <div className="space-y-4">
             <div className="bg-orange-50 text-orange-800 p-3 rounded-lg text-sm flex items-start gap-2">
               <Copy className="w-5 h-5 flex-shrink-0 mt-0.5" />
               <p>We couldn't automatically write to your Sheet (browser security). Don't worry, your data is already copied!</p>
             </div>
             
             <div className="space-y-2 text-sm text-gray-600">
               <p className="font-bold text-gray-900">Follow these steps:</p>
               <ol className="list-decimal pl-5 space-y-2">
                 <li>Click the button below to open your Sheet.</li>
                 <li>Click on the first empty cell (under Vendor/Column A).</li>
                 <li>Paste your data <span className="font-mono bg-gray-100 px-1 rounded">Ctrl+V</span> (or Long Press {'>'} Paste).</li>
               </ol>
             </div>

             <div className="pt-2">
               <a 
                 href={settings.googleSheetUrl} 
                 target="_blank" 
                 rel="noreferrer"
                 onClick={() => setTimeout(() => {
                   setShowExportModal(false);
                   setView(AppView.DASHBOARD);
                 }, 500)}
                 className="flex items-center justify-center w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 transition-colors"
               >
                 Open Sheet & Paste <ExternalLink className="w-4 h-4 ml-2" />
               </a>
             </div>
             
             <div className="text-center pt-2">
               <button onClick={copyToClipboard} className="text-xs text-blue-600 hover:underline">
                 Copy data again
               </button>
             </div>
          </div>
        </Modal>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      <div className="max-w-2xl mx-auto min-h-screen bg-white shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <header className="bg-white border-b px-6 py-4 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView(AppView.DASHBOARD)}>
            <div className="bg-green-600 text-white p-1.5 rounded-lg">
              <FileText className="w-5 h-5" />
            </div>
            <span className="font-bold text-xl tracking-tight text-gray-800">OrderSheet</span>
          </div>
          {view !== AppView.DASHBOARD && (
             <Button variant="ghost" onClick={() => setView(AppView.DASHBOARD)}>
               <Home className="w-5 h-5" />
             </Button>
          )}
        </header>

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-6 overflow-x-hidden">
          {view === AppView.DASHBOARD && renderDashboard()}
          {view === AppView.SCAN && renderScan()}
          {view === AppView.SETTINGS && renderSettings()}
          {(view === AppView.REVIEW || view === AppView.HISTORY) && renderReview()}
        </main>
        
        {/* Toast Notification */}
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
        
        {/* Hidden Inputs for File Upload */}
        {/* Camera Input (forces camera on mobile) */}
        <input 
          type="file" 
          ref={cameraInputRef}
          className="hidden" 
          accept="image/*"
          capture="environment"
          onChange={handleFileUpload}
        />
        {/* Generic File Upload Input (allows Gallery/Files/Camera choice) */}
        <input 
          type="file" 
          ref={uploadInputRef}
          className="hidden" 
          accept="image/*,application/pdf"
          onChange={handleFileUpload}
        />
      </div>
    </div>
  );
};

export default App;