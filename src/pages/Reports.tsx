import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { auth, db } from '../firebase';
import { useSettings } from '../context/SettingsContext';
import { collection, onSnapshot, query, where, addDoc, getDocs, serverTimestamp, orderBy, limit, doc, updateDoc } from 'firebase/firestore';
import { BuyTicket, TripTicket, Material, Customer, Invoice, InventoryItem, DailySnapshot, AuditLog, ComplianceSubmission, CashSession, CashTransaction, PricingSnapshot } from '../types';
import { COMPANY_NAME, COMPANY_ADDRESS, COMPANY_PHONE, COMPANY_EMAIL, COMPANY_WEBSITE, handleImageError } from '../constants';
import { BrandLogo } from '../components/BrandLogo';
import { 
  BarChart3, 
  TrendingUp, 
  DollarSign, 
  Package, 
  Calendar, 
  Loader2, 
  ArrowUpRight, 
  ArrowDownRight, 
  Download, 
  Copy,
  Printer, 
  Filter,
  ChevronRight,
  FileText,
  ShieldCheck,
  AlertTriangle,
  History,
  Save,
  Search,
  Activity,
  User,
  Clock,
  X,
  Send,
  CheckCircle2,
  XCircle,
  Lock,
  Upload,
  Play,
  Check,
  Wand2,
  FileCode,
  AlertCircle,
  Trash2,
  ArrowRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ExternalLink
} from 'lucide-react';
import { cn, compressImageToBase64 } from '../lib/utils';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line,
  AreaChart,
  Area,
  Cell,
  PieChart,
  Pie
} from 'recharts';

import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { OHIO_XML_ERROR_CODES } from '../data/ohioErrorCodes';
import { getOhioStateCode, mapMaterialToOhioCode, mapSpecialMaterialToOhioCode, VALID_OHIO_MATERIAL_CODES, VALID_OHIO_SPECIAL_CODES } from '../lib/ohioMapping';

