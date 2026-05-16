import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, doc, updateDoc, addDoc, query, orderBy, limit, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';
import { Material, PricingSnapshot } from '../types';
import { Plus, Search, Edit2, TrendingUp, TrendingDown, Minus, Loader2, X, ShieldCheck, FileSpreadsheet, History, RotateCcw, AlertCircle, CheckCircle2, Lock } from 'lucide-react';
import Papa from 'papaparse';
import { cn } from '../lib/utils';

import { UserProfile } from '../types';

import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { logAuditEvent } from '../lib/audit';

interface ManagePricesProps {
  profile: UserProfile | null;
}

export default function ManagePrices({ profile }: ManagePricesProps) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [snapshots, setSnapshots] = useState<PricingSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
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

  useEffect(() => {
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

    return () => {
      unsubMaterials();
      unsubSnapshots();
    };
  }, []);

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
    } catch (error) {
      console.error('Error creating snapshot:', error);
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

      // Create snapshot of current prices before syncing
      await createSnapshot('google_sheets', extractedId);

      // Try multiple endpoints for better compatibility
      const endpoints = directUrl ? [directUrl] : [
        extractedId.startsWith('2PACX') 
          ? `https://docs.google.com/spreadsheets/d/e/${extractedId}/pub?output=csv`
          : `https://docs.google.com/spreadsheets/d/${extractedId}/export?format=csv`,
        `https://docs.google.com/spreadsheets/d/${extractedId}/pub?output=csv`,
        `https://docs.google.com/spreadsheets/d/${extractedId}/gviz/tq?tqx=out:csv`
      ];

      let response;
      let lastError;

      console.log('Attempting to sync with Google Sheets. URLs:', endpoints);

      for (const url of endpoints) {
        try {
          // Try server-side proxy first as it's most reliable for CORS
          const proxyUrl = `/api/proxy-sheet?url=${encodeURIComponent(url)}`;
          console.log('Attempting fetch via server proxy:', proxyUrl);
          
          response = await fetch(proxyUrl);
          if (response.ok) {
            console.log('Successfully connected via server proxy to:', url);
            break;
          }
          
          // Fallback to direct fetch if proxy fails
          console.warn(`Server proxy failed for ${url}, trying direct fetch...`);
          response = await fetch(url);
          if (response.ok) {
            console.log('Successfully connected directly to:', url);
            break;
          }
          console.warn(`Failed to fetch from ${url}: ${response.status} ${response.statusText}`);
        } catch (e) {
          console.error(`Error fetching from ${url}:`, e);
          lastError = e;
        }
      }

      // Fallback to a CORS proxy if direct fetch fails
      let csvText = '';
      if (response && response.ok) {
        csvText = await response.text();
      } else {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(endpoints[0])}`;
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

      const codeKeywords = ['code', 'materialcode', 'id', 'material', 'sku', 'item', 'itemcode', 'partnumber', 'materialname', 'matcode', 'productcode', 'product'];
      const nameKeywords = ['name', 'materialname', 'description', 'desc', 'label', 'title', 'productname'];
      const categoryKeywords = ['category', 'group', 'type', 'class', 'section'];
      const unitKeywords = ['unit', 'uom', 'measure', 'weightunit'];
      const buyKeywords = ['buyprice', 'buy', 'buyrate', 'purchaseprice', 'cost', 'costprice', 'buyrate', 'purchase', 'buying'];
      const saleKeywords = ['saleprice', 'sale', 'salerate', 'sellingprice', 'price', 'rate', 'salerate', 'sell', 'selling'];

      // 2. Find the header row by looking for keywords
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
        setDebugRows(rawRows.slice(0, 15));
        throw new Error('Could not find a header row with "Code" and "Price" columns. Check the "Debug Data" below to see what the app is reading.');
      }

      const headers = rawRows[headerIndex];
      const dataRows = rawRows.slice(headerIndex + 1);
      
      // 3. Convert to objects using discovered headers
      const data = dataRows.map(row => {
        const obj: any = {};
        headers.forEach((header, i) => {
          if (header) obj[header] = row[i];
        });
        return obj;
      });

      console.log(`Discovered headers at row ${headerIndex + 1}:`, headers);

      const batch = writeBatch(db);
      let updatedCount = 0;

      // Smart Column Detection
      const findColumn = (row: any, keywords: string[]) => {
        const keys = Object.keys(row);
        // 1. Exact match (normalized)
        for (const key of keys) {
          const normalizedKey = key.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
          if (keywords.includes(normalizedKey)) return row[key];
        }
        // 2. Partial match
        for (const key of keys) {
          const normalizedKey = key.toLowerCase().trim();
          if (keywords.some(kw => normalizedKey.includes(kw))) return row[key];
        }
        return null;
      };

      // ULTIMATE FALLBACK: If we can't find a code column by name, 
      // look for a column that actually contains our material codes
      let discoveredCodeKey = '';
      if (data.length > 0) {
        const firstRowKeys = Object.keys(data[0]);
        for (const key of firstRowKeys) {
          const val = data[0][key]?.toString().toUpperCase().trim();
          if (materials.some(m => m.code.toUpperCase() === val)) {
            discoveredCodeKey = key;
            console.log('Found Code column by data matching:', key);
            break;
          }
        }
      }

      data.forEach((row: any) => {
        const codeValue = discoveredCodeKey ? row[discoveredCodeKey] : findColumn(row, codeKeywords);
        if (!codeValue) return;

        const code = codeValue.toString().trim();
        const material = materials.find(m => m.code.toUpperCase() === code.toUpperCase());
        
        const buyValue = findColumn(row, buyKeywords);
        const saleValue = findColumn(row, saleKeywords);
        const buyPrice = parseFloat(buyValue?.toString().replace(/[^0-9.]/g, '') || '0');
        const salePrice = parseFloat(saleValue?.toString().replace(/[^0-9.]/g, '') || '0');

        if (material) {
          if (!isNaN(buyPrice) || !isNaN(salePrice)) {
            const updates: any = { 
              updatedAt: serverTimestamp(),
              updatedBy: profile?.displayName || profile?.email || 'System',
              updatedByUid: profile?.uid || 'system'
            };
            if (!isNaN(buyPrice)) updates.buyPrice = buyPrice;
            if (!isNaN(salePrice)) updates.salePrice = salePrice;
            
            // Also update description if seeding
            if (isSeedingMode) {
              const nameValue = findColumn(row, nameKeywords);
              const categoryValue = findColumn(row, categoryKeywords);
              const unitValue = findColumn(row, unitKeywords);
              
              if (nameValue) updates.name = nameValue.toString().trim();
              if (categoryValue) updates.category = categoryValue.toString().trim();
              if (unitValue) {
                const unit = unitValue.toString().toLowerCase().trim();
                updates.unit = (unit === 'ton' || unit === 'tons') ? 'ton' : 'lb';
              }
            }

            batch.update(doc(db, 'materials', material.id), updates);
            updatedCount++;
          }
        } else if (isSeedingMode) {
          // Create new material
          const nameValue = findColumn(row, nameKeywords);
          const categoryValue = findColumn(row, categoryKeywords);
          const unitValue = findColumn(row, unitKeywords);
          
          const newMaterial: Omit<Material, 'id'> = {
            code,
            name: nameValue?.toString().trim() || code,
            category: categoryValue?.toString().trim() || 'General',
            buyPrice: isNaN(buyPrice) ? 0 : buyPrice,
            salePrice: isNaN(salePrice) ? 0 : salePrice,
            unit: (unitValue?.toString().toLowerCase().trim() === 'ton') ? 'ton' : 'lb',
            updatedAt: new Date().toISOString(),
            updatedBy: profile?.displayName || profile?.email || 'System',
            updatedByUid: profile?.uid || 'system'
          };
          
          batch.set(doc(collection(db, 'materials')), newMaterial);
          updatedCount++;
        }
      });

      if (updatedCount > 0) {
        await batch.commit();
        setSyncStatus({ type: 'success', message: `Successfully ${isSeedingMode ? 'seeded/updated' : 'updated'} ${updatedCount} material records!` });
        setDebugRows(null); // Clear debug on success
      } else {
        setSyncStatus({ type: 'error', message: 'No matching material codes found. Ensure your sheet has a "code" column matching the app.' });
      }
    } catch (error: any) {
      console.error('Sync error:', error);
      setSyncStatus({ type: 'error', message: error.message || 'Failed to sync with Google Sheets.' });
    } finally {
      setSyncing(false);
    }
  };

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
      setSyncStatus({ type: 'success', message: 'Successfully reverted to previous pricing!' });
      setShowHistory(false);
    } catch (error) {
      console.error('Revert error:', error);
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

      const filtered = materials.filter(m => batchCategory === 'All' || m.category === batchCategory);
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
        setSyncStatus({ type: 'success', message: `Successfully updated ${count} materials by ${percent}%!` });
        setBatchPercent('');
      } else {
        setSyncStatus({ type: 'error', message: 'No materials found in the selected category.' });
      }
    } catch (error) {
      console.error('Batch update error:', error);
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

  const handleUpdateMaterial = async (id: string) => {
    if (Object.keys(editForm).length === 0) return;
    
    const oldMaterial = materials.find(m => m.id === id);
    
    try {
      await updateDoc(doc(db, 'materials', id), {
        ...editForm,
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

      setIsEditing(null);
      setEditForm({});
    } catch (error) {
      console.error('Error updating material:', error);
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
      setAddingMaterial(false);
      return;
    }

    const newMaterial = {
      code,
      name,
      category,
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

      setAddStatus({ type: 'success', message: `Material "${name}" added successfully.` });
      
      // Auto-close modal after success delay
      setTimeout(() => {
        setShowAddModal(false);
        setAddStatus(null);
      }, 1500);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'materials');
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
    return aCode.localeCompare(bCode);
  });

  const categories = ['All', ...new Set(materials.map(m => m.category))];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
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
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">{material.category}</span>
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

      {showAddModal && (
        <div 
          className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-md overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-material-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !addingMaterial) {
              setShowAddModal(false);
              setAddStatus(null);
            }
          }}
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
    </main>
  );
}
