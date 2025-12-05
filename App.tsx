import React, { useState, useEffect, useRef } from 'react';
import { extractInvoiceData } from './services/geminiService';
import { InvoiceItem, InvoiceRecord, AppView, AppSettings } from './types';
import { Button, Input, Card, Badge, Toast, Modal, Switch } from './components/UI';
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
  ArrowDownAZ,
  Zap,
  CheckCircle2,
  AlertCircle,
  AlertTriangle
} from 'lucide-react';

const STORAGE_KEY = 'ordersheet_history';
const SETTINGS_KEY = 'ordersheet_settings';

// The specific sheet URL provided by the user
const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1c9qt5RejeAZ_tn-gXhFaDwVSIgZdmgRPojKD1LqhRYc/edit?gid=0#gid=0';

// Helper to resize images before sending to API (Fixes mobile crash issues)
const resizeImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // Max dimension 1500px is usually plenty for OCR and keeps size down
        const MAX_DIMENSION = 1500;
        
        if (width > height) {
          if (width > MAX_DIMENSION) {
            height *= MAX_DIMENSION / width;
            width = MAX_DIMENSION;
          }
        } else {
          if (height > MAX_DIMENSION) {
            width *= MAX_DIMENSION / height;
            height = MAX_DIMENSION;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        
        // Convert to base64, reduce quality to 0.8 to save bandwidth
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        resolve(dataUrl.split(',')[1]); // Return just the base64 data
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};

const App: React.FC = () => {
  const [view, setView] = useState<AppView>(AppView.DASHBOARD);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string | null>(null); // 'analyzing' | 'uploading'
  const [history, setHistory] = useState<InvoiceRecord[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
  // New state to control whether we are starting fresh or adding to existing
  const [scanMode, setScanMode] = useState<'new' | 'append'>('new');
  const [showExportModal, setShowExportModal] = useState(false);

  const [settings, setSettings] = useState<AppSettings>({
    googleSheetUrl: DEFAULT_SHEET_URL,
    scriptUrl: '',
    autoExport: true // Default to true to encourage automation
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
        const parsed = JSON.parse(savedSettings);
        setSettings({
          scriptUrl: parsed.scriptUrl || '',
          googleSheetUrl: DEFAULT_SHEET_URL, // Always force the correct URL
          autoExport: parsed.autoExport ?? true
        });
      } catch (e) {
        console.error("Failed to parse settings", e);
        setSettings({ googleSheetUrl: DEFAULT_SHEET_URL, scriptUrl: '', autoExport: true });
      }
    } else {
      setSettings({ googleSheetUrl: DEFAULT_SHEET_URL, scriptUrl: '', autoExport: true });
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

  const uploadToScript = async (dataToUpload: InvoiceItem[], currentScriptUrl: string) => {
    if (!currentScriptUrl) {
      return false;
    }
    
    // Sort before uploading for consistency
    const sortedData = [...dataToUpload].sort((a, b) => 
      a.description.toLowerCase().localeCompare(b.description.toLowerCase())
    );

    const payload = sortedData.map(i => ({
      inStock: i.inStock,
      par: i.par,
      order: i.order,
      description: i.description,
      vendor: i.vendor,
      price: i.price
    }));

    try {
      console.log("Uploading to:", currentScriptUrl);
      const response = await fetch(currentScriptUrl, {
        method: 'POST',
        // Standard mode to read response, requires "Anyone" access on script
        headers: { 'Content-Type': 'text/plain' }, 
        body: JSON.stringify({ items: payload })
      });
      
      const text = await response.text();
      console.log("Script Response:", text);
      
      if (text.includes("Success")) {
        return true;
      } else {
        console.error("Script returned error:", text);
        return false;
      }
    } catch (e) {
      console.error("Upload Error:", e);
      return false;
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setLoadingStep('analyzing');
    setView(AppView.SCAN);
    
    try {
      let base64Data = "";
      let mimeType = file.type;

      // Check if it is an image and compress it
      if (file.type.startsWith('image/')) {
        try {
          base64Data = await resizeImage(file);
          mimeType = 'image/jpeg'; // Canvas exports as jpeg
        } catch (resizeErr) {
          console.warn("Resize failed, falling back to original", resizeErr);
          // Fallback to original read
          base64Data = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
            reader.readAsDataURL(file);
          }) as string;
        }
      } else {
        // Handle PDF or other files without resize
         base64Data = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        }) as string;
      }
      
      try {
        const extractedItems = await extractInvoiceData(base64Data, mimeType);
        
        const vendor = extractedItems[0]?.vendor || "Unknown Vendor";
        const successMessage = `Scanned ${extractedItems.length} items for ${vendor}`;

        // AUTO EXPORT LOGIC
        if (settings.autoExport && settings.scriptUrl) {
          setLoadingStep('uploading');
          // Small delay to let UI update
          await new Promise(r => setTimeout(r, 500));
          
          const success = await uploadToScript(extractedItems, settings.scriptUrl);
          
          if (success) {
            setToastMessage("Auto-Export Successful! ✅");
          } else {
            setToastMessage("Auto-Export Failed. Check settings.");
            setShowExportModal(true); // Fallback to manual
          }
        } else if (settings.autoExport && !settings.scriptUrl) {
           setToastMessage("Skipped Auto-Export: Script URL not set in Settings");
        } else {
           setToastMessage(successMessage);
        }

        // Update state finally
        setItems(prev => {
          if (scanMode === 'append') {
            return [...prev, ...extractedItems];
          } else {
            return extractedItems;
          }
        });

        setView(AppView.REVIEW);
      } catch (error) {
        console.error(error);
        alert("Failed to extract data. Use a clearer photo or try a smaller file.");
        if (scanMode === 'append') setView(AppView.REVIEW);
        else setView(AppView.DASHBOARD);
      } finally {
        setIsProcessing(false);
        setLoadingStep(null);
      }
    } catch (error) {
      console.error(error);
      setIsProcessing(false);
      setLoadingStep(null);
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

  const handleManualExport = async () => {
    // 1. Save history
    const newRecord: InvoiceRecord = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      items: items, 
      totalItems: items.length,
      status: 'Uploaded'
    };
    setHistory(prev => [newRecord, ...prev]);

    // 2. Try Script Upload
    if (settings.scriptUrl) {
      setLoadingStep('uploading');
      setIsProcessing(true);
      
      const success = await uploadToScript(items, settings.scriptUrl);
      setIsProcessing(false);
      setLoadingStep(null);
      
      if (success) {
        setToastMessage("Sent to Sheet! (Sorted by name)");
        setTimeout(() => setView(AppView.DASHBOARD), 1000);
        return;
      } else {
        setToastMessage("Auto-upload failed. Switching to manual copy.");
      }
    }

    // 3. Fallback to clipboard
    await copyToClipboard();
    setShowExportModal(true);
  };

  // Pre-configured script code for the user
  const SCRIPT_CODE = `// COPY ALL OF THIS CODE
function doPost(e) {
  // 1. SAFEGUARD FOR MANUAL RUNS
  if (typeof e === 'undefined') {
    return ContentService.createTextOutput("Error: Event object 'e' is undefined. You cannot run this function manually from the editor. It must be triggered by the App.");
  }

  var lock = LockService.getScriptLock();
  // Wait for up to 10 seconds for other processes to finish.
  if (!lock.tryLock(10000)) {
     return ContentService.createTextOutput("Error: Could not obtain lock.");
  }

  try {
    // AUTO-CONFIGURED FOR YOUR SHEET ID:
    var sheet = SpreadsheetApp.openById("1c9qt5RejeAZ_tn-gXhFaDwVSIgZdmgRPojKD1LqhRYc").getSheets()[0];
    
    // Parse the data
    var rawData = e.postData ? e.postData.contents : null;
    if (!rawData) return ContentService.createTextOutput("Error: No data received.");

    var data = JSON.parse(rawData);
    
    if (data.items && data.items.length > 0) {
      var rows = data.items.map(function(item) {
        return [
          item.vendor || "", 
          item.description || "", 
          item.inStock || 0, 
          item.par || 0, 
          item.order || 0, 
          item.price || 0
          // Removed Date Timestamp as requested
        ];
      });
      
      // Batch write for better performance
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }
    
    return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT);
    
  } catch (err) {
    return ContentService.createTextOutput("Error: " + err.toString());
  } finally {
    lock.releaseLock();
  }
}`;

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-green-600 to-emerald-600 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
        <div className="relative z-10">
          <h1 className="text-3xl font-bold mb-2">OrderSheet</h1>
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
    <div className="flex flex-col items-center justify-center h-[60vh] text-center px-4 space-y-4">
      <Loader2 className="w-16 h-16 text-green-600 animate-spin" />
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">
          {loadingStep === 'uploading' ? 'Auto-Exporting...' : (scanMode === 'append' ? 'Processing Page...' : 'Analyzing Invoice...')}
        </h2>
        <p className="text-gray-500 animate-pulse">
          {loadingStep === 'uploading' 
            ? 'Sending data directly to your Google Sheet...' 
            : 'Extracting vendors, items, and quantities...'}
        </p>
      </div>
    </div>
  );

  const renderSettings = () => {
    const isScriptUrlWarning = settings.scriptUrl && !settings.scriptUrl.endsWith('/exec');

    return (
      <div className="space-y-6 pb-20">
         <div className="flex items-center gap-2 mb-6">
            <Button variant="ghost" onClick={() => setView(AppView.DASHBOARD)} className="pl-0">
              <ArrowLeft className="w-5 h-5" /> Back
            </Button>
            <h2 className="text-2xl font-bold">Automation Setup</h2>
         </div>

         <Card className="p-5 space-y-4 border-blue-100 bg-blue-50">
            <div className="flex justify-between items-center border-b border-blue-200 pb-2">
              <h3 className="font-bold text-lg text-blue-900">1. Link Google Sheet</h3>
              <Badge type={settings.scriptUrl ? 'success' : 'warning'}>{settings.scriptUrl ? 'Connected' : 'Not Linked'}</Badge>
            </div>
            
            <div className="space-y-4">
               <div className="text-sm text-gray-600 space-y-2">
                  <p>Follow these steps to create a <strong>New Deployment</strong> (Fixes "No active deployment"):</p>
                  <ol className="list-decimal pl-4 space-y-2 font-medium text-gray-800">
                    <li>Go to <a href="https://script.google.com/home" target="_blank" className="text-blue-600 underline">script.google.com</a>.</li>
                    <li>Create or Open your project.</li>
                    <li className="relative group">
                      <div className="bg-white border rounded-md p-2 text-xs font-mono text-gray-600 overflow-x-auto max-h-40">
                        <pre>{SCRIPT_CODE}</pre>
                        <Button 
                          variant="secondary" 
                          className="absolute top-2 right-2 h-8 text-xs"
                          onClick={() => {
                            navigator.clipboard.writeText(SCRIPT_CODE);
                            setToastMessage("Code copied!");
                          }}
                        >
                          <Copy className="w-3 h-3 mr-1" /> Copy Code
                        </Button>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Paste this code into the editor (replace everything).</p>
                    </li>
                    <li>Click <strong>Deploy</strong> (Blue button, top right) &rarr; <strong>New Deployment</strong>.</li>
                    <li>Click the Gear Icon ⚙️ (next to "Select type") &rarr; choose <strong>Web App</strong>.</li>
                    <li className="text-red-600 font-bold bg-red-50 p-1 rounded">
                      Who has access: Select "Anyone" (Required!)
                    </li>
                    <li>Click <strong>Deploy</strong> and copy the <strong>Web App URL</strong>.</li>
                  </ol>
               </div>

               <Input 
                  label="Paste Web App URL Here (/exec)" 
                  placeholder="https://script.google.com/macros/s/.../exec"
                  value={settings.scriptUrl}
                  onChange={(e) => setSettings({...settings, scriptUrl: e.target.value})}
                />
                
                {isScriptUrlWarning && (
                  <div className="flex items-center gap-2 text-amber-600 text-xs font-bold bg-amber-50 p-2 rounded">
                    <AlertTriangle className="w-4 h-4" />
                    Warning: URL should end in '/exec'. Do not use '/edit' or '/dev'.
                  </div>
                )}
                
                <div className="flex gap-2">
                  <Button 
                    onClick={async () => {
                      if (!settings.scriptUrl) {
                        setToastMessage("Paste a URL first!");
                        return;
                      }
                      setToastMessage("Testing connection...");
                      const success = await uploadToScript([{
                        id: 'test', description: 'Connection Test', vendor: 'Test', inStock: 1, par: 1, order: 0, price: 0
                      }], settings.scriptUrl);
                      if (success) {
                        setToastMessage("Connection Successful! ✅");
                      } else {
                        setToastMessage("Connection Failed. Check 'Who has access' is set to 'Anyone'");
                      }
                    }}
                    className="w-full"
                    variant="secondary"
                  >
                    Test Connection
                  </Button>
                </div>

               <div className="flex items-center justify-between pt-4 border-t border-blue-200">
                  <div>
                     <span className="font-semibold text-gray-800 flex items-center gap-2">
                       <Zap className="w-4 h-4 text-orange-500" fill="currentColor" /> Auto-Export
                     </span>
                     <p className="text-xs text-gray-500">Upload immediately after scan</p>
                  </div>
                  <Switch 
                    checked={settings.autoExport} 
                    onChange={(val) => setSettings({...settings, autoExport: val})} 
                  />
               </div>
            </div>
         </Card>

         <Card className="p-5 space-y-4">
            <h3 className="font-bold text-lg border-b pb-2">Fallback Settings</h3>
            <p className="text-xs text-gray-500">If automation fails, we will open this sheet for manual pasting.</p>
            <Input 
              label="Target Google Sheet URL" 
              value={settings.googleSheetUrl}
              onChange={(e) => setSettings({...settings, googleSheetUrl: e.target.value})}
            />
         </Card>
      </div>
    );
  }

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
           
           <Button onClick={handleManualExport} className="w-full bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-200 py-3 text-lg">
              Export / Upload <Sheet className="w-5 h-5 ml-2" />
           </Button>
        </div>

        {/* Manual Export Modal */}
        <Modal 
          isOpen={showExportModal} 
          onClose={() => setShowExportModal(false)}
          title="Export Data"
        >
          <div className="space-y-4">
             <div className="bg-blue-50 text-blue-800 p-3 rounded-lg text-sm flex items-start gap-2">
               <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
               <p>
                 {settings.scriptUrl 
                   ? "Auto-export encountered an issue. Please paste manually." 
                   : "Since automation isn't set up, the data has been copied to your clipboard."}
               </p>
             </div>
             
             <div className="space-y-2 text-sm text-gray-600">
               <p className="font-bold text-gray-900">Manual Steps (Troubleshooting):</p>
               <ul className="list-disc pl-5 space-y-1">
                 <li>Did you set "Who has access" to "Anyone"?</li>
                 <li>Did you select "New Deployment" when updating code?</li>
               </ul>
               <p className="font-bold text-gray-900 mt-2">To Paste Manually:</p>
               <ol className="list-decimal pl-5 space-y-2">
                 <li>Click <strong>Open Sheet</strong> below.</li>
                 <li>Click the first empty cell under "Vendor".</li>
                 <li>Paste (<span className="font-mono bg-gray-100 px-1 rounded">Ctrl+V</span>).</li>
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
        <input 
          type="file" 
          ref={cameraInputRef}
          className="hidden" 
          accept="image/*"
          capture="environment"
          onChange={handleFileUpload}
        />
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