import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { auth, db, storage } from '../firebase';
import { collection, onSnapshot, addDoc, doc, updateDoc, deleteDoc, writeBatch, query, where, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Customer } from '../types';
import { 
  Users, 
  Plus, 
  Search, 
  Phone, 
  MapPin, 
  Loader2, 
  UserPlus, 
  X, 
  Save, 
  Edit2, 
  Calendar, 
  FileText, 
  Mail, 
  Building, 
  Image as ImageIcon, 
  Upload, 
  Camera, 
  ShieldCheck,
  ArrowRightLeft,
  AlertTriangle,
  Truck,
  Sparkles
} from 'lucide-react';
import { cn, getCustomerDataGaps } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { CameraCapture } from '../components/CameraCapture';
import { logAuditEvent } from '../lib/audit';
import { handleImageError } from '../constants';
import ManagerPinModal from '../components/ManagerPinModal';
import { useToast } from '../context/ToastContext';

import { UserProfile } from '../types';

export default function Customers({ profile }: { profile: UserProfile | null }) {
  const { firestore, success, error: toastError, info } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Customer>>({});
  const [uploading, setUploading] = useState(false);
  const [isReadingID, setIsReadingID] = useState(false);
  const [isReadingVehicle, setIsReadingVehicle] = useState(false);

  // Deletion, duplication, and merging state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<Customer | null>(null);
  const [mergeSearch, setMergeSearch] = useState('');
  const [mergeCopyFields, setMergeCopyFields] = useState(true);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinPurpose, setPinPurpose] = useState<'delete' | 'merge' | null>(null);
  const [addForm, setAddForm] = useState<Partial<Customer>>({});
  const [searchParams, setSearchParams] = useSearchParams();
  const [filterMissingPhotos, setFilterMissingPhotos] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    const filterParam = searchParams.get('filter');
    if (filterParam === 'missing_photos' || filterParam === 'incomplete') {
      setFilterMissingPhotos(true);
    }
  }, [searchParams]);

  const triggerNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 4000);
    if (type === 'success') {
      firestore('Customer Committed', message);
    } else {
      toastError('Action Failed', message);
    }
  };

  // Handle URL deep linking for selecting a customer
  useEffect(() => {
    const customerId = searchParams.get('id');
    if (customerId && customers.length > 0) {
      const targetCustomer = customers.find(c => c.id === customerId);
      if (targetCustomer) {
        setSelectedCustomer(targetCustomer);
        setIsEditing(false); // Make sure we are viewing their profile
        
        // Clear search parameter so page behavior is normal after selecting
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('id');
        setSearchParams(newParams, { replace: true });
      }
    }
  }, [searchParams, customers, setSearchParams]);

  useEffect(() => {
    if (!auth.currentUser) return;

    const unsubscribe = onSnapshot(collection(db, 'customers'), (snapshot) => {
      setCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Customer[]);
      setLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'customers'));
    return () => {
      try {
        unsubscribe();
      } catch (e) {
        console.warn('unsubscribe customers error', e);
      }
    };
  }, [profile]);

  // Auto-enrich customer profile from previous tickets if missing vehicle info or photos
  useEffect(() => {
    if (!selectedCustomer) return;

    // Check if any of the key fields are missing
    const isMissingData = 
      !selectedCustomer.photoUrl || 
      !selectedCustomer.idImageUrl || 
      !selectedCustomer.vehiclePlate || 
      !selectedCustomer.vehicleType || 
      !selectedCustomer.vehicleYear || 
      !selectedCustomer.vehicleMake || 
      !selectedCustomer.vehicleModel || 
      !selectedCustomer.vehiclePhotoUrl ||
      !selectedCustomer.idType ||
      !selectedCustomer.idNumber ||
      !selectedCustomer.idExpiration;

    if (!isMissingData) return;

    const enrichCustomer = async () => {
      try {
        const ticketsRef = collection(db, 'buyTickets');
        const q = query(
          ticketsRef, 
          where('customerId', '==', selectedCustomer.id)
        );
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
          const tickets = querySnapshot.docs
            .map(doc => doc.data() as any)
            .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

          let photoUrl = selectedCustomer.photoUrl || '';
          let idImageUrl = selectedCustomer.idImageUrl || '';
          let vehiclePlate = selectedCustomer.vehiclePlate || '';
          let vehicleType = selectedCustomer.vehicleType || '';
          let vehicleYear = selectedCustomer.vehicleYear || '';
          let vehicleMake = selectedCustomer.vehicleMake || '';
          let vehicleModel = selectedCustomer.vehicleModel || '';
          let vehiclePhotoUrl = selectedCustomer.vehiclePhotoUrl || '';
          let idType = selectedCustomer.idType || '';
          let idNumber = selectedCustomer.idNumber || '';
          let idExpiration = selectedCustomer.idExpiration || '';

          for (const ticket of tickets) {
            if (!photoUrl && ticket.customerPhotoUrl) photoUrl = ticket.customerPhotoUrl;
            if (!idImageUrl && ticket.idImageUrl) idImageUrl = ticket.idImageUrl;
            if (!vehiclePlate && ticket.vehiclePlate) vehiclePlate = ticket.vehiclePlate;
            if (!vehicleType && ticket.vehicleType) vehicleType = ticket.vehicleType;
            if (!vehicleYear && ticket.vehicleYear) vehicleYear = ticket.vehicleYear;
            if (!vehicleMake && ticket.vehicleMake) vehicleMake = ticket.vehicleMake;
            if (!vehicleModel && ticket.vehicleModel) vehicleModel = ticket.vehicleModel;
            if (!vehiclePhotoUrl && ticket.vehiclePhotoUrl) vehiclePhotoUrl = ticket.vehiclePhotoUrl;
            if (!idType && ticket.idType) idType = ticket.idType;
            if (!idNumber && ticket.idNumber) idNumber = ticket.idNumber;
            if (!idExpiration && ticket.idExpiration) idExpiration = ticket.idExpiration;
          }

          const updates: any = {};
          if (photoUrl !== selectedCustomer.photoUrl) updates.photoUrl = photoUrl;
          if (idImageUrl !== selectedCustomer.idImageUrl) updates.idImageUrl = idImageUrl;
          if (vehiclePlate !== selectedCustomer.vehiclePlate) updates.vehiclePlate = vehiclePlate;
          if (vehicleType !== selectedCustomer.vehicleType) updates.vehicleType = vehicleType;
          if (vehicleYear !== selectedCustomer.vehicleYear) updates.vehicleYear = vehicleYear;
          if (vehicleMake !== selectedCustomer.vehicleMake) updates.vehicleMake = vehicleMake;
          if (vehicleModel !== selectedCustomer.vehicleModel) updates.vehicleModel = vehicleModel;
          if (vehiclePhotoUrl !== selectedCustomer.vehiclePhotoUrl) updates.vehiclePhotoUrl = vehiclePhotoUrl;
          if (idType !== selectedCustomer.idType) updates.idType = idType;
          if (idNumber !== selectedCustomer.idNumber) updates.idNumber = idNumber;
          if (idExpiration !== selectedCustomer.idExpiration) updates.idExpiration = idExpiration;

          if (Object.keys(updates).length > 0) {
            // Update in Firestore
            await updateDoc(doc(db, 'customers', selectedCustomer.id), {
              ...updates,
              updatedAt: new Date().toISOString()
            });
            // Update local state so it's visible on screen immediately
            setSelectedCustomer(prev => prev ? { ...prev, ...updates } : null);
          }
        }
      } catch (err) {
        console.error("Error auto-enriching customer from past tickets:", err);
      }
    };

    enrichCustomer();
  }, [selectedCustomer?.id]);

  const handleFileUpload = async (file: File, customerId?: string, field: 'idImageUrl' | 'vehiclePhotoUrl' = 'idImageUrl') => {
    if (!file) return null;
    setUploading(true);
    try {
      const fileName = `${Date.now()}_${file.name}`;
      const storageRef = ref(storage, `customer-ids/${fileName}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      
      if (customerId) {
        const customerRef = doc(db, 'customers', customerId);
        await updateDoc(customerRef, { [field]: url });
        setSelectedCustomer(prev => prev ? { ...prev, [field]: url } : null);
        setEditForm(prev => ({ ...prev, [field]: url }));
      } else {
        setAddForm(prev => ({ ...prev, [field]: url }));
      }
      return url;
    } catch (error) {
      console.error("Upload error:", error);
      return null;
    } finally {
      setUploading(false);
    }
  };

  const handleOCRID = async (imageUrl: string, target: 'add' | 'edit') => {
    setIsReadingID(true);
    try {
      const response = await fetch("/api/read-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idImageUrl: imageUrl })
      });
      if (!response.ok) throw new Error("Failed to read ID from photo");
      const res = await response.json();
      if (res.success && res.data) {
        const d = res.data;
        if (target === 'add') {
          setAddForm(prev => ({
            ...prev,
            name: d.name || prev.name || '',
            address: d.address || prev.address || '',
            idType: d.idType || prev.idType || 'Driver License',
            idNumber: d.idNumber || prev.idNumber || '',
            idExpiration: d.idExpiration || prev.idExpiration || ''
          }));
        } else {
          setEditForm(prev => ({
            ...prev,
            name: d.name || prev.name || '',
            address: d.address || prev.address || '',
            idType: d.idType || prev.idType || 'Driver License',
            idNumber: d.idNumber || prev.idNumber || '',
            idExpiration: d.idExpiration || prev.idExpiration || ''
          }));
        }
      }
    } catch (err) {
      console.error("AI ID OCR error:", err);
    } finally {
      setIsReadingID(false);
    }
  };

  const handleOCRVehicle = async (imageUrl: string, target: 'add' | 'edit') => {
    setIsReadingVehicle(true);
    try {
      const response = await fetch("/api/read-vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehiclePhotoUrl: imageUrl })
      });
      if (!response.ok) throw new Error("Failed to read vehicle from photo");
      const res = await response.json();
      if (res.success && res.data) {
        const d = res.data;
        if (target === 'add') {
          setAddForm(prev => ({
            ...prev,
            vehiclePlate: d.vehiclePlate || prev.vehiclePlate || '',
            vehicleType: d.vehicleType || prev.vehicleType || '',
            vehicleYear: d.vehicleYear || prev.vehicleYear || '',
            vehicleMake: d.vehicleMake || prev.vehicleMake || '',
            vehicleModel: d.vehicleModel || prev.vehicleModel || ''
          }));
        } else {
          setEditForm(prev => ({
            ...prev,
            vehiclePlate: d.vehiclePlate || prev.vehiclePlate || '',
            vehicleType: d.vehicleType || prev.vehicleType || '',
            vehicleYear: d.vehicleYear || prev.vehicleYear || '',
            vehicleMake: d.vehicleMake || prev.vehicleMake || '',
            vehicleModel: d.vehicleModel || prev.vehicleModel || ''
          }));
        }
      }
    } catch (err) {
      console.error("AI Vehicle OCR error:", err);
    } finally {
      setIsReadingVehicle(false);
    }
  };

  const handleUpdateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;

    try {
      const customerRef = doc(db, 'customers', selectedCustomer.id);
      
      const oldData = { ...selectedCustomer };

      // Remove id from update data as it's immutable in Firestore
      const rawCustomerType = editForm.customerType;
      const finalCustomerType = (rawCustomerType === 'individual' ? 'individual' : 'business');
      
      const { id, ...dataToUpdate } = editForm;
      await updateDoc(customerRef, {
        ...dataToUpdate,
        customerType: finalCustomerType,
        updatedAt: new Date().toISOString()
      });

      // Log update event
      await logAuditEvent(
        'customer',
        selectedCustomer.id,
        'update',
        { 
          before: { 
            name: oldData.name, 
            phone: oldData.phone, 
            address: oldData.address,
            idType: oldData.idType,
            idNumber: oldData.idNumber
          },
          after: { 
            name: editForm.name, 
            phone: editForm.phone, 
            address: editForm.address,
            idType: editForm.idType,
            idNumber: editForm.idNumber
          }
        },
        `Customer profile updated: ${oldData.name}`
      );

      setSelectedCustomer({ ...selectedCustomer, ...editForm } as Customer);
      setIsEditing(false);
      triggerNotification(`Customer "${editForm.name || selectedCustomer.name}" updated successfully!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `customers/${selectedCustomer.id}`);
    }
  };

  const executeDelete = async (customerId: string) => {
    if (!selectedCustomer) return;
    try {
      const customerRef = doc(db, 'customers', customerId);
      await deleteDoc(customerRef);

      // Log delete event
      await logAuditEvent(
        'customer',
        customerId,
        'delete',
        { before: selectedCustomer, after: null },
        `Customer profile deleted: ${selectedCustomer.name}`
      );

      setSelectedCustomer(null);
      setShowDeleteConfirm(false);
      triggerNotification(`Customer "${selectedCustomer.name}" deleted successfully!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `customers/${customerId}`);
    }
  };

  const executeMerge = async (source: Customer, target: Customer) => {
    setLoading(true);
    try {
      const batch = writeBatch(db);

      // 1. Fetch and update all buy tickets associated with the source customer
      const ticketsRef = collection(db, 'buyTickets');
      const q = query(ticketsRef, where('customerId', '==', source.id));
      const ticketSnapshot = await getDocs(q);

      ticketSnapshot.forEach((docSnap) => {
        batch.update(docSnap.ref, { customerId: target.id });
      });

      // 2. Optionally copy missing fields to destination
      const updatedFields: Partial<Customer> = {};
      if (mergeCopyFields) {
        const fieldsToCopy: (keyof Customer)[] = [
          'businessName', 'phone', 'secondaryPhone', 'email', 'address',
          'notes', 'idType', 'idNumber', 'idExpiration', 'idImageUrl', 'photoUrl'
        ];
        fieldsToCopy.forEach((field) => {
          if (!target[field] && source[field]) {
            (updatedFields as any)[field] = source[field];
          }
        });

        if (source.isBuyer && !target.isBuyer) {
          updatedFields.isBuyer = true;
        }
      }

      if (Object.keys(updatedFields).length > 0) {
        batch.update(doc(db, 'customers', target.id), {
          ...updatedFields,
          updatedAt: new Date().toISOString()
        });
      }

      // 3. Delete the source customer
      batch.delete(doc(db, 'customers', source.id));

      await batch.commit();

      // Log merge events
      await logAuditEvent(
        'customer',
        target.id,
        'update',
        { 
          before: target,
          after: { ...target, ...updatedFields }
        },
        `Merged customer ${source.name} into ${target.name}`
      );

      await logAuditEvent(
        'customer',
        source.id,
        'delete',
        { before: source, after: null },
        `Customer deleted due to merge into ${target.name}: ${source.name}`
      );

      // Reset states
      setSelectedCustomer(null);
      setMergeTarget(null);
      setMergeSearch('');
      setShowMergeModal(false);
      triggerNotification(`Merged customer "${source.name}" into "${target.name}" successfully!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `customers/${source.id}/merge`);
    } finally {
      setLoading(false);
    }
  };

  const handlePinSuccess = () => {
    if (pinPurpose === 'delete' && selectedCustomer) {
      executeDelete(selectedCustomer.id);
    } else if (pinPurpose === 'merge' && selectedCustomer && mergeTarget) {
      executeMerge(selectedCustomer, mergeTarget);
    }
    setPinPurpose(null);
  };

  const openProfile = (customer: Customer) => {
    setSelectedCustomer(customer);
    setEditForm(customer);
    setIsEditing(false);
  };

  const incompleteCount = customers.filter(c => getCustomerDataGaps(c).length > 0).length;

  const filteredCustomers = customers.filter(c => {
    if (filterMissingPhotos && getCustomerDataGaps(c).length === 0) {
      return false;
    }
    return (
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.businessName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone?.includes(searchQuery) ||
      c.email?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <main className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight font-display">Customer Management</h1>
          <p className="text-slate-500 font-medium mt-1">Search and manage your yard's customer database.</p>
        </div>
        <button
          onClick={() => {
            setAddForm({});
            setShowAddModal(true);
          }}
          aria-label="Add New Customer"
          className="px-6 py-3.5 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          <UserPlus className="w-5 h-5" aria-hidden="true" />
          New Customer
        </button>
      </header>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="relative group max-w-2xl flex-1">
          <label htmlFor="customer-search" className="sr-only">Search customers by name or phone</label>
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-blue-500 transition-colors" aria-hidden="true" />
          <input
            id="customer-search"
            type="text"
            placeholder="Search by name or phone..."
            className="w-full pl-14 pr-6 py-4 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-medium shadow-sm transition-all text-lg"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <button
          type="button"
          onClick={() => setFilterMissingPhotos(prev => !prev)}
          className={cn(
            "px-4 py-4 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 border transition-all shrink-0 cursor-pointer",
            filterMissingPhotos 
              ? "bg-amber-500 text-white border-amber-600 shadow-md shadow-amber-200" 
              : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
          )}
        >
          <AlertTriangle className={cn("w-4 h-4", filterMissingPhotos ? "text-white" : "text-amber-500")} />
          <span>Missing photos ({incompleteCount})</span>
        </button>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" aria-label="Customer List">
        {filteredCustomers.map((customer) => {
          const gaps = getCustomerDataGaps(customer);
          return (
            <article 
              key={customer.id} 
              className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm hover:border-blue-200 transition-colors group cursor-pointer outline-none focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500"
              onClick={() => openProfile(customer)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openProfile(customer);
                }
              }}
              aria-label={`View profile for ${customer.name}`}
            >
              <div className="flex items-center gap-4 mb-4">
                {customer.photoUrl ? (
                  <img 
                    src={customer.photoUrl} 
                    alt="" 
                    className="w-12 h-12 rounded-full object-cover border border-slate-200 shadow-sm"
                    referrerPolicy="no-referrer"
                    aria-hidden="true"
                    onError={handleImageError}
                  />
                ) : (
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                    <Users className="w-6 h-6" aria-hidden="true" />
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-slate-900">{customer.name}</h3>
                    {customer.isBuyer && (
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-black uppercase tracking-widest rounded-full flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" />
                        Buyer
                      </span>
                    )}
                    {gaps.length > 0 && (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold rounded-full flex items-center gap-1">
                        Needs {gaps.join(' + ')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">Customer since {new Date(customer.createdAt).toLocaleDateString()}</p>
                </div>
              </div>

            <div className="space-y-3">
              {customer.businessName && (
                <div className="flex items-center gap-3 text-sm text-slate-600">
                  <Building className="w-4 h-4 text-slate-400" aria-hidden="true" />
                  <span className="font-medium">{customer.businessName}</span>
                </div>
              )}
              <div className="flex items-center gap-3 text-sm text-slate-600">
                <Phone className="w-4 h-4 text-slate-400" aria-hidden="true" />
                <span aria-label="Phone number">{customer.phone || 'No phone provided'}</span>
              </div>
              {customer.email && (
                <div className="flex items-center gap-3 text-sm text-slate-600">
                  <Mail className="w-4 h-4 text-slate-400" />
                  <span className="truncate">{customer.email}</span>
                </div>
              )}
              <div className="flex items-center gap-3 text-sm text-slate-600">
                <MapPin className="w-4 h-4 text-slate-400" />
                <span className="truncate">{customer.address || 'No address provided'}</span>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-slate-50">
              <button 
                onClick={() => openProfile(customer)}
                className="w-full py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              >
                View Full Profile
              </button>
            </div>
          </article>
        );
      })}
      </section>

      {showAddModal && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-customer-title"
        >
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6">
              <h2 id="add-customer-title" className="text-xl font-bold text-slate-900">Add New Customer</h2>
              <button 
                onClick={() => setShowAddModal(false)} 
                className="p-2 hover:bg-slate-100 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                aria-label="Close modal"
              >
                <X className="w-5 h-5 text-slate-400" aria-hidden="true" />
              </button>
            </div>
              <form 
                onSubmit={async (e) => {
                  e.preventDefault();
                  const formData = new FormData(e.target as HTMLFormElement);
                  const fileInput = (e.target as HTMLFormElement).querySelector('input[type="file"]') as HTMLInputElement;
                  const file = fileInput?.files?.[0];
                  
                  let idImageUrl = '';
                  if (file) {
                    const uploadedUrl = await handleFileUpload(file);
                    if (uploadedUrl) idImageUrl = uploadedUrl;
                  }

                  const rawCustomerType = formData.get('customerType') as string;
                  const finalCustomerType = (rawCustomerType === 'individual' ? 'individual' : 'business');

                  const newCustomer = {
                    name: addForm.name || '',
                    businessName: addForm.businessName || '',
                    phone: addForm.phone || '',
                    secondaryPhone: addForm.secondaryPhone || '',
                    email: addForm.email || '',
                    address: addForm.address || '',
                    notes: addForm.notes || '',
                    isBuyer: !!addForm.isBuyer,
                    idType: addForm.idType || 'Driver License',
                    idNumber: addForm.idNumber || '',
                    idExpiration: addForm.idExpiration || '',
                    customerType: finalCustomerType,
                    verifiedStatus: 'unverified',
                    idImageUrl: idImageUrl || addForm.idImageUrl || '',
                    photoUrl: addForm.photoUrl || '',
                    vehiclePlate: addForm.vehiclePlate || '',
                    vehicleType: addForm.vehicleType || '',
                    vehicleYear: addForm.vehicleYear || '',
                    vehicleMake: addForm.vehicleMake || '',
                    vehicleModel: addForm.vehicleModel || '',
                    vehiclePhotoUrl: addForm.vehiclePhotoUrl || '',
                    createdAt: new Date().toISOString()
                  };

                  try {
                    const docRef = await addDoc(collection(db, 'customers'), newCustomer);
                    
                    // Log creation
                    await logAuditEvent(
                      'customer',
                      docRef.id,
                      'create',
                      { after: newCustomer },
                      `New customer added: ${newCustomer.name}`
                    );

                    setShowAddModal(false);
                    triggerNotification(`Customer "${newCustomer.name}" added successfully!`);
                  } catch (error) {
                    handleFirestoreError(error, OperationType.CREATE, 'customers');
                  }
                }} className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-1">
                    <label htmlFor="new-customer-name" className="text-xs font-bold text-slate-500 uppercase">Full Name</label>
                    <input 
                      id="new-customer-name" 
                      name="name" 
                      required 
                      value={addForm.name || ''} 
                      onChange={(e) => setAddForm(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                      placeholder="John Doe" 
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="new-customer-business" className="text-xs font-bold text-slate-500 uppercase">Business Name</label>
                    <input 
                      id="new-customer-business" 
                      name="businessName" 
                      value={addForm.businessName || ''} 
                      onChange={(e) => setAddForm(prev => ({ ...prev, businessName: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                      placeholder="Acme Corp" 
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label htmlFor="new-customer-phone" className="text-xs font-bold text-slate-500 uppercase">Primary Phone</label>
                      <input 
                        id="new-customer-phone" 
                        name="phone" 
                        value={addForm.phone || ''} 
                        onChange={(e) => setAddForm(prev => ({ ...prev, phone: e.target.value }))}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                        placeholder="(555) 000-0000" 
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="new-customer-secondary-phone" className="text-xs font-bold text-slate-500 uppercase">Secondary Phone</label>
                      <input 
                        id="new-customer-secondary-phone" 
                        name="secondaryPhone" 
                        value={addForm.secondaryPhone || ''} 
                        onChange={(e) => setAddForm(prev => ({ ...prev, secondaryPhone: e.target.value }))}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                        placeholder="(555) 000-0000" 
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label htmlFor="new-customer-id-type" className="text-xs font-bold text-slate-500 uppercase">ID Type</label>
                      <select 
                        id="new-customer-id-type" 
                        name="idType" 
                        value={addForm.idType || 'Driver License'} 
                        onChange={(e) => setAddForm(prev => ({ ...prev, idType: e.target.value }))}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      >
                        <option value="Driver License">Driver License</option>
                        <option value="State ID">State ID</option>
                        <option value="Passport">Passport</option>
                        <option value="Mexican Matricula">Mexican Matricula</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="new-customer-type" className="text-xs font-bold text-slate-500 uppercase">Customer Type</label>
                      <select 
                        id="new-customer-type" 
                        name="customerType" 
                        value={addForm.customerType || 'individual'} 
                        onChange={(e) => setAddForm(prev => ({ ...prev, customerType: e.target.value as 'individual' | 'commercial' | 'industrial' }))}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      >
                        <option value="individual">Individual</option>
                        <option value="commercial">Commercial/Business</option>
                        <option value="industrial">Industrial</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label htmlFor="new-customer-id-number" className="text-xs font-bold text-slate-500 uppercase">ID Number</label>
                      <input 
                        id="new-customer-id-number" 
                        name="idNumber" 
                        value={addForm.idNumber || ''} 
                        onChange={(e) => setAddForm(prev => ({ ...prev, idNumber: e.target.value }))}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                        placeholder="DL123456" 
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="new-customer-id-exp" className="text-xs font-bold text-slate-500 uppercase">ID Expiration</label>
                      <input 
                        id="new-customer-id-exp" 
                        name="idExpiration" 
                        type="date" 
                        value={addForm.idExpiration || ''} 
                        onChange={(e) => setAddForm(prev => ({ ...prev, idExpiration: e.target.value }))}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="new-customer-email" className="text-xs font-bold text-slate-500 uppercase">Email Address</label>
                    <input 
                      id="new-customer-email" 
                      name="email" 
                      type="email" 
                      value={addForm.email || ''} 
                      onChange={(e) => setAddForm(prev => ({ ...prev, email: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                      placeholder="john@example.com" 
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="new-customer-address" className="text-xs font-bold text-slate-500 uppercase">Address</label>
                    <input 
                      id="new-customer-address" 
                      name="address" 
                      value={addForm.address || ''} 
                      onChange={(e) => setAddForm(prev => ({ ...prev, address: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                      placeholder="123 Street, City, State" 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Profile Photo</label>
                    <CameraCapture 
                      label="Take Profile Photo"
                      onCapture={(url) => setAddForm(prev => ({ ...prev, photoUrl: url }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">ID Image</label>
                    <CameraCapture 
                      label="Take ID Photo"
                      onCapture={(url) => {
                        setAddForm(prev => ({ ...prev, idImageUrl: url }));
                        handleOCRID(url, 'add');
                      }}
                    />
                    <div className="flex items-center gap-4">
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        id="id-upload" 
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const url = await handleFileUpload(file, undefined, 'idImageUrl');
                            if (url) {
                              handleOCRID(url, 'add');
                            }
                          }
                        }}
                      />
                      <label htmlFor="id-upload" className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all text-slate-500">
                        <Upload className="w-5 h-5" aria-hidden="true" />
                        <span>{uploading ? 'Uploading...' : 'Upload ID Image'}</span>
                      </label>
                    </div>
                    {addForm.idImageUrl && (
                      <div className="mt-2 border border-slate-200 rounded-xl p-2 bg-slate-50 relative group">
                        <img src={addForm.idImageUrl} alt="ID Preview" className="w-full h-24 object-cover rounded-lg" />
                        <button
                          type="button"
                          disabled={isReadingID}
                          onClick={() => handleOCRID(addForm.idImageUrl!, 'add')}
                          className="absolute bottom-2 right-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2 px-3 rounded-lg shadow-lg flex items-center gap-1.5 transition-colors"
                        >
                          {isReadingID ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Analyzing...
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5" />
                              AI Scan ID
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Vehicle Details */}
                  <div className="border-t border-slate-200 pt-4 mt-4">
                    <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                      <Truck className="w-4 h-4 text-slate-500" />
                      Vehicle Details
                    </h3>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="space-y-1">
                        <label htmlFor="new-vehicle-plate" className="text-xs font-bold text-slate-500 uppercase">License Plate</label>
                        <input 
                          id="new-vehicle-plate" 
                          name="vehiclePlate" 
                          value={addForm.vehiclePlate || ''} 
                          onChange={(e) => setAddForm(prev => ({ ...prev, vehiclePlate: e.target.value }))}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all uppercase" 
                          placeholder="ABC-1234" 
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor="new-vehicle-type" className="text-xs font-bold text-slate-500 uppercase">Vehicle Type</label>
                        <input 
                          id="new-vehicle-type" 
                          name="vehicleType" 
                          value={addForm.vehicleType || ''} 
                          onChange={(e) => setAddForm(prev => ({ ...prev, vehicleType: e.target.value }))}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                          placeholder="Pickup Truck" 
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      <div className="space-y-1">
                        <label htmlFor="new-vehicle-year" className="text-xs font-bold text-slate-500 uppercase">Year</label>
                        <input 
                          id="new-vehicle-year" 
                          name="vehicleYear" 
                          value={addForm.vehicleYear || ''} 
                          onChange={(e) => setAddForm(prev => ({ ...prev, vehicleYear: e.target.value }))}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                          placeholder="2018" 
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor="new-vehicle-make" className="text-xs font-bold text-slate-500 uppercase">Make</label>
                        <input 
                          id="new-vehicle-make" 
                          name="vehicleMake" 
                          value={addForm.vehicleMake || ''} 
                          onChange={(e) => setAddForm(prev => ({ ...prev, vehicleMake: e.target.value }))}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                          placeholder="Ford" 
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor="new-vehicle-model" className="text-xs font-bold text-slate-500 uppercase">Model</label>
                        <input 
                          id="new-vehicle-model" 
                          name="vehicleModel" 
                          value={addForm.vehicleModel || ''} 
                          onChange={(e) => setAddForm(prev => ({ ...prev, vehicleModel: e.target.value }))}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" 
                          placeholder="F-150" 
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">Vehicle Photo (License Plate)</label>
                      <CameraCapture 
                        label="Take Vehicle Photo"
                        onCapture={(url) => {
                          setAddForm(prev => ({ ...prev, vehiclePhotoUrl: url }));
                          handleOCRVehicle(url, 'add');
                        }}
                      />
                      <div className="flex items-center gap-4">
                        <input 
                          type="file" 
                          accept="image/*" 
                          className="hidden" 
                          id="vehicle-upload-add" 
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const url = await handleFileUpload(file, undefined, 'vehiclePhotoUrl');
                              if (url) {
                                handleOCRVehicle(url, 'add');
                              }
                            }
                          }}
                        />
                        <label htmlFor="vehicle-upload-add" className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all text-slate-500">
                          <Upload className="w-5 h-5" aria-hidden="true" />
                          <span>Upload Vehicle Image</span>
                        </label>
                      </div>
                      
                      {addForm.vehiclePhotoUrl && (
                        <div className="mt-2 border border-slate-200 rounded-xl p-2 bg-slate-50 relative group">
                          <img src={addForm.vehiclePhotoUrl} alt="Vehicle Preview" className="w-full h-24 object-cover rounded-lg" />
                          <button
                            type="button"
                            disabled={isReadingVehicle}
                            onClick={() => handleOCRVehicle(addForm.vehiclePhotoUrl!, 'add')}
                            className="absolute bottom-2 right-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2 px-3 rounded-lg shadow-lg flex items-center gap-1.5 transition-colors"
                          >
                            {isReadingVehicle ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                Analyzing...
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3.5 h-3.5" />
                                AI Scan Plate
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="new-customer-notes" className="text-xs font-bold text-slate-500 uppercase">Notes</label>
                    <textarea 
                      id="new-customer-notes" 
                      name="notes" 
                      value={addForm.notes || ''} 
                      onChange={(e) => setAddForm(prev => ({ ...prev, notes: e.target.value }))}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all resize-none" 
                      rows={2} 
                      placeholder="Any additional details..." 
                    />
                  </div>
                  <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
                    <input 
                      type="checkbox" 
                      id="new-customer-is-buyer" 
                      name="isBuyer" 
                      checked={!!addForm.isBuyer}
                      onChange={(e) => setAddForm(prev => ({ ...prev, isBuyer: e.target.checked }))}
                      className="w-5 h-5 rounded border-blue-300 text-blue-600 focus:ring-blue-500" 
                    />
                    <label htmlFor="new-customer-is-buyer" className="text-sm font-bold text-blue-900">Label as Buyer (for Invoices)</label>
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="submit" disabled={uploading} className="flex-1 bg-blue-600 text-white py-4 rounded-xl font-bold hover:bg-blue-700 transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 shadow-lg shadow-blue-200">
                    {uploading ? 'Processing...' : 'Save Customer'}
                  </button>
                  <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-4 rounded-xl font-bold hover:bg-slate-50 transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-400">Cancel</button>
                </div>
              </form>
          </div>
        </div>
      )}

      {/* Full Profile Modal */}
      {selectedCustomer && (
        <div 
          className="fixed inset-0 bg-slate-900/60 z-[70] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-300"
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-modal-title"
        >
          <div className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            {/* Modal Header */}
                <div className="bg-slate-900 p-8 text-white relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/20 rounded-full blur-3xl -mr-32 -mt-32" aria-hidden="true"></div>
                  <div className="relative z-10 flex justify-between items-start">
                    <div className="flex items-center gap-6">
                      <div className="relative">
                        {selectedCustomer.photoUrl ? (
                          <img 
                            src={selectedCustomer.photoUrl} 
                            alt="" 
                            className="w-20 h-20 rounded-2xl object-cover border-2 border-white/20 shadow-xl"
                            referrerPolicy="no-referrer"
                            aria-hidden="true"
                            onError={handleImageError}
                          />
                        ) : (
                          <div className="w-20 h-20 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-md border border-white/20">
                            <Users className="w-10 h-10 text-blue-400" aria-hidden="true" />
                          </div>
                        )}
                        {selectedCustomer.verifiedStatus === 'verified' && (
                          <div className="absolute -bottom-2 -right-2 bg-green-500 text-white p-1 rounded-full shadow-lg border-2 border-slate-900">
                            <ShieldCheck className="w-4 h-4" />
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-3">
                          <h2 id="profile-modal-title" className="text-3xl font-black tracking-tight">{isEditing ? editForm.name : selectedCustomer.name}</h2>
                          {selectedCustomer.verifiedStatus === 'verified' && (
                             <span className="px-2 py-0.5 bg-green-500/20 text-green-400 border border-green-500/50 rounded-full text-[10px] font-black uppercase tracking-widest">Verified</span>
                          )}
                        </div>
                        <p className="text-blue-300 font-bold flex items-center gap-2 mt-1">
                          <Calendar className="w-4 h-4" aria-hidden="true" />
                          Customer since {new Date(selectedCustomer.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                <button 
                  onClick={() => setSelectedCustomer(null)}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  aria-label="Close modal"
                >
                  <X className="w-6 h-6" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="p-8 max-h-[70vh] overflow-y-auto">
              <form onSubmit={handleUpdateCustomer} className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div className="space-y-1">
                      <label htmlFor="edit-customer-name" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Users className="w-3 h-3" aria-hidden="true" />
                        Full Name
                      </label>
                      {isEditing ? (
                        <input 
                          id="edit-customer-name"
                          value={editForm.name || ''} 
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold"
                        />
                      ) : (
                        <p className="text-lg font-bold text-slate-900 px-1">{selectedCustomer.name}</p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="edit-customer-business" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Building className="w-3 h-3" aria-hidden="true" />
                        Business Name
                      </label>
                      {isEditing ? (
                        <input 
                          id="edit-customer-business"
                          value={editForm.businessName || ''} 
                          onChange={(e) => setEditForm({ ...editForm, businessName: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold"
                        />
                      ) : (
                        <p className="text-lg font-bold text-slate-900 px-1">{selectedCustomer.businessName || 'Not provided'}</p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="edit-customer-phone" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Phone className="w-3 h-3" aria-hidden="true" />
                        Primary Phone
                      </label>
                      {isEditing ? (
                        <input 
                          id="edit-customer-phone"
                          value={editForm.phone || ''} 
                          onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold"
                        />
                      ) : (
                        <p className="text-lg font-bold text-slate-900 px-1">{selectedCustomer.phone || 'Not provided'}</p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="edit-customer-secondary-phone" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Phone className="w-3 h-3" aria-hidden="true" />
                        Secondary Phone
                      </label>
                      {isEditing ? (
                        <input 
                          id="edit-customer-secondary-phone"
                          value={editForm.secondaryPhone || ''} 
                          onChange={(e) => setEditForm({ ...editForm, secondaryPhone: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold"
                        />
                      ) : (
                        <p className="text-lg font-bold text-slate-900 px-1">{selectedCustomer.secondaryPhone || 'Not provided'}</p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                        Identity Verification
                      </label>
                      {isEditing ? (
                        <div className="grid grid-cols-1 gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-200">
                          <select 
                            value={editForm.idType || ''}
                            onChange={(e) => setEditForm({ ...editForm, idType: e.target.value })}
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold transition-all focus:ring-2 focus:ring-blue-500 outline-none"
                          >
                            <option value="">Select ID Type</option>
                            <option value="Driver License">Driver License</option>
                            <option value="State ID">State ID</option>
                            <option value="Passport">Passport</option>
                            <option value="Other">Other</option>
                          </select>
                          <input 
                            placeholder="ID Number"
                            value={editForm.idNumber || ''}
                            onChange={(e) => setEditForm({ ...editForm, idNumber: e.target.value })}
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold transition-all focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                          <div className="space-y-1">
                            <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest px-1">Expiration Date</label>
                            <input 
                              type="date"
                              value={editForm.idExpiration || ''}
                              onChange={(e) => setEditForm({ ...editForm, idExpiration: e.target.value })}
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold transition-all focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="px-1 bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
                          <p className="text-sm font-black text-slate-900">{selectedCustomer.idType || 'No ID Type'}</p>
                          <p className="text-xs font-bold text-slate-500 mt-0.5">{selectedCustomer.idNumber || 'No ID Number'}</p>
                          {selectedCustomer.idExpiration && (
                            <p className="text-[10px] font-black text-blue-600 mt-2 uppercase tracking-tight">Exp: {selectedCustomer.idExpiration}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="space-y-1">
                      <label htmlFor="edit-customer-email" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Mail className="w-3 h-3" aria-hidden="true" />
                        Email Address
                      </label>
                      {isEditing ? (
                        <input 
                          id="edit-customer-email"
                          value={editForm.email || ''} 
                          onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold"
                        />
                      ) : (
                        <p className="text-lg font-bold text-slate-900 px-1">{selectedCustomer.email || 'Not provided'}</p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="edit-customer-address" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <MapPin className="w-3 h-3" aria-hidden="true" />
                        Address
                      </label>
                      {isEditing ? (
                        <input 
                          id="edit-customer-address"
                          value={editForm.address || ''} 
                          onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold"
                        />
                      ) : (
                        <p className="text-lg font-bold text-slate-900 px-1">{selectedCustomer.address || 'Not provided'}</p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Camera className="w-3 h-3" aria-hidden="true" />
                        Profile Photo
                      </label>
                      {isEditing ? (
                        <CameraCapture 
                          label="Update Profile Photo"
                          onCapture={(url) => setEditForm({ ...editForm, photoUrl: url })}
                        />
                      ) : (
                        selectedCustomer.photoUrl ? (
                          <img 
                            src={selectedCustomer.photoUrl} 
                            alt="Profile" 
                            className="w-full h-32 object-cover rounded-xl border border-slate-200"
                            referrerPolicy="no-referrer"
                            onError={handleImageError}
                          />
                        ) : (
                          <p className="text-slate-500 text-sm px-1 italic">No profile photo</p>
                        )
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <ImageIcon className="w-3 h-3" aria-hidden="true" />
                        ID Image
                      </label>
                      <div className="space-y-4">
                        {(editForm.idImageUrl || selectedCustomer.idImageUrl) ? (
                          <div className="relative group">
                            <img 
                              src={editForm.idImageUrl || selectedCustomer.idImageUrl} 
                              alt="Customer ID" 
                              className="w-full h-32 object-cover rounded-xl border border-slate-200"
                              referrerPolicy="no-referrer"
                              onError={handleImageError}
                            />
                            {isEditing && (
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl gap-2">
                                <label className="cursor-pointer bg-white text-slate-900 px-3 py-1.5 rounded-lg text-xs font-bold shadow-md hover:bg-slate-100 transition-colors">
                                  Change Image
                                  <input 
                                    type="file" 
                                    accept="image/*" 
                                    className="hidden" 
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) handleFileUpload(file, selectedCustomer.id);
                                    }}
                                  />
                                </label>
                                <button
                                  type="button"
                                  disabled={isReadingID}
                                  onClick={() => handleOCRID((editForm.idImageUrl || selectedCustomer.idImageUrl)!, 'edit')}
                                  className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-md hover:bg-blue-700 transition-colors flex items-center gap-1"
                                >
                                  {isReadingID ? (
                                    <>
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                      Scanning...
                                    </>
                                  ) : (
                                    <>
                                      <Sparkles className="w-3 h-3" />
                                      AI Scan ID
                                    </>
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="w-full h-32 bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-slate-400 gap-2">
                            <ImageIcon className="w-8 h-8" aria-hidden="true" />
                            <span className="text-xs">No ID image uploaded</span>
                            {isEditing && (
                              <label className="cursor-pointer bg-blue-600 text-white px-3 py-1 rounded-lg text-xs font-bold mt-1">
                                Upload Now
                                <input 
                                  type="file" 
                                  accept="image/*" 
                                  className="hidden" 
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleFileUpload(file, selectedCustomer.id);
                                  }}
                                />
                                </label>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                      <div className="space-y-1">
                        <label htmlFor="edit-customer-notes" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                          <FileText className="w-3 h-3" aria-hidden="true" />
                          Notes
                        </label>
                        {isEditing ? (
                          <textarea 
                            id="edit-customer-notes"
                            value={editForm.notes || ''} 
                            onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold resize-none"
                            rows={2}
                          />
                        ) : (
                          <p className="text-slate-600 px-1">{selectedCustomer.notes || 'No notes available'}</p>
                        )}
                      </div>

                      <div className="pt-4">
                        {isEditing ? (
                          <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
                            <input 
                              type="checkbox" 
                              id="edit-customer-is-buyer" 
                              checked={editForm.isBuyer || false}
                              onChange={(e) => setEditForm({ ...editForm, isBuyer: e.target.checked })}
                              className="w-5 h-5 rounded border-blue-300 text-blue-600 focus:ring-blue-500" 
                            />
                            <label htmlFor="edit-customer-is-buyer" className="text-sm font-bold text-blue-900">Label as Buyer (for Invoices)</label>
                          </div>
                        ) : selectedCustomer.isBuyer && (
                          <div className="flex items-center gap-2 text-blue-600 bg-blue-50 px-3 py-2 rounded-lg w-fit">
                            <ShieldCheck className="w-4 h-4" />
                            <span className="text-xs font-black uppercase tracking-widest">Verified Buyer</span>
                          </div>
                        )}
                      </div>
                    </div>
                </div>

                {/* Vehicle Information Section */}
                <div className="border-t border-slate-100 pt-6 mt-6">
                  <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <Truck className="w-5 h-5 text-slate-500" />
                    Vehicle & Transport Information
                  </h3>
                  
                  {isEditing ? (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label htmlFor="edit-vehicle-plate" className="text-xs font-bold text-slate-400 uppercase">License Plate</label>
                          <input 
                            id="edit-vehicle-plate"
                            value={editForm.vehiclePlate || ''}
                            onChange={(e) => setEditForm({ ...editForm, vehiclePlate: e.target.value })}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold uppercase"
                            placeholder="ABC-1234"
                          />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="edit-vehicle-type" className="text-xs font-bold text-slate-400 uppercase">Vehicle Type</label>
                          <input 
                            id="edit-vehicle-type"
                            value={editForm.vehicleType || ''}
                            onChange={(e) => setEditForm({ ...editForm, vehicleType: e.target.value })}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold"
                            placeholder="Pickup Truck"
                          />
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label htmlFor="edit-vehicle-year" className="text-xs font-bold text-slate-400 uppercase">Year</label>
                          <input 
                            id="edit-vehicle-year"
                            value={editForm.vehicleYear || ''}
                            onChange={(e) => setEditForm({ ...editForm, vehicleYear: e.target.value })}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold"
                            placeholder="2018"
                          />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="edit-vehicle-make" className="text-xs font-bold text-slate-400 uppercase">Make</label>
                          <input 
                            id="edit-vehicle-make"
                            value={editForm.vehicleMake || ''}
                            onChange={(e) => setEditForm({ ...editForm, vehicleMake: e.target.value })}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold"
                            placeholder="Ford"
                          />
                        </div>
                        <div className="space-y-1">
                          <label htmlFor="edit-vehicle-model" className="text-xs font-bold text-slate-400 uppercase">Model</label>
                          <input 
                            id="edit-vehicle-model"
                            value={editForm.vehicleModel || ''}
                            onChange={(e) => setEditForm({ ...editForm, vehicleModel: e.target.value })}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold"
                            placeholder="F-150"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase">Vehicle Photo (License Plate)</label>
                        <CameraCapture 
                          label="Take Vehicle Photo"
                          onCapture={(url) => {
                            setEditForm({ ...editForm, vehiclePhotoUrl: url });
                            handleOCRVehicle(url, 'edit');
                          }}
                        />
                        <div className="flex items-center gap-4">
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            id="vehicle-upload-edit" 
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const url = await handleFileUpload(file, selectedCustomer.id, 'vehiclePhotoUrl');
                                if (url) {
                                  handleOCRVehicle(url, 'edit');
                                }
                              }
                            }}
                          />
                          <label htmlFor="vehicle-upload-edit" className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all text-slate-500">
                            <Upload className="w-5 h-5" aria-hidden="true" />
                            <span>Upload Vehicle Image</span>
                          </label>
                        </div>
                        
                        {(editForm.vehiclePhotoUrl || selectedCustomer.vehiclePhotoUrl) && (
                          <div className="mt-2 border border-slate-200 rounded-xl p-2 bg-slate-50 relative group">
                            <img src={editForm.vehiclePhotoUrl || selectedCustomer.vehiclePhotoUrl} alt="Vehicle Preview" className="w-full h-32 object-cover rounded-lg" />
                            <button
                              type="button"
                              disabled={isReadingVehicle}
                              onClick={() => handleOCRVehicle((editForm.vehiclePhotoUrl || selectedCustomer.vehiclePhotoUrl)!, 'edit')}
                              className="absolute bottom-2 right-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2 px-3 rounded-lg shadow-lg flex items-center gap-1.5 transition-colors"
                            >
                              {isReadingVehicle ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  Analyzing...
                                </>
                              ) : (
                                <>
                                  <Sparkles className="w-3.5 h-3.5" />
                                  AI Scan Plate
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 rounded-2xl p-6 border border-slate-100">
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">License Plate</span>
                            <span className="text-lg font-black text-slate-900 uppercase">{selectedCustomer.vehiclePlate || 'Not Provided'}</span>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Vehicle Type</span>
                            <span className="text-lg font-bold text-slate-800">{selectedCustomer.vehicleType || 'Not Provided'}</span>
                          </div>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Year / Make / Model</span>
                          <span className="text-lg font-bold text-slate-800">
                            {[selectedCustomer.vehicleYear, selectedCustomer.vehicleMake, selectedCustomer.vehicleModel].filter(Boolean).join(' ') || 'Not Provided'}
                          </span>
                        </div>
                      </div>
                      
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">Vehicle Photo</span>
                        {selectedCustomer.vehiclePhotoUrl ? (
                          <div className="relative group rounded-xl overflow-hidden border border-slate-200">
                            <img src={selectedCustomer.vehiclePhotoUrl} alt="Vehicle/Truck" className="w-full h-32 object-cover" />
                          </div>
                        ) : (
                          <div className="w-full h-32 bg-slate-100 rounded-xl flex flex-col items-center justify-center text-slate-400 border border-slate-200">
                            <Truck className="w-8 h-8 opacity-40 mb-1" />
                            <span className="text-xs italic">No photo on file</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-8 border-t border-slate-100 flex gap-4">
                  {isEditing ? (
                    <>
                      <button 
                        type="button"
                        onClick={() => setEditForm(prev => ({ ...prev, verifiedStatus: prev.verifiedStatus === 'verified' ? 'unverified' : 'verified' }))}
                        className={cn(
                          "flex-1 py-4 border rounded-2xl font-bold flex items-center justify-center gap-2 transition-all outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                          editForm.verifiedStatus === 'verified'
                            ? "border-green-200 text-green-600 bg-green-50"
                            : "border-slate-200 text-slate-600 hover:bg-white"
                        )}
                      >
                        <ShieldCheck className={cn("w-5 h-5", editForm.verifiedStatus === 'verified' ? "text-green-600" : "text-slate-400")} aria-hidden="true" />
                        {editForm.verifiedStatus === 'verified' ? 'Verified Profile' : 'Mark as Verified'}
                      </button>
                      <button 
                        type="submit"
                        className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                      >
                        <Save className="w-5 h-5" aria-hidden="true" />
                        Save Changes
                      </button>
                      <button 
                        type="button"
                        onClick={() => setIsEditing(false)}
                        className="flex-1 py-4 border border-slate-200 text-slate-600 rounded-2xl font-bold hover:bg-slate-50 transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <div className="w-full space-y-3">
                      <button 
                        type="button"
                        onClick={() => setIsEditing(true)}
                        className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
                      >
                        <Edit2 className="w-5 h-5" aria-hidden="true" />
                        Edit Profile Information
                      </button>
                      
                      <div className="grid grid-cols-3 gap-3">
                        <button 
                          type="button"
                          onClick={() => {
                            setAddForm({
                              name: `${selectedCustomer.name} (Copy)`,
                              businessName: selectedCustomer.businessName || '',
                              phone: selectedCustomer.phone || '',
                              secondaryPhone: selectedCustomer.secondaryPhone || '',
                              email: selectedCustomer.email || '',
                              address: selectedCustomer.address || '',
                              notes: selectedCustomer.notes || '',
                              isBuyer: selectedCustomer.isBuyer || false,
                              idType: selectedCustomer.idType || 'Driver License',
                              idNumber: selectedCustomer.idNumber || '',
                              idExpiration: selectedCustomer.idExpiration || '',
                              customerType: selectedCustomer.customerType || 'individual',
                              photoUrl: selectedCustomer.photoUrl || '',
                              idImageUrl: selectedCustomer.idImageUrl || '',
                            });
                            setShowAddModal(true);
                          }}
                          className="py-3.5 border border-slate-200 text-slate-700 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-slate-50 transition-all active:scale-95 outline-none"
                        >
                          <Plus className="w-4 h-4" />
                          Duplicate
                        </button>
                        
                        <button 
                          type="button"
                          onClick={() => {
                            setMergeTarget(null);
                            setMergeSearch('');
                            setShowMergeModal(true);
                          }}
                          className="py-3.5 border border-slate-200 text-slate-700 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-slate-50 transition-all active:scale-95 outline-none"
                        >
                          <ArrowRightLeft className="w-4 h-4 text-blue-600" />
                          Merge
                        </button>
                        
                        <button 
                          type="button"
                          onClick={() => setShowDeleteConfirm(true)}
                          className="py-3.5 border border-red-200 text-red-600 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-red-50 transition-all active:scale-95 outline-none"
                        >
                          <X className="w-4 h-4" />
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && selectedCustomer && (
        <div className="fixed inset-0 bg-slate-900/60 z-[200] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-sm p-8 shadow-2xl animate-in zoom-in-95 duration-200 space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center text-red-600">
                <X className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900 font-display">Delete Customer</h3>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Are you absolutely sure?</p>
              </div>
            </div>
            
            <p className="text-slate-600 text-sm leading-relaxed">
              Are you sure you want to permanently delete <strong>{selectedCustomer.name}</strong>?
              Historical tickets will remain intact as "Unknown Customer", but this profile cannot be recovered.
            </p>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  const hasDeletePermission = profile?.role === 'manager' && profile?.permissions?.canDeleteData;
                  if (hasDeletePermission) {
                    executeDelete(selectedCustomer.id);
                  } else {
                    setPinPurpose('delete');
                    setShowPinModal(true);
                  }
                }}
                className="w-full py-4 bg-red-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-red-700 transition-all shadow-lg shadow-red-200"
              >
                Yes, Delete Permanently
              </button>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="w-full py-4 border border-slate-200 text-slate-500 rounded-2xl font-bold hover:bg-slate-50 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merge Profiles Modal */}
      {showMergeModal && selectedCustomer && (
        <div 
          className="fixed inset-0 bg-slate-900/60 z-[150] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div className="bg-white rounded-3xl w-full max-w-lg p-8 shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-2xl font-bold text-slate-900 font-display">Merge Customer Profiles</h3>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Combine records and preserve tickets</p>
              </div>
              <button onClick={() => setShowMergeModal(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <div className="space-y-6 overflow-y-auto pr-1 flex-1">
              {/* Source Customer (ReadOnly) */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">Source Profile (Will be Deleted)</label>
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                  <p className="text-md font-bold text-slate-900">{selectedCustomer.name}</p>
                  {selectedCustomer.phone && <p className="text-xs text-slate-500 font-mono mt-0.5">{selectedCustomer.phone}</p>}
                  {selectedCustomer.businessName && <p className="text-xs text-slate-500 mt-1">{selectedCustomer.businessName}</p>}
                </div>
              </div>

              {/* Merge Into Target Selector */}
              <div className="space-y-2 relative">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">Merge Into Target Profile (Will Remain)</label>
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search destination customer by name/phone..."
                    className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                    value={mergeSearch}
                    onChange={(e) => {
                      setMergeSearch(e.target.value);
                      setMergeTarget(null); // Clear selected if typing
                    }}
                  />
                </div>

                {/* Matches dropdown */}
                {mergeSearch && !mergeTarget && (
                  <div className="absolute z-[160] left-0 right-0 top-full mt-1 max-h-48 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl divide-y divide-slate-100">
                    {customers
                      .filter(c => c.id !== selectedCustomer.id && (
                        c.name.toLowerCase().includes(mergeSearch.toLowerCase()) ||
                        c.phone?.includes(mergeSearch) ||
                        c.businessName?.toLowerCase().includes(mergeSearch.toLowerCase())
                      ))
                      .slice(0, 5)
                      .map(customer => (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => {
                            setMergeTarget(customer);
                            setMergeSearch(customer.name);
                          }}
                          className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center justify-between"
                        >
                          <div>
                            <p className="text-sm font-bold text-slate-900">{customer.name}</p>
                            {customer.phone && <p className="text-xs text-slate-500 font-mono">{customer.phone}</p>}
                          </div>
                          {customer.businessName && <span className="text-xs font-black uppercase text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg">{customer.businessName}</span>}
                        </button>
                      ))
                    }
                    {customers.filter(c => c.id !== selectedCustomer.id && (
                      c.name.toLowerCase().includes(mergeSearch.toLowerCase()) ||
                      c.phone?.includes(mergeSearch) ||
                      c.businessName?.toLowerCase().includes(mergeSearch.toLowerCase())
                    )).length === 0 && (
                      <p className="p-3 text-xs text-slate-500 italic text-center">No other customers found</p>
                    )}
                  </div>
                )}
              </div>

              {mergeTarget && (
                <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100">
                  <p className="text-[10px] font-black uppercase text-blue-700 tracking-widest mb-1">Target Customer Selected</p>
                  <p className="text-md font-bold text-slate-800">{mergeTarget.name}</p>
                  {mergeTarget.phone && <p className="text-xs text-slate-500 font-mono mt-0.5">{mergeTarget.phone}</p>}
                </div>
              )}

              {/* Options */}
              <div className="flex items-start gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <input
                  type="checkbox"
                  id="merge-copy-fields"
                  checked={mergeCopyFields}
                  onChange={(e) => setMergeCopyFields(e.target.checked)}
                  className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 mt-0.5"
                />
                <label htmlFor="merge-copy-fields" className="text-xs font-bold text-slate-600 leading-relaxed cursor-pointer select-none">
                  Copy missing profile data (Phone, ID info, Address, Email, Notes, Photos) from source profile to target profile of target fields that are empty.
                </label>
              </div>

              {/* Warning message */}
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 text-amber-800 text-xs font-medium space-y-1.5 leading-relaxed">
                <p className="font-bold flex items-center gap-1.5 text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  Warning: Permanent Merge Action
                </p>
                <p>
                  All tickets under <strong>{selectedCustomer.name}</strong> will be re-assigned to <strong>{mergeTarget?.name || 'the target'}</strong>. Once merged, <strong>{selectedCustomer.name}</strong> will be permanently deleted.
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6 pt-4 border-t border-slate-100">
              <button
                type="button"
                disabled={!mergeTarget}
                onClick={() => {
                  const hasDeletePermission = profile?.role === 'manager' && profile?.permissions?.canDeleteData;
                  if (hasDeletePermission) {
                    executeMerge(selectedCustomer, mergeTarget!);
                  } else {
                    setPinPurpose('merge');
                    setShowPinModal(true);
                  }
                }}
                className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all outline-none disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                Merge Profiles
              </button>
              <button
                type="button"
                onClick={() => setShowMergeModal(false)}
                className="flex-1 py-4 border border-slate-200 text-slate-600 rounded-2xl font-bold hover:bg-slate-50 transition-all outline-none text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Authorizing PIN Manager Modal */}
      <ManagerPinModal
        isOpen={showPinModal}
        onClose={() => {
          setShowPinModal(false);
          setPinPurpose(null);
        }}
        onSuccess={handlePinSuccess}
        title="Manager Authorization Required"
        message={`Please enter a manager PIN to approve customer ${pinPurpose === 'delete' ? 'deletion' : 'merge'} override.`}
      />

      {notification && (
        <div className="fixed bottom-6 right-6 z-[100] bg-slate-900 text-white px-5 py-4 rounded-2xl shadow-2xl flex items-center gap-3 border border-slate-800 animate-in slide-in-from-bottom-5 fade-in duration-300">
          <div className={cn("p-1.5 rounded-lg", notification.type === 'success' ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400")}>
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <p className="font-black text-[10px] uppercase tracking-wider text-slate-400">{notification.type === 'success' ? 'Action Confirmed' : 'Error'}</p>
            <p className="text-xs text-slate-200 font-bold mt-0.5">{notification.message}</p>
          </div>
        </div>
      )}
    </main>
  );
}
