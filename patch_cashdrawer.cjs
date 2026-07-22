const fs = require('fs');
let content = fs.readFileSync('src/pages/CashDrawer.tsx', 'utf8');

const editLogic = `
  const [editingTransaction, setEditingTransaction] = useState<CashTransaction | null>(null);

  const handleEditTransaction = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingTransaction || !profile) return;
    setProcessing(true);
    
    const formData = new FormData(e.currentTarget);
    const rawAmount = parseFloat(formData.get('amount') as string);
    const amount = isNaN(rawAmount) ? 0 : Math.round(rawAmount * 100) / 100;
    const category = formData.get('category') as string;
    const notes = formData.get('notes') as string;
    
    try {
      const oldAmount = editingTransaction.amount;
      const oldCategory = editingTransaction.category;
      
      await updateDoc(doc(db, 'cashTransactions', editingTransaction.id), {
        category,
        amount,
        notes
      });

      // Track in Audit Log
      await logAuditEvent(
        'cashTransaction',
        editingTransaction.id,
        'update',
        { 
          before: { amount: oldAmount, category: oldCategory, notes: editingTransaction.notes }, 
          after: { amount, category, notes } 
        },
        \`Updated \${editingTransaction.type} transaction: amount \$\${oldAmount} -> \$\${amount}, category \${oldCategory} -> \${category}\`
      );
      
      firestore(
        'Transaction Updated',
        \`Successfully updated \${editingTransaction.type} of \$\${amount.toFixed(2)}.\`
      );
      setEditingTransaction(null);
    } catch (error: any) {
      toastError('Update Failed', \`Failed to update transaction: \${error.message || error}\`);
      handleFirestoreError(error, OperationType.UPDATE, 'cashTransactions');
    } finally {
      setProcessing(false);
    }
  };

  const handleAddTransaction`;

content = content.replace('  const handleAddTransaction', editLogic);

fs.writeFileSync('src/pages/CashDrawer.tsx', content);
