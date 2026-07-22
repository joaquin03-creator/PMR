const fs = require('fs');
const content = fs.readFileSync('src/pages/BuyTickets.tsx', 'utf8');

// Insert the edit mode logic
const editLogic = `
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const editTicketId = searchParams.get('edit');
  const [originalTicket, setOriginalTicket] = useState<BuyTicket | null>(null);

  useEffect(() => {
    if (editTicketId && materials.length > 0) {
      const fetchTicket = async () => {
        try {
          const docRef = doc(db, 'buyTickets', editTicketId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data() as BuyTicket;
            setOriginalTicket({ id: docSnap.id, ...data });
            
            // Set customer
            if (data.customerId) {
              const cust = customers.find(c => c.id === data.customerId);
              if (cust) setSelectedCustomer(cust);
            }
            
            // Set items
            const newItems = data.materials.map(m => ({
              id: Math.random().toString(36).substr(2, 9),
              materialId: m.materialId,
              material: materials.find(mat => mat.id === m.materialId) || null,
              grossWeight: m.grossWeight,
              tareWeight: m.tareWeight,
              netWeight: m.netWeight,
              pricePerUnit: m.pricePerUnit,
              totalAmount: m.totalAmount,
              materialSearch: materials.find(mat => mat.id === m.materialId)?.name || '',
              isDropdownOpen: false,
              photoUrl: m.photoUrl || ''
            }));
            setItems(newItems);
            
            // Set details
            setTicketDetails(prev => ({
              ...prev,
              vehiclePlate: data.vehiclePlate || '',
              vehicleType: data.vehicleType || '',
              paymentMethod: (data.paymentMethod as any) || 'cash',
              notes: data.notes || '',
              customerPhotoUrl: data.customerPhotoUrl || '',
              idImageUrl: data.idImageUrl || '',
              vehiclePhotoUrl: data.vehiclePhotoUrl || ''
            }));
          }
        } catch (e) {
          console.error(e);
        }
      };
      fetchTicket();
    }
  }, [editTicketId, materials, customers]);
`;

let newContent = content.replace(
  'export default function BuyTickets({ profile }: BuyTicketsProps) {\n  const { firestore, local, error: toastError, info } = useToast();\n  const [step, setStep] = useState(1);',
  'export default function BuyTickets({ profile }: BuyTicketsProps) {\n  const { firestore, local, error: toastError, info } = useToast();\n' + editLogic + '\n  const [step, setStep] = useState(1);'
);

