const fs = require('fs');
let content = fs.readFileSync('src/pages/CashDrawer.tsx', 'utf8');

const editButton = `
                              {selectedSession.status === 'open' && selectedSession.id === activeSession?.id && profile?.role === 'manager' && (
                                <div className="flex items-center gap-1">
                                  <button 
                                    onClick={() => setEditingTransaction(tx)}
                                    className="p-2 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-all"
                                    title="Edit Transaction"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button 
                                    onClick={() => handleDeleteTransaction(tx.id)}
                                    className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                    title="Delete Transaction"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              )}
`;

const oldButton = `                              {selectedSession.status === 'open' && selectedSession.id === activeSession?.id && profile?.role === 'manager' && (
                                <button 
                                  onClick={() => handleDeleteTransaction(tx.id)}
                                  className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                  title="Delete Transaction"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}`;

content = content.replace(oldButton, editButton);

const editModal = `
      {/* Edit Transaction Modal */}
      {editingTransaction && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 overflow-y-auto flex items-start justify-center p-4 sm:p-6 md:p-10">
          <div className="bg-white rounded-[2.5rem] p-10 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200 border border-slate-200 my-8 sm:my-12">
            <div className="flex items-center gap-4 mb-8">
              <div className={editingTransaction.type === 'inflow' ? "p-4 bg-emerald-50 rounded-3xl text-emerald-600" : "p-4 bg-red-50 rounded-3xl text-red-600"}>
                {editingTransaction.type === 'inflow' ? <ArrowUpCircle className="w-8 h-8" /> : <ArrowDownCircle className="w-8 h-8" />}
              </div>
              <div className="space-y-1">
                <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Edit {editingTransaction.type === 'inflow' ? 'Inflow' : 'Expense'}</h3>
                <p className="text-slate-500 text-xs font-black uppercase tracking-widest">Update Transaction</p>
              </div>
            </div>

            <form onSubmit={handleEditTransaction} className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Category</label>
                  <select 
                    name="category" 
                    defaultValue={editingTransaction.category}
                    required 
                    className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-xs uppercase tracking-widest outline-none focus:ring-2 focus:ring-slate-200"
                  >
                    {editingTransaction.type === 'inflow' ? (
                      <>
                        <option value="Bank Withdrawal">Bank Withdrawal</option>
                        <option value="Bank Run">Bank Run</option>
                        <option value="Cash In">Cash In</option>
                        <option value="Other Inflow">Other Inflow</option>
                      </>
                    ) : (
                      <>
                        <option value="Fuel">Fuel</option>
                        <option value="Vendor Payout">Vendor Payout</option>
                        <option value="Supplies">Supplies</option>
                        <option value="Employee Advance">Employee Advance</option>
                        <option value="Other">Other</option>
                      </>
                    )}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Amount</label>
                  <div className="relative">
                    <DollarSign className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                    <input 
                      name="amount" 
                      type="number" 
                      step="0.01" 
                      defaultValue={editingTransaction.amount}
                      required 
                      className="w-full pl-14 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-lg font-mono font-black outline-none focus:ring-4 focus:ring-blue-500/10" 
                      placeholder="0.00" 
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Notes</label>
                  <input 
                    name="notes" 
                    defaultValue={editingTransaction.notes}
                    className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-slate-200" 
                    placeholder="Optional notes" 
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setEditingTransaction(null)} className="flex-1 px-8 py-4 text-slate-500 font-bold uppercase text-xs tracking-widest">Cancel</button>
                <button disabled={processing} type="submit" className="flex-[2] bg-blue-600 text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-200">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
`;

content = content.replace('{/* Finalize/Close Modal */}', editModal + '\n      {/* Finalize/Close Modal */}');

fs.writeFileSync('src/pages/CashDrawer.tsx', content);
