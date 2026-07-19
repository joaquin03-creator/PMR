export const OHIO_STATE_CODES = new Set([
  "AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"
]);

export function getOhioStateCode(stateInput: string): string {
  if (!stateInput) return 'OH';
  const clean = stateInput.trim().substring(0, 2).toUpperCase();
  if (OHIO_STATE_CODES.has(clean)) return clean;
  return 'OH';
}

export function mapMaterialToOhioCode(materialName: string): string {
  const n = materialName.toLowerCase();
  
  // Copper
  if (n.includes('bare') || n.match(/#1|number 1/i) && n.includes('cop')) return '1';
  if (n.match(/#2|number 2/i) && n.includes('cop')) return '2';
  if (n.includes('sheet cop')) return '3';
  if (n.includes('insul') && n.includes('cop')) return '4';
  if (n.includes('rad') && (n.includes('alum') || n.includes('cop'))) return '5';
  
  // Brass
  if (n.includes('red brass')) return '6';
  if (n.includes('yellow brass') || n.includes('brass')) return '7';
  
  // Aluminum
  if (n.includes('alum') && n.includes('sheet')) return '8';
  if (n.includes('extru')) return '9';
  if (n.includes('clean') && n.includes('alum') && n.includes('wire')) return '10';
  if (n.includes('cast') && n.includes('alum')) return '11';
  if (n.includes('unclean') && n.includes('alum') && n.includes('wire')) return '12';
  if (n.includes('alum') && n.includes('ext')) return '13';
  if (n.includes('contam') && n.includes('alum')) return '14';
  if (n.includes('can') || n.includes('alum')) return '8'; // Generic aluminum fallback
  
  // Other Metals
  if (n.includes('stainless')) return '15';
  if (n.includes('appliance')) return '16';
  if (n.includes('struct') && n.includes('steel')) return '17';
  if (n.includes('iron')) return '19';
  if (n.includes('motor-veh') || n.includes('car part') || n.includes('auto')) return '20';
  if (n.includes('cat') && n.includes('conv')) return '21';
  if (n.includes('lead')) return '22';
  if (n.includes('motor') && n.includes('elec')) return '23';
  if (n.includes('board') || n.includes('electronic') || n.includes('pcb') || n.includes('computer')) return '24';
  
  return '18'; // Default: Miscellaneous Steel
}

export function mapSpecialMaterialToOhioCode(materialName: string): string | null {
  const n = materialName.toLowerCase();
  if (n.includes('keg')) return '1';
  if (n.includes('cable') || n.includes('wire') || n.includes('utility')) return '2';
  if (n.includes('grave') || n.includes('sculpture') || n.includes('cemetery')) return '3';
  if (n.includes('guard rail') || n.includes('sign') || n.includes('street light')) return '4';
  if (n.includes('historical') || n.includes('plaque')) return '5';
  if (n.includes('grocery cart')) return '6';
  if (n.includes('bossies')) return '7';
  if (n.includes('railroad') || n.includes('spike')) return '8';
  if (n.includes('tray') || n.includes('milk') || n.includes('beverage container')) return '9';
  if (n.includes('burnt wire')) return '10';
  
  return null;
}
