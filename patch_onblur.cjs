const fs = require('fs');
const content = fs.readFileSync('src/components/BuyTicketModal.tsx', 'utf8');

const target = "onFocus={() => updateItem(item.id, { isDropdownOpen: true })}";
const replacement = `onFocus={() => updateItem(item.id, { isDropdownOpen: true })}
                                onBlur={() => {
                                  // Delay to allow onMouseDown/onTouchStart to fire first
                                  setTimeout(() => {
                                    setItems(currentItems => currentItems.map(i => {
                                      if (i.id === item.id) {
                                        if (i.isDropdownOpen) {
                                          const search = (i.materialSearch || '').toLowerCase();
                                          if (search && !i.material) {
                                            const filtered = materials.filter(m => 
                                              m.name.toLowerCase().includes(search) || 
                                              m.code.toLowerCase().includes(search)
                                            );
                                            if (filtered.length > 0) {
                                              return {
                                                ...i,
                                                material: filtered[0],
                                                materialSearch: '',
                                                isDropdownOpen: false,
                                                materialId: filtered[0].id,
                                                pricePerUnit: filtered[0].buyPrice
                                              };
                                            }
                                          }
                                          return { ...i, isDropdownOpen: false };
                                        }
                                      }
                                      return i;
                                    }));
                                  }, 150);
                                }}`;

if(content.includes(target)) {
    fs.writeFileSync('src/components/BuyTicketModal.tsx', content.replace(target, replacement));
    console.log("Updated onBlur successfully");
} else {
    console.log("Target not found");
}
