import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { auth, db } from '../firebase';
import { collection, onSnapshot, doc, updateDoc, addDoc, query, orderBy, limit, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';
import { Material, PricingSnapshot } from '../types';
import { Plus, Search, Edit2, TrendingUp, TrendingDown, Minus, Loader2, X, ShieldCheck, FileSpreadsheet, History, RotateCcw, AlertCircle, CheckCircle2, Lock, Sliders, Trash2, AlertTriangle } from 'lucide-react';
import Papa from 'papaparse';
import { cn } from '../lib/utils';

import { UserProfile } from '../types';

import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { logAuditEvent } from '../lib/audit';
import { useToast } from '../context/ToastContext';

interface ManagePricesProps {
  profile: UserProfile | null;
}

export default function ManagePrices({ profile }: ManagePricesProps) {
  const { firestore, success, error: toastError, info } = useToast();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [snapshots, setSnapshots] = useState<PricingSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle URL deep linking for material searches
  useEffect(() => {
    const searchVal = searchParams.get('search');
    if (searchVal) {
      setSearchQuery(searchVal);
      
      // Clear search parameter so page behavior is normal after selecting
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('search');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Material>>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<Record<string, any>>({});
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [updatingPin, setUpdatingPin] = useState(false);
  const [newPin, setNewPin] = useState(profile?.managerPin || '');
  
  // Google Sheets Sync State
  const [sheetId, setSheetId] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [debugRows, setDebugRows] = useState<string[][] | null>(null);
  const [isSeedingMode, setIsSeedingMode] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // New sync states for robust preview and manual tracking
  const [rawParsedRows, setRawParsedRows] = useState<any[]>([]);
  const [headersList, setHeadersList] = useState<string[]>([]);
  const [mappedCode, setMappedCode] = useState('');
  const [mappedBuy, setMappedBuy] = useState('');
  const [mappedSale, setMappedSale] = useState('');
  const [mappedName, setMappedName] = useState('');
  const [mappedCategory, setMappedCategory] = useState('');
  const [mappedUnit, setMappedUnit] = useState('');
  
  const [previewItems, setPreviewItems] = useState<any[] | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [committingSync, setCommittingSync] = useState(false);

  // Storage Optimization State
  const [optimizing, setOptimizing] = useState(false);
  const [retentionDays, setRetentionDays] = useState(365);
  const [optimizationStats, setOptimizationStats] = useState<{ count: number, saved: boolean } | null>(null);
  const [batchCategory, setBatchCategory] = useState('All');
  const [batchType, setBatchType] = useState<'buy' | 'sale' | 'both'>('buy');
  const [batchPercent, setBatchPercent] = useState('');
  const [applyingBatch, setApplyingBatch] = useState(false);
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState<PricingSnapshot | null>(null);
  const [confirmOptimize, setConfirmOptimize] = useState(false);
  const [addingMaterial, setAddingMaterial] = useState(false);
  const [addStatus, setAddStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  // Batch delete all materials states
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [deleteAllConfirmText, setDeleteAllConfirmText] = useState('');
  const [deletingAll, setDeletingAll] = useState(false);

  useEffect(() => {
    if (!auth.currentUser) return;

    const unsubMaterials = onSnapshot(collection(db, 'materials'), (snapshot) => {
      const materialsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Material[];
      setMaterials(materialsData);
      setLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'materials'));

    const unsubSnapshots = onSnapshot(
      query(collection(db, 'pricingSnapshots'), orderBy('timestamp', 'desc'), limit(10)),
      (snapshot) => {
        setSnapshots(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as PricingSnapshot[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'pricingSnapshots')
    );

    // Load persisted Google Sheet URL/ID from system config
    const unsubConfig = onSnapshot(doc(db, 'system', 'config'), (snap) => {
      if (snap.exists() && snap.data().googleSheetUrl) {
        setSheetId(snap.data().googleSheetUrl);
      }
    }, (error) => {
      console.warn('System config snapshot failed in ManagePrices (using default/cached config):', error.message);
    });

    return () => {
      try { unsubMaterials(); } catch (e) { console.warn('unsubMaterials error', e); }
      try { unsubSnapshots(); } catch (e) { console.warn('unsubSnapshots error', e); }
      try { unsubConfig(); } catch (e) { console.warn('unsubConfig error', e); }
    };
  }, [profile]);

  // Hooks will run unconditionally. Permission check is moved below loading check.

  const createSnapshot = async (source: 'manual' | 'google_sheets', sid?: string) => {
    if (!profile) return;
    
    const snapshotData: Omit<PricingSnapshot, 'id'> = {
      timestamp: new Date().toISOString(),
      createdBy: profile.email,
      source,
      sheetId: sid,
      prices: materials.map(m => ({
        materialId: m.id,
        materialName: m.name,
        buyPrice: m.buyPrice,
        salePrice: m.salePrice
      }))
    };

    try {
      await addDoc(collection(db, 'pricingSnapshots'), snapshotData);
      firestore('Snapshot Created', 'A backup of material prices has been safely committed to Cloud Firestore.');
    } catch (error: any) {
      console.error('Error creating snapshot:', error);
      toastError('Snapshot Failed', `Failed to create backup snapshot: ${error.message || error}`);
    }
  };

  const optimizeStorage = async (force = false) => {
    if (!force) {
      setConfirmOptimize(true);
      return;
    }
    
    setOptimizing(true);
    setOptimizationStats(null);
    setConfirmOptimize(false);
    
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      const cutoffIso = cutoffDate.toISOString();
      
      const ticketsRef = collection(db, 'buyTickets');
      const q = query(ticketsRef, orderBy('timestamp', 'asc'));
      const snapshot = await getDocs(q);
      
      let count = 0;
      const batch = writeBatch(db);
      
      snapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        if (data.timestamp < cutoffIso) {
          let hasPhotos = !!data.customerPhotoUrl;
          const updatedMaterials = (data.materials || []).map((m: any) => {
            if (m.photoUrl) {
              hasPhotos = true;
              const { photoUrl, ...rest } = m;
              return rest;
            }
            return m;
          });
          
          if (hasPhotos) {
            batch.update(docSnap.ref, {
              customerPhotoUrl: null,
              materials: updatedMaterials,
              archivedAt: new Date().toISOString()
            });
            count++;
          }
        }
      });
      
      if (count > 0) {
        await batch.commit();
      }
      
      setOptimizationStats({ count, saved: true });
    } catch (error) {
      console.error('Storage optimization failed:', error);
      handleFirestoreError(error, OperationType.UPDATE, 'buyTickets');
    } finally {
      setOptimizing(false);
    }
  };

  const syncWithGoogleSheets = async () => {
    if (!sheetId) return;
    setSyncing(true);
    setSyncStatus(null);
    setDebugRows(null);

    try {
      // Extract ID if full URL was pasted
      let extractedId = sheetId.trim();
      let directUrl = '';

      // If they pasted the full published CSV link, use it directly
      if (extractedId.includes('/pub') && extractedId.includes('output=csv')) {
        directUrl = extractedId;
      } else if (extractedId.includes('docs.google.com/spreadsheets/')) {
        const eMatches = extractedId.match(/\/d\/e\/([a-zA-Z0-9-_]+)/);
        const dMatches = extractedId.match(/\/d\/([a-zA-Z0-9-_]+)/);
        
        if (eMatches && eMatches[1]) {
          extractedId = eMatches[1];
        } else if (dMatches && dMatches[1]) {
          extractedId = dMatches[1];
        }
      }

      // Try multiple endpoints with cache busting parameters for better compatibility
      const cacheBust = `nocache=${Date.now()}`;
      const endpoints = directUrl ? [`${directUrl}${directUrl.includes('?') ? '&' : '?'}${cacheBust}`] : [
        extractedId.startsWith('2PACX') 
          ? `https://docs.google.com/spreadsheets/d/e/${extractedId}/pub?output=csv&${cacheBust}`
          : `https://docs.google.com/spreadsheets/d/${extractedId}/export?format=csv&${cacheBust}`,
        `https://docs.google.com/spreadsheets/d/${extractedId}/pub?output=csv&${cacheBust}`,
        `https://docs.google.com/spreadsheets/d/${extractedId}/gviz/tq?tqx=out:csv&${cacheBust}`
      ];

      let response;
      let lastError;

      console.log('Attempting to sync with Google Sheets. URLs:', endpoints);

      for (const url of endpoints) {
        try {
          // Try server-side proxy first as it's most reliable for CORS
          const proxyUrl = `/api/proxy-sheet?url=${encodeURIComponent(url)}&t=${Date.now()}`;
          console.log('Attempting fetch via server proxy:', proxyUrl);
          
          response = await fetch(proxyUrl);
          if (response.ok) {
            console.log('Successfully connected via server proxy to:', url);
            break;
          } else {
            // Check for specific permission or sharing errors returned from our proxy
            try {
              const errData = await response.json();
              if (response.status === 401 || errData.status === 401 || (errData.error && errData.error.includes('401'))) {
                throw new Error(`Google Sheets Permission Error (401 Unauthorized): The spreadsheet is private or restricted.

To fix this:
1. Open your Google Sheet.
2. Click "Share" (top right), change General Access to "Anyone with the link can view".
3. Inside Google Sheets, go to "File" > "Share" > "Publish to web".
4. Select "Entire Document" or the specific sheet, select "Comma-separated values (.csv)", and click "Publish".
5. Copy and paste that published .csv link or use your Sheet ID in the field above.`);
              }
              if (response.status === 403 || errData.status === 403 || (errData.error && errData.error.includes('403'))) {
                throw new Error(`Google Sheets Access Forbidden (403): Access is blocked. Please ensure the sheet sharing permissions are turned on ("Anyone with the link can view") and it is "Published to web" as CSV format.`);
              }
              if (response.status === 404 || errData.status === 404 || (errData.error && errData.error.includes('404'))) {
                throw new Error(`Google Sheet Not Found (404). Please verify your Google Sheet ID or URL is correct and exists.`);
              }
            } catch (err: any) {
              // If we already parsed and threw our custom permission error, let it propagate out
              if (err.message && err.message.includes('Google Sheets')) {
                throw err;
              }
              // Otherwise continue and try direct fetch
            }
          }
          
          // Fallback to direct fetch if proxy fails
          console.warn(`Server proxy failed for ${url}, trying direct fetch...`);
          response = await fetch(url);
          if (response.ok) {
            console.log('Successfully connected directly to:', url);
            break;
          }
          console.warn(`Failed to fetch from ${url}: ${response.status} ${response.statusText}`);
        } catch (e: any) {
          console.error(`Error fetching from ${url}:`, e);
          // If this is a specific Google Sheets validation/permission error we threw, rethrow it to exit the loop!
          if (e.message && e.message.includes('Google Sheets')) {
            throw e;
          }
          lastError = e;
        }
      }

      // Fallback to a CORS proxy if direct fetch fails
      let csvText = '';
      if (response && response.ok) {
        csvText = await response.text();
      } else {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(endpoints[0])}&t=${Date.now()}`;
        console.log('Attempting fallback via CORS proxy:', proxyUrl);
        try {
          const proxyResponse = await fetch(proxyUrl);
          if (proxyResponse.ok) {
            const proxyData = await proxyResponse.json();
            if (proxyData.contents) {
              console.log('Successfully fetched via proxy');
              csvText = proxyData.contents;
            }
          }
        } catch (e) {
          console.error('Proxy fallback failed:', e);
        }
      }

      if (!csvText) {
        throw new Error(`Connection failed. 1) Verify the link is "Published to web" as CSV. 2) Check if your browser/network blocks docs.google.com. 3) Try opening the link in a new tab: ${endpoints[0]}`);
      }
      
      // 1. Parse raw rows first to find the header row
      const rawParse = Papa.parse(csvText, { skipEmptyLines: true, delimiter: "" });
      const rawRows = rawParse.data as string[][];
      
      if (!rawRows || rawRows.length === 0) {
        throw new Error('The sheet appears to be empty.');
      }

      // Store raw rows for debugging if needed
      setDebugRows(rawRows.slice(0, 10));

      const codeKeywords = ['code', 'materialcode', 'id', 'material', 'sku', 'item', 'itemcode', 'partnumber', 'matcode', 'productcode', 'product'];
      const nameKeywords = ['name', 'materialname', 'description', 'desc', 'label', 'title', 'productname', 'itemname'];
      const categoryKeywords = ['category', 'group', 'type', 'class', 'section', 'metaltype'];
      const unitKeywords = ['unit', 'uom', 'measure', 'weightunit', 'per'];
      const buyKeywords = ['buyprice', 'buy', 'buyrate', 'purchaseprice', 'cost', 'costprice', 'buying', 'scalebuy', 'purchase'];
      const saleKeywords = ['saleprice', 'sale', 'salerate', 'sellingprice', 'price', 'rate', 'sell', 'selling', 'scalesell'];

      // Find the header row by looking for keywords
      let headerIndex = -1;
      for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
        const row = rawRows[i];
        const hasCode = row.some(cell => {
          const norm = cell.toString().toLowerCase().trim().replace(/[^a-z0-9]/g, '');
          return codeKeywords.includes(norm) || codeKeywords.some(kw => norm.includes(kw));
        });
        const hasPrice = row.some(cell => {
          const norm = cell.toString().toLowerCase().trim().replace(/[^a-z0-9]/g, '');
          return buyKeywords.includes(norm) || saleKeywords.includes(norm) || 
                 buyKeywords.some(kw => norm.includes(kw)) || saleKeywords.some(kw => norm.includes(kw));
        });

        if (hasCode && hasPrice) {
          headerIndex = i;
          break;
        }
      }

      if (headerIndex === -1) {
        // Fallback: Use the first row as headers
        headerIndex = 0;
      }

      const headers = rawRows[headerIndex].map((h, idx) => h?.toString().trim() || `Column ${idx + 1}`);
      const dataRows = rawRows.slice(headerIndex + 1);
      
      // Convert to objects using discovered headers
      const formattedData = dataRows.map(row => {
        const obj: any = {};
        headers.forEach((header, idx) => {
          if (header) obj[header] = row[idx];
        });
        return obj;
      });

      setHeadersList(headers);
      setRawParsedRows(formattedData);

      // Auto discover column keys
      const autoDiscoverCol = (hdrs: string[], keywords: string[]) => {
        for (const h of hdrs) {
          const norm = h.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
          if (keywords.includes(norm)) return h;
        }
        for (const h of hdrs) {
          const norm = h.toLowerCase().trim();
          if (keywords.some(kw => norm.includes(kw))) return h;
        }
        return '';
      };

      const discoveredCode = autoDiscoverCol(headers, codeKeywords) || headers[0] || '';
      const discoveredBuy = autoDiscoverCol(headers, buyKeywords) || '';
      const discoveredSale = autoDiscoverCol(headers, saleKeywords) || '';
      const discoveredName = autoDiscoverCol(headers, nameKeywords) || '';
      const discoveredCategory = autoDiscoverCol(headers, categoryKeywords) || '';
      const discoveredUnit = autoDiscoverCol(headers, unitKeywords) || '';

      setMappedCode(discoveredCode);
      setMappedBuy(discoveredBuy);
      setMappedSale(discoveredSale);
      setMappedName(discoveredName);
      setMappedCategory(discoveredCategory);
      setMappedUnit(discoveredUnit);

      setShowPreviewModal(true);

    } catch (error: any) {
      console.error('Sync error:', error);
      setSyncStatus({ type: 'error', message: error.message || 'Failed to parse Google Sheets.' });
    } finally {
      setSyncing(false);
    }
  };

  const commitSyncPreview = async () => {
    if (!previewItems || previewItems.length === 0) return;
    setCommittingSync(true);
    setSyncStatus(null);
    try {
      let extractedId = sheetId.trim();
      if (extractedId.includes('docs.google.com/spreadsheets/')) {
        const eMatches = extractedId.match(/\/d\/e\/([a-zA-Z0-9-_]+)/);
        const dMatches = extractedId.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (eMatches && eMatches[1]) {
          extractedId = eMatches[1];
        } else if (dMatches && dMatches[1]) {
          extractedId = dMatches[1];
        }
      }

      // Create snapshot of current prices before syncing
      await createSnapshot('google_sheets', extractedId);

      const batch = writeBatch(db);
      let updatedCount = 0;
      let createdCount = 0;

      for (const item of previewItems) {
        if (item.status === 'ignored' || item.status === 'unchanged') continue;

        const material = materials.find(m => m.code.toUpperCase() === item.code.toUpperCase());
        if (material) {
          const updates: any = {
            buyPrice: item.newBuyPrice,
            salePrice: item.newSalePrice,
            updatedAt: new Date().toISOString(),
            updatedBy: profile?.displayName || profile?.email || 'System',
            updatedByUid: profile?.uid || 'system'
          };
          if (isSeedingMode) {
            updates.name = item.name;
            updates.category = item.category;
            updates.unit = item.unit;
          }
          batch.update(doc(db, 'materials', material.id), updates);
          updatedCount++;
        } else if (isSeedingMode && item.status === 'create') {
          const newMaterialRef = doc(collection(db, 'materials'));
          const newMatData = {
            code: item.code,
            name: item.name,
            category: item.category,
            buyPrice: item.newBuyPrice,
            salePrice: item.newSalePrice,
            unit: item.unit,
            updatedAt: new Date().toISOString(),
            updatedBy: profile?.displayName || profile?.email || 'System',
            updatedByUid: profile?.uid || 'system'
          };
          batch.set(newMaterialRef, newMatData);
          createdCount++;
        }
      }

      await batch.commit();

      // Persist the sheet setting in Firestore globally
      try {
        await updateDoc(doc(db, 'system', 'config'), {
          googleSheetUrl: sheetId.trim(),
          pricingLastSyncedAt: new Date().toISOString(),
          pricingLastSyncedBy: profile?.email || 'System'
        });
      } catch (e) {
        console.warn('Unable to persist googleSheetUrl globally, continuing:', e);
      }

      firestore(
        'Database Synced',
        `Google Sheets sync successfully committed to Cloud Firestore: Updated ${updatedCount} and Created ${createdCount} material records.`
      );

      setSyncStatus({ 
        type: 'success', 
        message: `Sync Applied: Updated ${updatedCount} and Created ${createdCount} material records.` 
      });
      setShowPreviewModal(false);
      setRawParsedRows([]);
      setPreviewItems(null);
    } catch (err: any) {
      console.error('Error committing sync:', err);
      toastError('Sync Failed', `Google Sheets sync failed: ${err.message || err}`);
      setSyncStatus({ type: 'error', message: err.message || 'Error occurred during database sync write.' });
    } finally {
      setCommittingSync(false);
    }
  };

  useEffect(() => {
    if (rawParsedRows.length > 0) {
      const items = rawParsedRows.map(row => {
        const codeVal = mappedCode ? row[mappedCode]?.toString().trim() : '';
        if (!codeVal) return null;

        const material = materials.find(m => m.code.toUpperCase() === codeVal.toUpperCase());

        const buyVal = mappedBuy ? row[mappedBuy] : null;
        const saleVal = mappedSale ? row[mappedSale] : null;

        const buyPrice = parseFloat(buyVal?.toString().replace(/[^0-9.]/g, '') || '');
        const salePrice = parseFloat(saleVal?.toString().replace(/[^0-9.]/g, '') || '');

        const nameVal = mappedName ? row[mappedName]?.toString().trim() : '';
        const catVal = mappedCategory ? row[mappedCategory]?.toString().trim() : '';
        const unitVal = mappedUnit ? row[mappedUnit]?.toString().toLowerCase().trim() : '';

        if (material) {
          const finalBuy = !isNaN(buyPrice) ? buyPrice : material.buyPrice;
          const finalSale = !isNaN(salePrice) ? salePrice : material.salePrice;
          const hasDiff = 
            (Math.abs(material.buyPrice - finalBuy) > 0.001) ||
            (Math.abs(material.salePrice - finalSale) > 0.001);

          return {
            code: material.code,
            name: material.name,
            category: material.category,
            unit: material.unit,
            currentBuyPrice: material.buyPrice,
            newBuyPrice: finalBuy,
            currentSalePrice: material.salePrice,
            newSalePrice: finalSale,
            isNew: false,
            hasDiff,
            status: hasDiff ? 'update' : 'unchanged'
          };
        } else if (isSeedingMode) {
          const finalUnit = (unitVal === 'ton' || unitVal === 'tons') ? 'ton' : 'lb';
          return {
            code: codeVal,
            name: nameVal || codeVal,
            category: catVal || 'General',
            unit: finalUnit,
            newBuyPrice: !isNaN(buyPrice) ? buyPrice : 0,
            newSalePrice: !isNaN(salePrice) ? salePrice : 0,
            isNew: true,
            hasDiff: true,
            status: 'create'
          };
        } else {
          return {
            code: codeVal,
            name: nameVal || codeVal,
            category: 'General',
            unit: 'lb',
            newBuyPrice: !isNaN(buyPrice) ? buyPrice : 0,
            newSalePrice: !isNaN(salePrice) ? salePrice : 0,
            isNew: false,
            hasDiff: false,
            status: 'ignored'
          };
        }
      }).filter(Boolean);

      setPreviewItems(items);
    } else {
      setPreviewItems(null);
    }
  }, [rawParsedRows, mappedCode, mappedBuy, mappedSale, mappedName, mappedCategory, mappedUnit, isSeedingMode, materials]);

  const revertToSnapshot = async (snapshot: PricingSnapshot) => {
    if (!confirmRevert || confirmRevert.id !== snapshot.id) {
      setConfirmRevert(snapshot);
      return;
    }
    
    setLoading(true);
    setConfirmRevert(null);
    try {
      // Create a snapshot of current state before reverting
      await createSnapshot('manual');

      const batch = writeBatch(db);
      snapshot.prices.forEach(p => {
        batch.update(doc(db, 'materials', p.materialId), {
          buyPrice: p.buyPrice,
          salePrice: p.salePrice,
          updatedAt: new Date().toISOString(),
          updatedBy: profile?.displayName || profile?.email || 'System',
          updatedByUid: profile?.uid || 'system'
        });
      });

      await batch.commit();
      firestore('Prices Reverted', `Successfully reverted all prices in Cloud Firestore to snapshot from ${new Date(snapshot.timestamp).toLocaleString()}.`);
      setSyncStatus({ type: 'success', message: 'Successfully reverted to previous pricing!' });
      setShowHistory(false);
    } catch (error: any) {
      console.error('Revert error:', error);
      toastError('Revert Failed', `Failed to revert pricing: ${error.message || error}`);
      setSyncStatus({ type: 'error', message: 'Failed to revert pricing.' });
    } finally {
      setLoading(false);
    }
  };

  const handleBatchUpdate = async () => {
    const percent = parseFloat(batchPercent);
    if (isNaN(percent) || percent === 0) return;
    
    if (!confirmBatch) {
      setConfirmBatch(true);
      return;
    }

    setApplyingBatch(true);
    setSyncStatus(null);
    setConfirmBatch(false);

    try {
      // Create snapshot before batch update
      await createSnapshot('manual');

      const filtered = materials.filter(m => batchCategory === 'All' || getCanonicalCategory(m.category) === batchCategory);
      const batch = writeBatch(db);
      let count = 0;

      filtered.forEach(material => {
        const updates: any = {
          updatedAt: new Date().toISOString()
        };

        const multiplier = 1 + (percent / 100);

        if (batchType === 'buy' || batchType === 'both') {
          updates.buyPrice = Number((material.buyPrice * multiplier).toFixed(2));
        }
        if (batchType === 'sale' || batchType === 'both') {
          updates.salePrice = Number((material.salePrice * multiplier).toFixed(2));
        }

        batch.update(doc(db, 'materials', material.id), updates);
        count++;
      });

      if (count > 0) {
        await batch.commit();
        firestore('Batch Adjustment Applied', `Successfully adjusted prices for ${count} materials by ${percent}% in Cloud Firestore.`);
        setSyncStatus({ type: 'success', message: `Successfully updated ${count} materials by ${percent}%!` });
        setBatchPercent('');
      } else {
        info('No Materials Adjusted', 'No materials were found matching the selected category.');
        setSyncStatus({ type: 'error', message: 'No materials found in the selected category.' });
      }
    } catch (error: any) {
      console.error('Batch update error:', error);
      toastError('Adjustment Failed', `Failed to apply batch adjustment: ${error.message || error}`);
      setSyncStatus({ type: 'error', message: 'Failed to apply batch adjustment.' });
    } finally {
      setApplyingBatch(false);
    }
  };

  const handleUpdatePin = async () => {
    if (!profile || newPin.length !== 4) return;
    setUpdatingPin(true);
    setSyncStatus(null);
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        managerPin: newPin
      });
      setSyncStatus({ type: 'success', message: 'Manager PIN updated successfully!' });
    } catch (error) {
      console.error('Error updating PIN:', error);
      setSyncStatus({ type: 'error', message: 'Failed to update PIN.' });
    } finally {
      setUpdatingPin(false);
    }
  };

  const seedMaterials = async () => {
    setSeeding(true);
    const initialMaterials = [
      { code: '1', name: 'Aluminum Cans', category: 'Aluminum', buyPrice: 0.50, salePrice: 0.70, unit: 'lb' },
      { code: '2', name: 'Bare Bright Copper', category: 'Copper', buyPrice: 3.80, salePrice: 4.20, unit: 'lb' },
      { code: '3', name: '#1 Copper', category: 'Copper', buyPrice: 3.60, salePrice: 4.00, unit: 'lb' },
      { code: '4', name: '#2 Copper', category: 'Copper', buyPrice: 3.50, salePrice: 3.90, unit: 'lb' },
      { code: '5', name: 'Clean Sheet Copper', category: 'Copper', buyPrice: 3.45, salePrice: 3.85, unit: 'lb' },
      { code: '6', name: '#1 Insulated 70%', category: 'Copper', buyPrice: 2.30, salePrice: 2.70, unit: 'lb' },
      { code: '7', name: '#2 Insulated 50%', category: 'Copper', buyPrice: 1.35, salePrice: 1.75, unit: 'lb' },
      { code: '8', name: 'Clean Yellow Brass', category: 'Brass', buyPrice: 2.00, salePrice: 2.40, unit: 'lb' },
    ];

    try {
      for (const mat of initialMaterials) {
        // Check if code already exists to avoid duplicates
        if (!materials.some(m => m.code === mat.code)) {
          await addDoc(collection(db, 'materials'), {
            ...mat,
            updatedAt: new Date().toISOString()
          });
        }
      }
    } catch (error) {
      console.error('Error seeding materials:', error);
    } finally {
      setSeeding(false);
    }
  };

  const handleDeleteAllMaterials = async () => {
    if (deleteAllConfirmText.trim().toUpperCase() !== 'DELETE ALL') return;
    setDeletingAll(true);
    
    try {
      // Create a batch
      let batch = writeBatch(db);
      let count = 0;
      const originalMaterials = [...materials];
      
      for (const m of originalMaterials) {
        batch.delete(doc(db, 'materials', m.id));
        count++;
        
        // Ensure we are well within the 500 document limit for Firestore batches
        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      
      if (count > 0) {
        await batch.commit();
      }

      // Log the batch delete event
      await logAuditEvent(
        'material',
        'ALL',
        'delete',
        { before: originalMaterials, after: [] },
        `Batch deleted all ${originalMaterials.length} material records for system restart`
      );

      setSyncStatus({ type: 'success', message: `All ${originalMaterials.length} material records deleted successfully.` });
      setShowDeleteAllModal(false);
      setDeleteAllConfirmText('');
    } catch (error: any) {
      console.error('Error batch deleting materials:', error);
      handleFirestoreError(error, OperationType.DELETE, 'materials');
      setSyncStatus({ type: 'error', message: `Batch delete failed: ${error.message || error}` });
    } finally {
      setDeletingAll(false);
    }
  };

  const handleUpdateMaterial = async (id: string) => {
    if (Object.keys(editForm).length === 0) return;
    
    const oldMaterial = materials.find(m => m.id === id);
    
    try {
      const finalUpdates = { ...editForm };
      if (finalUpdates.category) {
        finalUpdates.category = getCanonicalCategory(finalUpdates.category);
      }
      await updateDoc(doc(db, 'materials', id), {
        ...finalUpdates,
        updatedAt: new Date().toISOString(),
        updatedBy: profile?.displayName || profile?.email || 'System',
        updatedByUid: profile?.uid || 'system'
      });

      // Log the change
      if (oldMaterial) {
        await logAuditEvent(
          'material',
          id,
          'update',
          {
            before: {
              code: oldMaterial.code,
              name: oldMaterial.name,
              buyPrice: oldMaterial.buyPrice,
              salePrice: oldMaterial.salePrice
            },
            after: {
              code: editForm.code,
              name: editForm.name,
              buyPrice: editForm.buyPrice,
              salePrice: editForm.salePrice
            }
          },
          `Manual price update for ${oldMaterial.name}`
        );
      }

      firestore(
        'Material Updated',
        `Successfully committed updates for "${editForm.name || oldMaterial?.name || 'Material'}" to Cloud Firestore.`
      );

      setIsEditing(null);
      setEditForm({});
    } catch (error: any) {
      console.error('Error updating material:', error);
      toastError('Update Failed', `Failed to commit material update: ${error.message || error}`);
    }
  };

  const handleAddMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingMaterial(true);
    setAddStatus(null);

    const formData = new FormData(e.target as HTMLFormElement);
    const code = (formData.get('code') as string).toUpperCase().trim();
    const name = (formData.get('name') as string).trim();
    const category = formData.get('category') as string;
    const description = (formData.get('description') as string).trim();
    const buyPrice = Number(formData.get('buyPrice'));
    const salePrice = Number(formData.get('salePrice'));
    const unit = formData.get('unit') as 'lb' | 'ton';

    // Duplicate check
    const isDuplicate = materials.some(m => m.code === code);
    if (isDuplicate) {
      setAddStatus({ type: 'error', message: `Material code "${code}" already exists.` });
      toastError('Duplicate Material', `Material code "${code}" already exists in local database.`);
      setAddingMaterial(false);
      return;
    }

    const newMaterial = {
      code,
      name,
      category: getCanonicalCategory(category),
      description,
      buyPrice,
      salePrice,
      unit,
      updatedAt: new Date().toISOString(),
      updatedBy: profile?.displayName || profile?.email || 'System',
      updatedByUid: profile?.uid || 'system'
    };

    try {
      const docRef = await addDoc(collection(db, 'materials'), newMaterial);
      
      // Log creation
      await logAuditEvent(
        'material',
        docRef.id,
        'create',
        { after: newMaterial },
        `New material created: ${name}`
      );

      firestore(
        'Material Created',
        `Successfully created material "${name}" and committed to Cloud Firestore.`
      );

      setAddStatus({ type: 'success', message: `Material "${name}" added successfully.` });
      
      // Auto-close modal after success delay
      setTimeout(() => {
        setShowAddModal(false);
        setAddStatus(null);
      }, 1500);
    } catch (error: any) {
      handleFirestoreError(error, OperationType.CREATE, 'materials');
      toastError('Creation Failed', `Failed to add material to Firestore: ${error.message || error}`);
      setAddStatus({ type: 'error', message: 'Failed to add material. Please try again.' });
    } finally {
      setAddingMaterial(false);
    }
  };

  const analyzePrice = async (material: Material) => {
    setAnalyzing(material.id);
    try {
      const response = await fetch('/api/analyze-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialName: material.name,
          category: material.category,
          currentPrice: material.buyPrice,
          unit: material.unit
        })
      });

      if (!response.ok) throw new Error('AI Analysis failed');
      
      const result = await response.json();
      setAiAnalysis(prev => ({ ...prev, [material.id]: result }));
    } catch (error) {
      console.error('AI Analysis failed:', error);
    } finally {
      setAnalyzing(null);
    }
  };

  const categoryCasingMap = useMemo(() => {
    const map: Record<string, string> = {};
    materials.forEach(m => {
      const cat = (m.category || '').trim();
      if (!cat) return;
      const lower = cat.toLowerCase();
      if (!map[lower]) {
        map[lower] = cat;
      } else {
        const currentUpperCount = (map[lower].match(/[A-Z]/g) || []).length;
        const newUpperCount = (cat.match(/[A-Z]/g) || []).length;
        if (newUpperCount > currentUpperCount) {
          map[lower] = cat;
        }
      }
    });
    return map;
  }, [materials]);

  const getCanonicalCategory = useCallback((cat: string) => {
    if (!cat) return 'General';
    const lower = cat.trim().toLowerCase();
    return categoryCasingMap[lower] || cat.trim();
  }, [categoryCasingMap]);

  const filteredMaterials = materials.filter(m => 
    m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.category.toLowerCase().includes(searchQuery.toLowerCase())
  ).sort((a, b) => {
    const search = searchQuery.toLowerCase();
    const aCode = a.code.toLowerCase();
    const bCode = b.code.toLowerCase();
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();

    if (aCode === search && bCode !== search) return -1;
    if (bCode === search && aCode !== search) return 1;
    if (aCode.startsWith(search) && !bCode.startsWith(search)) return -1;
    if (bCode.startsWith(search) && !aCode.startsWith(search)) return 1;
    if (aName.startsWith(search) && !bName.startsWith(search)) return -1;
    if (bName.startsWith(search) && !aName.startsWith(search)) return 1;
    return aCode.localeCompare(bCode, undefined, { numeric: true, sensitivity: 'base' });
  });

  const categories = useMemo(() => {
    return ['All', ...new Set(materials.map(m => getCanonicalCategory(m.category)))];
  }, [materials, getCanonicalCategory]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (profile?.role !== 'manager' || !profile?.permissions?.canManagePrices) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8">
        <div className="p-6 bg-red-50 rounded-full text-red-600 mb-6">
          <Lock className="w-12 h-12" />
        </div>
        <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Access Restricted</h2>
        <p className="text-slate-500 mt-2 max-w-md">You do not have the required permissions to manage material prices. Please contact your system administrator.</p>
      </div>
    );
  }

  return (
    <main className="space-y-6">
      {/* Confirmation Modals */}
      {confirmOptimize && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-amber-50 rounded-2xl">
                <AlertCircle className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Confirm Archive</h3>
                <p className="text-slate-500 font-medium">
                  This will permanently remove transaction photos for tickets older than {retentionDays} days to comply with Ohio Dept of State regulations while saving storage space. Text records will be preserved.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setConfirmOptimize(false)}
                className="flex-1 px-6 py-3 bg-slate-100 text-slate-600 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={() => optimizeStorage(true)}
                className="flex-1 px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl shadow-slate-200"
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manager PIN, Sync & Batch Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        {/* PIN Management */}
        <section className="bg-slate-900 rounded-2xl p-6 text-white shadow-xl shadow-slate-900/20 border border-slate-800 flex flex-col justify-between" aria-label="Manager PIN Management">
          <div className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-400" aria-hidden="true" />
                Manager PIN
              </h2>
              <p className="text-slate-400 text-sm">Required for price overrides.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="manager-pin" className="sr-only">4-digit Manager PIN</label>
              <input
                id="manager-pin"
                type="password"
                maxLength={4}
                placeholder="PIN"
                className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-center font-black tracking-[0.5em] flex-1 min-w-[100px] focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
              />
              <button
                onClick={handleUpdatePin}
                disabled={updatingPin || newPin.length !== 4}
                aria-label="Update Manager PIN"
                className="px-4 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 shrink-0"
              >
                {updatingPin ? '...' : 'Update'}
              </button>
            </div>
          </div>
        </section>

        {/* Data Retention & Storage Optimization */}
        <section className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-between" aria-label="Data Retention & Storage Optimization">
          <div className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-xl font-bold flex items-center gap-2 text-slate-900">
                <History className="w-5 h-5 text-blue-600" aria-hidden="true" />
                Storage Optimizer
              </h2>
              <p className="text-slate-500 text-sm">Comply with Ohio ORC 4737.04.</p>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="retention-days" className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Retention (Days)</label>
                <input 
                  id="retention-days"
                  type="number" 
                  className="w-16 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-right outline-none focus:ring-2 focus:ring-blue-500"
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(parseInt(e.target.value) || 365)}
                />
              </div>
              <button
                onClick={() => optimizeStorage()}
                disabled={optimizing}
                className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
              >
                {optimizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                Archive Photos
              </button>
              {optimizationStats && (
                <p className="text-[10px] text-green-600 font-bold text-center animate-in fade-in slide-in-from-top-1">
                  Archived {optimizationStats.count} tickets.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Google Sheets Sync */}
        <section className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-between" aria-label="Google Sheets Sync">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h2 className="text-xl font-bold flex items-center gap-2 text-slate-900">
                  <FileSpreadsheet className="w-5 h-5 text-green-600" aria-hidden="true" />
                  Google Sync
                </h2>
                <p className="text-slate-500 text-sm">Import from public Sheet.</p>
              </div>
              <button
                onClick={() => setShowHistory(!showHistory)}
                aria-label={showHistory ? "Hide Pricing History" : "Show Pricing History"}
                className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                title="Pricing History"
              >
                <History className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="sheet-id" className="sr-only">Google Sheet ID</label>
              <input
                id="sheet-id"
                type="text"
                placeholder="Sheet ID or URL"
                className="flex-1 min-w-[120px] px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-green-500 outline-none transition-all text-sm"
                value={sheetId}
                onChange={(e) => setSheetId(e.target.value)}
              />
              <button
                onClick={syncWithGoogleSheets}
                disabled={syncing || !sheetId}
                aria-label="Sync with Google Sheets"
                className="px-4 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 shrink-0"
              >
                {syncing ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="w-4 h-4" aria-hidden="true" />}
                {isSeedingMode ? 'Seed' : 'Sync'}
              </button>
            </div>

            <div className="flex items-center gap-2 px-1">
              <button
                onClick={() => setIsSeedingMode(!isSeedingMode)}
                className={cn(
                  "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2",
                  isSeedingMode ? "bg-green-600" : "bg-slate-200"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-3 w-3 transform rounded-full bg-white transition-transform",
                    isSeedingMode ? "translate-x-5" : "translate-x-1"
                  )}
                />
              </button>
              <span className="text-xs font-bold text-slate-600">
                Seeding Mode {isSeedingMode ? '(Create New Materials)' : '(Update Prices Only)'}
              </span>
            </div>

            {syncStatus && (
              <div className={cn(
                "p-3 rounded-xl flex items-start gap-2 animate-in fade-in slide-in-from-top-2",
                syncStatus.type === 'success' ? "bg-green-50 text-green-700 border border-green-100" : "bg-red-50 text-red-700 border border-red-100"
              )}>
                {syncStatus.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                <p className="text-xs font-medium leading-tight">{syncStatus.message}</p>
              </div>
            )}
            
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
              <p className="text-[9px] text-amber-800 font-bold leading-tight">
                <span className="text-amber-900 uppercase tracking-widest block mb-1">How to Sync:</span>
                1. Go to your Google Sheet<br/>
                2. File &gt; Share &gt; <span className="underline">Publish to web</span><br/>
                3. Select "Entire Document" and "Comma-separated values (.csv)"<br/>
                4. Click Publish and paste the link above.
              </p>
            </div>

            {debugRows && (
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Debug Data (What the app sees)</span>
                  <button onClick={() => setDebugRows(null)} className="text-slate-500 hover:text-white">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <div className="overflow-x-auto max-h-32 scrollbar-thin scrollbar-thumb-slate-700">
                  <table className="w-full text-[9px] text-slate-300 font-mono">
                    <tbody>
                      {debugRows.map((row, i) => (
                        <tr key={i} className={i === 0 ? "bg-slate-800/50" : ""}>
                          {row.map((cell, j) => (
                            <td key={j} className="px-1 py-0.5 border border-slate-800 whitespace-nowrap">
                              {cell || <span className="text-slate-600">empty</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Batch Adjustment */}
        <section className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-between" aria-label="Batch Price Adjustment">
          <div className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-xl font-bold flex items-center gap-2 text-slate-900">
                <TrendingUp className="w-5 h-5 text-purple-600" aria-hidden="true" />
                Batch Adjustment
              </h2>
              <p className="text-slate-500 text-sm">Adjust prices by %.</p>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <label htmlFor="batch-category" className="sr-only">Select Category</label>
              <select 
                id="batch-category"
                className="px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold outline-none focus:ring-2 focus:ring-purple-500"
                value={batchCategory}
                onChange={(e) => setBatchCategory(e.target.value)}
              >
                {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
              <label htmlFor="batch-type" className="sr-only">Select Price Type</label>
              <select 
                id="batch-type"
                className="px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold outline-none focus:ring-2 focus:ring-purple-500"
                value={batchType}
                onChange={(e) => setBatchType(e.target.value as any)}
              >
                <option value="buy">Buy Price</option>
                <option value="sale">Sale Price</option>
                <option value="both">Both</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[80px]">
                <input
                  type="number"
                  step="0.01"
                  placeholder="e.g. +5"
                  className="w-full pl-3 pr-7 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none transition-all text-sm font-bold"
                  value={batchPercent}
                  onChange={(e) => setBatchPercent(e.target.value)}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">%</span>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={handleBatchUpdate}
                  disabled={applyingBatch || !batchPercent}
                  className={cn(
                    "px-4 py-3 rounded-xl font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-sm",
                    confirmBatch ? "bg-red-600 text-white hover:bg-red-700" : "bg-purple-600 text-white hover:bg-purple-700"
                  )}
                >
                  {applyingBatch ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <TrendingUp className="w-4 h-4" />
                  )}
                  {confirmBatch ? 'Confirm' : 'Apply'}
                </button>
                {confirmBatch && (
                  <button 
                    onClick={() => setConfirmBatch(false)}
                    className="p-3 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      {syncStatus && (
        <div className={cn(
          "flex items-center gap-2 p-4 rounded-2xl text-sm font-bold animate-in fade-in slide-in-from-top-2 shadow-lg",
          syncStatus.type === 'success' ? "bg-green-600 text-white" : "bg-red-600 text-white"
        )}>
          {syncStatus.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          {syncStatus.message}
          <button onClick={() => setSyncStatus(null)} className="ml-auto p-1 hover:bg-white/20 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Pricing History Modal/Overlay */}
      {showHistory && (
        <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 animate-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-slate-900 flex items-center gap-2">
              <History className="w-5 h-5 text-blue-600" />
              Pricing History & Revert
            </h3>
            <button onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-slate-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {snapshots.map((snapshot) => (
              <div key={snapshot.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{new Date(snapshot.timestamp).toLocaleDateString()}</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase">
                      {new Date(snapshot.timestamp).toLocaleTimeString()}
                      {snapshot.createdBy && ` • ${snapshot.createdBy}`}
                    </p>
                  </div>
                  <span className={cn(
                    "px-2 py-1 rounded text-[10px] font-bold uppercase",
                    snapshot.source === 'google_sheets' ? "bg-green-50 text-green-600" : "bg-blue-50 text-blue-600"
                  )}>
                    {snapshot.source.replace('_', ' ')}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  <p>By: {snapshot.createdBy}</p>
                  <p>{snapshot.prices.length} materials tracked</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => revertToSnapshot(snapshot)}
                    className={cn(
                      "flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2",
                      confirmRevert?.id === snapshot.id 
                        ? "bg-red-600 text-white hover:bg-red-700" 
                        : "bg-slate-900 text-white hover:bg-slate-800"
                    )}
                  >
                    <RotateCcw className="w-3 h-3" />
                    {confirmRevert?.id === snapshot.id ? 'Confirm Revert?' : 'Revert to this state'}
                  </button>
                  {confirmRevert?.id === snapshot.id && (
                    <button 
                      onClick={() => setConfirmRevert(null)}
                      className="px-3 py-2 border border-slate-200 rounded-lg text-slate-400 hover:bg-slate-50"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {snapshots.length === 0 && (
              <div className="col-span-full py-12 text-center text-slate-400 italic">
                No pricing snapshots found yet.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight font-display">Manage Prices</h1>
          <p className="text-slate-500 font-medium mt-1">Update buy and sale prices across the system.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {materials.length > 0 && (
            <button
              onClick={() => {
                setDeleteAllConfirmText('');
                setShowDeleteAllModal(true);
              }}
              className="px-4 py-3 bg-red-50 text-red-700 rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-red-100 transition-all border border-red-200 active:scale-95 shrink-0"
              title="Delete All Materials"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear All Materials
            </button>
          )}
          <button
            onClick={seedMaterials}
            disabled={seeding}
            className="px-4 py-3 bg-slate-100 text-slate-700 rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-slate-200 transition-all border border-slate-200 disabled:opacity-50 active:scale-95 shrink-0"
          >
            {seeding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            Seed Data
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-6 py-3 bg-blue-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 active:scale-95 shrink-0"
          >
            <Plus className="w-4 h-4" />
            Add Material
          </button>
        </div>
      </div>

      <div className="relative group max-w-2xl">
        <label htmlFor="material-search" className="sr-only">Search materials or categories</label>
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-blue-500 transition-colors" aria-hidden="true" />
        <input
          id="material-search"
          type="text"
          placeholder="Search materials or categories..."
          className="w-full pl-14 pr-6 py-4 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-medium shadow-sm transition-all text-lg"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6" aria-label="Materials List">
        {filteredMaterials.map((material) => (
          <article key={material.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                {isEditing === material.id ? (
                  <div className="flex flex-col shrink-0">
                    <label htmlFor={`edit-code-${material.id}`} className="sr-only">Edit Code</label>
                    <input
                      id={`edit-code-${material.id}`}
                      type="text"
                      className="w-14 px-2 py-2 border border-slate-200 rounded-lg font-bold text-center uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm"
                      value={editForm.code}
                      onChange={(e) => setEditForm(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                    />
                  </div>
                ) : (
                  <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center font-bold text-slate-600 border border-slate-200 shrink-0" aria-label={`Material code: ${material.code}`}>
                    {material.code}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  {isEditing === material.id ? (
                    <div className="space-y-2">
                      <div className="flex flex-col">
                        <label htmlFor={`edit-name-${material.id}`} className="sr-only">Edit Name</label>
                        <input
                          id={`edit-name-${material.id}`}
                          type="text"
                          placeholder="Material Name"
                          className="w-full px-2 py-1 border border-slate-200 rounded-lg font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm"
                          value={editForm.name}
                          onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                        />
                      </div>
                      <div className="flex flex-col">
                        <label htmlFor={`edit-category-${material.id}`} className="sr-only">Edit Category</label>
                        <input
                          id={`edit-category-${material.id}`}
                          type="text"
                          placeholder="Category"
                          className="w-full px-2 py-1 border border-slate-200 rounded-lg text-[10px] font-black text-slate-400 uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                          value={editForm.category}
                          onChange={(e) => setEditForm(prev => ({ ...prev, category: e.target.value }))}
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <h3 className="font-bold text-slate-900 truncate">{material.name}</h3>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">{getCanonicalCategory(material.category)}</span>
                        {material.updatedBy && (
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1 leading-none">
                            <span className="opacity-30">•</span>
                            <span className="text-blue-500/70">{material.updatedBy}</span>
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => analyzePrice(material)}
                  disabled={analyzing === material.id}
                  className="w-11 h-11 flex items-center justify-center text-blue-600 hover:bg-blue-50 rounded-xl transition-all disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:scale-95"
                  title="AI Price Analysis"
                  aria-label={`AI Price Analysis for ${material.name}`}
                >
                  {analyzing === material.id ? (
                    <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <TrendingUp className="w-5 h-5" aria-hidden="true" />
                  )}
                </button>
                <button
                  onClick={() => {
                    setIsEditing(material.id);
                    setEditForm(material);
                  }}
                  className="w-11 h-11 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:scale-95"
                  aria-label={`Edit ${material.name}`}
                >
                  <Edit2 className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="p-5 grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500 uppercase">Buy Price</p>
                {isEditing === material.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400" aria-hidden="true">$</span>
                    <label htmlFor={`buy-price-${material.id}`} className="sr-only">Edit Buy Price</label>
                    <input
                      id={`buy-price-${material.id}`}
                      type="number"
                      step="0.01"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm"
                      value={editForm.buyPrice}
                      onChange={(e) => setEditForm(prev => ({ ...prev, buyPrice: Number(e.target.value) }))}
                    />
                  </div>
                ) : (
                  <p className="text-xl font-bold text-slate-900">
                    ${material.buyPrice.toFixed(2)}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500 uppercase">Sale Price</p>
                {isEditing === material.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400" aria-hidden="true">$</span>
                    <label htmlFor={`sale-price-${material.id}`} className="sr-only">Edit Sale Price</label>
                    <input
                      id={`sale-price-${material.id}`}
                      type="number"
                      step="0.01"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm"
                      value={editForm.salePrice}
                      onChange={(e) => setEditForm(prev => ({ ...prev, salePrice: Number(e.target.value) }))}
                    />
                  </div>
                ) : (
                  <p className="text-xl font-bold text-slate-900">
                    ${material.salePrice.toFixed(2)}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500 uppercase">Unit</p>
                {isEditing === material.id ? (
                  <select
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm"
                    value={editForm.unit}
                    onChange={(e) => setEditForm(prev => ({ ...prev, unit: e.target.value as 'lb' | 'ton' }))}
                  >
                    <option value="lb">lb</option>
                    <option value="ton">ton</option>
                  </select>
                ) : (
                  <p className="text-xl font-bold text-slate-900 uppercase">{material.unit}</p>
                )}
              </div>
            </div>

            {isEditing === material.id ? (
              <div className="px-5 pb-4 space-y-1">
                <p className="text-xs font-medium text-slate-500 uppercase">Description / Notes</p>
                <textarea
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-sm resize-none"
                  rows={2}
                  value={editForm.description || ''}
                  onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Material description..."
                />
              </div>
            ) : material.description && (
              <div className="px-5 pb-4">
                <p className="text-xs text-slate-500 italic">{material.description}</p>
              </div>
            )}

            {isEditing === material.id && (
              <div className="px-5 pb-5 flex gap-2">
                <button
                  onClick={() => handleUpdateMaterial(material.id)}
                  className="flex-1 bg-blue-600 text-white py-3 rounded-xl text-sm font-bold hover:bg-blue-700 transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                >
                  Save Changes
                </button>
                <button
                  onClick={() => setIsEditing(null)}
                  className="px-6 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                >
                  Cancel
                </button>
              </div>
            )}

            {aiAnalysis[material.id] && (
              <div className="mx-5 mb-5 p-4 bg-slate-50 rounded-lg border border-slate-100 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-sm text-slate-900">
                    {aiAnalysis[material.id].trend === 'up' && <TrendingUp className="w-4 h-4 text-green-600" />}
                    {aiAnalysis[material.id].trend === 'down' && <TrendingDown className="w-4 h-4 text-red-600" />}
                    {aiAnalysis[material.id].trend === 'flat' && <Minus className="w-4 h-4 text-slate-600" />}
                    AI Suggestion: ${aiAnalysis[material.id].suggestedPrice.toFixed(2)}
                  </div>
                  <button 
                    onClick={() => setAiAnalysis(prev => {
                      const next = { ...prev };
                      delete next[material.id];
                      return next;
                    })}
                    className="p-2 text-slate-400 hover:text-slate-600 rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                    aria-label="Dismiss analysis"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {aiAnalysis[material.id].reasoning}
                </p>
                <button
                  onClick={() => {
                    setEditForm({ ...material, buyPrice: aiAnalysis[material.id].suggestedPrice });
                    setIsEditing(material.id);
                  }}
                  className="text-xs font-bold text-blue-600 hover:underline outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded px-1"
                >
                  Apply Suggestion
                </button>
              </div>
            )}
          </article>
        ))}
      </section>

      {showPreviewModal && (
        <div 
          className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-sync-title"
        >
          <div className="bg-white rounded-[2rem] w-full max-w-5xl h-[85vh] flex flex-col p-6 sm:p-8 shadow-2xl animate-in zoom-in-95 duration-200 relative overflow-hidden">
            <button 
              onClick={() => {
                setShowPreviewModal(false);
                setRawParsedRows([]);
                setPreviewItems(null);
              }}
              className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
              aria-label="Close sync preview"
              disabled={committingSync}
            >
              <X className="w-6 h-6" aria-hidden="true" />
            </button>

            <div className="flex flex-col h-full space-y-6">
              <div>
                <h2 id="preview-sync-title" className="text-2xl font-black text-slate-900 tracking-tight font-display flex items-center gap-2">
                  <FileSpreadsheet className="w-6 h-6 text-green-600" />
                  Sync Pricing Preview
                </h2>
                <p className="text-slate-500 font-medium text-xs mt-1">
                  Preview current system prices vs. incoming sheet prices before committing changes.
                </p>
              </div>

              {/* Stats Panel */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-50 border border-slate-100 p-3 rounded-2xl">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Parsed</p>
                  <p className="text-xl font-black text-slate-800">{previewItems?.length || 0} rows</p>
                </div>
                <div className="bg-indigo-50 border border-indigo-100/50 p-3 rounded-2xl">
                  <p className="text-[10px] font-bold text-indigo-505 uppercase tracking-wider block">Price Updates</p>
                  <p className="text-xl font-black text-indigo-700">
                    {previewItems?.filter(i => i.status === 'update').length || 0} items
                  </p>
                </div>
                <div className="bg-emerald-50 border border-emerald-100/50 p-3 rounded-2xl">
                  <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">New Materials</p>
                  <p className="text-xl font-black text-emerald-700">
                    {previewItems?.filter(i => i.status === 'create').length || 0} items
                  </p>
                </div>
                <div className="bg-slate-50 border border-slate-100 p-3 rounded-2xl">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">No Change/Ignored</p>
                  <p className="text-xl font-black text-slate-600">
                    {previewItems?.filter(i => i.status === 'unchanged' || i.status === 'ignored').length || 0} items
                  </p>
                </div>
              </div>

              {/* Column Override drop-downs (details expandable) */}
              <details className="group bg-slate-50/50 border border-slate-200/60 rounded-2xl p-4 cursor-pointer">
                <summary className="font-bold text-sm text-slate-700 select-none flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-slate-500" />
                    Advanced Column Mapping Overrides
                  </span>
                  <span className="text-xs text-blue-600 group-open:hidden">Show settings</span>
                  <span className="text-xs text-slate-500 hidden group-open:inline">Hide settings</span>
                </summary>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-4 text-xs cursor-default">
                  <div className="space-y-1">
                    <label id="map-code-lbl" className="font-bold text-slate-500 block">Code Column *</label>
                    <select 
                      aria-labelledby="map-code-lbl"
                      className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-1 focus:ring-blue-500"
                      value={mappedCode}
                      onChange={(e) => setMappedCode(e.target.value)}
                    >
                      {headersList.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label id="map-buy-lbl" className="font-bold text-slate-500 block">Buy Price Column</label>
                    <select 
                      aria-labelledby="map-buy-lbl"
                      className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-1 focus:ring-blue-500"
                      value={mappedBuy}
                      onChange={(e) => setMappedBuy(e.target.value)}
                    >
                      <option value="">-- Choose Column --</option>
                      {headersList.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label id="map-sale-lbl" className="font-bold text-slate-500 block">Sale Price Column</label>
                    <select 
                      aria-labelledby="map-sale-lbl"
                      className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-1 focus:ring-blue-500"
                      value={mappedSale}
                      onChange={(e) => setMappedSale(e.target.value)}
                    >
                      <option value="">-- Choose Column --</option>
                      {headersList.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  {isSeedingMode && (
                    <>
                      <div className="space-y-1">
                        <label id="map-name-lbl" className="font-bold text-slate-500 block">Material Name Column</label>
                        <select 
                          aria-labelledby="map-name-lbl"
                          className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-1 focus:ring-blue-500"
                          value={mappedName}
                          onChange={(e) => setMappedName(e.target.value)}
                        >
                          <option value="">-- Choose Column --</option>
                          {headersList.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label id="map-cat-lbl" className="font-bold text-slate-500 block">Category Column</label>
                        <select 
                          aria-labelledby="map-cat-lbl"
                          className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-1 focus:ring-blue-500"
                          value={mappedCategory}
                          onChange={(e) => setMappedCategory(e.target.value)}
                        >
                          <option value="">-- Choose Column --</option>
                          {headersList.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label id="map-unit-lbl" className="font-bold text-slate-500 block">Unit Column</label>
                        <select 
                          aria-labelledby="map-unit-lbl"
                          className="w-full p-2 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-1 focus:ring-blue-500"
                          value={mappedUnit}
                          onChange={(e) => setMappedUnit(e.target.value)}
                        >
                          <option value="">-- Choose Column --</option>
                          {headersList.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    </>
                  )}
                </div>
              </details>

              {/* Scrollable list/table of pricing updates */}
              <div className="flex-1 overflow-y-auto border border-slate-200 rounded-2xl">
                <table className="w-full border-collapse text-left text-sm" role="table">
                  <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200 font-bold text-slate-600 text-xs uppercase" role="rowgroup">
                    <tr role="row">
                      <th scope="col" className="p-4">Material</th>
                      <th scope="col" className="p-4 text-center">Unit</th>
                      <th scope="col" className="p-4 text-right">Buy Price Change</th>
                      <th scope="col" className="p-4 text-right">Sale Price Change</th>
                      <th scope="col" className="p-4 text-center">Action Summary</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium" role="rowgroup">
                    {previewItems?.map((item: any, idx) => (
                      <tr 
                        key={`${item.code}-${idx}`} 
                        role="row"
                        className={cn(
                          "hover:bg-slate-50/50 transition-colors",
                          item.status === 'create' ? "bg-emerald-50/15" : "",
                          item.status === 'update' ? "bg-indigo-50/10" : ""
                        )}
                      >
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 bg-slate-100 rounded text-xs font-black text-slate-600 block shrink-0">{item.code}</span>
                            <span className="text-slate-900 font-semibold truncate block max-w-sm">{item.name}</span>
                          </div>
                          {isSeedingMode && item.isNew && (
                            <span className="text-[10px] block text-emerald-600 ml-11 font-bold">Category: {item.category}</span>
                          )}
                        </td>
                        <td className="p-4 text-center text-slate-600 uppercase font-bold text-xs">{item.unit}</td>
                        <td className="p-4 text-right text-slate-900">
                          {item.status === 'create' ? (
                            <span className="text-emerald-600 font-bold">${item.newBuyPrice.toFixed(2)}</span>
                          ) : item.status === 'update' && item.currentBuyPrice !== item.newBuyPrice ? (
                            <div className="flex flex-col items-end">
                              <span className="text-xs text-slate-400 line-through">${item.currentBuyPrice?.toFixed(2)}</span>
                              <span className="text-indigo-600 font-bold">${item.newBuyPrice.toFixed(2)}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">${item.newBuyPrice.toFixed(2)}</span>
                          )}
                        </td>
                        <td className="p-4 text-right text-slate-900">
                          {item.status === 'create' ? (
                            <span className="text-emerald-600 font-bold">${item.newSalePrice.toFixed(2)}</span>
                          ) : item.status === 'update' && item.currentSalePrice !== item.newSalePrice ? (
                            <div className="flex flex-col items-end">
                              <span className="text-xs text-slate-400 line-through">${item.currentSalePrice?.toFixed(2)}</span>
                              <span className="text-indigo-600 font-bold">${item.newSalePrice.toFixed(2)}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">${item.newSalePrice.toFixed(2)}</span>
                          )}
                        </td>
                        <td className="p-4 text-center">
                          {item.status === 'update' ? (
                            <span className="inline-block px-3 py-1 bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-full text-[10px] font-black uppercase tracking-wider">
                              Update Price
                            </span>
                          ) : item.status === 'create' ? (
                            <span className="inline-block px-3 py-1 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-full text-[10px] font-black uppercase tracking-wider">
                              Create New
                            </span>
                          ) : item.status === 'ignored' ? (
                            <span className="inline-block px-3 py-1 bg-amber-50 border border-amber-100 text-amber-700 rounded-full text-[10px] font-black uppercase tracking-wider" title="Seeding mode is off: unrecognized material code">
                              Ignored (New)
                            </span>
                          ) : (
                            <span className="inline-block px-3 py-1 bg-slate-50 border border-slate-100 text-slate-400 rounded-full text-[10px] font-black uppercase tracking-wider">
                              Unchanged
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {rawParsedRows.length === 0 && (
                      <tr role="row">
                        <td colSpan={5} className="p-8 text-center text-slate-400">No rows are available to preview. Check your columns.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Action bar inside modal */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 border-t border-slate-100">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setIsSeedingMode(!isSeedingMode)}
                    className={cn(
                      "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500",
                      isSeedingMode ? "bg-green-600" : "bg-slate-200"
                    )}
                  >
                    <span className="sr-only">Toggle Seeding Mode</span>
                    <span
                      className={cn(
                        "inline-block h-3 w-3 transform rounded-full bg-white transition-transform",
                        isSeedingMode ? "translate-x-5" : "translate-x-1"
                      )}
                    />
                  </button>
                  <span className="text-xs font-bold text-slate-600">
                    Seeding Mode {isSeedingMode ? '(Allows creating new materials)' : '(Ignore unfamiliar codes)'}
                  </span>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button
                    onClick={() => {
                      setShowPreviewModal(false);
                      setRawParsedRows([]);
                      setPreviewItems(null);
                    }}
                    disabled={committingSync}
                    className="flex-1 sm:flex-initial px-6 py-3.5 border border-slate-200 text-slate-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-50 transition-all outline-none"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={commitSyncPreview}
                    disabled={committingSync || !previewItems || previewItems.length === 0}
                    className="flex-1 sm:flex-initial px-8 py-3.5 bg-green-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-green-700 transition-all shadow-xl shadow-green-150 flex items-center justify-center gap-2 outline-none"
                  >
                    {committingSync ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                    Confirm & Apply Sync
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddModal && (
        <div 
          className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-md overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-material-title"
        >
          <div className="bg-white rounded-[2.5rem] w-full max-w-lg p-10 shadow-2xl animate-in zoom-in-95 duration-200 relative">
            <button 
              onClick={() => {
                setShowAddModal(false);
                setAddStatus(null);
              }}
              className="absolute top-8 right-8 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              aria-label="Close modal"
              disabled={addingMaterial}
            >
              <X className="w-6 h-6" aria-hidden="true" />
            </button>

            <div className="space-y-8">
              <div>
                <h2 id="add-material-title" className="text-3xl font-black text-slate-900 tracking-tight font-display">Add New Material</h2>
                <p className="text-slate-500 font-medium mt-1">Define a new material for your inventory and pricing.</p>
              </div>

              {addStatus && (
                <div className={cn(
                  "p-4 rounded-2xl border flex items-center gap-3 animate-in fade-in slide-in-from-top-2",
                  addStatus.type === 'success' ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-red-50 border-red-100 text-red-800"
                )}>
                  {addStatus.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertCircle className="w-5 h-5 text-red-600" />}
                  <p className="text-sm font-bold">{addStatus.message}</p>
                </div>
              )}

              <form onSubmit={handleAddMaterial} className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <label htmlFor="new-code" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Code</label>
                    <div className="relative">
                      <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input 
                        id="new-code" 
                        name="code" 
                        required 
                        disabled={addingMaterial}
                        className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold uppercase placeholder:normal-case" 
                        placeholder="e.g. C1" 
                      />
                    </div>
                  </div>
                  <div className="sm:col-span-2 space-y-2">
                    <label htmlFor="new-name" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Material Name</label>
                    <input 
                      id="new-name" 
                      name="name" 
                      required 
                      disabled={addingMaterial}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold" 
                      placeholder="e.g. Copper #1" 
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="new-category" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Category</label>
                  <select 
                    id="new-category" 
                    name="category" 
                    required 
                    disabled={addingMaterial}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all appearance-none font-bold"
                  >
                    <option value="Non-Ferrous">Non-Ferrous</option>
                    <option value="Ferrous">Ferrous</option>
                    <option value="Aluminum">Aluminum</option>
                    <option value="Copper">Copper</option>
                    <option value="Brass">Brass</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label htmlFor="new-buy-price" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Buy Price ($)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                      <input 
                        id="new-buy-price" 
                        name="buyPrice" 
                        type="number" 
                        step="0.01" 
                        required 
                        disabled={addingMaterial}
                        className="w-full pl-8 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold" 
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="new-sale-price" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Sale Price ($)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                      <input 
                        id="new-sale-price" 
                        name="salePrice" 
                        type="number" 
                        step="0.01" 
                        required 
                        disabled={addingMaterial}
                        className="w-full pl-8 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold" 
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="new-unit" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Weight Unit</label>
                  <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-2xl">
                    <label className="cursor-pointer">
                      <input type="radio" name="unit" value="lb" defaultChecked className="sr-only peer" disabled={addingMaterial} />
                      <div className="py-2 text-center rounded-xl text-xs font-black uppercase tracking-widest transition-all peer-checked:bg-white peer-checked:text-blue-600 peer-checked:shadow-sm text-slate-500">Pound (lb)</div>
                    </label>
                    <label className="cursor-pointer">
                      <input type="radio" name="unit" value="ton" className="sr-only peer" disabled={addingMaterial} />
                      <div className="py-2 text-center rounded-xl text-xs font-black uppercase tracking-widest transition-all peer-checked:bg-white peer-checked:text-blue-600 peer-checked:shadow-sm text-slate-500">Ton</div>
                    </label>
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="new-description" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Description / Notes</label>
                  <textarea 
                    id="new-description" 
                    name="description" 
                    rows={2}
                    disabled={addingMaterial}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all resize-none font-medium" 
                    placeholder="Additional details about this material..." 
                  />
                </div>

                <div className="flex gap-4 pt-4">
                  <button 
                    type="submit" 
                    disabled={addingMaterial}
                    className="flex-1 bg-blue-600 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 shadow-xl shadow-blue-200 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {addingMaterial ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Add Material
                  </button>
                  <button 
                    type="button" 
                    onClick={() => {
                      setShowAddModal(false);
                      setAddStatus(null);
                    }} 
                    disabled={addingMaterial}
                    className="flex-1 border border-slate-200 text-slate-600 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-50 transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {showDeleteAllModal && (
        <div 
          className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-md overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-all-title"
        >
          <div className="bg-white rounded-[2.5rem] w-full max-w-lg p-10 shadow-2xl animate-in zoom-in-95 duration-200 relative">
            <button 
              onClick={() => {
                setShowDeleteAllModal(false);
                setDeleteAllConfirmText('');
              }}
              className="absolute top-8 right-8 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              aria-label="Close modal"
              disabled={deletingAll}
            >
              <X className="w-6 h-6" aria-hidden="true" />
            </button>

            <div className="space-y-6">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center text-red-600 border border-red-150">
                  <AlertTriangle className="w-8 h-8" />
                </div>
                <div className="space-y-1">
                  <h2 id="delete-all-title" className="text-2xl font-black text-slate-900 tracking-tight font-display">Delete All Materials?</h2>
                  <p className="text-slate-500 font-medium text-sm">
                    This will permanently delete all <strong className="text-red-600 font-black">{materials.length}</strong> material records from the local database.
                  </p>
                </div>
              </div>

              <div className="bg-red-50 border border-red-100 rounded-2xl p-4 text-center">
                <p className="text-xs text-red-800 font-semibold leading-relaxed">
                  <strong>WARNING:</strong> This action is completely irreversible. 
                  All custom buy prices, sale prices, and material codes will be wiped.
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="confirm-delete-input" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">
                  Type <span className="font-bold text-red-600 select-all font-mono">DELETE ALL</span> to confirm
                </label>
                <input
                  id="confirm-delete-input"
                  type="text"
                  placeholder="Type DELETE ALL"
                  className="w-full px-4 py-3 bg-red-50/30 border border-red-200 rounded-2xl focus:ring-2 focus:ring-red-500 outline-none transition-all font-bold text-center text-red-700 tracking-widest uppercase"
                  value={deleteAllConfirmText}
                  onChange={(e) => setDeleteAllConfirmText(e.target.value)}
                  disabled={deletingAll}
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleDeleteAllMaterials}
                  disabled={deleteAllConfirmText.trim().toUpperCase() !== 'DELETE ALL' || deletingAll}
                  className="flex-1 bg-red-600 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-700 hover:shadow-lg hover:shadow-red-200 transition-all outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {deletingAll ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Yes, Delete Everything
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteAllModal(false);
                    setDeleteAllConfirmText('');
                  }}
                  disabled={deletingAll}
                  className="flex-1 border border-slate-200 text-slate-600 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-50 transition-all outline-none"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
