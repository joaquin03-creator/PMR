const fs = require('fs');
let content = fs.readFileSync('src/pages/TicketHistory.tsx', 'utf8');
content = content.replace('  Edit2  Edit2', '  Edit2');
// Let's use a regex to replace any instance of Edit2 followed by whitespace and Edit2
content = content.replace(/Edit2\s+Edit2/g, 'Edit2');
fs.writeFileSync('src/pages/TicketHistory.tsx', content);
