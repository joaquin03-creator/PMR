const fs = require('fs');
let content = fs.readFileSync('src/pages/TicketHistory.tsx', 'utf8');
content = content.replace(/import \{Edit2, /g, 'import {');
content = content.replace(/import \{ Edit2, Search,/g, 'import { Edit2, Search,');
fs.writeFileSync('src/pages/TicketHistory.tsx', content);
