import { Material } from '../types';

// Extracted verbatim from QuickTicketModal.tsx (2026-09-20) so the Digital
// Material Inventory Sheet's material entry uses the exact same code-priority
// matching algorithm as Quick Ticket, not a reimplementation. QuickTicketModal
// itself is left untouched -- it still defines and uses its own copy inline --
// this file exists purely so new callers share the identical logic.
export function filterAndSortMaterials(materials: Material[], rawSearch: string): Material[] {
  if (!rawSearch || !rawSearch.trim()) return [];
  const search = rawSearch.toLowerCase().trim();

  const compareMaterials = (a: Material, b: Material) => {
    const codeA = (a.code || '').trim();
    const codeB = (b.code || '').trim();
    const numA = parseInt(codeA, 10);
    const numB = parseInt(codeB, 10);
    const aIsNum = !isNaN(numA) && String(numA) === codeA;
    const bIsNum = !isNaN(numB) && String(numB) === codeB;

    if (aIsNum && bIsNum) {
      if (numA !== numB) return numA - numB;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    }
    if (aIsNum && !bIsNum) return -1;
    if (!aIsNum && bIsNum) return 1;

    const codeCompare = codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
    if (codeCompare !== 0) return codeCompare;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  };

  const p1ExactCode: Material[] = [];
  const p2CodeStartsWith: Material[] = [];
  const p3CodeContains: Material[] = [];
  const p4NameStartsWith: Material[] = [];
  const p5NameContains: Material[] = [];

  for (const m of materials) {
    const code = (m.code || '').toLowerCase().trim();
    const name = (m.name || '').toLowerCase().trim();

    if (code && code === search) {
      p1ExactCode.push(m);
    } else if (code && code.startsWith(search)) {
      p2CodeStartsWith.push(m);
    } else if (code && code.includes(search)) {
      p3CodeContains.push(m);
    } else if (name.startsWith(search)) {
      p4NameStartsWith.push(m);
    } else if (name.includes(search)) {
      p5NameContains.push(m);
    }
  }

  p1ExactCode.sort(compareMaterials);
  p2CodeStartsWith.sort(compareMaterials);
  p3CodeContains.sort(compareMaterials);
  p4NameStartsWith.sort(compareMaterials);
  p5NameContains.sort(compareMaterials);

  return [
    ...p1ExactCode,
    ...p2CodeStartsWith,
    ...p3CodeContains,
    ...p4NameStartsWith,
    ...p5NameContains,
  ];
}
