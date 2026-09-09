import { Material } from '../types';

export interface MaterialWithStats extends Material {
  inventoryWeight: number;
  completedTicketCount: number;
  allTicketCount: number;
}

export interface DuplicateGroup {
  id: string;
  type: 'same_code' | 'similar_name';
  groupKey: string;
  displayName: string;
  materials: MaterialWithStats[];
}

export interface DuplicateDetectionResult {
  sameCodeGroups: DuplicateGroup[];
  similarNameGroups: DuplicateGroup[];
  totalDuplicates: number;
  totalUniqueMaterialsInvolved: number;
}

/**
 * Normalizes a material name:
 * Lowercases, converts punctuation and symbols to spaces, collapses extra spaces.
 */
export function normalizeMaterialName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Levenshtein distance between two strings
 */
export function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

const COMMON_ABBREVIATIONS: Record<string, string> = {
  alum: 'aluminum',
  aluminium: 'aluminum',
  al: 'aluminum',
  cu: 'copper',
  rad: 'radiator',
  rads: 'radiator',
  ss: 'stainless',
  pb: 'lead',
  zn: 'zinc',
  fe: 'steel',
  extr: 'extrusion',
  br: 'brass',
  batt: 'battery',
  batts: 'battery',
  wire: 'wire'
};

const CONFLICTING_SCRAP_TERMS: [string, string][] = [
  ['clean', 'dirty'],
  ['clean', 'irony'],
  ['sheet', 'cast'],
  ['yellow', 'red'],
  ['soft', 'hard'],
  ['bare', 'insulated'],
  ['prepared', 'unprepared']
];

/**
 * Checks if two material names are identical or highly similar duplicates.
 * Correctly flags "Cu/Al Rad Ends" and "Cu-Al Rad Ends",
 * while preventing false matches on distinct scrap grades like "Copper #1" vs "Copper #2".
 */
export function areNamesSimilar(nameA: string, nameB: string): boolean {
  const normA = normalizeMaterialName(nameA);
  const normB = normalizeMaterialName(nameB);

  if (!normA || !normB) return false;
  if (normA === normB) return true;

  // 1. Guard against grade conflicts (e.g. Copper 1 vs Copper 2)
  const numsA = normA.match(/\b\d+\b/g) || [];
  const numsB = normB.match(/\b\d+\b/g) || [];
  if (numsA.length > 0 && numsB.length > 0) {
    if (numsA.sort().join(',') !== numsB.sort().join(',')) {
      return false;
    }
  }

  // 2. Guard against distinct scrap quality polarities
  const wordsA = new Set(normA.split(' '));
  const wordsB = new Set(normB.split(' '));
  for (const [w1, w2] of CONFLICTING_SCRAP_TERMS) {
    if (
      (wordsA.has(w1) && !wordsA.has(w2) && !wordsB.has(w1) && wordsB.has(w2)) ||
      (!wordsA.has(w1) && wordsA.has(w2) && wordsB.has(w1) && !wordsB.has(w2))
    ) {
      return false;
    }
  }

  // 3. Token sorted equality (e.g. "bare bright copper" vs "copper bare bright")
  const tokensA = normA.split(' ').filter(Boolean).sort();
  const tokensB = normB.split(' ').filter(Boolean).sort();
  if (tokensA.join(' ') === tokensB.join(' ')) return true;

  // 4. Expand abbreviations and compare
  const expand = (tokens: string[]) => tokens.map(t => COMMON_ABBREVIATIONS[t] || t).sort().join(' ');
  const expA = expand(tokensA);
  const expB = expand(tokensB);
  if (expA === expB) return true;

  // 5. Normalized string edit distance
  const maxLen = Math.max(normA.length, normB.length);
  const dist = levenshteinDistance(normA, normB);
  const sim = 1 - dist / maxLen;

  // If edit distance is <= 2 or similarity >= 0.85
  if (dist <= 2 && maxLen >= 6) return true;
  if (maxLen > 6 && sim >= 0.85) return true;

  // 6. Token overlap with expanded forms
  const expTokensA = expA.split(' ');
  const expTokensB = expB.split(' ');
  const setB = new Set(expTokensB);
  const common = expTokensA.filter(t => setB.has(t));
  const overlap = common.length / Math.max(expTokensA.length, expTokensB.length);
  if (overlap >= 0.75 && dist <= 4) return true;

  return false;
}

/**
 * Detects duplicate materials grouped into:
 * Category A: SAME CODE
 * Category B: SAME/SIMILAR NAME
 */
export function detectDuplicateMaterials(
  materials: Material[],
  inventoryMap: Record<string, number>,
  ticketStats: {
    completed: Record<string, number>;
    all: Record<string, number>;
  }
): DuplicateDetectionResult {
  // Map materials to MaterialWithStats
  const enrichedMaterials: MaterialWithStats[] = materials.map((m) => ({
    ...m,
    inventoryWeight: inventoryMap[m.id] ?? 0,
    completedTicketCount: ticketStats.completed[m.id] ?? 0,
    allTicketCount: ticketStats.all[m.id] ?? 0
  }));

  // A. SAME CODE
  const codeMap = new Map<string, MaterialWithStats[]>();
  enrichedMaterials.forEach((mat) => {
    const normCode = (mat.code || '').trim().toUpperCase();
    if (!normCode) return;
    const list = codeMap.get(normCode) || [];
    list.push(mat);
    codeMap.set(normCode, list);
  });

  const sameCodeGroups: DuplicateGroup[] = [];
  codeMap.forEach((mats, code) => {
    if (mats.length >= 2) {
      sameCodeGroups.push({
        id: `code_${code}`,
        type: 'same_code',
        groupKey: code,
        displayName: `Code "${code}" (${mats.length} materials)`,
        materials: mats
      });
    }
  });

  // B. SAME / SIMILAR NAME
  // Use connected components (Union-Find)
  const n = enrichedMaterials.length;
  const parent: number[] = Array.from({ length: n }, (_, i) => i);
  function find(i: number): number {
    if (parent[i] === i) return i;
    parent[i] = find(parent[i]);
    return parent[i];
  }
  function union(i: number, j: number) {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) {
      parent[rootI] = rootJ;
    }
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (areNamesSimilar(enrichedMaterials[i].name, enrichedMaterials[j].name)) {
        union(i, j);
      }
    }
  }

  const clusters = new Map<number, MaterialWithStats[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = clusters.get(root) || [];
    list.push(enrichedMaterials[i]);
    clusters.set(root, list);
  }

  const similarNameGroups: DuplicateGroup[] = [];
  clusters.forEach((mats, rootIndex) => {
    if (mats.length >= 2) {
      const canonicalName = enrichedMaterials[rootIndex].name;
      similarNameGroups.push({
        id: `name_cluster_${rootIndex}`,
        type: 'similar_name',
        groupKey: normalizeMaterialName(canonicalName),
        displayName: `Similar Name: "${canonicalName}" (${mats.length} materials)`,
        materials: mats
      });
    }
  });

  // Calculate unique materials involved
  const involvedIds = new Set<string>();
  sameCodeGroups.forEach(g => g.materials.forEach(m => involvedIds.add(m.id)));
  similarNameGroups.forEach(g => g.materials.forEach(m => involvedIds.add(m.id)));

  return {
    sameCodeGroups,
    similarNameGroups,
    totalDuplicates: sameCodeGroups.length + similarNameGroups.length,
    totalUniqueMaterialsInvolved: involvedIds.size
  };
}
