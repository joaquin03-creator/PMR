const fs = require('fs');
let content = fs.readFileSync('src/pages/TicketHistory.tsx', 'utf8');
content = content.replace('AlertCircle  Edit2,', 'AlertCircle,\n  Edit2,');
fs.writeFileSync('src/pages/TicketHistory.tsx', content);
