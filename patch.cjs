const fs = require('fs');
const content = fs.readFileSync('server.ts', 'utf8');
const startMatch = '// 2. Fallback to Local Firestore "doNotBuyList" Check';
const endMatch = 'res.json({ success: true, ...checkResult });\n  });';

const startIndex = content.indexOf(startMatch);
const endIndex = content.indexOf(endMatch) + endMatch.length;

if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
  console.log("Could not find matching block");
  process.exit(1);
}

const replacement = `// 2. Fallback to Local Check
      try {
        const demoFlaggedNames = ["banned seller", "john thief", "scrap thief", "hold customer", "do not buy"];
        const isDemoFlagged = demoFlaggedNames.some(flagged => targetName.toLowerCase().includes(flagged));
           
        if (isDemoFlagged) {
          checkResult = {
            status: "flagged",
            source: "local_database_fallback",
            message: \`FLAGGED: Seller matched a testing placeholder on the simulated "Do Not Buy" database.\`
          };
        } else {
          checkResult = {
            status: "cleared",
            source: "local_database_fallback",
            message: \`CLEARED: No active holds found in the state database or simulated blocklist for "\${targetName}".\`
          };
        }
      } catch (dbError: any) {
        console.error("[Ohio DB Check] Fallback query failed:", dbError);
        checkResult = {
          status: "cleared",
          source: "local_database_fallback",
          message: \`CLEARED (Offline Fallback): Checked locally, state server was unreachable.\`
        };
      }
    }

    res.json({ success: true, ...checkResult });
  });`;

const newContent = content.slice(0, startIndex) + replacement + content.slice(endIndex);
fs.writeFileSync('server.ts', newContent);
console.log("File updated successfully");
