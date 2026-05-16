import { useState, useEffect } from 'react';
import { db, storage } from '../firebase';
import { collection, onSnapshot, addDoc, doc, updateDoc } from 'firebase/firestore';
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
  ShieldCheck 
} from 'lucide-react';
import { cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { CameraCapture } from '../components/CameraCapture';
import { logAuditEvent } from '../lib/audit';
import { handleImageError } from '../constants';

import { UserProfile } from '../types';

export default function Customers({ profile }: { profile: UserProfile | null }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Customer>>({});
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'customers'), (snapshot) => {
      setCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Customer[]);
      setLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'customers'));
    return () => unsubscribe();
  }, []);

  const handleFileUpload = async (file: File, customerId?: string) => {
    if (!file) return null;
    setUploading(true);
    try {
      const fileName = `${Date.now()}_${file.name}`;
      const storageRef = ref(storage, `customer-ids/${fileName}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      
      if (customerId) {
        const customerRef = doc(db, 'customers', customerId);
        await updateDoc(customerRef, { idImageUrl: url });
        setSelectedCustomer(prev => prev ? { ...prev, idImageUrl: url } : null);
        setEditForm(prev => ({ ...prev, idImageUrl: url }));
      }
      return url;
    } catch (error) {
      console.error("Upload error:", error);
      return null;
    } finally {
      setUploading(false);
    }
  };

  const handleUpdateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;

    try {
      const customerRef = doc(db, 'customers', selectedCustomer.id);
      
      const oldData = { ...selectedCustomer };

      // Remove id from update data as it's immutable in Firestore
      const { id, ...dataToUpdate } = editForm;
      await updateDoc(customerRef, {
        ...dataToUpdate,
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
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `customers/${selectedCustomer.id}`);
    }
  };

  const openProfile = (customer: Customer) => {
    setSelectedCustomer(customer);
    setEditForm(customer);
    setIsEditing(false);
  };

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.businessName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.phone?.includes(searchQuery) ||
    c.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
          onClick={() => setShowAddModal(true)}
          aria-label="Add New Customer"
          className="px-6 py-3.5 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          <UserPlus className="w-5 h-5" aria-hidden="true" />
          New Customer
        </button>
      </header>

      <div className="relative group max-w-2xl">
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

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" aria-label="Customer List">
        {filteredCustomers.map((customer) => (
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
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-900">{customer.name}</h3>
                  {customer.isBuyer && (
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-black uppercase tracking-widest rounded-full flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" />
                      Buyer
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
        ))}
      </section>

      {showAddModal && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-customer-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAddModal(false);
          }}
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
              <form onSubmit={async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target as HTMLFormElement);
                const fileInput = (e.target as HTMLFormElement).querySelector('input[type="file"]') as HTMLInputElement;
                const file = fileInput?.files?.[0];
                
                let idImageUrl = '';
                if (file) {
                  const uploadedUrl = await handleFileUpload(file);
                  if (uploadedUrl) idImageUrl = uploadedUrl;
                }

                const newCustomer = {
                  name: formData.get('name') as string,
                  businessName: formData.get('businessName') as string,
                  phone: formData.get('phone') as string,
                  secondaryPhone: formData.get('secondaryPhone') as string,
                  email: formData.get('email') as string,
                  address: formData.get('address') as string,
                  notes: formData.get('notes') as string,
                  isBuyer: formData.get('isBuyer') === 'on',
                  idType: formData.get('idType') as string,
                  idNumber: formData.get('idNumber') as string,
                  idExpiration: formData.get('idExpiration') as string,
                  customerType: formData.get('customerType') as any,
                  verifiedStatus: 'unverified',
                  idImageUrl,
                  photoUrl: editForm.photoUrl || '',
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
                } catch (error) {
                  handleFirestoreError(error, OperationType.CREATE, 'customers');
                }
              }} className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-1">
                  <label htmlFor="new-customer-name" className="text-xs font-bold text-slate-500 uppercase">Full Name</label>
                  <input id="new-customer-name" name="name" required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="John Doe" />
                </div>
                <div className="space-y-1">
                  <label htmlFor="new-customer-business" className="text-xs font-bold text-slate-500 uppercase">Business Name</label>
                  <input id="new-customer-business" name="businessName" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="Acme Corp" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label htmlFor="new-customer-phone" className="text-xs font-bold text-slate-500 uppercase">Primary Phone</label>
                    <input id="new-customer-phone" name="phone" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="(555) 000-0000" />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="new-customer-secondary-phone" className="text-xs font-bold text-slate-500 uppercase">Secondary Phone</label>
                    <input id="new-customer-secondary-phone" name="secondaryPhone" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="(555) 000-0000" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label htmlFor="new-customer-id-type" className="text-xs font-bold text-slate-500 uppercase">ID Type</label>
                    <select id="new-customer-id-type" name="idType" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all">
                      <option value="Driver License">Driver License</option>
                      <option value="State ID">State ID</option>
                      <option value="Passport">Passport</option>
                      <option value="Mexican Matricula">Mexican Matricula</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="new-customer-type" className="text-xs font-bold text-slate-500 uppercase">Customer Type</label>
                    <select id="new-customer-type" name="customerType" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all">
                      <option value="individual">Individual</option>
                      <option value="commercial">Commercial/Business</option>
                      <option value="industrial">Industrial</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label htmlFor="new-customer-id-number" className="text-xs font-bold text-slate-500 uppercase">ID Number</label>
                    <input id="new-customer-id-number" name="idNumber" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="DL123456" />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="new-customer-id-exp" className="text-xs font-bold text-slate-500 uppercase">ID Expiration</label>
                    <input id="new-customer-id-exp" name="idExpiration" type="date" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label htmlFor="new-customer-email" className="text-xs font-bold text-slate-500 uppercase">Email Address</label>
                  <input id="new-customer-email" name="email" type="email" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="john@example.com" />
                </div>
                <div className="space-y-1">
                  <label htmlFor="new-customer-address" className="text-xs font-bold text-slate-500 uppercase">Address</label>
                  <input id="new-customer-address" name="address" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all" placeholder="123 Street, City, State" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">Profile Photo</label>
                  <CameraCapture 
                    label="Take Profile Photo"
                    onCapture={(url) => setEditForm(prev => ({ ...prev, photoUrl: url }))}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="id-upload" className="text-xs font-bold text-slate-500 uppercase">ID Image</label>
                  <div className="flex items-center gap-4">
                    <input type="file" accept="image/*" className="hidden" id="id-upload" />
                    <label htmlFor="id-upload" className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all text-slate-500">
                      <Upload className="w-5 h-5" aria-hidden="true" />
                      <span>{uploading ? 'Uploading...' : 'Upload ID Image'}</span>
                    </label>
                  </div>
                </div>
                <div className="space-y-1">
                  <label htmlFor="new-customer-notes" className="text-xs font-bold text-slate-500 uppercase">Notes</label>
                  <textarea id="new-customer-notes" name="notes" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all resize-none" rows={2} placeholder="Any additional details..." />
                </div>
                <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl border border-blue-100">
                  <input 
                    type="checkbox" 
                    id="new-customer-is-buyer" 
                    name="isBuyer" 
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
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedCustomer(null);
          }}
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
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl">
                                <label className="cursor-pointer bg-white text-slate-900 px-3 py-1 rounded-lg text-xs font-bold">
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
                    <button 
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
                    >
                      <Edit2 className="w-5 h-5" aria-hidden="true" />
                      Edit Profile Information
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
