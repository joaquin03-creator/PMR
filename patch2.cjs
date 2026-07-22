const fs = require('fs');
let content = fs.readFileSync('src/pages/TicketHistory.tsx', 'utf8');

// Find the void button and insert an edit button right before it
const editButton = `
                  {profile.permissions?.canRetroactivePriceAdjustments && (
                    <button 
                      onClick={() => {
                        window.location.href = \`/buy-tickets?edit=\${selectedTicket.id}\`;
                      }}
                      disabled={processing || selectedTicket?.status === 'voided' || selectedTicket?.status === 'cancelled'}
                      className="flex items-center gap-2 px-6 py-4 bg-blue-50 text-blue-600 border border-blue-200 rounded-2xl font-bold hover:bg-blue-100 transition-all active:scale-95 disabled:opacity-50"
                    >
                      <Edit2 className="w-5 h-5" />
                      Edit
                    </button>
                  )}
                  {profile.permissions?.canVoidTickets && (
`;

content = content.replace('{profile.permissions?.canVoidTickets && (', editButton);

// Ensure Edit2 is imported
if (!content.includes('Edit2')) {
  content = content.replace('import { Search, Ban', 'import { Search, Ban, Edit2');
}

fs.writeFileSync('src/pages/TicketHistory.tsx', content);
