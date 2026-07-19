const fs = require('fs');
const content = fs.readFileSync('src/pages/Reports.tsx', 'utf8');

const startMatch = '// Generate XML compliance string based on selected tickets\n  const handleGenerateXml = (ticketsToExport: BuyTicket[]) => {';
const endMatch = '    setGeneratedXml(xml);\n    return xml;\n  };';

const startIndex = content.indexOf(startMatch);
const endIndex = content.indexOf(endMatch) + endMatch.length;

if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
  console.log("Could not find matching block");
  process.exit(1);
}

const replacement = `// Generate XML compliance string based on selected tickets
  const handleGenerateXml = async (ticketsToExport: BuyTicket[]) => {
    let xml = \`<?xml version="1.0" encoding="UTF-8"?>\\n<ScrapDealerTransactions>\\n\`;
    
    for (const ticket of ticketsToExport) {
      const customer = customers.find(c => c.id === ticket.customerId);
      const nameParts = (customer?.name || 'Unknown').trim().split(/\\s+/);
      let firstName = nameParts[0] || 'Unknown';
      let lastName = nameParts[nameParts.length - 1] || 'Unknown';
      let middleName = nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '';
      let suffix = '';

      const suffixes = ['jr', 'sr', 'ii', 'iii', 'iv', 'esq', 'phd'];
      if (suffixes.includes(lastName.toLowerCase().replace(/\\./g, ''))) {
        suffix = lastName;
        lastName = nameParts[nameParts.length - 2] || 'Unknown';
        middleName = nameParts.length > 3 ? nameParts.slice(1, -2).join(' ') : '';
      }
      if (lastName === firstName) {
        lastName = '';
      }

      const addr = customer?.address || '123 Main St, Columbus, OH 43215';
      let street = addr;
      let city = 'Columbus';
      let state = 'OH';
      let zip = '43215';

      try {
        const parts = addr.split(',');
        if (parts.length >= 3) {
          street = parts[0].trim();
          city = parts[1].trim();
          const stateZip = parts[2].trim().split(/\\s+/);
          state = stateZip[0] || 'OH';
          zip = stateZip[1] || '43215';
        } else if (parts.length === 2) {
          street = parts[0].trim();
          const cityStateZip = parts[1].trim().split(/\\s+/);
          city = cityStateZip[0] || 'Columbus';
          state = cityStateZip[1] || 'OH';
          zip = cityStateZip[2] || '43215';
        }
      } catch (_) {}

      const totalWeight = ticket.materials.reduce((sum, m) => sum + m.netWeight, 0);
      const materialNamesList = ticket.materials.map(tm => materials.find(m => m.id === tm.materialId)?.name || 'Scrap Metal');
      const mNames = materialNamesList.join(', ');
      
      const nonSpecialCodesArray = Array.from(new Set(materialNamesList.map(n => mapMaterialToOhioCode(n))));
      const nonSpecialCodes = nonSpecialCodesArray.join(',');
      
      const specialCodesArray = Array.from(new Set(materialNamesList.map(n => mapSpecialMaterialToOhioCode(n)).filter(Boolean)));
      const specialCodes = specialCodesArray.join(',');

      // Compress images
      const MAX_BYTES = 750000;
      let idCardBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      if (ticket.idImageUrl) {
        idCardBase64 = await compressImageToBase64(ticket.idImageUrl, MAX_BYTES);
      }
      
      let sellerPhotoBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const sourcePhotoUrl = ticket.customerPhotoUrl || customer?.photoUrl;
      if (sourcePhotoUrl) {
        sellerPhotoBase64 = await compressImageToBase64(sourcePhotoUrl, MAX_BYTES);
      }

      xml += \`  <ScrapDealerTransaction>\\n\`;
      xml += \`    <facilityRegNumber>\${escapeXml(settings.ohioScrapDealerId || 'SMBC-2025-0000710')}</facilityRegNumber>\\n\`;
      // Ensure txnNumber does not exceed 20 characters to satisfy error code 105
      const truncatedTicketId = ticket.id.toUpperCase().replace(/-[A-Z]{3}$/, '').substring(0, 20);
      xml += \`    <txnNumber>\${escapeXml(truncatedTicketId)}</txnNumber>\\n\`;
      xml += \`    <firstName>\${escapeXml(firstName.substring(0, 33))}</firstName>\\n\`;
      xml += \`    <middleName>\${escapeXml(middleName.substring(0, 31))}</middleName>\\n\`;
      xml += \`    <lastName>\${escapeXml(lastName.substring(0, 33))}</lastName>\\n\`;
      xml += \`    <suffix>\${escapeXml(suffix.substring(0, 5))}</suffix>\\n\`;
      xml += \`    <add1>\${escapeXml(street.substring(0, 40))}</add1>\\n\`;
      xml += \`    <add2></add2>\\n\`;
      xml += \`    <city>\${escapeXml(city.substring(0, 40))}</city>\\n\`;
      xml += \`    <state>\${escapeXml(getOhioStateCode(state))}</state>\\n\`;
      xml += \`    <zip>\${escapeXml(zip.replace(/[^0-9-]/g, '').substring(0, 9))}</zip>\\n\`;
      xml += \`    <txnDateTime>\${escapeXml(new Date(ticket.timestamp).toISOString())}</txnDateTime>\\n\`;
      xml += \`    <idCardImage>\${idCardBase64}</idCardImage>\\n\`;
      xml += \`    <photoOfSeller>\${sellerPhotoBase64}</photoOfSeller>\\n\`;
      xml += \`    <bulkContainerDesc>\${escapeXml(mNames.substring(0, 255))}</bulkContainerDesc>\\n\`;
      xml += \`    <numberOfBulkContainers>\${Math.min(ticket.materials.length, 99999)}</numberOfBulkContainers>\\n\`;
      xml += \`    <weightOfBulkContainers>\${Math.min(totalWeight, 99999)}</weightOfBulkContainers>\\n\`;
      xml += \`    <bulkContainerPhoptos>\\n\`; // Note: Required Ohio spelling typo
      xml += \`      <base64Binary>\${sellerPhotoBase64}</base64Binary>\\n\`;
      xml += \`    </bulkContainerPhoptos>\\n\`;
      xml += \`    <licensePlateNumner>\${escapeXml((ticket.vehiclePlate || 'NONE').substring(0, 20))}</licensePlateNumner>\\n\`; // Note: Required Ohio spelling typo
      xml += \`    <licensePlateIssueState>\${escapeXml(getOhioStateCode(ticket.vehicleType || 'OH'))}</licensePlateIssueState>\\n\`;
      xml += \`    <metalArticlesNotRecyclableDesc></metalArticlesNotRecyclableDesc>\\n\`;
      xml += \`    <weightOfMetalArticlesNotRecyclable>0</weightOfMetalArticlesNotRecyclable>\\n\`;
      xml += \`    <recycMaterilasNotSpecialPurchaseArticles>\${escapeXml(nonSpecialCodes)}</recycMaterilasNotSpecialPurchaseArticles>\\n\`; // Note: Required Ohio spelling typo
      xml += \`    <recycMaterialsSpecialPurchaseArticles>\${escapeXml(specialCodes)}</recycMaterialsSpecialPurchaseArticles>\\n\`;
      xml += \`    <recycMaterialsSpecialPurchaseArticlePhotos>\\n\`;
      if (specialCodes) {
        specialCodesArray.forEach(() => {
          xml += \`      <base64Binary>\${idCardBase64}</base64Binary>\\n\`;
        });
      }
      xml += \`    </recycMaterialsSpecialPurchaseArticlePhotos>\\n\`;
      xml += \`  </ScrapDealerTransaction>\\n\`;
    }

    xml += \`</ScrapDealerTransactions>\`;
    setGeneratedXml(xml);
    return xml;
  };`;

const newContent = content.slice(0, startIndex) + replacement + content.slice(endIndex);
fs.writeFileSync('src/pages/Reports.tsx', newContent);
console.log("File updated successfully");
