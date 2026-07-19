const fs = require('fs');
const content = fs.readFileSync('src/pages/Reports.tsx', 'utf8');

let newContent = content.replace("const exportData = (format: 'csv' | 'xml') => {", "const exportData = async (format: 'csv' | 'xml') => {");
newContent = newContent.replace("xmlToExport = handleGenerateXml(validBuyTickets);", "xmlToExport = await handleGenerateXml(validBuyTickets);");

// there might be other usages like button
newContent = newContent.replace("handleGenerateXml(selectedTickets);", "await handleGenerateXml(selectedTickets);");
newContent = newContent.replace("onClick={() => {\n                            const selectedTickets = complianceTickets.filter(t => selectedXmlTickets.includes(t.id));", "onClick={async () => {\n                            const selectedTickets = complianceTickets.filter(t => selectedXmlTickets.includes(t.id));");

fs.writeFileSync('src/pages/Reports.tsx', newContent);
console.log("File updated successfully");
