export type UserRole = 'manager' | 'cashier';

export interface PricingSnapshot {
  id: string;
  timestamp: string;
  createdBy: string;
  prices: {
    materialId: string;
    materialName: string;
    buyPrice: number;
    salePrice: number;
  }[];
  source: 'manual' | 'google_sheets';
  sheetId?: string;
}

export interface UserPermissions {
  canManagePrices: boolean;
  canManageUsers: boolean;
  canVoidTickets: boolean;
  canDeleteData: boolean;
  canManageInventory: boolean;
  canGenerateReports: boolean;
  canManageInvoices: boolean;
  canManageCash: boolean;
  canApproveChanges: boolean;
  canOpenCloseSessions: boolean;
  canRetroactivePriceAdjustments: boolean;
}

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  displayName?: string;
  managerPin?: string; // 4-digit PIN for approvals
  cachedPassword?: string;
  permissions?: UserPermissions;
}

export interface Material {
  id: string;
  code: string;
  name: string;
  category: string;
  description?: string;
  buyPrice: number;
  salePrice: number;
  unit: 'lb' | 'ton';
  updatedAt: string;
  updatedBy?: string; // user email or name
  updatedByUid?: string;
}

export interface Customer {
  id: string;
  name: string;
  businessName?: string;
  phone?: string;
  secondaryPhone?: string;
  email?: string;
  address?: string;
  idImageUrl?: string;
  photoUrl?: string;
  notes?: string;
  isBuyer?: boolean;
  createdAt: string;
  // Compliance Fields
  idType?: string;
  idNumber?: string;
  idExpiration?: string;
  verifiedStatus?: 'unverified' | 'verified' | 'restricted';
  customerType?: 'individual' | 'commercial' | 'industrial';
  // Vehicle Fields for persistent profile preloading
  vehiclePlate?: string;
  vehicleType?: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehiclePhotoUrl?: string;
}

export interface BuyTicketMaterial {
  materialId: string;
  grossWeight: number;
  tareWeight: number;
  netWeight: number;
  pricePerUnit: number;
  totalAmount: number;
  deductionWeight?: number;
  deductionReason?: string;
  notes?: string;
  photoUrl?: string;
}

export interface BuyTicket {
  id: string;
  customerId: string;
  materials: BuyTicketMaterial[];
  totalAmount: number;
  status: 'pending' | 'completed' | 'cancelled' | 'voided';
  timestamp: string;
  vehiclePlate?: string;
  vehicleType?: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  paymentMethod?: 'cash' | 'check' | 'eft' | 'other';
  notes?: string;
  customerPhotoUrl?: string;
  idImageUrl?: string;
  sellerAffirmed?: boolean; // Lawful ownership affirmation
  fingerprintUrl?: string; // Optional for high-risk items
  signatureUrl?: string; // Essential for compliance & acknowledgment
  vehiclePhotoUrl?: string; // Captured from Entrance Cam
  createdBy?: string;
  createdByName?: string;
  ohioDatabaseStatus?: 'not_checked' | 'cleared' | 'flagged';
}

export interface TripTicketMaterial {
  materialId: string;
  weight: number; // calculated net weight
  salePrice: number;
  customName?: string;
  boxNumber?: string;
  grossWeight?: number;
  tareWeight?: number;
  slotIndex?: number;
}

export interface TripTicket {
  id: string;
  destination: string;
  driver: string;
  vehicle: string;
  carrier?: string;
  trailerNumber?: string;
  sealNumber?: string;
  bolNumber?: string;
  materials: TripTicketMaterial[];
  buyerAddress?: string;
  buyerPhone?: string;
  status: 'in-transit' | 'delivered' | 'cancelled' | 'voided';
  timestamp: string;
  notes?: string;
  invoiceId?: string;
  invoiceStatus?: 'pending' | 'matched' | 'disputed' | 'invoiced';
  totalWeight?: number;
  totalValue?: number;
  createdBy?: string;
  createdByName?: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  tripTicketId: string;
  buyerName: string;
  buyerAddress?: string;
  buyerPhone?: string;
  date: string;
  dueDate: string;
  materials: TripTicketMaterial[];
  totalWeight: number;
  totalAmount: number;
  paymentTerms?: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue';
  notes?: string;
  createdBy?: string;
  createdByName?: string;
  loadPlanId?: string;
}

export interface InventoryItem {
  id: string;
  materialId: string;
  currentWeight: number;
  lastUpdated: string;
}

