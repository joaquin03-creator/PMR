export const OHIO_STATE_CODES = new Set([
  "AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"
]);

export function getOhioStateCode(stateInput: string): string {
  if (!stateInput) return 'OH';
  const clean = stateInput.trim().substring(0, 2).toUpperCase();
  if (OHIO_STATE_CODES.has(clean)) return clean;
  return 'OH';
}

const PMR_CODE_TO_OHIO: Record<string, string> = {
  '2':   '1',   '3':   '1',   '4':   '1',   '5':   '3',   '51':  '3',
  '222': '1',   '345': '1',   '611': '4',   '100': '4',   '71':  '4',
  '61':  '4',   '6':   '4',   '7':   '4',   '42':  '4',   '72':  '4',
  '250': '4',   '249': '4',   '86':  '4',   '87':  '4',   '95':  '2',
  '13':  '5',   '14':  '5',   '10':  '5',   '11':  '5',   '143': '5',
  '9':   '6',   '8':   '7',   '81':  '7',   '82':  '7',   '17':  '8',
  '19':  '9',   '20':  '9',   '21':  '9',   '41':  '9',   '22':  '10',
  '30':  '12',  '31':  '12',  '43':  '12',  '18':  '11',  '1':   '14',
  '23':  '14',  '24':  '14',  '241': '14',  '28':  '14',  '34':  '14',
  '25':  '14',  '251': '14',  '252': '14',  '606': '14',  '12':  '15',
  '16':  '15',  '121': '15',  '53':  '18',  '67':  '18',  '96':  '18',
  '59':  '23',  '599': '23',  '60':  '23',  '161': '23',  '165': '23',
  '164': '23',  '163': '18',  '142': '4',   '32':  '22',  '36':  '18',
  '37':  '18',  '625': '18',
};

export const VALID_OHIO_MATERIAL_CODES = new Set([
  '1','2','3','4','5','6','7','8','9','10',
  '11','12','13','14','15','16','17','18','19','20',
  '21','22','23','24'
]);

export const VALID_OHIO_SPECIAL_CODES = new Set([
  '1','2','3','4','5','6','7','8','9','10'
]);

export function mapMaterialToOhioCode(materialCode: string, materialName?: string): string {
  if (materialCode && PMR_CODE_TO_OHIO[materialCode]) {
    return PMR_CODE_TO_OHIO[materialCode];
  }
  if (materialName) {
    const n = materialName.toLowerCase();
    if (n.includes('bare bright')) return '1';
    if (n.match(/#1.*cop|copper.*#1/i)) return '1';
    if (n.match(/#2.*cop|copper.*#2/i)) return '1';
    if (n.includes('sheet cop')) return '3';
    if (n.includes('insul') && n.includes('cop')) return '4';
    if (n.includes('rad') && (n.includes('alum') || n.includes('cop'))) return '5';
    if (n.includes('red brass')) return '6';
    if (n.includes('brass')) return '7';
    if (n.includes('extru')) return '9';
    if (n.includes('cast') && n.includes('alum')) return '11';
    if (n.includes('alum')) return '8';
    if (n.includes('stainless')) return '15';
    if (n.includes('motor')) return '23';
    if (n.includes('batter')) return '22';
  }
  return '18';
}

export function mapSpecialMaterialToOhioCode(materialCode: string, materialName?: string): string | null {
  if (materialName) {
    const n = materialName.toLowerCase();
    if (n.includes('keg')) return '1';
    if (n.includes('cable') || n.includes('utility wire')) return '2';
    if (n.includes('grave') || n.includes('sculpture') || n.includes('cemetery')) return '3';
    if (n.includes('guard rail') || n.includes('street light') || n.includes('street sign')) return '4';
    if (n.includes('historical') || n.includes('plaque')) return '5';
    if (n.includes('grocery cart')) return '6';
    if (n.includes('bossie')) return '7';
    if (n.includes('railroad') || n.includes('rail spike')) return '8';
    if (n.includes('milk tray') || n.includes('beverage container')) return '9';
    if (n.includes('burnt wire')) return '10';
  }
  return null;
}