// Modify saveTicket to handle edit mode
const saveTicketLogic = `
  const saveTicket = async () => {
    setProcessing(true);
    try {
      let customerId = selectedCustomer?.id;
      if (isNewCustomer && !customerId) {
        const custRef = await addDoc(collection(db, 'customers'), {
          ...newCustomer,
          createdAt: new Date().toISOString()
        });
        customerId = custRef.id;
      }
      if (!customerId) throw new Error("Customer ID missing");

      const ticketMaterials: BuyTicketMaterial[] = items.map(item => {
        const material: BuyTicketMaterial = {
          materialId: item.materialId,
          grossWeight: item.grossWeight,
          tareWeight: item.tareWeight,
          netWeight: item.netWeight,
          pricePerUnit: item.pricePerUnit,
          totalAmount: item.totalAmount
        };
        
        if (item.deductionWeight !== undefined) material.deductionWeight = item.deductionWeight;
        if (item.deductionReason !== undefined) material.deductionReason = item.deductionReason;
        if (item.notes !== undefined) material.notes = item.notes;
        if (item.photoUrl !== undefined) material.photoUrl = item.photoUrl;
        
        return material;
      });

      const ticketData = {
        customerId,
        materials: ticketMaterials,
        totalAmount,
        status: 'completed',
        timestamp: originalTicket ? originalTicket.timestamp : new Date().toISOString(),
        vehiclePlate: ticketDetails.vehiclePlate || '',
        vehicleType: ticketDetails.vehicleType || '',
        vehicleYear: ticketDetails.vehicleYear || '',
        vehicleMake: ticketDetails.vehicleMake || '',
        vehicleModel: ticketDetails.vehicleModel || '',
        paymentMethod: ticketDetails.paymentMethod || 'cash',
        notes: ticketDetails.notes || '',
        customerPhotoUrl: ticketDetails.customerPhotoUrl || '',
        idImageUrl: ticketDetails.idImageUrl || '',
        vehiclePhotoUrl: ticketDetails.vehiclePhotoUrl || '',
        signatureUrl: ticketDetails.signatureUrl || '',
        sellerAffirmed: ticketDetails.sellerAffirmed,
        ohioDatabaseStatus: ticketDetails.ohioDatabaseStatus || 'not_checked',
        createdBy: originalTicket ? originalTicket.createdBy : (profile?.uid || ''),
        createdByName: originalTicket ? originalTicket.createdByName : (profile?.displayName || profile?.email || 'System'),
        customerSnapshot: selectedCustomer ? {
          name: selectedCustomer.name,
          address: selectedCustomer.address || '',
          idType: selectedCustomer.idType || '',
          idNumber: selectedCustomer.idNumber || '',
          idExpiration: selectedCustomer.idExpiration || ''
        } : (isNewCustomer ? {
          name: newCustomer.name,
          address: newCustomer.address || '',
          idType: newCustomer.idType || '',
          idNumber: newCustomer.idNumber || '',
          idExpiration: newCustomer.idExpiration || ''
        } : null)
      };

      if (editTicketId && originalTicket) {
        // Reverse old inventory
        for (const item of originalTicket.materials) {
          const invRef = doc(db, 'inventory', item.materialId);
          await updateDoc(invRef, {
            currentWeight: increment(-item.netWeight)
          }).catch(console.warn);
        }
        
        // Update document
        await updateDoc(doc(db, 'buyTickets', editTicketId), ticketData);
        setLastCreatedTicket({ id: editTicketId, ...ticketData } as any);
      } else {
        const docRef = await addDoc(collection(db, 'buyTickets'), ticketData);
        setLastCreatedTicket({ id: docRef.id, ...ticketData } as any);
      }

      // Customer update
      const customerUpdate: any = {};
      if (ticketDetails.customerPhotoUrl) customerUpdate.photoUrl = ticketDetails.customerPhotoUrl;
      if (ticketDetails.idImageUrl) customerUpdate.idImageUrl = ticketDetails.idImageUrl;
      if (ticketDetails.vehiclePlate) customerUpdate.vehiclePlate = ticketDetails.vehiclePlate;
      if (ticketDetails.vehicleType) customerUpdate.vehicleType = ticketDetails.vehicleType;
      if (ticketDetails.vehicleYear) customerUpdate.vehicleYear = ticketDetails.vehicleYear;
      if (ticketDetails.vehicleMake) customerUpdate.vehicleMake = ticketDetails.vehicleMake;
      if (ticketDetails.vehicleModel) customerUpdate.vehicleModel = ticketDetails.vehicleModel;
      if (ticketDetails.vehiclePhotoUrl) customerUpdate.vehiclePhotoUrl = ticketDetails.vehiclePhotoUrl;
      if (selectedCustomer) {
        customerUpdate.phone = selectedCustomer.phone || '';
        customerUpdate.secondaryPhone = selectedCustomer.secondaryPhone || '';
        customerUpdate.email = selectedCustomer.email || '';
        customerUpdate.address = selectedCustomer.address || '';
        customerUpdate.businessName = selectedCustomer.businessName || '';
        customerUpdate.idType = selectedCustomer.idType || '';
        customerUpdate.idNumber = selectedCustomer.idNumber || '';
        customerUpdate.idExpiration = selectedCustomer.idExpiration || '';
      }
      
      if (Object.keys(customerUpdate).length > 0) {
        await updateDoc(doc(db, 'customers', customerId), {
          ...customerUpdate,
          updatedAt: new Date().toISOString()
        });
      }

      for (const item of ticketMaterials) {
        const invRef = doc(db, 'inventory', item.materialId);
        try {
          await updateDoc(invRef, {
            currentWeight: increment(item.netWeight)
          });
        } catch(e) {
          await setDoc(invRef, {
            materialId: item.materialId,
            currentWeight: item.netWeight
          }, { merge: true });
        }
      }

      if (activeDraftId && !editTicketId) {
        try {
          await deleteDoc(doc(db, 'ticketDrafts', activeDraftId));
        } catch(e) {
          console.warn('Could not delete draft:', e);
        }
      }

      firestore(
        editTicketId ? 'Ticket Updated' : 'Ticket Created',
        \`Successfully \${editTicketId ? 'updated' : 'created'} ticket for \${selectedCustomer?.name || newCustomer.name} (\$\${totalAmount.toFixed(2)}) in Cloud Firestore.\`
      );

      setShowPrintPreview(true);
      
    } catch (error: any) {
      toastError(editTicketId ? 'Update Failed' : 'Save Failed', \`Failed to \${editTicketId ? 'update' : 'save'} ticket: \${error.message || error}\`);
    } finally {
      setProcessing(false);
    }
  };
`;

newContent = newContent.replace(/const saveTicket = async \(\) => \{[\s\S]*?(?=const printTicket)/, saveTicketLogic + '\n\n  ');

fs.writeFileSync('src/pages/BuyTickets.tsx', newContent);
