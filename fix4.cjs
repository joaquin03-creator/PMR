const fs = require('fs');
let content = fs.readFileSync('src/pages/TicketHistory.tsx', 'utf8');
content = content.replace('  Edit2  Edit2', '  Edit2');
fs.writeFileSync('src/pages/TicketHistory.tsx', content);