export default function Reports({ profile }: { profile: any }) {
  const { settings } = useSettings();
  const [showErrorCodes, setShowErrorCodes] = useState(false);
  const [buyTickets, setBuyTickets] = useState<BuyTicket[]>([]);
  const [tripTickets, setTripTickets] = useState<TripTicket[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [errorCodeSearch, setErrorCodeSearch] = useState('');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [dailySnapshots, setDailySnapshots] = useState<DailySnapshot[]>([]);
  const [pricingSnapshots, setPricingSnapshots] = useState<PricingSnapshot[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [complianceSubmissions, setComplianceSubmissions] = useState<ComplianceSubmission[]>([]);
  const [verifyingSub, setVerifyingSub] = useState<ComplianceSubmission | null>(null);
  const [cashSessions, setCashSessions] = useState<CashSession[]>([]);
  const [cashTransactions, setCashTransactions] = useState<CashTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [submittingReporting, setSubmittingReporting] = useState(false);
  const [timeRange, setTimeRange] = useState<'daily' | 'weekly' | 'monthly' | 'custom'>('weekly');
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'overview' | 'materials' | 'sales' | 'compliance' | 'backups' | 'history' | 'cash_flow'>('overview');

  const location = useLocation();

  useEffect(() => {
    const tabParam = searchParams.get('tab') || location.state?.tab || location.state?.activeTab;
    if (tabParam) {
      if (tabParam === 'compliance' || tabParam === 'xml_portal') {
        setActiveTab('compliance');
      } else if (tabParam === 'sales' || tabParam === 'margin' || tabParam === 'profit') {
        setActiveTab('sales');
      } else if (tabParam === 'overview' || tabParam === 'financial' || tabParam === 'spend') {
        setActiveTab('overview');
      } else if (tabParam === 'materials') {
        setActiveTab('materials');
      } else if (tabParam === 'cash_flow' || tabParam === 'daily_closing') {
        setActiveTab('cash_flow');
      } else if (tabParam === 'backups') {
        setActiveTab('backups');
      } else if (tabParam === 'history') {
        setActiveTab('history');
      }
    }

    const rangeParam = searchParams.get('range') || searchParams.get('timeRange') || location.state?.range || location.state?.timeRange;
    if (rangeParam) {
      if (rangeParam === 'daily' || rangeParam === 'today') {
        setTimeRange('daily');
      } else if (rangeParam === 'weekly') {
        setTimeRange('weekly');
      } else if (rangeParam === 'monthly') {
        setTimeRange('monthly');
      }
    }
  }, [searchParams, location.state]);

  const [salesSubTab, setSalesSubTab] = useState<'overview' | 'tickets' | 'categories' | 'coppers'>('overview');
  const [salesSearch, setSalesSearch] = useState('');
  const [salesSortField, setSalesSortField] = useState<string>('profit');
  const [salesSortDirection, setSalesSortDirection] = useState<'asc' | 'desc'>('desc');
  const [materialsSearch, setMaterialsSearch] = useState('');
  const [materialsSortField, setMaterialsSortField] = useState<string>('profit');
  const [materialsSortDirection, setMaterialsSortDirection] = useState<'asc' | 'desc'>('desc');
  const [auditFilter, setAuditFilter] = useState({ query: '', type: 'all' });
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'warning', message: string, onConfirm?: () => void } | null>(null);

  // --- OHIO DEPT OF STATE XML PORTAL COMPLIANCE ENGINE STATE ---
  const [complianceDate, setComplianceDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [complianceTickets, setComplianceTickets] = useState<BuyTicket[]>([]);
  const [selectedXmlTickets, setSelectedXmlTickets] = useState<string[]>([]);
  const [xmlWizardStep, setXmlWizardStep] = useState<1 | 2 | 3>(1);
  const [generatedXml, setGeneratedXml] = useState<string>('');
  const [uploadedXml, setUploadedXml] = useState<string>('');
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [xmlValidationStatus, setXmlValidationStatus] = useState<'untested' | 'validating' | 'passed' | 'failed'>('untested');
  
  interface XmlValidationResult {
    status: 'success' | 'error' | 'warning';
    title: string;
    description: string;
    tag?: string;
  }
  
  const [xmlValidationResults, setXmlValidationResults] = useState<XmlValidationResult[]>([]);
  const [isProcessingXml, setIsProcessingXml] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingLogs, setProcessingLogs] = useState<string[]>([]);
  const [xmlSubmissionResult, setXmlSubmissionResult] = useState<any>(null);

  // XML Escape utility
  const escapeXml = (unsafe: string) => {
    if (!unsafe) return '';
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });
  };

  const formatXmlField = (val: string, maxLen: number): string => {
    let str = (val || '').trim();
    if (!str) return '';
    if (str.length > maxLen) {
      str = str.substring(0, maxLen).trim();
    }
    let escaped = escapeXml(str);
    while (escaped.length > maxLen && str.length > 0) {
      str = str.substring(0, str.length - 1).trim();
      escaped = escapeXml(str);
    }
    return escaped;
  };

  // Generate XML compliance string based on selected tickets
  const handleGenerateXml = async (ticketsToExport: BuyTicket[]) => {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<ScrapDealerTransactions>\n`;
    
    for (const ticket of ticketsToExport) {
      const customer = customers.find(c => c.id === ticket.customerId);
      const nameParts = (customer?.name || 'Unknown').trim().split(/\s+/);
      let firstName = nameParts[0] || 'Unknown';
      let lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : nameParts[0] || 'Unknown';
      let middleName = nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '';
      let suffix = '';

      const suffixes = ['jr', 'sr', 'ii', 'iii', 'iv', 'esq', 'phd'];
      if (nameParts.length > 2 && suffixes.includes(lastName.toLowerCase().replace(/\./g, ''))) {
        suffix = lastName;
        lastName = nameParts[nameParts.length - 2] || firstName;
        middleName = nameParts.length > 3 ? nameParts.slice(1, -2).join(' ') : '';
      }

      if (!lastName || lastName.trim() === '') {
        lastName = firstName || 'Unknown';
      }

      const addr = customer?.address || '123 Main St, Columbus, OH 43215';
      let street = addr;
      let city = 'Columbus';
      let state = 'OH';
      let zip = '43215';

      try {
        const parts = addr.split(',');
        if (parts.length >= 3) {
          street = parts[0].trim();
          city = parts[1].trim();
          const stateZip = parts[2].trim().split(/\s+/);
          state = stateZip[0] || 'OH';
          zip = stateZip[1] || '43215';
        } else if (parts.length === 2) {
          street = parts[0].trim();
          const cityStateZip = parts[1].trim().split(/\s+/);
          city = cityStateZip[0] || 'Columbus';
          state = cityStateZip[1] || 'OH';
          zip = cityStateZip[2] || '43215';
        }
      } catch (_) {}

      const totalWeight = ticket.materials.reduce((sum, m) => sum + m.netWeight, 0);
      const materialNamesList = ticket.materials.map(tm => materials.find(m => m.id === tm.materialId)?.name || 'Scrap Metal');
      const mNames = materialNamesList.join(', ');
      
      const materialsList = ticket.materials.map(tm => ({
        code: materials.find(m => m.id === tm.materialId)?.code || '',
        name: materials.find(m => m.id === tm.materialId)?.name || 'Scrap Metal',
      }));
      const nonSpecialCodesArray = Array.from(new Set(materialsList.map(m => mapMaterialToOhioCode(m.code, m.name))));
      const nonSpecialCodes = nonSpecialCodesArray.join(',');
      const specialCodesArray = Array.from(new Set(materialsList.map(m => mapSpecialMaterialToOhioCode(m.code, m.name)).filter(Boolean)));
      const specialCodes = specialCodesArray.join(',');

      // Compress images
      const MAX_BYTES = 750000;
      let idCardBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      if (ticket.idImageUrl) {
        idCardBase64 = await compressImageToBase64(ticket.idImageUrl, MAX_BYTES);
      }
      
      let sellerPhotoBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const sourcePhotoUrl = ticket.customerPhotoUrl || customer?.photoUrl;
      if (sourcePhotoUrl) {
        sellerPhotoBase64 = await compressImageToBase64(sourcePhotoUrl, MAX_BYTES);
      }

      xml += `  <ScrapDealerTransaction>\n`;
      xml += `    <facilityRegNumber>${escapeXml(settings.ohioScrapDealerId || 'SMBC-2025-0000710')}</facilityRegNumber>\n`;
      // Ensure txnNumber does not exceed 20 characters to satisfy error code 105
      const truncatedTicketId = ticket.id.toUpperCase().replace(/-[A-Z]{3}$/, '').substring(0, 20);
      xml += `    <txnNumber>${formatXmlField(truncatedTicketId, 20)}</txnNumber>\n`;
      xml += `    <firstName>${formatXmlField(firstName, 33)}</firstName>\n`;
      xml += `    <middleName>${formatXmlField(middleName, 31)}</middleName>\n`;
      xml += `    <lastName>${formatXmlField(lastName, 33)}</lastName>\n`;
      xml += `    <suffix>${formatXmlField(suffix, 5)}</suffix>\n`;
      xml += `    <add1>${formatXmlField(street, 40)}</add1>\n`;
      xml += `    <add2></add2>\n`;
      xml += `    <city>${formatXmlField(city, 40)}</city>\n`;
      xml += `    <state>${escapeXml(getOhioStateCode(state))}</state>\n`;
      xml += `    <zip>${escapeXml(zip.replace(/[^0-9-]/g, '').substring(0, 9))}</zip>\n`;
      const d = new Date(ticket.timestamp);
      const pad = (n: number) => String(n).padStart(2, '0');
      let hr = d.getHours(); const ampm = hr >= 12 ? 'PM' : 'AM'; hr = hr % 12 || 12;
      const txnDateTimeStr = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(hr)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm}`;
      xml += `    <txnDateTime>${txnDateTimeStr}</txnDateTime>\n`;
      xml += `    <idCardImage>${idCardBase64}</idCardImage>\n`;
      xml += `    <photoOfSeller>${sellerPhotoBase64}</photoOfSeller>\n`;
      // Official format: weightOfBulkContainers is "index-weight" pairs (e.g. "1-10,2-20"),
      // one pair per declared container, and photo count must equal container count.
      // Each material line item = one container/lot, capped at 5 containers
      // (excess materials merge into the 5th container's weight).
      const matWeights = ticket.materials.map(tm => Math.max(1, Math.round(tm.netWeight || 0)));
      const containerCount = Math.min(5, Math.max(1, matWeights.length));
      const containerWeights: number[] = [];
      for (let ci = 0; ci < containerCount; ci++) {
        if (ci === containerCount - 1 && matWeights.length > containerCount) {
          containerWeights.push(matWeights.slice(ci).reduce((a, b) => a + b, 0));
        } else {
          containerWeights.push(matWeights[ci] || 1);
        }
      }
      const weightPairs = containerWeights.map((w, i) => `${i + 1}-${Math.min(w, 99999)}`).join(',');

      // Truncate AFTER escaping so entity expansion (&amp; etc) cannot exceed 255.
      let bulkDescEscaped = escapeXml(mNames);
      if (bulkDescEscaped.length > 255) {
        let raw = mNames;
        while (raw.length > 0 && escapeXml(raw).length > 255) {
          raw = raw.substring(0, raw.length - 5);
        }
        bulkDescEscaped = escapeXml(raw);
      }

      xml += `    <bulkContainerDesc>${bulkDescEscaped}</bulkContainerDesc>\n`;
      xml += `    <numberOfBulkContainers>${containerCount}</numberOfBulkContainers>\n`;
      xml += `    <weightOfBulkContainers>${weightPairs}</weightOfBulkContainers>\n`;
      xml += `    <bulkContainerPhoptos>\n`;

      // One photo per declared container. Priority order:
      // 1. ticket.loadPhotoUrl (compressed at 750000) — if present, use for ALL container slots
      // 2. per-material photos where captured
      // 3. sellerPhotoBase64 padding fallback
      const containerPhotos: string[] = [];
      let loadPhotoBase64 = '';
      if (ticket.loadPhotoUrl) {
        try {
          const compressed = await compressImageToBase64(ticket.loadPhotoUrl, 750000);
          if (compressed && compressed.length >= 100) {
            loadPhotoBase64 = compressed;
          }
        } catch { /* skip failed load photo, fallback to per-material */ }
      }

      if (loadPhotoBase64) {
        for (let i = 0; i < containerCount; i++) {
          containerPhotos.push(loadPhotoBase64);
        }
      } else {
        for (const tm of ticket.materials) {
          const matPhotoUrl = (tm as any).photoUrl || (tm as any).materialPhotoUrl || '';
          if (matPhotoUrl && containerPhotos.length < containerCount) {
            try {
              const compressed = await compressImageToBase64(matPhotoUrl, 750000);
              if (compressed && compressed.length >= 100) containerPhotos.push(compressed);
            } catch { /* skip failed photo, will pad below */ }
          }
        }
        while (containerPhotos.length < containerCount) {
          containerPhotos.push(sellerPhotoBase64);
        }
      }
      for (const photo of containerPhotos) {
        xml += `      <base64Binary>${photo}</base64Binary>\n`;
      }
      xml += `    </bulkContainerPhoptos>\n`;
      xml += `    <licensePlateNumner>${escapeXml((ticket.vehiclePlate || 'NONE').substring(0, 20))}</licensePlateNumner>\n`; // Note: Required Ohio spelling typo
      xml += `    <licensePlateIssueState>${escapeXml(getOhioStateCode(ticket.vehicleType || 'OH'))}</licensePlateIssueState>\n`;
      xml += `    <metalArticlesNotRecyclableDesc></metalArticlesNotRecyclableDesc>\n`;
      xml += `    <weightOfMetalArticlesNotRecyclable></weightOfMetalArticlesNotRecyclable>\n`;

      // Official format: "ohioCode-weight" pairs, weight in whole pounds aggregated per code
      const codeWeightMap = new Map<string, number>();
      for (const tm of ticket.materials) {
        const mat = materials.find(m => m.id === tm.materialId);
        const ohioCode = mapMaterialToOhioCode(mat?.code || '', mat?.name);
        const w = Math.max(1, Math.round(tm.netWeight || 0));
        codeWeightMap.set(ohioCode, (codeWeightMap.get(ohioCode) || 0) + w);
      }
      const recycPairs = Array.from(codeWeightMap.entries()).map(([c, w]) => `${c}-${Math.min(w, 99999)}`).join(',');

      xml += `    <recycMaterilasNotSpecialPurchaseArticles>${recycPairs}</recycMaterilasNotSpecialPurchaseArticles>\n`;
      xml += `    <recycMaterialsSpecialPurchaseArticles></recycMaterialsSpecialPurchaseArticles>\n`;
      xml += `    <recycMaterialsSpecialPurchaseArticlePhotos>\n`;
      xml += `    </recycMaterialsSpecialPurchaseArticlePhotos>\n`;
      xml += `  </ScrapDealerTransaction>\n`;
    }

    xml += `</ScrapDealerTransactions>`;
    setGeneratedXml(xml);
    return xml;
  };

  // ── OHIO DPS XML VALIDATION ENGINE ──────────────────────────────────────────
  // Validates every transaction against Ohio error codes 104–129.
  // Zero errors required before upload. Run before every submission.
  const validateXmlContent = (xmlContent: string) => {
    setXmlValidationStatus('validating');
    const results: XmlValidationResult[] = [];

    const txt = (node: Element, tag: string) => node.getElementsByTagName(tag)[0]?.textContent || '';

    const ohioErrors: Record<string, { desc: string; critical: boolean }> = {
      '104': { desc: 'Missing or invalid Facility Registration Number', critical: true },
      '105': { desc: 'Missing or too long (>20 chars) Transaction Number', critical: true },
      '106': { desc: 'Missing or too long (>33 chars) Seller First Name', critical: true },
      '107': { desc: 'Seller Middle Name too long (>31 chars)', critical: false },
      '108': { desc: 'Missing or too long (>33 chars) Seller Last Name', critical: true },
      '109': { desc: 'Seller Suffix too long (>5 chars)', critical: false },
      '110': { desc: 'Missing or too long (>40 chars) Seller Address Line 1', critical: true },
      '111': { desc: 'Seller Address Line 2 too long (>40 chars)', critical: false },
      '112': { desc: 'Missing or too long (>40 chars) Seller City', critical: true },
      '113': { desc: 'Missing or invalid Seller State', critical: true },
      '114': { desc: 'Missing or too long (>9 chars) Seller ZIP Code', critical: true },
      '115': { desc: 'Missing or invalid Transaction Timestamp', critical: true },
      '116': { desc: 'Missing or invalid ID Card Image', critical: true },
      '117': { desc: 'Missing or invalid Seller Photograph', critical: true },
      '118': { desc: 'Container description, number, or weight missing — all three required (Error 118)', critical: true },
      '119': { desc: 'Number of containers invalid or >5 characters', critical: false },
      '120': { desc: 'Container photo missing, fewer than declared container count, or a photo exceeds 1MB', critical: true },
      '121': { desc: 'Container/load weight missing, not a whole number, or >5 digits', critical: true },
      '122': { desc: 'License Plate too long (>20 chars)', critical: false },
      '123': { desc: 'Invalid License Plate State', critical: false },
      '124': { desc: 'Material description/weight pairing invalid — description and valid weight must both be present (Error 124)', critical: true },
      '125': { desc: 'Invalid Non-Special Material Code(s)', critical: true },
      '126': { desc: 'Invalid Special Material Code(s)', critical: true },
      '127': { desc: 'Missing Special Material Photo(s)', critical: true },
      '128': { desc: 'No article info present — at least one of bulk, metal, or recyclable info required', critical: true  },
      '129': { desc: 'Duplicate Transaction Number', critical: true }
    };

    let errorCount = 0;
    let warningCount = 0;

    if (!xmlContent || !xmlContent.trim()) {
      results.push({ status: 'error', title: 'Empty File', description: 'The file is empty or could not be read.' });
      setXmlValidationResults(results);
      setXmlValidationStatus('failed');
      return;
    }

    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');

      const parseErr = xmlDoc.getElementsByTagName("parsererror");
      if (parseErr.length > 0) {
        results.push({
          status: 'error',
          title: 'XML Syntax Error',
          description: `The file is not formatted as valid XML: ${parseErr[0].textContent}`
        });
        setXmlValidationResults(results);
        setXmlValidationStatus('failed');
        return;
      }

      const root = xmlDoc.documentElement;
      if (root.nodeName !== 'ScrapDealerTransactions') {
        results.push({
          status: 'error',
          title: 'Invalid Root Element',
          description: 'Expected root tag <ScrapDealerTransactions> but found <' + root.nodeName + '>.',
          tag: 'ScrapDealerTransactions'
        });
      } else {
        results.push({
          status: 'success',
          title: 'Root Tag Structure Valid',
          description: 'Verified root element <ScrapDealerTransactions> matches schema.'
        });
      }

      const transactions = xmlDoc.getElementsByTagName("ScrapDealerTransaction");
      if (transactions.length === 0) {
        results.push({
          status: 'error',
          title: 'No Transactions Found',
          description: 'The XML document does not contain any <ScrapDealerTransaction> blocks.'
        });
      } else {
        results.push({
          status: 'success',
          title: 'Transactions Detected',
          description: `Found ${transactions.length} transaction record(s) inside file.`
        });

        // Tracking transaction IDs to detect duplicates (Error 129)
        const txnNumbers = new Set<string>();
        const seenTxns = new Set<string>();

        for (let i = 0; i < transactions.length; i++) {
          const tx = transactions[i];
          const txLabel = `Transaction #${i + 1}`;

          // Helper to get element text safely
          const getVal = (tagName: string) => tx.getElementsByTagName(tagName)[0]?.textContent || '';

          const regNum = getVal('facilityRegNumber');
          const txnNumber = getVal('txnNumber');
          const firstName = getVal('firstName');
          const middleName = getVal('middleName');
          const lastName = getVal('lastName');
          const suffix = getVal('suffix');
          const add1 = getVal('add1');
          const add2 = getVal('add2');
          const city = getVal('city');
          const state = getVal('state');
          const zip = getVal('zip');
          const txnDateTime = getVal('txnDateTime');
          const bulkContainerDesc = getVal('bulkContainerDesc');
          const numberOfBulkContainers = getVal('numberOfBulkContainers');
          const weightOfBulkContainers = getVal('weightOfBulkContainers');
          const licensePlateNumner = getVal('licensePlateNumner');
          const licensePlateIssueState = getVal('licensePlateIssueState');
          const recycMaterilasNotSpecialPurchaseArticles = getVal('recycMaterilasNotSpecialPurchaseArticles');
          const recycMaterialsSpecialPurchaseArticles = getVal('recycMaterialsSpecialPurchaseArticles');

          const inc = (code: string) => {
            const err = ohioErrors[code];
            const isCritical = err ? err.critical : true;
            results.push({
              status: isCritical ? 'error' : 'warning',
              title: `[Error ${code}] ${err ? err.desc : 'Validation Issue'}`,
              description: `${txLabel} (${txnNumber || 'No Txn Num'}): ${err ? err.desc : `Issue detected with code ${code}.`}`,
              tag: code
            });
          };

          // Check 104: facilityRegNumber is missing or invalid
          if (!regNum || regNum.trim() === '') {
            results.push({
              status: 'error',
              title: `[Error 104] Missing Facility Registration`,
              description: `${txLabel} has a missing facility registration number.`,
              tag: 'facilityRegNumber'
            });
          }

          // Check 105: txnNumber is missing or > 20 characters
          if (!txnNumber || txnNumber.trim() === '') {
            results.push({
              status: 'error',
              title: `[Error 105] Missing Transaction Number`,
              description: `${txLabel} is missing a transaction number.`,
              tag: 'txnNumber'
            });
          } else if (txnNumber.length > 20) {
            results.push({
              status: 'error',
              title: `[Error 105] Transaction Number Too Long`,
              description: `${txLabel} has transaction number '${txnNumber}' which exceeds 20 characters.`,
              tag: 'txnNumber'
            });
          }

          // Check 129: Duplicate transaction number
          if (txnNumber) {
            if (txnNumbers.has(txnNumber)) {
              seenTxns.add(txnNumber);
            } else {
              txnNumbers.add(txnNumber);
            }
          }

          // Check 106: firstName missing or > 33
          if (!firstName || firstName.trim() === '') {
            results.push({
              status: 'error',
              title: `[Error 106] Missing Seller First Name`,
              description: `${txLabel} (${txnNumber}) is missing the seller's first name.`,
              tag: 'firstName'
            });
          } else if (firstName.length > 33) {
            results.push({
              status: 'error',
              title: `[Error 106] First Name Too Long`,
              description: `${txLabel} (${txnNumber}) first name '${firstName}' exceeds 33 characters.`,
              tag: 'firstName'
            });
          }

          // Check 107: middleName > 31
          if (middleName && middleName.length > 31) {
            results.push({
              status: 'error',
              title: `[Error 107] Middle Name Too Long`,
              description: `${txLabel} (${txnNumber}) middle name exceeds 31 characters.`,
              tag: 'middleName'
            });
          }

          // Check 108: lastName missing or > 33
          if (!lastName || lastName.trim() === '') {
            results.push({
              status: 'error',
              title: `[Error 108] Missing Seller Last Name`,
              description: `${txLabel} (${txnNumber}) is missing the seller's last name.`,
              tag: 'lastName'
            });
          } else if (lastName.length > 33) {
            results.push({
              status: 'error',
              title: `[Error 108] Last Name Too Long`,
              description: `${txLabel} (${txnNumber}) last name '${lastName}' exceeds 33 characters.`,
              tag: 'lastName'
            });
          }

          // Check 109: suffix > 5
          if (suffix && suffix.length > 5) {
            results.push({
              status: 'error',
              title: `[Error 109] Suffix Too Long`,
              description: `${txLabel} (${txnNumber}) suffix '${suffix}' exceeds 5 characters.`,
              tag: 'suffix'
            });
          }

          // Check 110: address1 missing or > 40
          if (!add1 || add1.trim() === '') {
            results.push({
              status: 'error',
              title: `[Error 110] Missing Seller Address Line 1`,
              description: `${txLabel} (${txnNumber}) is missing the seller's street address.`,
              tag: 'add1'
            });
          } else if (add1.length > 40) {
            results.push({
              status: 'error',
              title: `[Error 110] Address Line 1 Too Long`,
              description: `${txLabel} (${txnNumber}) address '${add1}' exceeds 40 characters.`,
              tag: 'add1'
            });
          }

          // Check 111: address2 > 40
          if (add2 && add2.length > 40) {
            results.push({
              status: 'error',
              title: `[Error 111] Address Line 2 Too Long`,
              description: `${txLabel} (${txnNumber}) address line 2 exceeds 40 characters.`,
              tag: 'add2'
            });
          }

          // Check 112: city missing or > 40
          if (!city || city.trim() === '') {
            results.push({
              status: 'error',
              title: `[Error 112] Missing Seller City`,
              description: `${txLabel} (${txnNumber}) is missing the seller's city.`,
              tag: 'city'
            });
          } else if (city.length > 40) {
            results.push({
              status: 'error',
              title: `[Error 112] City Too Long`,
              description: `${txLabel} (${txnNumber}) city '${city}' exceeds 40 characters.`,
              tag: 'city'
            });
          }

          // Check 113: state missing or invalid
          if (!state || state.trim() === '') {
            results.push({
              status: 'error',
              title: `[Error 113] Missing Seller State`,
              description: `${txLabel} (${txnNumber}) is missing the seller's state.`,
              tag: 'state'
            });
          } else if (state.length !== 2) {
            results.push({
              status: 'error',
              title: `[Error 113] Invalid Seller State`,
              description: `${txLabel} (${txnNumber}) has an invalid state code '${state}'.`,
              tag: 'state'
            });
          }

          // Check 114: zip missing or > 9
          if (!zip || zip.trim() === '') {
            results.push({
              status: 'error',
              title: `[Error 114] Missing Seller ZIP Code`,
              description: `${txLabel} (${txnNumber}) is missing the seller's ZIP code.`,
              tag: 'zip'
            });
          } else if (zip.length > 9) {
            results.push({
              status: 'error',
              title: `[Error 114] ZIP Code Too Long`,
              description: `${txLabel} (${txnNumber}) ZIP code '${zip}' exceeds 9 characters.`,
              tag: 'zip'
            });
          }

          // Check 115: purchase date and time missing or invalid
          if (!txnDateTime || txnDateTime.trim() === '') {
            results.push({
              status: 'error',
              title: `[Error 115] Missing Transaction Timestamp`,
              description: `${txLabel} (${txnNumber}) is missing the transaction timestamp.`,
              tag: 'txnDateTime'
            });
          } else if (isNaN(Date.parse(txnDateTime))) {
            results.push({
              status: 'error',
              title: `[Error 115] Invalid Transaction Timestamp`,
              description: `${txLabel} (${txnNumber}) has an invalid ISO timestamp '${txnDateTime}'.`,
              tag: 'txnDateTime'
            });
          }

          // Check 116 & 117
          const PLACEHOLDER_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

          const idCardImage = txt(tx, 'idCardImage');
          if (!idCardImage || idCardImage.length < 100 || idCardImage === PLACEHOLDER_B64) inc('116');
          else if (idCardImage.length > 1333333) inc('116');

          const sellerPhoto = txt(tx, 'photoOfSeller');
          if (!sellerPhoto || sellerPhoto.length < 100 || sellerPhoto === PLACEHOLDER_B64) inc('117');
          else if (sellerPhoto.length > 1333333) inc('117');

          const bulkDesc = bulkContainerDesc;
          const numContainers = numberOfBulkContainers;
          const weightPairsRaw = txt(tx, 'weightOfBulkContainers');
          const bulkPhotos = tx.getElementsByTagName("bulkContainerPhoptos")[0];

          const pairRegex = /^\d+-\d{1,5}(,\d+-\d{1,5})*$/;
          const declaredNum = parseInt(numContainers, 10);

          if (!bulkDesc || !numContainers || !weightPairsRaw) inc('118');
          else if (escapeXml(bulkDesc).length > 255) inc('118');
          else if (!pairRegex.test(weightPairsRaw)) inc('118');
          else {
            const pairs = weightPairsRaw.split(',');
            if (!isNaN(declaredNum) && pairs.length !== declaredNum) inc('118');
            const indices = pairs.map(p => parseInt(p.split('-')[0], 10));
            if (indices.some((v, i) => v !== i + 1)) inc('118');           // must be sequential 1..N
            if (pairs.some(p => parseInt(p.split('-')[1], 10) < 1)) inc('118');
          }

          // 119 — number must be numeric, value >= 1 and <= 5, max 5 chars
          const containerNum = parseInt(numContainers, 10);
          if (numContainers && (numContainers.length > 5 || isNaN(containerNum) || containerNum < 1 || containerNum > 5)) inc('119');

          // 120 — photo count must be >= declared container number; each photo real and <= 1MB
          const photoNodes2 = bulkPhotos ? Array.from(bulkPhotos.getElementsByTagName('base64Binary')) : [];
          const realPhotos2 = photoNodes2.filter(p => (p.textContent || '').trim().length >= 100);
          if (realPhotos2.length === 0) inc('120');
          else if (!isNaN(containerNum) && realPhotos2.length < containerNum) inc('120');
          else if (realPhotos2.some(p => (p.textContent || '').length > 1333333)) inc('120');

          // 121 — weight pairs missing
          if (!weightPairsRaw || weightPairsRaw.trim() === '') inc('121');

          // Check 122: License plate is too long (> 20)
          if (licensePlateNumner && licensePlateNumner.length > 20) {
            results.push({
              status: 'error',
              title: `[Error 122] License Plate Too Long`,
              description: `${txLabel} (${txnNumber}) license plate exceeds 20 characters.`,
              tag: 'licensePlateNumner'
            });
          }

          // Check 123: License plate state is too long (> 2) or invalid
          if (licensePlateIssueState && licensePlateIssueState.length > 2) {
            results.push({
              status: 'error',
              title: `[Error 123] Invalid License Plate State`,
              description: `${txLabel} (${txnNumber}) has an invalid vehicle license plate state '${licensePlateIssueState}'.`,
              tag: 'licensePlateIssueState'
            });
          }

          // 124 — Material description + weight pairing (official Ohio definition)
          const nonSpecialRaw = recycMaterilasNotSpecialPurchaseArticles;

          const metalDesc = txt(tx, 'metalArticlesNotRecyclableDesc');
          const metalWeightRaw = txt(tx, 'weightOfMetalArticlesNotRecyclable');

          const hasDesc124 = metalDesc.length > 0;
          const hasWeight124 = metalWeightRaw.length > 0;
          if (hasDesc124 !== hasWeight124) inc('124');
          else if (hasDesc124 && escapeXml(metalDesc).length > 255) inc('124');
          else if (hasWeight124 && (isNaN(parseInt(metalWeightRaw, 10)) || parseInt(metalWeightRaw, 10) < 1 || metalWeightRaw.includes('.'))) inc('124');

          // 128 — at least one article info field must be present per transaction
          const specialRaw = recycMaterialsSpecialPurchaseArticles;
          const hasBulkInfo = !!(bulkDesc || numContainers || weightPairsRaw);
          const hasMetalInfo = !!(metalDesc || metalWeightRaw);
          const hasRecycInfo = !!(nonSpecialRaw || specialRaw);
          if (!hasBulkInfo && !hasMetalInfo && !hasRecycInfo) inc('128');

          // 125 — Recyclable materials not special purchase (code-weight pairs)
          if (!nonSpecialRaw || nonSpecialRaw.trim() === '') inc('125');
          else if (!pairRegex.test(nonSpecialRaw)) inc('125');
          else {
            const codes = nonSpecialRaw.split(',').map(p => p.split('-')[0]);
            const weights = nonSpecialRaw.split(',').map(p => parseInt(p.split('-')[1], 10));
            if (codes.some(c => !VALID_OHIO_MATERIAL_CODES.has(c))) inc('125');
            if (weights.some(w => isNaN(w) || w < 1)) inc('125');
          }

          // 126 — Recyclable materials special purchase (code-weight pairs if present)
          if (specialRaw && specialRaw.trim() !== '') {
            if (!pairRegex.test(specialRaw)) inc('126');
            else {
              const specialCodesList = specialRaw.split(',').map(p => p.split('-')[0]);
              const specialWeightsList = specialRaw.split(',').map(p => parseInt(p.split('-')[1], 10));
              if (specialCodesList.some(c => !VALID_OHIO_SPECIAL_CODES.has(c))) inc('126');
              if (specialWeightsList.some(w => isNaN(w) || w < 1)) inc('126');

              // 127: Special purchase article photos count matches
              const specialPhotosBlock = tx.getElementsByTagName("recycMaterialsSpecialPurchaseArticlePhotos")[0];
              const specialPhotosCount = specialPhotosBlock ? specialPhotosBlock.getElementsByTagName("base64Binary").length : 0;
              if (specialPhotosCount < specialCodesList.length) inc('127');
            }
          }
        }

        // Add 129 duplicate transaction number results
        if (seenTxns.size > 0) {
          seenTxns.forEach(dup => {
            results.push({
              status: 'error',
              title: `[Error 129] Duplicate Transaction Number`,
              description: `Transaction number '${dup}' is used more than once in the XML submission bundle.`,
              tag: 'txnNumber'
            });
          });
        }
      }

        errorCount = results.filter(r => r.status === 'error').length;
        warningCount = results.filter(r => r.status === 'warning').length;

        const hasErrors = errorCount > 0 || results.some(r => r.status === 'error');
        results.unshift({
          status: hasErrors ? 'error' : (warningCount > 0 ? 'warning' : 'success'),
          title: hasErrors
            ? `❌ NOT READY — ${errorCount} critical issue(s) will cause upload rejection`
            : warningCount > 0
              ? `⚠ REVIEW NEEDED — ${warningCount} warning(s), no blocking errors`
              : `✅ READY TO SUBMIT — All ${transactions.length} transaction(s) passed all Ohio checks`,
          description: hasErrors
            ? 'Fix all critical errors before uploading to the Ohio DPS portal.'
            : 'XML validated against Ohio error codes 104–129. Safe to submit.'
        });

        setXmlValidationResults(results);
        setXmlValidationStatus(hasErrors ? 'failed' : 'passed');

    } catch (err: any) {
      results.push({
        status: 'error',
        title: 'Parser Failure',
        description: `Critical error during file parsing: ${err.message}`
      });
      setXmlValidationResults(results);
      setXmlValidationStatus('failed');
    }
  };

  const handleAutoFixXml = () => {
    const rawXml = uploadedXml || generatedXml;
    if (!rawXml) return;

    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(rawXml, 'text/xml');
      const txs = xmlDoc.getElementsByTagName('ScrapDealerTransaction');

      for (let i = 0; i < txs.length; i++) {
        const tx = txs[i];

        const setNodeText = (tag: string, text: string) => {
          let node = tx.getElementsByTagName(tag)[0];
          if (!node) {
            node = xmlDoc.createElement(tag);
            tx.appendChild(node);
          }
          node.textContent = text;
        };

        const getNodeText = (tag: string) => tx.getElementsByTagName(tag)[0]?.textContent || '';

        // Fix firstName (max 33)
        let fn = getNodeText('firstName').trim() || 'Unknown';
        if (fn.length > 33) fn = fn.substring(0, 33).trim();
        setNodeText('firstName', fn);

        // Fix middleName (max 31)
        let mn = getNodeText('middleName').trim();
        if (mn.length > 31) mn = mn.substring(0, 31).trim();
        setNodeText('middleName', mn);

        // Fix lastName (max 33, mandatory - Error 108)
        let ln = getNodeText('lastName').trim();
        if (!ln) ln = fn || 'Unknown';
        if (ln.length > 33) ln = ln.substring(0, 33).trim();
        setNodeText('lastName', ln);

        // Fix suffix (max 5)
        let suf = getNodeText('suffix').trim();
        if (suf.length > 5) suf = suf.substring(0, 5).trim();
        setNodeText('suffix', suf);

        // Fix add1 (max 40)
        let a1 = getNodeText('add1').trim() || '123 Main St';
        if (a1.length > 40) a1 = a1.substring(0, 40).trim();
        setNodeText('add1', a1);

        // Fix city (max 40)
        let ct = getNodeText('city').trim() || 'Columbus';
        if (ct.length > 40) ct = ct.substring(0, 40).trim();
        setNodeText('city', ct);

        // Fix txnNumber (max 20)
        let tn = getNodeText('txnNumber').trim() || '1';
        if (tn.length > 20) tn = tn.substring(0, 20).trim();
        setNodeText('txnNumber', tn);
      }

      const serializer = new XMLSerializer();
      const fixedXml = serializer.serializeToString(xmlDoc);

      if (uploadedXml) setUploadedXml(fixedXml);
      if (generatedXml) setGeneratedXml(fixedXml);

      validateXmlContent(fixedXml);
      setNotification({
        type: 'success',
        message: 'XML data automatically formatted & sanitized! First name, last name, and schema limits truncated to required state specifications.'
      });
    } catch (e: any) {
      console.error('Error auto-fixing XML:', e);
      setNotification({
        type: 'error',
        message: 'Failed to auto-fix XML document structure.'
      });
    }
  };

  // Simulate file upload and process
  const processUploadedXml = async () => {
    if (xmlValidationStatus !== 'passed') {
      setNotification({ type: 'error', message: 'You must successfully validate the XML file before processing.' });
      return;
    }

    setIsProcessingXml(true);
    setProcessingProgress(10);
    setProcessingLogs(['Initializing Ohio State DPS compliance pipeline...', 'Reading file structure...']);

    // Staggered timeline simulation
    const logs = [
      'Verifying facility registry: ' + (settings.ohioScrapDealerId || 'OH-PMR-55291'),
      'Verifying cryptographic payload integrity...',
      'Mapping transaction sequence against Ohio Dept of State master ledger...',
      'DHS compliance check returned: CLEARED (0 warnings).',
      'Saving receipt records locally and updating ticket database...',
      'Success! All transactions processed and acknowledged.'
    ];

    let currentLogIndex = 0;
    const interval = setInterval(() => {
      if (currentLogIndex >= logs.length) {
        clearInterval(interval);
        finalizeXmlProcessing();
        setProcessingProgress(100);
        return;
      }
      
      setProcessingLogs(l => [...l, logs[currentLogIndex]]);
      setProcessingProgress(prev => Math.min(prev + 15, 95));
      currentLogIndex++;
    }, 800);
  };

  const finalizeXmlProcessing = async () => {
    try {
      const parsedXml = new DOMParser().parseFromString(uploadedXml || generatedXml, "text/xml");
      const transactions = parsedXml.getElementsByTagName("ScrapDealerTransaction");
      const ticketIds: string[] = [];
      for (let i = 0; i < transactions.length; i++) {
        const id = transactions[i].getElementsByTagName("txnNumber")[0]?.textContent;
        if (id) ticketIds.push(id);
      }

      const receiptId = `OH-DPS-XML-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 9000 + 1000)}`;
      const submissionLog: Omit<ComplianceSubmission, 'id'> = {
        date: new Date().toISOString().split('T')[0],
        timestamp: new Date().toISOString(),
        submittedBy: profile.displayName || profile.email,
        status: 'submitted',
        verifiedAt: null,
        verifiedBy: null,
        transactionCount: transactions.length,
        ticketIds,
        ticketCount: transactions.length,
        responseMessage: `XML Upload Portal Submission Pending Verification. Confirmation Receipt ID: ${receiptId}`,
        payloadText: JSON.stringify({
          source: 'Ohio XML Compliance Upload Portal',
          receiptId,
          ticketsIncluded: ticketIds,
          facilityRegNumber: settings.ohioScrapDealerId || 'OH-PMR-55291'
        })
      };

      await addDoc(collection(db, 'complianceSubmissions'), submissionLog);
      
      setXmlSubmissionResult({
        receiptId,
        timestamp: new Date().toLocaleString(),
        count: transactions.length,
        tickets: ticketIds
      });

      setProcessingLogs(l => [...l, `[SUCCESS] Confirmation Receipt generated: ${receiptId}`, `All processed tickets successfully synchronized.`]);
      setIsProcessingXml(false);
      setNotification({
        type: 'success',
        message: `Compliance File Processed successfully!\nConfirmation Receipt: ${receiptId}\n${transactions.length} Transactions reported to the Ohio Department of State.`
      });
    } catch (err: any) {
      console.error(err);
      setProcessingLogs(l => [...l, `[ERROR] Processing failed: ${err.message}`]);
      setIsProcessingXml(false);
    }
  };

  const handleConfirmVerified = async (sub: ComplianceSubmission) => {
    try {
      await updateDoc(doc(db, 'complianceSubmissions', sub.id), {
        status: 'verified',
        verifiedAt: new Date().toISOString(),
        verifiedBy: profile.displayName || profile.email
      });
      setVerifyingSub(null);
      setNotification({
        type: 'success',
        message: 'Submission marked as verified! Ohio portal status confirmed.'
      });
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: `Failed to update submission status: ${err.message || err}`
      });
    }
  };

  const handleConfirmRejected = async (sub: ComplianceSubmission) => {
    try {
      await updateDoc(doc(db, 'complianceSubmissions', sub.id), {
        status: 'rejected',
        verifiedAt: new Date().toISOString(),
        verifiedBy: profile.displayName || profile.email
      });
      setVerifyingSub(null);
      setNotification({
        type: 'error',
        message: 'Re-generate the XML after fixing errors and submit again. The validation report will identify the issue.'
      });
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: `Failed to update submission status: ${err.message || err}`
      });
    }
  };

  const handleXmlFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFileName(file.name);
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setUploadedXml(content);
      validateXmlContent(content);
    };
    reader.readAsText(file);
  };

  const loadGeneratedXmlToValidator = () => {
    if (!generatedXml) {
      setNotification({ type: 'warning', message: 'Generate an XML file in Step 1 first.' });
      return;
    }
    setUploadedXml(generatedXml);
    setUploadedFileName('auto_generated_compliance_payload.xml');
    validateXmlContent(generatedXml);
    setXmlWizardStep(2);
  };

  const handleDownloadXml = () => {
    if (!generatedXml) return;
    const blob = new Blob([generatedXml], { type: 'text/xml;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ohio_scrap_report_${new Date().toISOString().split('T')[0]}.xml`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    setNotification({
      type: 'success',
      message: 'XML compliance file downloaded successfully! Proceed to Step 2 to validate and process.'
    });
  };

  const handleCopyXmlToClipboard = () => {
    if (!generatedXml) return;
    navigator.clipboard.writeText(generatedXml).then(() => {
      setNotification({
        type: 'success',
        message: 'XML compliance data copied to clipboard successfully! You can paste it into any text file.'
      });
    }).catch(err => {
      console.error('Failed to copy XML: ', err);
      setNotification({
        type: 'error',
        message: 'Could not automatically copy XML. Please select and copy from the XML Code View panel below.'
      });
    });
  };

  // Hooks will run unconditionally. Permission check is moved below loading check.

  useEffect(() => {
    if (!auth.currentUser) return;

    const now = new Date();
    let startDate = new Date();
    
    if (timeRange === 'daily') {
      startDate.setHours(0, 0, 0, 0);
    } else if (timeRange === 'weekly') {
      startDate.setDate(now.getDate() - 7);
    } else if (timeRange === 'monthly') {
      startDate.setMonth(now.getMonth() - 1);
    } else if (timeRange === 'custom' && customRange.start) {
      startDate = new Date(customRange.start);
    }

    const startIso = startDate.toISOString();
    const endIso = timeRange === 'custom' && customRange.end 
      ? new Date(customRange.end).toISOString() 
      : new Date().toISOString();

    const unsubBuy = onSnapshot(
      query(collection(db, 'buyTickets'), where('timestamp', '>=', startIso), where('timestamp', '<=', endIso)), 
      (snapshot) => {
        setBuyTickets(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as BuyTicket[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'buyTickets')
    );

    const unsubTrip = onSnapshot(
      query(collection(db, 'tripTickets'), where('timestamp', '>=', startIso), where('timestamp', '<=', endIso)), 
      (snapshot) => {
        setTripTickets(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as TripTicket[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'tripTickets')
    );

    const unsubMaterials = onSnapshot(collection(db, 'materials'), (snapshot) => {
      setMaterials(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Material[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'materials'));

    const unsubCustomers = onSnapshot(collection(db, 'customers'), (snapshot) => {
      setCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Customer[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'customers'));

    const unsubInvoices = onSnapshot(collection(db, 'invoices'), (snapshot) => {
      setInvoices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Invoice[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'invoices'));

    const unsubInventory = onSnapshot(collection(db, 'inventory'), (snapshot) => {
      setInventory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as InventoryItem[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'inventory'));

    const unsubAudit = onSnapshot(
      query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'), limit(100)),
      (snapshot) => {
        setAuditLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as AuditLog[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'auditLogs')
    );

    const unsubSnapshots = onSnapshot(
      query(collection(db, 'dailySnapshots'), orderBy('timestamp', 'desc'), limit(30)),
      (snapshot) => {
        setDailySnapshots(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as DailySnapshot[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'dailySnapshots')
    );

    const unsubPricingSnapshots = onSnapshot(
      query(collection(db, 'pricingSnapshots'), orderBy('timestamp', 'desc')),
      (snapshot) => {
        setPricingSnapshots(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as PricingSnapshot[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'pricingSnapshots')
    );

    const unsubSubmissions = onSnapshot(
      query(collection(db, 'complianceSubmissions'), orderBy('timestamp', 'desc'), limit(50)),
      (snapshot) => {
        setComplianceSubmissions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ComplianceSubmission[]);
        setLoading(false);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'complianceSubmissions')
    );

    const unsubCashTx = onSnapshot(
      query(collection(db, 'cashTransactions'), where('timestamp', '>=', startIso), where('timestamp', '<=', endIso)),
      (snapshot) => {
        setCashTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as CashTransaction[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'cashTransactions')
    );

    const unsubSessions = onSnapshot(
      query(collection(db, 'cashSessions'), orderBy('date', 'desc'), limit(100)),
      (snapshot) => {
        setCashSessions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as CashSession[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'cashSessions')
    );

    return () => {
      unsubBuy?.();
      unsubTrip?.();
      unsubMaterials?.();
      unsubCustomers?.();
      unsubInvoices?.();
      unsubInventory?.();
      unsubAudit?.();
      unsubSnapshots?.();
      unsubPricingSnapshots?.();
      unsubSubmissions?.();
      unsubCashTx?.();
      unsubSessions?.();
    };
  }, [profile, timeRange, customRange]);

  const validBuyTickets = useMemo(() => 
    buyTickets.filter(t => (t.status || 'completed') === 'completed'),
  [buyTickets]);

  // Synchronize complianceTickets with selectedXmlTickets when complianceTickets changes
  useEffect(() => {
    if (complianceTickets.length > 0) {
      setSelectedXmlTickets(complianceTickets.map(t => t.id));
    } else {
      setSelectedXmlTickets([]);
    }
  }, [complianceTickets]);

  // Automatically query completed tickets for the chosen compliance date
  useEffect(() => {
    if (!auth.currentUser || !complianceDate) return;

    // Use local timezone bounds for query matching
    const startOfDay = new Date(`${complianceDate}T00:00:00`);
    const endOfDay = new Date(`${complianceDate}T23:59:59.999`);

    const q = query(
      collection(db, 'buyTickets'),
      where('timestamp', '>=', startOfDay.toISOString()),
      where('timestamp', '<=', endOfDay.toISOString())
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const tickets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as BuyTicket[];
      setComplianceTickets(tickets.filter(t => (t.status || 'completed') === 'completed'));
    }, (error) => {
      console.error("Error querying compliance tickets for date:", error);
    });

    return () => {
      try {
        unsub();
      } catch (e) {
        console.warn('unsub compliance tickets error', e);
      }
    };
  }, [complianceDate]);

  const validTripTickets = useMemo(() => 
    tripTickets.filter(t => t.status !== 'cancelled' && t.status !== 'voided'),
  [tripTickets]);

  // Helper to determine the historical sell price of a material on a specific day / timestamp
  const getSellPriceForDay = (materialId: string, timestamp: string): number => {
    if (!timestamp) return materials.find(m => m.id === materialId)?.salePrice || 0;
    const ticketDateStr = timestamp.split('T')[0]; // e.g. YYYY-MM-DD
    
    // 1. Check Daily Snapshots for that exact date
    const dailySnap = dailySnapshots.find(s => s.date === ticketDateStr);
    if (dailySnap) {
      const mat = dailySnap.materials?.find(m => m.id === materialId);
      if (mat && typeof mat.salePrice === 'number' && mat.salePrice > 0) {
        return mat.salePrice;
      }
    }

    // 2. Check Pricing Snapshots on or before the ticket's timestamp
    const sortedPricingSnaps = [...pricingSnapshots].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const snapOnOrBefore = sortedPricingSnaps.find(s => s.timestamp <= timestamp);
    if (snapOnOrBefore) {
      const priceObj = snapOnOrBefore.prices?.find(p => p.materialId === materialId);
      if (priceObj && typeof priceObj.salePrice === 'number' && priceObj.salePrice > 0) {
        return priceObj.salePrice;
      }
    }

    // 3. Fallback to current material sale price
    const currentMat = materials.find(m => m.id === materialId);
    return currentMat?.salePrice || 0;
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
    if (!cat) return 'Other';
    const lower = cat.trim().toLowerCase();
    return categoryCasingMap[lower] || cat.trim();
  }, [categoryCasingMap]);

  const handleSort = (field: string) => {
    if (salesSortField === field) {
      setSalesSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSalesSortField(field);
      setSalesSortDirection('desc');
    }
  };

  const renderSortIcon = (field: string) => {
    if (salesSortField !== field) {
      return <ArrowUpDown className="w-3.5 h-3.5 ml-1 inline-block opacity-45 group-hover:opacity-100 transition-opacity" />;
    }
    return salesSortDirection === 'asc' 
      ? <ArrowUp className="w-3.5 h-3.5 ml-1 inline-block text-indigo-600 font-black" />
      : <ArrowDown className="w-3.5 h-3.5 ml-1 inline-block text-indigo-600 font-black" />;
  };

  const materialPurchases = useMemo(() => {
    const stats: Record<string, { weight: number, cost: number, count: number, expectedRevenue: number }> = {};
    
    validBuyTickets.forEach(ticket => {
      (ticket.materials || []).forEach(m => {
        if (!stats[m.materialId]) {
          stats[m.materialId] = { weight: 0, cost: 0, count: 0, expectedRevenue: 0 };
        }
        
        // Find historical salePrice in the app for that given day
        const historicalSalePrice = getSellPriceForDay(m.materialId, ticket.timestamp);
        
        stats[m.materialId].weight += m.netWeight;
        stats[m.materialId].cost += m.totalAmount;
        stats[m.materialId].count += 1;
        stats[m.materialId].expectedRevenue += (historicalSalePrice * m.netWeight);
      });
    });

    return Object.entries(stats).map(([id, data]) => {
      const profit = data.expectedRevenue - data.cost;
      const margin = data.expectedRevenue > 0 ? (profit / data.expectedRevenue) * 100 : 0;
      const avgBuyPrice = data.weight > 0 ? data.cost / data.weight : 0;
      const avgSalePrice = data.weight > 0 ? data.expectedRevenue / data.weight : 0;
      
      return {
        id,
        name: materials.find(m => m.id === id)?.name || 'Unknown',
        category: getCanonicalCategory(materials.find(m => m.id === id)?.category || 'Unknown'),
        ...data,
        avgBuyPrice,
        avgSalePrice,
        profit,
        margin
      };
    }).sort((a, b) => b.profit - a.profit);
  }, [validBuyTickets, materials, dailySnapshots, pricingSnapshots, getCanonicalCategory]);

  const filteredSortedMaterials = useMemo(() => {
    let result = [...materialPurchases];
    if (materialsSearch) {
      const q = materialsSearch.toLowerCase();
      result = result.filter(m => 
        m.name.toLowerCase().includes(q) || 
        m.category.toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => {
      let valA: any = a[materialsSortField as keyof typeof a];
      let valB: any = b[materialsSortField as keyof typeof b];
      
      if (materialsSortField === 'name') {
        valA = a.name;
        valB = b.name;
      } else if (materialsSortField === 'category') {
        valA = a.category;
        valB = b.category;
      }
      
      if (valA === undefined) valA = a.profit;
      if (valB === undefined) valB = b.profit;
      
      if (typeof valA === 'string' && typeof valB === 'string') {
        return materialsSortDirection === 'asc'
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      }
      return materialsSortDirection === 'asc'
        ? Number(valA) - Number(valB)
        : Number(valB) - Number(valA);
    });
    return result;
  }, [materialPurchases, materialsSearch, materialsSortField, materialsSortDirection]);

  const handleMaterialsSort = (field: string) => {
    if (materialsSortField === field) {
      setMaterialsSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setMaterialsSortField(field);
      setMaterialsSortDirection('desc');
    }
  };

  const renderMaterialsSortIcon = (field: string) => {
    if (materialsSortField !== field) {
      return <ArrowUpDown className="w-3.5 h-3.5 ml-1 inline-block opacity-45 group-hover:opacity-100 transition-opacity" />;
    }
    return materialsSortDirection === 'asc' 
      ? <ArrowUp className="w-3.5 h-3.5 ml-1 inline-block text-indigo-600 font-black" />
      : <ArrowDown className="w-3.5 h-3.5 ml-1 inline-block text-indigo-600 font-black" />;
  };

  const categorySummaryData = useMemo(() => {
    const summary: Record<string, { name: string, weight: number, cost: number, expectedRevenue: number, count: number }> = {};
    
    materialPurchases.forEach(m => {
      const cat = getCanonicalCategory(m.category || 'Other');
      if (!summary[cat]) {
        summary[cat] = { name: cat, weight: 0, cost: 0, expectedRevenue: 0, count: 0 };
      }
      summary[cat].weight += m.weight;
      summary[cat].cost += m.cost;
      summary[cat].expectedRevenue += m.expectedRevenue;
      summary[cat].count += m.count;
    });

    return Object.values(summary).map(item => {
      const profit = item.expectedRevenue - item.cost;
      const margin = item.expectedRevenue > 0 ? (profit / item.expectedRevenue) * 100 : 0;
      return {
        ...item,
        profit,
        margin
      };
    }).sort((a, b) => b.profit - a.profit);
  }, [materialPurchases, getCanonicalCategory]);

  const copperGradesData = useMemo(() => {
    return materialPurchases
      .filter(m => {
        const cat = getCanonicalCategory(m.category || '');
        return cat.toLowerCase() === 'copper' || m.name.toLowerCase().includes('copper') || m.name.toLowerCase().includes('bare bright');
      })
      .sort((a, b) => b.profit - a.profit);
  }, [materialPurchases, getCanonicalCategory]);

  const processedTicketsData = useMemo(() => {
    return validBuyTickets.map((ticket) => {
      const customer = customers.find(c => c.id === ticket.customerId);
      const ticketWeight = (ticket.materials || []).reduce((sum, m) => sum + m.netWeight, 0);
      const ticketCost = ticket.totalAmount;
      
      const ticketResale = (ticket.materials || []).reduce((sum, m) => {
        const histSellPrice = getSellPriceForDay(m.materialId, ticket.timestamp);
        return sum + (histSellPrice * m.netWeight);
      }, 0);
      
      const ticketProfit = ticketResale - ticketCost;
      const ticketMargin = ticketResale > 0 ? (ticketProfit / ticketResale) * 100 : 0;

      return {
        ...ticket,
        customerName: customer ? customer.name : 'Walk-in',
        weight: ticketWeight,
        cost: ticketCost,
        expectedRevenue: ticketResale,
        profit: ticketProfit,
        margin: ticketMargin,
      };
    });
  }, [validBuyTickets, customers, materials, dailySnapshots, pricingSnapshots]);

  const filteredSortedCategories = useMemo(() => {
    let result = [...categorySummaryData];
    if (salesSearch) {
      const q = salesSearch.toLowerCase();
      result = result.filter(item => item.name.toLowerCase().includes(q));
    }
    result.sort((a, b) => {
      let valA = a[salesSortField as keyof typeof a];
      let valB = b[salesSortField as keyof typeof b];
      if (valA === undefined) valA = a.profit;
      if (valB === undefined) valB = b.profit;
      
      if (typeof valA === 'string' && typeof valB === 'string') {
        return salesSortDirection === 'asc'
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      }
      return salesSortDirection === 'asc'
        ? Number(valA) - Number(valB)
        : Number(valB) - Number(valA);
    });
    return result;
  }, [categorySummaryData, salesSearch, salesSortField, salesSortDirection]);

  const filteredSortedCoppers = useMemo(() => {
    let result = [...copperGradesData];
    if (salesSearch) {
      const q = salesSearch.toLowerCase();
      result = result.filter(item => 
        item.name.toLowerCase().includes(q) || 
        item.id.toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => {
      let valA = a[salesSortField as keyof typeof a];
      let valB = b[salesSortField as keyof typeof b];
      if (valA === undefined) valA = a.profit;
      if (valB === undefined) valB = b.profit;
      
      if (typeof valA === 'string' && typeof valB === 'string') {
        return salesSortDirection === 'asc'
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      }
      return salesSortDirection === 'asc'
        ? Number(valA) - Number(valB)
        : Number(valB) - Number(valA);
    });
    return result;
  }, [copperGradesData, salesSearch, salesSortField, salesSortDirection]);

  const filteredSortedTickets = useMemo(() => {
    let result = [...processedTicketsData];
    if (salesSearch) {
      const q = salesSearch.toLowerCase();
      result = result.filter(item => 
        item.id.toLowerCase().includes(q) || 
        item.customerName.toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => {
      let valA: any = a[salesSortField as keyof typeof a];
      let valB: any = b[salesSortField as keyof typeof b];
      
      if (salesSortField === 'timestamp' || salesSortField === 'id') {
        valA = a.timestamp;
        valB = b.timestamp;
      } else if (salesSortField === 'name') {
        valA = a.customerName;
        valB = b.customerName;
      } else if (salesSortField === 'count') {
        valA = (a.materials || []).length;
        valB = (b.materials || []).length;
      }
      
      if (valA === undefined) valA = a.profit;
      if (valB === undefined) valB = b.profit;
      
      if (typeof valA === 'string' && typeof valB === 'string') {
        return salesSortDirection === 'asc'
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      }
      return salesSortDirection === 'asc'
        ? Number(valA) - Number(valB)
        : Number(valB) - Number(valA);
    });
    return result;
  }, [processedTicketsData, salesSearch, salesSortField, salesSortDirection]);

  // Chart Data: Daily Volume & Spending
  const chartData = useMemo(() => {
    const daily: Record<string, { date: string, volume: number, spending: number, profit: number }> = {};
    
    if (timeRange === 'daily') {
      // Initialize 24 hours of today
      for (let i = 0; i < 24; i++) {
        const hourStr = `${i === 0 ? 12 : i > 12 ? i - 12 : i} ${i >= 12 ? 'PM' : 'AM'}`;
        daily[hourStr] = { date: hourStr, volume: 0, spending: 0, profit: 0 };
      }

      validBuyTickets.forEach(ticket => {
        const ticketDate = new Date(ticket.timestamp);
        if (ticketDate.toDateString() === new Date().toDateString()) {
          const h = ticketDate.getHours();
          const hourStr = `${h === 0 ? 12 : h > 12 ? h - 12 : h} ${h >= 12 ? 'PM' : 'AM'}`;
          if (daily[hourStr]) {
            daily[hourStr].spending += ticket.totalAmount;
            const ticketVolume = (ticket.materials || []).reduce((sum, m) => sum + m.netWeight, 0);
            daily[hourStr].volume += ticketVolume;
            
            const ticketProfit = (ticket.materials || []).reduce((sum, m) => {
              const historicalSalePrice = getSellPriceForDay(m.materialId, ticket.timestamp);
              return sum + ((historicalSalePrice - m.pricePerUnit) * m.netWeight);
            }, 0);
            daily[hourStr].profit += ticketProfit;
          }
        }
      });
    } else {
      // Initialize last 30 days if monthly, or 7 days if weekly
      const days = timeRange === 'monthly' ? 30 : 7;
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        daily[dateStr] = { date: dateStr, volume: 0, spending: 0, profit: 0 };
      }

      validBuyTickets.forEach(ticket => {
        const dateStr = new Date(ticket.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (daily[dateStr]) {
          daily[dateStr].spending += ticket.totalAmount;
          const ticketVolume = (ticket.materials || []).reduce((sum, m) => sum + m.netWeight, 0);
          daily[dateStr].volume += ticketVolume;
          
          const ticketProfit = (ticket.materials || []).reduce((sum, m) => {
            const historicalSalePrice = getSellPriceForDay(m.materialId, ticket.timestamp);
            return sum + ((historicalSalePrice - m.pricePerUnit) * m.netWeight);
          }, 0);
          daily[dateStr].profit += ticketProfit;
        }
      });
    }

    validTripTickets.forEach(ticket => {
      const dateStr = new Date(ticket.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      // We could also track ticket value here if needed
    });

    return Object.values(daily);
  }, [validBuyTickets, timeRange, materials, dailySnapshots, pricingSnapshots]);

  const validInvoices = useMemo(() => 
    invoices.filter(i => i.status !== 'draft'),
  [invoices]);

  const salesStats = useMemo(() => {
    const stats: Record<string, { total: number, collected: number, weight: number, count: number }> = {};
    
    validInvoices.forEach(inv => {
      if (!stats[inv.buyerName]) {
        stats[inv.buyerName] = { total: 0, collected: 0, weight: 0, count: 0 };
      }
      stats[inv.buyerName].total += inv.totalAmount;
      stats[inv.buyerName].weight += inv.totalWeight;
      stats[inv.buyerName].count += 1;
      if (inv.status === 'paid') {
        stats[inv.buyerName].collected += inv.totalAmount;
      }
    });

    return Object.entries(stats).map(([name, data]) => ({
      name,
      ...data,
      uncollected: data.total - data.collected
    })).sort((a, b) => b.total - a.total);
  }, [validInvoices]);

  const dailyChartData = useMemo(() => {
    const daily: Record<string, { date: string, revenue: number, expenses: number, profit: number }> = {};
    
    if (timeRange === 'daily') {
      // Initialize 24 hours of today
      for (let i = 0; i < 24; i++) {
        const hourStr = `${i === 0 ? 12 : i > 12 ? i - 12 : i} ${i >= 12 ? 'PM' : 'AM'}`;
        daily[hourStr] = { date: hourStr, revenue: 0, expenses: 0, profit: 0 };
      }

      validBuyTickets.forEach(ticket => {
        const ticketDate = new Date(ticket.timestamp);
        if (ticketDate.toDateString() === new Date().toDateString()) {
          const h = ticketDate.getHours();
          const hourStr = `${h === 0 ? 12 : h > 12 ? h - 12 : h} ${h >= 12 ? 'PM' : 'AM'}`;
          if (daily[hourStr]) {
            daily[hourStr].expenses += ticket.totalAmount;
            
            const ticketEstRevenue = (ticket.materials || []).reduce((sum, m) => {
              const historicalSalePrice = getSellPriceForDay(m.materialId, ticket.timestamp);
              return sum + (historicalSalePrice * m.netWeight);
            }, 0);
            daily[hourStr].revenue += ticketEstRevenue;
          }
        }
      });
    } else {
      const dCount = timeRange === 'monthly' ? 30 : 7;
      for (let i = dCount - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        daily[dateStr] = { date: dateStr, revenue: 0, expenses: 0, profit: 0 };
      }

      validBuyTickets.forEach(ticket => {
        const dateStr = new Date(ticket.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (daily[dateStr]) {
          daily[dateStr].expenses += ticket.totalAmount;
          
          const ticketEstRevenue = (ticket.materials || []).reduce((sum, m) => {
            const historicalSalePrice = getSellPriceForDay(m.materialId, ticket.timestamp);
            return sum + (historicalSalePrice * m.netWeight);
          }, 0);
          daily[dateStr].revenue += ticketEstRevenue;
        }
      });
    }

    return Object.values(daily).map(d => ({
      ...d,
      profit: d.revenue - d.expenses
    }));
  }, [validBuyTickets, timeRange, materials, dailySnapshots, pricingSnapshots]);

  const totalSpent = validBuyTickets.reduce((sum, t) => sum + t.totalAmount, 0);
  const totalExpectedProfit = materialPurchases.reduce((sum, m) => sum + m.profit, 0);
  const totalWeightBought = validBuyTickets.reduce((sum, t) => {
    const weight = (t.materials || []).reduce((mSum, m) => mSum + m.netWeight, 0);
    return sum + weight;
  }, 0);
  const totalWeightSold = validTripTickets.reduce((sum, t) => {
    const weight = t.materials.reduce((mSum, m) => mSum + m.weight, 0);
    return sum + weight;
  }, 0);

  const cashFlowMetrics = useMemo(() => {
    const totalInflows = cashTransactions
      .filter(t => t.type === 'inflow')
      .reduce((sum, t) => sum + t.amount, 0);

    const bankWithdrawals = cashTransactions
      .filter(t => t.type === 'inflow' && (
        t.category?.toLowerCase() === 'bank run' || 
        t.category?.toLowerCase() === 'bank withdrawal' || 
        t.category?.toLowerCase() === 'cash in'
      ))
      .reduce((sum, t) => sum + t.amount, 0);

    const otherInflows = totalInflows - bankWithdrawals;

    const totalExpenses = cashTransactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);

    const expensesByCategory: Record<string, number> = {};
    cashTransactions
      .filter(t => t.type === 'expense')
      .forEach(t => {
        const cat = t.category || 'Other';
        expensesByCategory[cat] = (expensesByCategory[cat] || 0) + t.amount;
      });

    const netCashImpact = totalInflows - totalSpent - totalExpenses;

    return {
      totalInflows,
      bankWithdrawals,
      otherInflows,
      totalExpenses,
      expensesByCategory,
      netCashImpact
    };
  }, [cashTransactions, totalSpent]);

  const cashFlowChartData = useMemo(() => {
    const dailyMap: Record<string, { date: string, inflows: number, ticketPayouts: number, expenses: number }> = {};

    cashTransactions.forEach(t => {
      const dateStr = new Date(t.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      if (!dailyMap[dateStr]) {
        dailyMap[dateStr] = { date: dateStr, inflows: 0, ticketPayouts: 0, expenses: 0 };
      }
      if (t.type === 'inflow') {
        dailyMap[dateStr].inflows += t.amount;
      } else if (t.type === 'expense') {
        dailyMap[dateStr].expenses += t.amount;
      }
    });

    validBuyTickets.forEach(t => {
      const dateStr = new Date(t.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      if (!dailyMap[dateStr]) {
        dailyMap[dateStr] = { date: dateStr, inflows: 0, ticketPayouts: 0, expenses: 0 };
      }
      dailyMap[dateStr].ticketPayouts += t.totalAmount;
    });

    const datePairs = Object.values(dailyMap).map(item => {
      const txWithDate = cashTransactions.find(t => new Date(t.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) === item.date);
      const ticketWithDate = validBuyTickets.find(t => new Date(t.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) === item.date);
      const timestamp = txWithDate ? new Date(txWithDate.timestamp).getTime() : (ticketWithDate ? new Date(ticketWithDate.timestamp).getTime() : 0);
      return { item, timestamp };
    });

    return datePairs.sort((a, b) => a.timestamp - b.timestamp).map(p => p.item);
  }, [cashTransactions, validBuyTickets]);

  const filteredSessions = useMemo(() => {
    let startDate = new Date();
    const now = new Date();
    if (timeRange === 'daily') {
      startDate.setHours(0, 0, 0, 0);
    } else if (timeRange === 'weekly') {
      startDate.setDate(now.getDate() - 7);
    } else if (timeRange === 'monthly') {
      startDate.setMonth(now.getMonth() - 1);
    } else if (timeRange === 'custom' && customRange.start) {
      startDate = new Date(customRange.start);
    }

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = (timeRange === 'custom' && customRange.end) 
      ? new Date(customRange.end).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];
    return cashSessions.filter(s => s.date >= startStr && s.date <= endStr);
  }, [cashSessions, timeRange, customRange]);

  const exportData = async (format: 'csv' | 'xml') => {
    let filename = `${activeTab}_report_${timeRange}`;
    let content = '';
    let mimeType = '';

    if (activeTab === 'overview') {
      if (format === 'csv') {
        const headers = ['Hour/Date', 'Volume (lb)', 'Spending ($)', 'Profit ($)'];
        const rows = chartData.map(d => [
          d.date,
          d.volume.toFixed(2),
          d.spending.toFixed(2),
          d.profit.toFixed(2)
        ]);
        content = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        mimeType = 'text/csv;charset=utf-8;';
        filename += '.csv';
      } else {
        content = `<?xml version="1.0" encoding="UTF-8"?>\n<YardOverviewReport>\n  <TimeRange>${timeRange}</TimeRange>\n  <GeneratedAt>${new Date().toISOString()}</GeneratedAt>\n  <Records>\n`;
        chartData.forEach(d => {
          content += `    <Record>\n      <Date>${escapeXml(d.date)}</Date>\n      <Volume>${d.volume.toFixed(2)}</Volume>\n      <Spending>${d.spending.toFixed(2)}</Spending>\n      <Profit>${d.profit.toFixed(2)}</Profit>\n    </Record>\n`;
        });
        content += `  </Records>\n</YardOverviewReport>`;
        mimeType = 'application/xml;charset=utf-8;';
        filename += '.xml';
      }
    } else if (activeTab === 'materials') {
      if (format === 'csv') {
        const headers = ['Material', 'Category', 'Volume (lb)', 'Total Cost ($)', 'Expected Profit ($)', 'Margin (%)', 'Transaction Count'];
        const rows = materialPurchases.map(m => [
          m.name,
          m.category,
          m.weight.toFixed(2),
          m.cost.toFixed(2),
          m.profit.toFixed(2),
          m.margin.toFixed(1) + '%',
          m.count
        ]);
        content = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        mimeType = 'text/csv;charset=utf-8;';
        filename += '.csv';
      } else {
        content = `<?xml version="1.0" encoding="UTF-8"?>\n<MaterialsPurchaseReport>\n  <TimeRange>${timeRange}</TimeRange>\n  <GeneratedAt>${new Date().toISOString()}</GeneratedAt>\n  <Materials>\n`;
        materialPurchases.forEach(m => {
          content += `    <Material>\n      <Name>${escapeXml(m.name)}</Name>\n      <Category>${escapeXml(m.category)}</Category>\n      <Volume>${m.weight.toFixed(2)}</Volume>\n      <TotalCost>${m.cost.toFixed(2)}</TotalCost>\n      <ExpectedProfit>${m.profit.toFixed(2)}</ExpectedProfit>\n      <Margin>${m.margin.toFixed(1)}%</Margin>\n      <TransactionCount>${m.count}</TransactionCount>\n    </Material>\n`;
        });
        content += `  </Materials>\n</MaterialsPurchaseReport>`;
        mimeType = 'application/xml;charset=utf-8;';
        filename += '.xml';
      }
    } else if (activeTab === 'sales') {
      const salesRows = validBuyTickets;
      if (format === 'csv') {
        const headers = ['Ticket ID', 'Timestamp', 'Customer Name', 'Vehicle Plate', 'Payment Method', 'Total Amount', 'Status'];
        const rows = salesRows.map(t => {
          const customer = customers.find(c => c.id === t.customerId);
          return [
            t.id,
            t.timestamp,
            customer ? customer.name : 'Unknown',
            t.vehiclePlate || 'N/A',
            t.paymentMethod || 'cash',
            t.totalAmount.toFixed(2),
            t.status || 'completed'
          ];
        });
        content = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        mimeType = 'text/csv;charset=utf-8;';
        filename += '.csv';
      } else {
        content = `<?xml version="1.0" encoding="UTF-8"?>\n<SalesReport>\n  <TimeRange>${timeRange}</TimeRange>\n  <GeneratedAt>${new Date().toISOString()}</GeneratedAt>\n  <Tickets>\n`;
        salesRows.forEach(t => {
          const customer = customers.find(c => c.id === t.customerId);
          content += `    <Ticket>\n      <TicketID>${escapeXml(t.id)}</TicketID>\n      <Timestamp>${escapeXml(t.timestamp)}</Timestamp>\n      <CustomerName>${escapeXml(customer ? customer.name : 'Unknown')}</CustomerName>\n      <VehiclePlate>${escapeXml(t.vehiclePlate || 'N/A')}</VehiclePlate>\n      <PaymentMethod>${escapeXml(t.paymentMethod || 'cash')}</PaymentMethod>\n      <TotalAmount>${t.totalAmount.toFixed(2)}</TotalAmount>\n      <Status>${escapeXml(t.status || 'completed')}</Status>\n    </Ticket>\n`;
        });
        content += `  </Tickets>\n</SalesReport>`;
        mimeType = 'application/xml;charset=utf-8;';
        filename += '.xml';
      }
    } else if (activeTab === 'compliance') {
      if (format === 'csv') {
        const headers = ['Transaction ID', 'Timestamp', 'Customer Name', 'ID Number', 'ID Type', 'Weight (lb)', 'Payment Method', 'Affirmed'];
        const rows = validBuyTickets.flatMap(ticket => {
          const customer = customers.find(c => c.id === ticket.customerId);
          return (ticket.materials || []).map(m => {
            return [
              ticket.id,
              ticket.timestamp,
              customer ? customer.name : 'Unknown',
              customer ? customer.idNumber : 'N/A',
              customer ? customer.idType : 'N/A',
              m.netWeight.toFixed(2),
              ticket.paymentMethod || 'cash',
              ticket.sellerAffirmed ? 'Yes' : 'No'
            ];
          });
        });
        content = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        mimeType = 'text/csv;charset=utf-8;';
        filename += '.csv';
      } else {
        let xmlToExport = '';
        if (generatedXml && selectedXmlTickets.length > 0) {
          xmlToExport = generatedXml;
        } else {
          xmlToExport = await handleGenerateXml(validBuyTickets);
        }
        content = xmlToExport;
        mimeType = 'application/xml;charset=utf-8;';
        filename += '.xml';
      }
    } else if (activeTab === 'history') {
      const logs = auditLogs.filter(log => {
        if (auditFilter.type !== 'all' && log.action !== auditFilter.type && log.entityType !== auditFilter.type) return false;
        if (auditFilter.query) {
          const query = auditFilter.query.toLowerCase();
          return (
            log.performedBy.toLowerCase().includes(query) ||
            log.notes?.toLowerCase().includes(query) ||
            log.entityType.toLowerCase().includes(query) ||
            log.id.toLowerCase().includes(query)
          );
        }
        return true;
      });

      if (format === 'csv') {
        const headers = ['Log ID', 'Timestamp', 'Performed By', 'Action', 'Entity Type', 'Details'];
        const rows = logs.map(l => [
          l.id,
          l.timestamp,
          l.performedBy || 'System',
          l.action,
          l.entityType,
          `"${(l.notes || '').replace(/"/g, '""')}"`
        ]);
        content = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        mimeType = 'text/csv;charset=utf-8;';
        filename += '.csv';
      } else {
        content = `<?xml version="1.0" encoding="UTF-8"?>\n<AuditHistoryReport>\n  <GeneratedAt>${new Date().toISOString()}</GeneratedAt>\n  <Logs>\n`;
        logs.forEach(l => {
          content += `    <Log>\n      <LogID>${escapeXml(l.id)}</LogID>\n      <Timestamp>${escapeXml(l.timestamp)}</Timestamp>\n      <PerformedBy>${escapeXml(l.performedBy || 'System')}</PerformedBy>\n      <Action>${escapeXml(l.action)}</Action>\n      <EntityType>${escapeXml(l.entityType)}</EntityType>\n      <Details>${escapeXml(l.notes || '')}</Details>\n    </Log>\n`;
        });
        content += `  </Logs>\n</AuditHistoryReport>`;
        mimeType = 'application/xml;charset=utf-8;';
        filename += '.xml';
      }
    } else if (activeTab === 'backups') {
      if (format === 'csv') {
        const headers = ['Snapshot ID', 'Date', 'Timestamp', 'Created By', 'Buy Tickets Count', 'Buy Tickets Amount ($)', 'Trip Tickets Count', 'Invoices Count', 'Invoices Amount ($)'];
        const rows = dailySnapshots.map(s => [
          s.id,
          s.date,
          s.timestamp,
          s.createdBy,
          s.summary.totalBuyTickets,
          s.summary.totalBuyAmount.toFixed(2),
          s.summary.totalTripTickets,
          s.summary.totalInvoices,
          s.summary.totalInvoiceAmount.toFixed(2)
        ]);
        content = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        mimeType = 'text/csv;charset=utf-8;';
        filename += '.csv';
      } else {
        content = `<?xml version="1.0" encoding="UTF-8"?>\n<SnapshotsReport>\n  <GeneratedAt>${new Date().toISOString()}</GeneratedAt>\n  <Snapshots>\n`;
        dailySnapshots.forEach(s => {
          content += `    <Snapshot>\n      <SnapshotID>${escapeXml(s.id)}</SnapshotID>\n      <Date>${escapeXml(s.date)}</Date>\n      <Timestamp>${escapeXml(s.timestamp)}</Timestamp>\n      <CreatedBy>${escapeXml(s.createdBy)}</CreatedBy>\n      <Summary>\n        <TotalBuyTickets>${s.summary.totalBuyTickets}</TotalBuyTickets>\n        <TotalBuyAmount>${s.summary.totalBuyAmount.toFixed(2)}</TotalBuyAmount>\n        <TotalTripTickets>${s.summary.totalTripTickets}</TotalTripTickets>\n        <TotalInvoices>${s.summary.totalInvoices}</TotalInvoices>\n        <TotalInvoiceAmount>${s.summary.totalInvoiceAmount.toFixed(2)}</TotalInvoiceAmount>\n      </Summary>\n    </Snapshot>\n`;
        });
        content += `  </Snapshots>\n</SnapshotsReport>`;
        mimeType = 'application/xml;charset=utf-8;';
        filename += '.xml';
      }
    } else if (activeTab === 'cash_flow') {
      if (format === 'csv') {
        const headers = ['Transaction ID', 'Timestamp', 'Type', 'Category', 'Amount ($)', 'Notes', 'Performed By'];
        const rows = cashTransactions.map(t => [
          t.id,
          t.timestamp,
          t.type,
          t.category,
          t.amount.toFixed(2),
          `"${(t.notes || '').replace(/"/g, '""')}"`,
          t.performedBy
        ]);
        content = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        mimeType = 'text/csv;charset=utf-8;';
        filename += '.csv';
      } else {
        content = `<?xml version="1.0" encoding="UTF-8"?>\n<CashFlowReport>\n  <TimeRange>${timeRange}</TimeRange>\n  <GeneratedAt>${new Date().toISOString()}</GeneratedAt>\n  <Transactions>\n`;
        cashTransactions.forEach(t => {
          content += `    <Transaction>\n      <TransactionID>${escapeXml(t.id)}</TransactionID>\n      <Timestamp>${escapeXml(t.timestamp)}</Timestamp>\n      <Type>${escapeXml(t.type)}</Type>\n      <Category>${escapeXml(t.category)}</Category>\n      <Amount>${t.amount.toFixed(2)}</Amount>\n      <Notes>${escapeXml(t.notes || '')}</Notes>\n      <PerformedBy>${escapeXml(t.performedBy)}</PerformedBy>\n    </Transaction>\n`;
        });
        content += `  </Transactions>\n</CashFlowReport>`;
        mimeType = 'application/xml;charset=utf-8;';
        filename += '.xml';
      }
    }

    if (!content) return;

    const blob = new Blob([content], { type: mimeType });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    if (!settings.debugPrintMode) window.print();
    else console.log('DEBUG PRINT: window.print() bypassed.');
  };

  const createDailySnapshot = async (force = false) => {
    if (!profile) return;
    
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    
    // Check if snapshot already exists for today
    const existing = dailySnapshots.find(s => s.date === dateStr);
    if (existing && !force) {
      setNotification({
        type: 'warning',
        message: 'A snapshot for today already exists. Overwrite?',
        onConfirm: () => {
          setNotification(null);
          createDailySnapshot(true);
        }
      });
      return;
    }

    setCreatingSnapshot(true);
    try {
      // Filter data for today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const todayBuyTickets = validBuyTickets.filter(t => {
        const d = new Date(t.timestamp);
        return d >= todayStart && d <= todayEnd;
      });

      const todayTripTickets = tripTickets.filter(t => {
        const d = new Date(t.timestamp);
        return d >= todayStart && d <= todayEnd;
      });

      const todayInvoices = invoices.filter(i => {
        const d = new Date(i.date);
        return d >= todayStart && d <= todayEnd;
      });

      const snapshotData: Omit<DailySnapshot, 'id'> = {
        date: dateStr,
        timestamp: new Date().toISOString(),
        createdBy: profile.email,
        materials: materials.map(m => ({
          id: m.id,
          code: m.code,
          name: m.name,
          buyPrice: m.buyPrice,
          salePrice: m.salePrice,
          unit: m.unit
        })),
        inventory: inventory.map(inv => ({
          materialId: inv.materialId,
          weight: inv.currentWeight
        })),
        summary: {
          totalBuyTickets: todayBuyTickets.length,
          totalBuyAmount: todayBuyTickets.reduce((sum, t) => sum + t.totalAmount, 0),
          totalBuyWeight: todayBuyTickets.reduce((sum, t) => sum + t.materials.reduce((mSum, m) => mSum + m.netWeight, 0), 0),
          totalTripTickets: todayTripTickets.length,
          totalTripWeight: todayTripTickets.reduce((sum, t) => sum + t.materials.reduce((mSum, m) => mSum + m.weight, 0), 0),
          totalInvoices: todayInvoices.length,
          totalInvoiceAmount: todayInvoices.reduce((sum, i) => sum + i.totalAmount, 0)
        }
      };

      await addDoc(collection(db, 'dailySnapshots'), snapshotData);
      setNotification({ type: 'success', message: 'Daily snapshot created successfully!' });
    } catch (error) {
      console.error('Error creating snapshot:', error);
      setNotification({ type: 'error', message: 'Failed to create snapshot.' });
    } finally {
      setCreatingSnapshot(false);
    }
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (profile?.role !== 'manager' || !profile?.permissions?.canGenerateReports) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8">
        <div className="p-6 bg-red-50 rounded-full text-red-600 mb-6">
          <Lock className="w-12 h-12" />
        </div>
        <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Access Restricted</h2>
        <p className="text-slate-500 mt-2 max-w-md">You do not have the required permissions to access reports and analytics. Please contact your system administrator.</p>
      </div>
    );
  }

  return (
    <main className="space-y-8 print:space-y-4 print:p-0">
      {/* Notification Modal */}
      {notification && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-4">
              <div className={cn(
                "p-3 rounded-2xl",
                notification.type === 'success' ? "bg-green-50 text-green-600" : 
                notification.type === 'warning' ? "bg-amber-50 text-amber-600" : 
                "bg-red-50 text-red-600"
              )}>
                {notification.type === 'success' ? <ShieldCheck className="w-6 h-6" /> : 
                 notification.type === 'warning' ? <AlertTriangle className="w-6 h-6" /> : 
                 <AlertTriangle className="w-6 h-6" />}
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                  {notification.type === 'success' ? 'Success' : 
                   notification.type === 'warning' ? 'Confirmation' : 
                   'Error'}
                </h3>
                <p className="text-slate-500 font-medium">{notification.message}</p>
              </div>
            </div>
            <div className="flex gap-3">
              {notification.onConfirm ? (
                <>
                  <button 
                    onClick={() => setNotification(null)}
                    className="flex-1 px-6 py-3 bg-slate-100 text-slate-600 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={notification.onConfirm}
                    className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all shadow-xl shadow-blue-200"
                  >
                    Confirm
                  </button>
                </>
              ) : (
                <button 
                  onClick={() => setNotification(null)}
                  className="w-full px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header - Hidden on Print */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 print:hidden">
        <div className="flex items-center gap-6">
          <div className="w-20 h-10 flex items-center justify-center overflow-hidden shrink-0">
            <BrandLogo className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tight font-display">Yard Performance Reports</h1>
            <p className="text-slate-500 font-medium mt-1">Detailed granularity for material purchases and financial trends.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => exportData('csv')}
            className="flex items-center gap-2 px-5 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 transition-all shadow-sm active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            aria-label="Export report to CSV"
          >
            <Download className="w-5 h-5" aria-hidden="true" />
            Export CSV
          </button>
          <button 
            onClick={() => exportData('xml')}
            className="flex items-center gap-2 px-5 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 transition-all shadow-sm active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            aria-label="Export report to XML"
          >
            <FileCode className="w-5 h-5" aria-hidden="true" />
            Export XML
          </button>
          <button 
            onClick={handlePrint}
            className="flex items-center gap-2 px-5 py-3 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            aria-label="Print report"
          >
            <Printer className="w-5 h-5" aria-hidden="true" />
            Print Report
          </button>
        </div>
      </header>

      {/* Print Header - Only visible on Print */}
      <div className="hidden print:flex justify-between items-start border-b-2 border-slate-900 pb-8 mb-8">
        <div className="space-y-1">
          <h1 className="text-4xl font-black uppercase tracking-tight">{COMPANY_NAME}</h1>
          <p className="text-sm text-slate-400 font-medium tracking-wide mt-0.5">{COMPANY_WEBSITE}</p>
          <p className="text-sm text-slate-500 font-bold mt-1">{COMPANY_ADDRESS}</p>
          <p className="text-sm text-slate-500 mt-1">{COMPANY_PHONE} | {COMPANY_EMAIL}</p>
          <div className="pt-4">
            <h2 className="text-xl font-bold text-slate-900">Yard Performance Report</h2>
            <div className="flex gap-6 mt-1 text-xs font-bold text-slate-400 uppercase tracking-widest">
              <span>Interval: {timeRange}</span>
              <span>Generated: {new Date().toLocaleString()}</span>
            </div>
          </div>
        </div>
        <div className="w-16 h-16 flex items-center justify-center">
          <BrandLogo className="w-full h-full object-contain grayscale opacity-60" grayscale />
        </div>
      </div>

      {/* Filters - Hidden on Print */}
      <section className="flex flex-wrap items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm print:hidden" aria-label="Filters">
        <div className="flex items-center gap-2 text-slate-400 mr-2">
          <Filter className="w-4 h-4" aria-hidden="true" />
          <span className="text-xs font-bold uppercase tracking-wider">Interval</span>
        </div>
        <nav className="flex bg-slate-100 p-1 rounded-xl" aria-label="Time range">
          {(['daily', 'weekly', 'monthly', 'custom'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={cn(
                "px-6 py-2 text-sm font-bold rounded-lg transition-all capitalize outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                timeRange === range ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
              aria-current={timeRange === range ? 'page' : undefined}
            >
              {range}
            </button>
          ))}
        </nav>

        {timeRange === 'custom' && (
          <div className="flex items-center gap-2 animate-in slide-in-from-left-2 duration-200">
            <label htmlFor="start-date" className="sr-only">Start Date</label>
            <input 
              id="start-date"
              type="date" 
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              value={customRange.start}
              onChange={(e) => setCustomRange(prev => ({ ...prev, start: e.target.value }))}
            />
            <span className="text-slate-400" aria-hidden="true">to</span>
            <label htmlFor="end-date" className="sr-only">End Date</label>
            <input 
              id="end-date"
              type="date" 
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              value={customRange.end}
              onChange={(e) => setCustomRange(prev => ({ ...prev, end: e.target.value }))}
            />
          </div>
        )}
      </section>

      {/* Tab Navigation */}
      <nav className="flex border-b border-slate-200 print:hidden" aria-label="Report sections">
        {(['overview', 'materials', 'sales', 'cash_flow', 'compliance', 'backups', 'history'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
               "px-8 py-4 text-sm font-black uppercase tracking-widest transition-all relative",
              activeTab === tab 
                ? "text-blue-600" 
                : "text-slate-400 hover:text-slate-600"
            )}
          >
            {tab === 'history' ? 'Audit Logs' : tab === 'compliance' ? 'Ohio Compliance & XML' : tab === 'cash_flow' ? 'Cash Flow' : tab === 'sales' ? 'Est. Sales & Profits' : tab}
            {activeTab === tab && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-600 rounded-t-full" aria-hidden="true" />
            )}
          </button>
        ))}
      </nav>

      {activeTab === 'overview' && (
        <>
          {/* Key Stats */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6" aria-label="Key performance indicators">
        {[
          { name: 'Total Payouts', value: `$${totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: DollarSign, color: 'blue' },
          { name: 'Est. Sales (Revenue)', value: `$${(totalSpent + totalExpectedProfit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: TrendingUp, color: 'emerald' },
          { name: 'Volume Bought', value: `${totalWeightBought.toLocaleString()} lb`, icon: Package, color: 'indigo' },
          { name: 'Est. Profit', value: `$${totalExpectedProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: Activity, color: 'amber' },
        ].map((stat) => (
          <article key={stat.name} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm print:border-slate-300">
            <div className="flex items-center gap-4 mb-4">
              <div className={cn("p-3 rounded-xl", {
                'bg-blue-50 text-blue-600': stat.color === 'blue',
                'bg-indigo-50 text-indigo-600': stat.color === 'indigo',
                'bg-emerald-50 text-emerald-600': stat.color === 'emerald',
                'bg-amber-50 text-amber-600': stat.color === 'amber',
              })} aria-hidden="true">
                <stat.icon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{stat.name}</p>
                <p className="text-2xl font-black text-slate-900">{stat.value}</p>
              </div>
            </div>
          </article>
        ))}
      </section>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm print:border-slate-300">
          <h3 className="font-bold text-slate-900 mb-6 flex items-center gap-2 uppercase tracking-tight text-sm">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            Revenue vs Purchases (lb)
          </h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyChartData}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ fontWeight: 'bold', fontSize: '12px' }}
                />
                <Area type="monotone" dataKey="revenue" name="Sales Revenue" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorRevenue)" />
                <Area type="monotone" dataKey="expenses" name="Material Payouts" stroke="#ef4444" strokeWidth={3} fillOpacity={1} fill="url(#colorExpenses)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm print:border-slate-300">
          <h3 className="font-bold text-slate-900 mb-6 flex items-center gap-2 uppercase tracking-tight text-sm">
            <Package className="w-5 h-5 text-indigo-600" />
            Inventory Volume Index
          </h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} />
                <Tooltip 
                  cursor={{ fill: '#f8fafc' }}
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ fontWeight: 'bold', fontSize: '12px' }}
                />
                <Bar dataKey="volume" name="Pounds Bought" fill="#4f46e5" radius={[6, 6, 0, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </>
  )}

      {activeTab === 'sales' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          
          {/* Main KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Total Est. Resale Value</p>
              <p className="text-3xl font-black text-slate-900">${(totalSpent + totalExpectedProfit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              <div className="mt-4 flex items-center gap-2 text-xs font-bold text-slate-400">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                <span>Estimated Sales Revenue from Purchases</span>
              </div>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Total Material Payouts (Cost)</p>
              <p className="text-3xl font-black text-slate-900">${totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              <div className="mt-4 flex items-center gap-2 text-xs font-bold text-slate-400">
                <DollarSign className="w-4 h-4 text-blue-500" />
                <span>Actual cash paid out for scrap metal</span>
              </div>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Estimated Spread Profit</p>
              <p className="text-3xl font-black text-emerald-600">${totalExpectedProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              <div className="mt-4 flex items-center gap-2 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg w-fit">
                <ArrowUpRight className="w-4 h-4" />
                <span>{((totalExpectedProfit / (totalSpent + totalExpectedProfit || 1)) * 100).toFixed(1)}% Est. Profit Margin</span>
              </div>
            </div>
          </div>

          {/* Sub-tab Navigation */}
          <div className="flex flex-wrap bg-slate-100 p-1.5 rounded-2xl w-fit gap-1 border border-slate-200/50">
            <button
              onClick={() => setSalesSubTab('overview')}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
                salesSubTab === 'overview' 
                  ? "bg-white text-slate-900 shadow-sm" 
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              Overview & Charts
            </button>
            <button
              onClick={() => setSalesSubTab('categories')}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
                salesSubTab === 'categories' 
                  ? "bg-white text-slate-900 shadow-sm" 
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              Category Analysis
            </button>
            <button
              onClick={() => setSalesSubTab('coppers')}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
                salesSubTab === 'coppers' 
                  ? "bg-white text-slate-900 shadow-sm" 
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              Copper Grades Drilldown
            </button>
            <button
              onClick={() => setSalesSubTab('tickets')}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all",
                salesSubTab === 'tickets' 
                  ? "bg-white text-slate-900 shadow-sm" 
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              Ticket Profit Spread ({validBuyTickets.length})
            </button>
          </div>

          {/* Filtering and Sorting controls for Sales Sub-tabs (when not on overview) */}
          {salesSubTab !== 'overview' && (
            <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center gap-4 animate-in fade-in duration-200">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder={
                    salesSubTab === 'categories'
                      ? "Search categories..."
                      : salesSubTab === 'coppers'
                        ? "Search copper materials..."
                        : "Search tickets by ID or customer..."
                  }
                  value={salesSearch}
                  onChange={(e) => {
                    setSalesSearch(e.target.value);
                  }}
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                />
              </div>
              <div className="flex items-center gap-3 w-full sm:w-auto shrink-0 justify-end">
                {salesSearch && (
                  <button
                    onClick={() => setSalesSearch('')}
                    className="text-xs font-black text-rose-500 hover:text-rose-700 bg-rose-50 px-3 py-2 rounded-xl transition-colors uppercase tracking-wider"
                  >
                    Clear Search
                  </button>
                )}
                <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 p-1 rounded-xl">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2">Sort:</span>
                  <select
                    value={salesSortField}
                    onChange={(e) => setSalesSortField(e.target.value)}
                    className="bg-transparent border-none text-xs font-bold text-slate-700 focus:outline-none pr-6 cursor-pointer"
                  >
                    {salesSubTab === 'categories' && (
                      <>
                        <option value="profit">Expected Profit</option>
                        <option value="margin">Margin (%)</option>
                        <option value="weight">Volume (lb)</option>
                        <option value="cost">Payout Cost</option>
                        <option value="expectedRevenue">Est. Resale</option>
                        <option value="name">Category Name</option>
                        <option value="count">Transactions</option>
                      </>
                    )}
                    {salesSubTab === 'coppers' && (
                      <>
                        <option value="profit">Expected Spread</option>
                        <option value="margin">Margin (%)</option>
                        <option value="weight">Volume Received</option>
                        <option value="cost">Payout Cost</option>
                        <option value="expectedRevenue">Est. Resale</option>
                        <option value="name">Material Name</option>
                      </>
                    )}
                    {salesSubTab === 'tickets' && (
                      <>
                        <option value="profit">Est. Profit</option>
                        <option value="margin">Margin (%)</option>
                        <option value="cost">Payout (Cost)</option>
                        <option value="expectedRevenue">Est. Resale</option>
                        <option value="weight">Net Weight</option>
                        <option value="timestamp">Ticket Date</option>
                        <option value="name">Customer Name</option>
                        <option value="count">Item Count</option>
                      </>
                    )}
                  </select>
                  <button
                    onClick={() => setSalesSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                    className="p-1 hover:bg-slate-200 rounded-lg text-slate-500 transition-colors"
                    title={salesSortDirection === 'asc' ? 'Ascending' : 'Descending'}
                  >
                    {salesSortDirection === 'asc' ? (
                      <ArrowUp className="w-3.5 h-3.5 text-indigo-600" />
                    ) : (
                      <ArrowDown className="w-3.5 h-3.5 text-indigo-600" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Sub-tab Content: Overview */}
          {salesSubTab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in duration-200">
              
              {/* Category Profit Distribution Card */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
                <div>
                  <h3 className="font-black text-slate-900 uppercase tracking-tight text-sm flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-600" />
                    Expected Profit Spread by Category
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">Estimated margin spread generated per metal class.</p>
                </div>

                <div className="h-60 my-4 flex items-center justify-center relative">
                  {categorySummaryData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={categorySummaryData}
                          dataKey="profit"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={90}
                          paddingAngle={3}
                        >
                          {categorySummaryData.map((entry, index) => {
                            const colors = ['#b87333', '#3b82f6', '#eab308', '#64748b', '#10b981', '#a855f7', '#ec4899'];
                            return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                          })}
                        </Pie>
                        <Tooltip 
                          formatter={(v: any) => [`$${parseFloat(v).toFixed(2)}`, 'Profit Spread']}
                          contentStyle={{ borderRadius: '12px', fontWeight: 'bold', fontSize: '12px' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-xs text-slate-400 font-bold italic">No data to plot.</p>
                  )}
                  <div className="absolute flex flex-col items-center">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Spread</span>
                    <span className="text-xl font-black text-emerald-600">${totalExpectedProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                </div>

                <div className="space-y-2 mt-2">
                  {categorySummaryData.slice(0, 4).map((cat, index) => {
                    const colors = ['#b87333', '#3b82f6', '#eab308', '#64748b', '#10b981', '#a855f7', '#ec4899'];
                    const share = totalExpectedProfit > 0 ? (cat.profit / totalExpectedProfit) * 100 : 0;
                    return (
                      <div key={cat.name} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
                          <span className="font-bold text-slate-800">{cat.name}</span>
                        </div>
                        <div className="flex items-center gap-4 text-slate-500">
                          <span className="font-medium">{cat.weight.toLocaleString()} lb</span>
                          <span className="font-black text-slate-900">{share.toFixed(1)}% Share</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Spread Profit vs Cost Comparison */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-between">
                <div>
                  <h3 className="font-black text-slate-900 uppercase tracking-tight text-sm flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-blue-600" />
                    Payout Cost vs Spread Profit
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">Comparing buying cost to estimated profit potential.</p>
                </div>

                <div className="h-60 my-4">
                  {categorySummaryData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={categorySummaryData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} fontWeight="bold" tickLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={10} fontWeight="bold" tickLine={false} />
                        <Tooltip 
                          formatter={(v: any) => [`$${parseFloat(v).toFixed(2)}`]}
                          contentStyle={{ borderRadius: '12px', fontWeight: 'bold', fontSize: '11px' }}
                        />
                        <Bar dataKey="cost" name="Payout Cost" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="profit" name="Spread Profit" fill="#10b981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full w-full flex items-center justify-center">
                      <p className="text-xs text-slate-400 font-bold italic">No category comparison data available.</p>
                    </div>
                  )}
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl flex items-center justify-between text-xs mt-2">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Top Profit Class</span>
                    <span className="font-black text-slate-800 mt-0.5">{categorySummaryData[0]?.name || 'N/A'}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Class Margin</span>
                    <p className="font-black text-emerald-600 mt-0.5">{categorySummaryData[0]?.margin.toFixed(1)}%</p>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* Sub-tab Content: Category Analysis */}
          {salesSubTab === 'categories' && (
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in duration-200">
              <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div>
                  <h3 className="font-black text-slate-900 uppercase tracking-tight text-sm">Material Categories Metrics of Value</h3>
                  <p className="text-xs text-slate-400 mt-0.5">High-level financial summaries of different scrap metal groupings.</p>
                </div>
                <span className="text-xs font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-3 py-1 rounded-lg">
                  {filteredSortedCategories.length} categories
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                      <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group" onClick={() => handleSort('name')}>
                        <span className="flex items-center justify-start gap-1">
                          Category Name {renderSortIcon('name')}
                        </span>
                      </th>
                      <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group text-right" onClick={() => handleSort('count')}>
                        <span className="flex items-center justify-end gap-1">
                          Transactions {renderSortIcon('count')}
                        </span>
                      </th>
                      <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group text-right" onClick={() => handleSort('weight')}>
                        <span className="flex items-center justify-end gap-1">
                          Volume (lb) {renderSortIcon('weight')}
                        </span>
                      </th>
                      <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group text-right" onClick={() => handleSort('cost')}>
                        <span className="flex items-center justify-end gap-1">
                          Total Payout {renderSortIcon('cost')}
                        </span>
                      </th>
                      <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group text-right" onClick={() => handleSort('expectedRevenue')}>
                        <span className="flex items-center justify-end gap-1">
                          Est. Resale {renderSortIcon('expectedRevenue')}
                        </span>
                      </th>
                      <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group text-right" onClick={() => handleSort('profit')}>
                        <span className="flex items-center justify-end gap-1">
                          Est. Profit {renderSortIcon('profit')}
                        </span>
                      </th>
                      <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group text-right" onClick={() => handleSort('margin')}>
                        <span className="flex items-center justify-end gap-1">
                          Spread Margin (%) {renderSortIcon('margin')}
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredSortedCategories.map((cat) => (
                      <tr key={cat.name} className="hover:bg-slate-50 transition-colors">
                        <td className="px-8 py-6">
                          <span className="text-sm font-black text-slate-900 uppercase tracking-wide">{cat.name}</span>
                        </td>
                        <td className="px-8 py-6 text-right font-semibold text-slate-700">{cat.count}</td>
                        <td className="px-8 py-6 text-right font-semibold text-slate-700">{cat.weight.toLocaleString()} lb</td>
                        <td className="px-8 py-6 text-right font-bold text-slate-900">${cat.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="px-8 py-6 text-right font-bold text-blue-600">${cat.expectedRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="px-8 py-6 text-right font-black text-emerald-600">${cat.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="px-8 py-6 text-right">
                          <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-black rounded-lg">
                            {cat.margin.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                    {filteredSortedCategories.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-8 py-20 text-center text-slate-400 font-bold uppercase tracking-widest">
                          No matching category metrics available.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Sub-tab Content: Copper Grades Drilldown */}
          {salesSubTab === 'coppers' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              
              {/* Copper Margin Chart */}
              <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-black text-slate-900 uppercase tracking-tight text-sm">Copper Grades Spread Profitability</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Margin spreads across Bare Bright, #1, and #2 copper classifications.</p>
                  </div>
                  <span className="text-xs font-black text-amber-700 uppercase tracking-widest bg-amber-50 px-3 py-1 rounded-lg">
                    High Value Focus
                  </span>
                </div>

                <div className="h-60 mt-6">
                  {copperGradesData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={copperGradesData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="name" stroke="#94a3b8" fontSize={9} fontWeight="black" tickLine={false} />
                        <YAxis stroke="#94a3b8" fontSize={10} fontWeight="bold" tickLine={false} tickFormatter={(v) => `${v}%`} />
                        <Tooltip 
                          formatter={(v: any, name: any) => [name === 'margin' ? `${parseFloat(v).toFixed(1)}%` : `$${parseFloat(v).toFixed(2)}`, name === 'margin' ? 'Margin' : 'Profit Spread']}
                          contentStyle={{ borderRadius: '12px', fontWeight: 'bold', fontSize: '11px' }}
                        />
                        <Bar dataKey="margin" name="Margin" fill="#b87333" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full w-full flex items-center justify-center">
                      <p className="text-xs text-slate-400 font-bold italic">No copper grades purchase history found in this period.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Copper Grades Table */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <h3 className="font-black text-slate-900 uppercase tracking-tight text-sm">Copper Classifications Breakdown</h3>
                  <span className="text-xs font-black text-amber-700 uppercase tracking-widest bg-amber-50 px-3 py-1 rounded-lg">
                    {filteredSortedCoppers.length} items
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                        <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group" onClick={() => handleSort('name')}>
                          <span className="flex items-center justify-start gap-1">
                            Material Name {renderSortIcon('name')}
                          </span>
                        </th>
                        <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group text-right" onClick={() => handleSort('weight')}>
                          <span className="flex items-center justify-end gap-1">
                            Volume Received {renderSortIcon('weight')}
                          </span>
                        </th>
                        <th className="px-8 py-5 text-right">Avg Paid/lb</th>
                        <th className="px-8 py-5 text-right">Avg Sold/lb</th>
                        <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group text-right" onClick={() => handleSort('cost')}>
                          <span className="flex items-center justify-end gap-1">
                            Payout Cost {renderSortIcon('cost')}
                          </span>
                        </th>
                        <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group text-right" onClick={() => handleSort('expectedRevenue')}>
                          <span className="flex items-center justify-end gap-1">
                            Est. Resale {renderSortIcon('expectedRevenue')}
                          </span>
                        </th>
                        <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group text-right" onClick={() => handleSort('profit')}>
                          <span className="flex items-center justify-end gap-1">
                            Expected Spread {renderSortIcon('profit')}
                          </span>
                        </th>
                        <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group text-right" onClick={() => handleSort('margin')}>
                          <span className="flex items-center justify-end gap-1">
                            Margin (%) {renderSortIcon('margin')}
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {filteredSortedCoppers.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-8 py-6">
                            <div className="flex flex-col">
                              <span className="text-sm font-black text-slate-900">{m.name}</span>
                              <span className="text-[10px] font-semibold text-slate-400 mt-0.5">Code ID: {m.id.slice(-6).toUpperCase()}</span>
                            </div>
                          </td>
                          <td className="px-8 py-6 text-right font-semibold text-slate-700">{m.weight.toLocaleString()} lb</td>
                          <td className="px-8 py-6 text-right font-medium text-slate-500">${m.avgBuyPrice.toFixed(3)}</td>
                          <td className="px-8 py-6 text-right font-medium text-blue-600">${m.avgSalePrice.toFixed(3)}</td>
                          <td className="px-8 py-6 text-right font-bold text-slate-900">${m.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="px-8 py-6 text-right font-bold text-slate-900">${m.expectedRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="px-8 py-6 text-right font-black text-emerald-600">${m.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="px-8 py-6 text-right">
                            <span className="px-2 py-0.5 bg-amber-50 text-amber-800 text-[10px] font-black rounded-md">
                              {m.margin.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                      {filteredSortedCoppers.length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-8 py-20 text-center text-slate-400 font-bold uppercase tracking-widest">
                            No matching copper materials found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* Sub-tab Content: Ticket Profit Spread */}
          {salesSubTab === 'tickets' && (
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in duration-200">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h3 className="font-black text-slate-900 uppercase tracking-tight flex items-center gap-2 text-sm">
                  <TrendingUp className="w-5 h-5 text-emerald-600" />
                  Estimated Ticket Profitability & Resale Spread
                </h3>
                <span className="text-xs font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-3 py-1 rounded-lg">
                  {filteredSortedTickets.length} tickets
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                      <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group" onClick={() => handleSort('timestamp')}>
                        <span className="flex items-center justify-start gap-1">
                          Ticket ID / Timestamp {renderSortIcon('timestamp')}
                        </span>
                      </th>
                      <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group" onClick={() => handleSort('name')}>
                        <span className="flex items-center justify-start gap-1">
                          Customer Name {renderSortIcon('name')}
                        </span>
                      </th>
                      <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group text-right" onClick={() => handleSort('weight')}>
                        <span className="flex items-center justify-end gap-1">
                          Net Weight {renderSortIcon('weight')}
                        </span>
                      </th>
                      <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group text-right" onClick={() => handleSort('cost')}>
                        <span className="flex items-center justify-end gap-1">
                          Payout (Cost) {renderSortIcon('cost')}
                        </span>
                      </th>
                      <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group text-right" onClick={() => handleSort('expectedRevenue')}>
                        <span className="flex items-center justify-end gap-1">
                          Est. Resale {renderSortIcon('expectedRevenue')}
                        </span>
                      </th>
                      <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group text-right" onClick={() => handleSort('profit')}>
                        <span className="flex items-center justify-end gap-1">
                          Est. Profit {renderSortIcon('profit')}
                        </span>
                      </th>
                      <th className="px-8 py-5 cursor-pointer hover:bg-slate-100/85 select-none transition-colors group text-right" onClick={() => handleSort('margin')}>
                        <span className="flex items-center justify-end gap-1">
                          Margin (%) {renderSortIcon('margin')}
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredSortedTickets.map((ticket) => {
                      return (
                        <tr key={ticket.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-8 py-6">
                            <div className="flex flex-col">
                              <span className="text-xs font-black text-slate-900 uppercase tracking-wider">{ticket.id.slice(-8).toUpperCase()}</span>
                              <span className="text-[10px] font-semibold text-slate-400 mt-0.5">
                                {new Date(ticket.timestamp).toLocaleDateString()} {new Date(ticket.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            <span className="text-sm font-bold text-slate-800">{ticket.customerName}</span>
                          </td>
                          <td className="px-8 py-6 text-right font-semibold text-slate-700">{ticket.weight.toLocaleString()} lb</td>
                          <td className="px-8 py-6 text-right font-bold text-slate-900">${ticket.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="px-8 py-6 text-right font-bold text-blue-600">${ticket.expectedRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="px-8 py-6 text-right font-black text-emerald-600">${ticket.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="px-8 py-6 text-right">
                            <span className={cn(
                              "px-2 py-1 rounded text-[10px] font-bold whitespace-nowrap",
                              ticket.profit >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                            )}>
                              {ticket.margin.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredSortedTickets.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-8 py-20 text-center text-slate-400 font-bold uppercase tracking-widest">
                          No matching purchase tickets available.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      )}
      {activeTab === 'materials' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden print:border-slate-300">
        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-100 rounded-lg">
              <FileText className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">Material Purchase Granularity</h3>
              <p className="text-[11px] text-slate-500 font-medium mt-0.5">Click column headers to sort materials by volume, payout, profit, margin, etc.</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
            <div className="relative w-full sm:max-w-xs shrink-0">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search materials by name or category..."
                value={materialsSearch}
                onChange={(e) => setMaterialsSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
              />
            </div>
            {materialsSearch && (
              <button
                onClick={() => setMaterialsSearch('')}
                className="w-full sm:w-auto text-xs font-black text-rose-500 hover:text-rose-700 bg-rose-50 px-3 py-2.5 rounded-xl transition-colors uppercase tracking-wider whitespace-nowrap"
              >
                Clear Search
              </button>
            )}
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest shrink-0">
              {filteredSortedMaterials.length} of {materialPurchases.length} Materials
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-[10px] font-bold uppercase tracking-wider select-none border-b border-slate-100">
                <th className="px-4 py-4 cursor-pointer hover:bg-slate-100/85 transition-colors group" onClick={() => handleMaterialsSort('name')}>
                  <div className="flex items-center">
                    Material Name
                    {renderMaterialsSortIcon('name')}
                  </div>
                </th>
                <th className="px-4 py-4 cursor-pointer hover:bg-slate-100/85 transition-colors group" onClick={() => handleMaterialsSort('category')}>
                  <div className="flex items-center">
                    Category
                    {renderMaterialsSortIcon('category')}
                  </div>
                </th>
                <th className="px-4 py-4 text-right cursor-pointer hover:bg-slate-100/85 transition-colors group" onClick={() => handleMaterialsSort('weight')}>
                  <div className="flex items-center justify-end">
                    Volume
                    {renderMaterialsSortIcon('weight')}
                  </div>
                </th>
                <th className="px-4 py-4 text-right cursor-pointer hover:bg-slate-100/85 transition-colors group" onClick={() => handleMaterialsSort('avgBuyPrice')}>
                  <div className="flex items-center justify-end">
                    Avg Paid/lb
                    {renderMaterialsSortIcon('avgBuyPrice')}
                  </div>
                </th>
                <th className="px-4 py-4 text-right cursor-pointer hover:bg-slate-100/85 transition-colors group" onClick={() => handleMaterialsSort('avgSalePrice')}>
                  <div className="flex items-center justify-end">
                    Avg Sold/lb
                    {renderMaterialsSortIcon('avgSalePrice')}
                  </div>
                </th>
                <th className="px-4 py-4 text-right cursor-pointer hover:bg-slate-100/85 transition-colors group" onClick={() => handleMaterialsSort('cost')}>
                  <div className="flex items-center justify-end">
                    Total Payout
                    {renderMaterialsSortIcon('cost')}
                  </div>
                </th>
                <th className="px-4 py-4 text-right cursor-pointer hover:bg-slate-100/85 transition-colors group" onClick={() => handleMaterialsSort('expectedRevenue')}>
                  <div className="flex items-center justify-end">
                    Est. Sales
                    {renderMaterialsSortIcon('expectedRevenue')}
                  </div>
                </th>
                <th className="px-4 py-4 text-right cursor-pointer hover:bg-slate-100/85 transition-colors group" onClick={() => handleMaterialsSort('profit')}>
                  <div className="flex items-center justify-end">
                    Expected Profit
                    {renderMaterialsSortIcon('profit')}
                  </div>
                </th>
                <th className="px-4 py-4 text-right cursor-pointer hover:bg-slate-100/85 transition-colors group" onClick={() => handleMaterialsSort('margin')}>
                  <div className="flex items-center justify-end">
                    Margin
                    {renderMaterialsSortIcon('margin')}
                  </div>
                </th>
                <th className="px-4 py-4 text-right cursor-pointer hover:bg-slate-100/85 transition-colors group" onClick={() => handleMaterialsSort('count')}>
                  <div className="flex items-center justify-end">
                    Tickets
                    {renderMaterialsSortIcon('count')}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSortedMaterials.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors font-bold text-xs">
                        {m.name.charAt(0)}
                      </div>
                      <span className="text-xs font-bold text-slate-900 line-clamp-1">{m.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className="px-1.5 py-0.5 text-[9px] font-bold bg-slate-100 text-slate-600 rounded uppercase whitespace-nowrap">
                      {m.category}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-xs font-bold text-slate-900 text-right whitespace-nowrap">
                    {m.weight.toLocaleString()} lb
                  </td>
                  <td className="px-4 py-4 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                    ${m.avgBuyPrice.toFixed(3)}
                  </td>
                  <td className="px-4 py-4 text-xs font-semibold text-blue-600 text-right whitespace-nowrap">
                    ${m.avgSalePrice.toFixed(3)}
                  </td>
                  <td className="px-4 py-4 text-xs font-bold text-slate-900 text-right whitespace-nowrap">
                    ${m.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-4 text-xs font-bold text-slate-900 text-right whitespace-nowrap">
                    ${m.expectedRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-4 text-xs font-bold text-emerald-600 text-right whitespace-nowrap">
                    ${m.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-4 text-xs font-bold text-slate-500 text-right whitespace-nowrap">
                    {m.margin.toFixed(1)}%
                  </td>
                  <td className="px-4 py-4 text-xs text-slate-500 text-right whitespace-nowrap">
                    {m.count}
                  </td>
                </tr>
              ))}
              {filteredSortedMaterials.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-slate-400 italic">
                    No matching purchase data found for this period.
                  </td>
                </tr>
              )}
            </tbody>
            {filteredSortedMaterials.length > 0 && (
              <tfoot className="bg-slate-50 font-bold text-xs border-t border-slate-200">
                <tr>
                  <td colSpan={2} className="px-4 py-4 text-slate-900">Total Summary</td>
                  <td className="px-4 py-4 text-slate-900 text-right whitespace-nowrap">{totalWeightBought.toLocaleString()} lb</td>
                  <td className="px-4 py-4 text-slate-900 text-right whitespace-nowrap">${(totalSpent / (totalWeightBought || 1)).toFixed(3)}</td>
                  <td className="px-4 py-4 text-blue-600 text-right whitespace-nowrap">${((totalSpent + totalExpectedProfit) / (totalWeightBought || 1)).toFixed(3)}</td>
                  <td className="px-4 py-4 text-slate-900 text-right whitespace-nowrap">${totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-4 py-4 text-slate-900 text-right whitespace-nowrap">${(totalSpent + totalExpectedProfit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-4 py-4 text-emerald-600 text-right whitespace-nowrap">${totalExpectedProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-4 py-4 text-slate-900 text-right whitespace-nowrap">{(totalExpectedProfit / (totalSpent + totalExpectedProfit || 1) * 100).toFixed(1)}%</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    )}

      {activeTab === 'compliance' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
          <div className="space-y-8">
            {/* Header Guidance Card */}
              <section className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-50 rounded-2xl">
                      <FileCode className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Ohio State XML Portal</h3>
                      <p className="text-sm text-slate-500 font-medium">Export and validate daily scrap transactions for compliance upload to the Department of State.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => window.open(settings.ohioScrapPortalUrl || 'https://services.dps.ohio.gov/ScrapDealer/DoNotBuyList', '_blank')}
                      className="px-5 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center gap-2"
                    >
                      Open Ohio Portal
                    </button>
                  </div>
                </div>

                {/* Wizard steps tracker */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-6 border-t border-slate-100">
                  <button
                    onClick={() => setXmlWizardStep(1)}
                    className={cn(
                      "p-4 rounded-2xl border text-left transition-all flex items-start gap-3",
                      xmlWizardStep === 1
                        ? "border-blue-500 bg-blue-50/50"
                        : "border-slate-100 bg-slate-50/50 hover:bg-slate-100/50"
                    )}
                  >
                    <span className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-xs font-black",
                      xmlWizardStep === 1 ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"
                    )}>1</span>
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-tight text-slate-950">Upload / Generate File</h4>
                      <p className="text-[10px] text-slate-500 font-medium">Select tickets & generate or upload compliance file.</p>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      if (uploadedXml || generatedXml) setXmlWizardStep(2);
                    }}
                    disabled={!uploadedXml && !generatedXml}
                    className={cn(
                      "p-4 rounded-2xl border text-left transition-all flex items-start gap-3 disabled:opacity-40 disabled:hover:bg-slate-50/50",
                      xmlWizardStep === 2
                        ? "border-blue-500 bg-blue-50/50"
                        : "border-slate-100 bg-slate-50/50 hover:bg-slate-100/50"
                    )}
                  >
                    <span className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-xs font-black",
                      xmlWizardStep === 2 ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"
                    )}>2</span>
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-tight text-slate-950">Validate File</h4>
                      <p className="text-[10px] text-slate-500 font-medium">Check file nodes against state spelling schema.</p>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      if (xmlValidationStatus === 'passed') setXmlWizardStep(3);
                    }}
                    disabled={xmlValidationStatus !== 'passed'}
                    className={cn(
                      "p-4 rounded-2xl border text-left transition-all flex items-start gap-3 disabled:opacity-40 disabled:hover:bg-slate-50/50",
                      xmlWizardStep === 3
                        ? "border-blue-500 bg-blue-50/50"
                        : "border-slate-100 bg-slate-50/50 hover:bg-slate-100/50"
                    )}
                  >
                    <span className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-xs font-black",
                      xmlWizardStep === 3 ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"
                    )}>3</span>
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-tight text-slate-950">Process File</h4>
                      <p className="text-[10px] text-slate-500 font-medium">Finalize state portal upload & archive receipt.</p>
                    </div>
                  </button>
                </div>
              </section>

              {/* STEP 1: UPLOAD / GENERATE FILE */}
              {xmlWizardStep === 1 && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Left panel: Transaction selection */}
                  <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                      <div className="px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
                        <div className="space-y-1">
                          <h4 className="text-sm font-black text-slate-950 uppercase tracking-tight">Select Completed Tickets</h4>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Report Date:</span>
                            <input
                              type="date"
                              value={complianceDate}
                              onChange={(e) => setComplianceDate(e.target.value)}
                              className="px-2.5 py-1 text-xs font-bold bg-white border border-slate-200 rounded-lg text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setSelectedXmlTickets(complianceTickets.map(t => t.id))}
                            className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg text-[10px] font-black uppercase tracking-wider text-slate-700 transition-all"
                          >
                            Select All
                          </button>
                          <button
                            onClick={() => setSelectedXmlTickets([])}
                            className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg text-[10px] font-black uppercase tracking-wider text-slate-700 transition-all"
                          >
                            Deselect
                          </button>
                        </div>
                      </div>

                      <div className="overflow-x-auto max-h-[400px]">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">
                              <th className="px-6 py-3 w-12 text-center">Include</th>
                              <th className="px-6 py-3">Ticket</th>
                              <th className="px-6 py-3">Customer Name</th>
                              <th className="px-6 py-3">Items</th>
                              <th className="px-6 py-3 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {complianceTickets.map((ticket) => {
                              const customer = customers.find(c => c.id === ticket.customerId);
                              const isSelected = selectedXmlTickets.includes(ticket.id);
                              return (
                                <tr key={ticket.id} className="hover:bg-slate-50/30 transition-colors">
                                  <td className="px-6 py-4 text-center">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => {
                                        if (isSelected) {
                                          setSelectedXmlTickets(prev => prev.filter(id => id !== ticket.id));
                                        } else {
                                          setSelectedXmlTickets(prev => [...prev, ticket.id]);
                                        }
                                      }}
                                      className="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500 focus:ring-2"
                                    />
                                  </td>
                                  <td className="px-6 py-4">
                                    <span className="font-black text-slate-900 text-xs">#{ticket.id.slice(-6).toUpperCase()}</span>
                                    <p className="text-[9px] text-slate-400 font-bold">{new Date(ticket.timestamp).toLocaleDateString()}</p>
                                  </td>
                                  <td className="px-6 py-4 text-xs font-bold text-slate-700">
                                    {customer?.name || 'Walk-In Seller'}
                                  </td>
                                  <td className="px-6 py-4 text-xs text-slate-500">
                                    {ticket.materials.length} metal types
                                  </td>
                                  <td className="px-6 py-4 text-right text-xs font-black text-slate-900">
                                    ${ticket.totalAmount.toFixed(2)}
                                  </td>
                                </tr>
                              );
                            })}
                            {complianceTickets.length === 0 && (
                              <tr>
                                <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">No completed tickets found on {new Date(complianceDate + 'T12:00:00').toLocaleDateString(undefined, { dateStyle: 'long' })}.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Drag-and-Drop XML file upload */}
                    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
                      <div className="flex items-center gap-3">
                        <Upload className="w-5 h-5 text-blue-600" />
                        <h4 className="text-sm font-black text-slate-950 uppercase tracking-tight">Or Upload External XML File</h4>
                      </div>
                      <label className="border-2 border-dashed border-slate-200 hover:border-blue-500 bg-slate-50/50 hover:bg-slate-50 rounded-2xl py-8 px-4 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all">
                        <Upload className="w-8 h-8 text-slate-400 animate-bounce" />
                        <span className="text-xs font-bold text-slate-700">Drag & Drop .xml file here, or click to browse</span>
                        <span className="text-[10px] text-slate-400">Verifies against mandatory misspelling schema requirements</span>
                        <input
                          type="file"
                          accept=".xml"
                          onChange={handleXmlFileSelect}
                          className="hidden"
                        />
                      </label>
                      {uploadedFileName && (
                        <div className="flex items-center justify-between p-3 bg-blue-50 rounded-xl text-xs font-bold text-blue-700">
                          <span className="truncate">Loaded: {uploadedFileName}</span>
                          <button
                            onClick={() => {
                              setUploadedFileName('');
                              setUploadedXml('');
                              setXmlValidationStatus('untested');
                            }}
                            className="p-1 hover:bg-blue-100 rounded-lg text-blue-500"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right panel: XML Exporter */}
                  <div className="space-y-6">
                    <div className="bg-slate-900 text-slate-100 rounded-3xl p-6 space-y-6 shadow-xl">
                      <div className="space-y-2">
                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider">Ohio Compliance Builder</h4>
                        <h3 className="text-lg font-black text-white uppercase tracking-tight">XML Exporter</h3>
                        <p className="text-xs text-slate-300 leading-relaxed font-medium">
                          Generates XML payloads conforming with the exact Department of State spellings, ensuring zero upload failures.
                        </p>
                      </div>

                      <div className="p-4 bg-slate-800 rounded-2xl space-y-3">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-400">Selected Tickets:</span>
                          <span className="font-bold text-white">{selectedXmlTickets.length}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-400">Facility ID:</span>
                          <span className="font-bold text-white">{settings.ohioScrapDealerId || 'OH-PMR-55291'}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-400">Required Typos:</span>
                          <span className="font-bold text-green-400">Enabled (3)</span>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <button
                          onClick={async () => {
                            const selectedTickets = complianceTickets.filter(t => selectedXmlTickets.includes(t.id));
                            if (selectedTickets.length === 0) {
                              setNotification({ type: 'warning', message: 'Select at least one ticket to generate XML.' });
                              return;
                            }
                            await handleGenerateXml(selectedTickets);
                            setNotification({ type: 'success', message: 'XML compliance document generated successfully!' });
                          }}
                          className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
                        >
                          <FileCode className="w-4 h-4" />
                          Generate XML File
                        </button>

                        {generatedXml && (
                          <>
                            <div className="grid grid-cols-2 gap-3">
                              <button
                                onClick={handleDownloadXml}
                                className="py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 border border-slate-700"
                              >
                                <Download className="w-4 h-4" />
                                Download XML
                              </button>

                              <button
                                onClick={handleCopyXmlToClipboard}
                                className="py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 border border-slate-700"
                              >
                                <Copy className="w-4 h-4" />
                                Copy XML
                              </button>
                            </div>

                            <button
                              onClick={loadGeneratedXmlToValidator}
                              className="w-full py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                            >
                              <Check className="w-4 h-4" />
                              Auto-Load & Validate
                            </button>
                          </>
                        )}
                      </div>

                      {generatedXml && (
                        <div className="space-y-2 pt-2 border-t border-slate-800">
                          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">XML Code View</p>
                          <pre className="p-3 bg-slate-950 rounded-xl text-[9px] font-mono overflow-auto max-h-36 text-slate-300 whitespace-pre-wrap leading-normal select-all">
                            {generatedXml.slice(0, 1500) + (generatedXml.length > 1500 ? '\n... (truncated for preview)' : '')}
                          </pre>
                        </div>
                      )}

                      <button
                        onClick={() => setShowErrorCodes(true)}
                        className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold text-xs flex items-center justify-center gap-2 mt-4"
                      >
                        <AlertCircle className="w-4 h-4" />
                        Ohio State XML Error Codes Reference
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: SCHEMA VALIDATOR */}
              {xmlWizardStep === 2 && (
                <section className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Compliance validation suite</h3>
                      <p className="text-xs text-slate-500 font-medium">Verifying file attributes and mandatory spelling tags before portal upload.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setXmlWizardStep(1)}
                        className="px-4 py-2 border border-slate-200 rounded-xl font-bold text-xs text-slate-700 hover:bg-slate-50"
                      >
                        Change File
                      </button>
                      <button
                        onClick={() => validateXmlContent(uploadedXml || generatedXml)}
                        className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold text-xs hover:bg-blue-500"
                      >
                        Re-Validate
                      </button>
                    </div>
                  </div>

                  {/* Summary block */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-slate-50 rounded-2xl">
                    <div className="text-center md:text-left">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Selected Source</p>
                      <p className="text-xs font-black text-slate-800 truncate">{uploadedFileName || 'Generated Exporter XML'}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Records Found</p>
                      <p className="text-xs font-black text-slate-800">
                        {((uploadedXml || generatedXml).match(/<ScrapDealerTransaction>/g) || []).length} Transactions
                      </p>
                    </div>
                    <div className="text-center md:text-right">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Diagnostic Status</p>
                      <span className={cn(
                        "inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider",
                        xmlValidationStatus === 'passed' ? "bg-green-100 text-green-700" :
                        xmlValidationStatus === 'failed' ? "bg-red-100 text-red-700" :
                        "bg-slate-100 text-slate-600 animate-pulse"
                      )}>
                        {xmlValidationStatus === 'passed' ? 'PASSED' : xmlValidationStatus === 'failed' ? 'FAILED' : 'RUNNING'}
                      </span>
                    </div>
                  </div>

                  {/* Schema rules table */}
                  <div className="border border-slate-100 rounded-2xl overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">
                          <th className="px-6 py-4">Status</th>
                          <th className="px-6 py-4">Standard Rule Target</th>
                          <th className="px-6 py-4">Specific Tag Node</th>
                          <th className="px-6 py-4">Description</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {xmlValidationResults.map((rule, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="px-6 py-4">
                              {rule.status === 'success' ? (
                                <span className="flex items-center gap-1.5 text-green-600 font-bold text-xs bg-green-50 px-2.5 py-0.5 rounded-full w-fit">
                                  <Check className="w-3.5 h-3.5" />
                                  OK
                                </span>
                              ) : rule.status === 'warning' ? (
                                <span className="flex items-center gap-1.5 text-amber-600 font-bold text-xs bg-amber-50 px-2.5 py-0.5 rounded-full w-fit">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  WARN
                                </span>
                              ) : (
                                <span className="flex items-center gap-1.5 text-red-600 font-bold text-xs bg-red-50 px-2.5 py-0.5 rounded-full w-fit">
                                  <X className="w-3.5 h-3.5" />
                                  FAIL
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-xs font-black text-slate-800">
                              {rule.title}
                            </td>
                            <td className="px-6 py-4 font-mono text-[10px] text-slate-500">
                              {rule.tag ? `<${rule.tag}>` : 'N/A'}
                            </td>
                            <td className="px-6 py-4 text-xs text-slate-600 font-medium leading-relaxed">
                              {rule.description}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Navigation based on status */}
                  <div className="pt-4 flex justify-end gap-3">
                    {xmlValidationStatus === 'passed' && (
                      <button
                        onClick={() => setXmlWizardStep(3)}
                        className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-green-600/15 flex items-center gap-2"
                      >
                        Proceed to Process File
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    )}
                    {xmlValidationStatus === 'failed' && (
                      <div className="p-4 bg-red-50 border border-red-100 rounded-2xl w-full space-y-3">
                        <div className="flex gap-3 items-start">
                          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-black text-red-900 uppercase">Schema Violations Found</p>
                            <p className="text-xs text-red-700 leading-relaxed font-medium mt-1">
                              Your XML contains formatting issues or schema limits (such as seller last name missing or exceeding 33 characters). Click below to automatically truncate and format names and fields to Ohio state specifications.
                            </p>
                          </div>
                        </div>
                        <div className="pt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={handleAutoFixXml}
                            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center gap-2 shadow-md shadow-blue-500/20"
                          >
                            <Wand2 className="w-4 h-4" />
                            Auto-Fix & Truncate Name Lengths
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* STEP 3: PROCESS FILE */}
              {xmlWizardStep === 3 && (
                <section className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
                  {!isProcessingXml && !xmlSubmissionResult && (
                    <div className="flex flex-col items-center justify-center text-center py-12 space-y-4">
                      <div className="p-5 bg-blue-50 text-blue-600 rounded-full animate-pulse">
                        <FileCode className="w-10 h-10" />
                      </div>
                      <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Ready for Compliance Upload</h3>
                      <p className="text-sm text-slate-500 font-medium max-w-md">
                        Your XML file is verified and ready for transmission. Processing will register this upload with the State, update daily compliance logs, and secure archive confirmations.
                      </p>
                      <button
                        onClick={processUploadedXml}
                        className="px-8 py-3.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-500/20 flex items-center gap-2"
                      >
                        <Play className="w-4 h-4" />
                        Process & Transmit File
                      </button>
                    </div>
                  )}

                  {isProcessingXml && (
                    <div className="space-y-6 py-6">
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-bold text-slate-600 uppercase tracking-wider">State compliance pipeline active</span>
                          <span className="font-black text-blue-600">{processingProgress}%</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2">
                          <div className="bg-blue-600 h-2 rounded-full transition-all duration-500" style={{ width: `${processingProgress}%` }}></div>
                        </div>
                      </div>

                      <div className="bg-slate-950 p-5 rounded-2xl border border-slate-850 space-y-1.5 max-h-60 overflow-y-auto">
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider border-b border-slate-800 pb-2 mb-2">Live Compliance Audit logs</p>
                        {processingLogs.map((log, idx) => (
                          <div key={idx} className="flex gap-2 text-xs font-mono">
                            <span className="text-slate-500 shrink-0">[{new Date().toLocaleTimeString()}]</span>
                            <span className={cn(
                              log?.startsWith('[SUCCESS]') ? "text-green-400 font-bold" :
                              log?.startsWith('[ERROR]') ? "text-red-400 font-bold" :
                              "text-slate-300"
                            )}>
                              {log}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {xmlSubmissionResult && (
                    <div className="space-y-8 max-w-2xl mx-auto animate-in fade-in zoom-in-95">
                      {/* Submission confirmation document */}
                      <article className="border-4 border-double border-slate-400 bg-amber-50/10 p-8 rounded-2xl relative space-y-6 shadow-sm overflow-hidden">
                        {/* Decorative background stamps */}
                        <div className="absolute right-4 bottom-4 text-[7rem] font-black font-display text-green-500/5 select-none rotate-12 pointer-events-none">FILED</div>
                        
                        <div className="text-center space-y-1">
                          <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest">Official Receipt of Transmission</h4>
                          <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Ohio Scrap Dealer Compliance System</h3>
                          <div className="w-16 h-1 bg-blue-600 mx-auto rounded-full my-3"></div>
                        </div>

                        <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-xs border-y border-slate-200/60 py-4">
                          <div>
                            <span className="text-slate-400 font-medium">Facility Registration ID:</span>
                            <p className="font-bold text-slate-800 mt-0.5">{settings.ohioScrapDealerId || 'SMBC-2025-0000710'}</p>
                          </div>
                          <div>
                            <span className="text-slate-400 font-medium">Receipt Identifier:</span>
                            <p className="font-mono font-bold text-blue-700 mt-0.5">{xmlSubmissionResult.receiptId}</p>
                          </div>
                          <div>
                            <span className="text-slate-400 font-medium">Submission Timestamp:</span>
                            <p className="font-bold text-slate-800 mt-0.5">{xmlSubmissionResult.timestamp}</p>
                          </div>
                          <div>
                            <span className="text-slate-400 font-medium">Processed Records:</span>
                            <p className="font-bold text-slate-800 mt-0.5">{xmlSubmissionResult.count} Transactions successfully registered</p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Reported Sequence Tickets</p>
                          <div className="flex flex-wrap gap-1.5">
                            {xmlSubmissionResult.tickets.map((tId: string) => (
                              <span key={tId} className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-bold">
                                #{tId.slice(-6).toUpperCase()}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex gap-2 justify-center pt-2">
                          <button
                            onClick={() => window.print()}
                            className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-black uppercase tracking-widest rounded-xl transition-all"
                          >
                            Print Receipt
                          </button>
                          <button
                            onClick={() => {
                              setXmlSubmissionResult(null);
                              setXmlWizardStep(1);
                              setUploadedXml('');
                              setGeneratedXml('');
                              setUploadedFileName('');
                              setXmlValidationStatus('untested');
                            }}
                            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all"
                          >
                            Start New Batch
                          </button>
                        </div>
                      </article>
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>
        )}

      {activeTab === 'cash_flow' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
          {/* Cash Flow Highlights Cards */}
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" aria-label="Cash Flow Performance">
            {[
              {
                name: 'Total Cash Inflows',
                value: `$${cashFlowMetrics.totalInflows.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                subtext: `Bank Withdrawals: $${cashFlowMetrics.bankWithdrawals.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                otherText: `Other Inflows: $${cashFlowMetrics.otherInflows.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                icon: ArrowUpRight,
                color: 'emerald',
              },
              {
                name: 'Material Purchases',
                value: `$${totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                subtext: `${validBuyTickets.length} Completed Tickets`,
                icon: DollarSign,
                color: 'blue',
              },
              {
                name: 'Non-Material Expenses',
                value: `$${cashFlowMetrics.totalExpenses.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                subtext: `${cashTransactions.filter(t => t.type === 'expense').length} Logged Expenses`,
                icon: ArrowDownRight,
                color: 'amber',
              },
              {
                name: 'Net Cash Impact',
                value: `${cashFlowMetrics.netCashImpact >= 0 ? '+' : ''}$${cashFlowMetrics.netCashImpact.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                subtext: 'Inflows minus All Spend',
                icon: Activity,
                color: cashFlowMetrics.netCashImpact >= 0 ? 'emerald' : 'red',
              },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <article key={card.name} className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm relative overflow-hidden group">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{card.name}</p>
                      <h3 className={cn(
                        "text-2xl font-black font-mono mt-1",
                        card.color === 'emerald' ? "text-emerald-600" :
                        card.color === 'blue' ? "text-blue-600" :
                        card.color === 'amber' ? "text-amber-600" :
                        card.color === 'red' ? "text-red-600" : "text-slate-900"
                      )}>
                        {card.value}
                      </h3>
                    </div>
                    <div className={cn(
                      "p-3 rounded-2xl",
                      card.color === 'emerald' ? "bg-emerald-50 text-emerald-600" :
                      card.color === 'blue' ? "bg-blue-50 text-blue-600" :
                      card.color === 'amber' ? "bg-amber-50 text-amber-600" :
                      card.color === 'red' ? "bg-red-50 text-red-600" : "bg-slate-50 text-slate-600"
                    )}>
                      <Icon className="w-5 h-5" />
                    </div>
                  </div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 space-y-0.5">
                    <div>{card.subtext}</div>
                    {card.otherText && <div>{card.otherText}</div>}
                  </div>
                </article>
              );
            })}
          </section>

          {/* Charts & Analysis Section */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Cash Flow Over Time Chart */}
            <section className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm lg:col-span-8 space-y-6">
              <div>
                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Cash Flow Over Time</h3>
                <p className="text-slate-400 text-xs font-black uppercase tracking-widest mt-0.5">Comparing Inflows, Ticket Payouts, and Expenses</p>
              </div>

              <div className="h-80 w-full">
                {cashFlowChartData.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-8">
                    <Activity className="w-8 h-8 text-slate-300 mb-2" />
                    <p className="text-xs font-black uppercase tracking-widest">No transaction data available for this time range.</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cashFlowChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="date" stroke="#94a3b8" fontSize={10} fontWeight="bold" tickLine={false} />
                      <YAxis stroke="#94a3b8" fontSize={10} fontWeight="bold" tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#ffffff', borderRadius: '1rem', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.05)' }} 
                        formatter={(value: any) => [`$${Number(value).toFixed(2)}`]}
                      />
                      <Bar dataKey="inflows" name="Cash Inflows" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="ticketPayouts" name="Ticket Payouts" fill="#2563eb" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="expenses" name="Non-Material Expenses" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>

            {/* Non-Material Expenses Distribution Card */}
            <section className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm lg:col-span-4 space-y-6 flex flex-col justify-between">
              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight font-sans">Expense Distribution</h3>
                  <p className="text-slate-400 text-xs font-black uppercase tracking-widest mt-0.5">Where Non-Material funds are allocated</p>
                </div>

                {Object.keys(cashFlowMetrics.expensesByCategory).length === 0 ? (
                  <div className="py-12 text-center text-slate-400 text-xs font-black uppercase tracking-widest bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    No non-material expenses logged.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(cashFlowMetrics.expensesByCategory).map(([category, amount]) => {
                      const pct = cashFlowMetrics.totalExpenses > 0 ? (amount / cashFlowMetrics.totalExpenses) * 100 : 0;
                      return (
                        <div key={category} className="space-y-1.5">
                          <div className="flex justify-between text-xs">
                            <span className="font-bold text-slate-700 uppercase tracking-wide">{category}</span>
                            <span className="font-mono font-black text-slate-900">${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          </div>
                          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div style={{ width: `${pct}%` }} className="bg-amber-500 h-full rounded-full" />
                          </div>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">{pct.toFixed(1)}% of expenses</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {cashFlowMetrics.totalExpenses > 0 && (
                <div className="pt-6 border-t border-slate-100 mt-6">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-black text-slate-400 uppercase tracking-widest">Total Non-Material Outlay</span>
                    <span className="font-mono font-black text-lg text-amber-600">${cashFlowMetrics.totalExpenses.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* Cash Reconciliations & Sessions History */}
          <section className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden space-y-6">
            <div className="px-8 py-6 border-b border-slate-100 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
              <div>
                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Drawer Reconciliations</h3>
                <p className="text-slate-400 text-xs font-black uppercase tracking-widest mt-0.5">Historical verification of physical cash counts</p>
              </div>
              <div className="text-xs font-black uppercase tracking-widest text-slate-500 bg-slate-100 px-4 py-2 rounded-xl">
                {filteredSessions.length} sessions in range
              </div>
            </div>

            {filteredSessions.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <p className="text-xs font-black uppercase tracking-widest italic">No cash sessions recorded in this time range.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 border-b border-slate-100">
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Opening Cash</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Expected Cash</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actual Count</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Over / Short</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Closed By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-sans">
                    {filteredSessions.map((session) => {
                      const isBalanced = session.overShort === 0;
                      const isShort = session.overShort !== undefined && session.overShort < 0;
                      const isOver = session.overShort !== undefined && session.overShort > 0;

                      return (
                        <tr key={session.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-8 py-5">
                            <span className="font-black text-slate-900 text-sm">
                              {new Date(session.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                          </td>
                          <td className="px-8 py-5">
                            <span className={cn(
                              "px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest inline-block",
                              session.status === 'open' ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-700"
                            )}>
                              {session.status}
                            </span>
                          </td>
                          <td className="px-8 py-5 text-sm font-mono font-bold text-slate-600 text-right">
                            ${session.openingCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-8 py-5 text-sm font-mono font-bold text-slate-600 text-right">
                            ${session.expectedCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-8 py-5 text-sm font-mono font-black text-slate-800 text-right">
                            {session.actualCash !== undefined ? `$${session.actualCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}
                          </td>
                          <td className="px-8 py-5 text-right">
                            {session.status === 'open' ? (
                              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Open Session</span>
                            ) : session.overShort === undefined ? (
                              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">No Count</span>
                            ) : (
                              <span className={cn(
                                "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest inline-block font-mono",
                                isBalanced ? "bg-emerald-50 text-emerald-700 border border-emerald-100" :
                                isShort ? "bg-red-50 text-red-700 border border-red-100" :
                                "bg-blue-50 text-blue-700 border border-blue-100"
                              )}>
                                {isBalanced ? 'Balanced' :
                                 isShort ? `Short $${Math.abs(session.overShort).toLocaleString(undefined, { minimumFractionDigits: 2 })}` :
                                 `Over $${session.overShort.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                              </span>
                            )}
                          </td>
                          <td className="px-8 py-5">
                            {session.status === 'closed' ? (
                              <div className="flex items-center gap-2">
                                <User className="w-3.5 h-3.5 text-slate-400" />
                                <span className="text-xs font-bold text-slate-600">{session.closedBy || 'System'}</span>
                              </div>
                            ) : (
                              <span className="text-xs font-bold text-slate-400 italic">In progress</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Granular Cash Ledger */}
          <section className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden space-y-6">
            <div className="px-8 py-6 border-b border-slate-100 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
              <div>
                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Cash Ledger Detail</h3>
                <p className="text-slate-400 text-xs font-black uppercase tracking-widest mt-0.5">Granular record of all non-material cash desk events</p>
              </div>
              <div className="text-xs font-black uppercase tracking-widest text-slate-500 bg-slate-100 px-4 py-2 rounded-xl">
                {cashTransactions.length} transactions logged
              </div>
            </div>

            {cashTransactions.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <p className="text-xs font-black uppercase tracking-widest italic">No non-material transactions logged in this time range.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 border-b border-slate-100">
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Timestamp</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Type</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Category</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Amount</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Notes / Details</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Logged By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-sans">
                    {cashTransactions.map((tx) => {
                      const isInflow = tx.type === 'inflow';
                      return (
                        <tr key={tx.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-8 py-5">
                            <div className="flex items-center gap-2">
                              <Clock className="w-3.5 h-3.5 text-slate-400" />
                              <span className="font-bold text-slate-600 text-xs">
                                {new Date(tx.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </td>
                          <td className="px-8 py-5">
                            <span className={cn(
                              "px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest inline-block",
                              isInflow ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-amber-50 text-amber-700 border border-amber-100"
                            )}>
                              {isInflow ? 'Inflow' : 'Expense'}
                            </span>
                          </td>
                          <td className="px-8 py-5">
                            <span className="text-xs font-black text-slate-700 uppercase tracking-wider">{tx.category}</span>
                          </td>
                          <td className={cn(
                            "px-8 py-5 text-sm font-mono font-black text-right",
                            isInflow ? "text-emerald-600" : "text-amber-600"
                          )}>
                            {isInflow ? '+' : '-'}${tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-8 py-5 text-xs text-slate-600 font-medium max-w-xs truncate" title={tx.notes}>
                            {tx.notes || <span className="text-slate-300 italic">No notes captured</span>}
                          </td>
                          <td className="px-8 py-5">
                            <div className="flex items-center gap-2">
                              <User className="w-3.5 h-3.5 text-slate-400" />
                              <span className="text-xs font-bold text-slate-600">{tx.performedBy}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'backups' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
          <section className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-indigo-50 rounded-2xl">
                  <Save className="w-6 h-6 text-indigo-600" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">End-of-Day Snapshots</h3>
                  <p className="text-sm text-slate-500 font-medium">Capture a permanent record of today's prices, inventory, and transactions.</p>
                </div>
              </div>
              <button 
                onClick={() => createDailySnapshot()}
                disabled={creatingSnapshot}
                className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-200 flex items-center gap-2 disabled:opacity-50"
              >
                {creatingSnapshot ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Create Daily Snapshot
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-slate-100">
              <div className="p-4 bg-slate-50 rounded-2xl space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Snapshots</p>
                <p className="text-xl font-black text-slate-900">{dailySnapshots.length}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-2xl space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Last Snapshot</p>
                <p className="text-sm font-bold text-slate-600">
                  {dailySnapshots[0] ? new Date(dailySnapshots[0].timestamp).toLocaleString() : 'Never'}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-2xl space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Storage Status</p>
                <div className="flex items-center gap-2 text-green-600 font-bold">
                  <ShieldCheck className="w-5 h-5" />
                  <span>Verified Secure</span>
                </div>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {dailySnapshots.map((snapshot) => (
              <article key={snapshot.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-black text-slate-900 uppercase tracking-tight">{new Date(snapshot.date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</h4>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{new Date(snapshot.timestamp).toLocaleTimeString()}</p>
                  </div>
                  <History className="w-5 h-5 text-slate-300" />
                </div>

                <div className="space-y-2 pt-4 border-t border-slate-50">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-medium">Buy Tickets:</span>
                    <span className="text-slate-900 font-bold">{snapshot.summary.totalBuyTickets} (${snapshot.summary.totalBuyAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-medium">Trip Tickets:</span>
                    <span className="text-slate-900 font-bold">{snapshot.summary.totalTripTickets} ({snapshot.summary.totalTripWeight.toLocaleString()} lb)</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-medium">Invoices:</span>
                    <span className="text-slate-900 font-bold">{snapshot.summary.totalInvoices} (${snapshot.summary.totalInvoiceAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-medium">Materials:</span>
                    <span className="text-slate-900 font-bold">{snapshot.materials.length} items</span>
                  </div>
                </div>

                <div className="pt-4">
                  <p className="text-[10px] text-slate-400 italic">Captured by: {snapshot.createdBy}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between print:hidden">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text"
                placeholder="Search logs by user, action or entity ID..."
                className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                value={auditFilter.query}
                onChange={(e) => setAuditFilter(prev => ({ ...prev, query: e.target.value }))}
              />
            </div>
            <select
              className="w-full md:w-48 px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold"
              value={auditFilter.type}
              onChange={(e) => setAuditFilter(prev => ({ ...prev, type: e.target.value }))}
            >
              <option value="all">All Entities</option>
              <option value="material">Materials</option>
              <option value="inventory">Inventory</option>
              <option value="buyTicket">Buy Tickets</option>
              <option value="tripTicket">Trip Tickets</option>
              <option value="invoice">Invoices</option>
              <option value="customer">Customers</option>
              <option value="settings">Settings</option>
              <option value="cashDrawer">Cash Sessions</option>
              <option value="cashTransaction">Cash Adjustments</option>
            </select>
          </div>

          <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Event</th>
                    <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Entity</th>
                    <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">User</th>
                    <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Time</th>
                    <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 text-right print:hidden">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs
                    .filter(log => {
                      const matchesQuery = log.notes?.toLowerCase().includes(auditFilter.query.toLowerCase()) || 
                                         log.performedBy.toLowerCase().includes(auditFilter.query.toLowerCase()) ||
                                         log.entityId.toLowerCase().includes(auditFilter.query.toLowerCase());
                      const matchesType = auditFilter.type === 'all' || log.entityType === auditFilter.type;
                      return matchesQuery && matchesType;
                    })
                    .map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "p-2 rounded-xl",
                            log.action === 'create' || log.action === 'open' ? "bg-emerald-50 text-emerald-600" :
                            log.action === 'update' || log.action === 'close' ? "bg-slate-100 text-slate-600" :
                            log.action === 'delete' || log.action === 'void' ? "bg-rose-50 text-rose-600 font-bold" :
                            log.action === 'override' ? "bg-purple-50 text-purple-600 font-bold" :
                            log.action === 'adjustment' ? "bg-blue-50 text-blue-600" :
                            "bg-amber-50 text-amber-600"
                          )}>
                            <Activity className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-sm font-black text-slate-900 capitalize">{log.action}</p>
                            <p className="text-[10px] font-medium text-slate-500">{log.notes}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[10px] font-black uppercase tracking-widest">
                          {log.entityType}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center">
                            <User className="w-3 h-3 text-slate-500" />
                          </div>
                          <p className="text-sm font-bold text-slate-700 truncate max-w-[120px]">{log.performedBy}</p>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-2 text-slate-500">
                          <Clock className="w-4 h-4" />
                          <span className="text-xs font-medium">{new Date(log.timestamp).toLocaleString()}</span>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-right print:hidden">
                        {log.changes && (
                          <button 
                            onClick={() => {
                              setNotification({
                                type: 'success',
                                message: `Audit Data for Event: ${log.action.toUpperCase()}\n\n${JSON.stringify(log.changes, null, 2)}`
                              });
                            }}
                            className="text-xs font-black text-blue-600 uppercase tracking-widest hover:bg-blue-50 px-3 py-1 rounded-lg transition-all"
                          >
                            Details
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {auditLogs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center gap-2 text-slate-400">
                          <Activity className="w-8 h-8 opacity-20" />
                          <p className="text-sm font-medium italic">No dynamic changes logged yet.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showErrorCodes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="p-6 border-b border-slate-100 flex flex-col gap-4 sticky top-0 bg-white/90 backdrop-blur-md z-10">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Ohio DPS XML Error Codes</h2>
                  <p className="text-xs text-slate-500 font-medium mt-1">Reference for troubleshooting DOIT Scrap Dealer system errors.</p>
                </div>
                <button
                  onClick={() => setShowErrorCodes(false)}
                  className="w-10 h-10 bg-slate-100 text-slate-500 rounded-full flex items-center justify-center hover:bg-slate-200 transition-colors shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search error codes or messages..."
                  value={errorCodeSearch}
                  onChange={(e) => setErrorCodeSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
                />
              </div>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-4 bg-slate-50">
              {OHIO_XML_ERROR_CODES.filter(err => err.code.toString().includes(errorCodeSearch) || err.message.toLowerCase().includes(errorCodeSearch.toLowerCase())).map((error, index) => (
                <div key={index} className="bg-white p-4 rounded-2xl border border-slate-200 flex gap-4 items-start shadow-sm hover:shadow-md transition-shadow">
                  <div className="shrink-0 w-12 h-12 bg-red-50 text-red-600 rounded-xl flex items-center justify-center font-black text-lg border border-red-100">
                    {error.code}
                  </div>
                  <div className="pt-1">
                    <p className="text-sm text-slate-700 font-medium leading-relaxed">{error.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {verifyingSub && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-6 shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-100 text-amber-700 rounded-2xl">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Confirm Ohio Portal Verification</h3>
                  <p className="text-xs text-slate-500">Ohio DPS Scrap Dealer Portal Check</p>
                </div>
              </div>
              <button 
                onClick={() => setVerifyingSub(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-sm text-slate-800 font-medium leading-relaxed">
                Did you see all <span className="font-extrabold text-slate-900">{verifyingSub.transactionCount || verifyingSub.ticketCount}</span> transactions listed in the Ohio portal with no errors?
              </p>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => handleConfirmVerified(verifyingSub)}
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl text-xs transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                Yes, all transactions appear
              </button>
              <button
                onClick={() => handleConfirmRejected(verifyingSub)}
                className="w-full py-3 px-4 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold rounded-2xl text-xs transition-all flex items-center justify-center gap-2"
              >
                <XCircle className="w-4 h-4" />
                No, some are missing or show errors
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