export interface ExternalSale {
  id: string;
  materialId: string;
  weight: number;
  salePrice: number;
  date: string;
  notes?: string;
  recordedAt: string;
  recordedBy: string;
}

export interface LoadPlanBox {
  slotIndex: number;
  materialId?: string;
  weight?: number;
  notes?: string;
}

export interface LoadPlan {
  id: string;
  loadNumber: string;
  date: string;
  status: 'draft' | 'shipped' | 'cancelled';
  carrier?: string;
  notes?: string;
  boxes: LoadPlanBox[];
  totalWeight: number;
  recordedAt: string;
  recordedBy: string;
}

export interface DoNotBuyEntry {
  id: string;
  name: string;
  idNumber: string;
  reason?: string;
  addedAt: string;
}

export interface AuditLog {
  id: string;
  entityType: 'material' | 'customer' | 'buyTicket' | 'tripTicket' | 'invoice' | 'inventory' | 'settings' | 'cashDrawer' | 'cashTransaction' | 'externalSale' | 'loadPlan';
  entityId: string;
  action: 'create' | 'update' | 'delete' | 'sync' | 'optimize' | 'void' | 'override' | 'adjustment' | 'open' | 'close';
  changes?: {
    before?: any;
    after: any;
  };
  performedBy: string; // user email
  timestamp: string;
  notes?: string;
}

export interface DailySnapshot {
  id: string;
  date: string; // YYYY-MM-DD
  timestamp: string;
  createdBy: string;
  materials: {
    id: string;
    code: string;
    name: string;
    buyPrice: number;
    salePrice: number;
    unit: string;
  }[];
  inventory: {
    materialId: string;
    weight: number;
  }[];
  summary: {
    totalBuyTickets: number;
    totalBuyAmount: number;
    totalBuyWeight: number;
    totalTripTickets: number;
    totalTripWeight: number;
    totalInvoices: number;
    totalInvoiceAmount: number;
  };
}

export interface ComplianceSubmission {
  id: string;
  date: string; // YYYY-MM-DD
  timestamp: string;
  submittedBy: string;
  status: 'pending' | 'success' | 'failed';
  ticketCount: number;
  responseMessage?: string;
  payloadText: string; // CSV or JSON sent
}

export interface UserSession {
  id: string;
  userId: string;
  userEmail: string;
  displayName?: string;
  hardwareId: string;
  userAgent: string;
  loginAt: string;
  lastActiveAt: string;
  status: 'active' | 'expired' | 'logout';
}

export interface UserInvite {
  id: string;
  email?: string;
  role: UserRole;
  createdAt: string;
  expiresAt: string;
  used: boolean;
  createdBy: string;
}

export interface SystemConfig {
  maintenanceMode: boolean;
  maintenanceMessage?: string;
  announcement?: {
    message: string;
    type: 'info' | 'warning' | 'error';
    active: boolean;
  };
  currentVersion: string;
  minSupportedVersion: string;
  lastUpdated: string;
}

export interface CashSession {
  id: string;
  date: string; // YYYY-MM-DD
  status: 'open' | 'closed';
  openingCash: number; // Combined Safe + Register
  expectedCash: number; // Calculated: Opening + Replenishments - Payouts - Expenses
  actualCash?: number; // Physical count at end of day
  overShort?: number;
  openedAt: string;
  openedBy: string;
  closedAt?: string;
  closedBy?: string;
  notes?: string;
  openingDenominations?: {
    hundreds: number;
    fifties: number;
    twenties: number;
    tens: number;
    fives: number;
    ones: number;
    dollarCoins: number;
    halfDollars: number;
    quarters: number;
    dimes: number;
    nickels: number;
  };
  closingDenominations?: {
    hundreds: number;
    fifties: number;
    twenties: number;
    tens: number;
    fives: number;
    ones: number;
    dollarCoins: number;
    halfDollars: number;
    quarters: number;
    dimes: number;
    nickels: number;
  };
  verificationStatus?: 'unverified' | 'verified' | 'disputed';
  verifiedBy?: string;
  verifiedAt?: string;
  verificationComment?: string;
}

export interface CashTransaction {
  id: string;
  sessionId: string;
  type: 'inflow' | 'expense'; // inflow (bank run) or expense (fuel, vendor, etc)
  category: string;
  amount: number;
  notes?: string;
  timestamp: string;
  performedBy: string;
}

export interface SystemLog {
  id: string;
  type: 'info' | 'error' | 'security';
  message: string;
  timestamp: string;
  source: string;
  details?: any;
}
