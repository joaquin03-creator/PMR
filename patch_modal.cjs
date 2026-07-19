const fs = require('fs');
const content = fs.readFileSync('src/components/BuyTicketModal.tsx', 'utf8');

let newContent = content.replace(
  "if (e.key === 'Tab' || e.key === 'Enter') {\n                                    const search = (item.materialSearch || '').toLowerCase();\n                                    const filtered = materials.filter(m => ",
  "if (e.key === 'Tab' || e.key === 'Enter') {\n                                    if (item.material && !(item.materialSearch || '').trim()) return;\n                                    const search = (item.materialSearch || '').toLowerCase();\n                                    if (!search) return;\n                                    const filtered = materials.filter(m => "
);

newContent = newContent.replace(
  "onMouseDown={(e) => {\n                                            e.preventDefault();\n                                            updateItem(item.id, { material: m, isDropdownOpen: false, materialSearch: '', pricePerUnit: m.buyPrice });\n                                          }}",
  "onMouseDown={(e) => {\n                                            e.preventDefault();\n                                            updateItem(item.id, { material: m, isDropdownOpen: false, materialSearch: '', pricePerUnit: m.buyPrice });\n                                          }}\n                                          onTouchStart={(e) => {\n                                            e.preventDefault();\n                                            updateItem(item.id, { material: m, isDropdownOpen: false, materialSearch: '', pricePerUnit: m.buyPrice });\n                                          }}"
);

fs.writeFileSync('src/components/BuyTicketModal.tsx', newContent);
console.log("Updated BuyTicketModal");
