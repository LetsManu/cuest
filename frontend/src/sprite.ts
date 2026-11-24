/** Shared pixel hero: a box-shadow sprite built from character rows. */
export const ROWS = ['..........KKKK..........','........KKLLGGKK........','.......KLLGGGGGgK.......','......KLGGGGGGGGgK......','.....KLGGGGGGGGGGgK.....','....KLGGKKKKKKKKGGgK....','....KGGKHHHHHHHHKGgK....','....KGKHHhHHHHhHHKgK....','....KGKHSSHSSHSSHKgK....','....KGKSSSSSSSSSSKgK....','....KGKSKWSSSSKWSKgK....','....KGKSKKSSSSKKSKgK....','....KGKSPSSKKSSPSKgK....','....KGKsSSSSSSSSsKgK....','....KGGKKsSSSSsKKGgK....','....KGKyYYYYYYYYYKgK....','...KGGKRRRYYYYRRRKGgK...','...KGGKRRRRYYRRRrKGgK...','...KGGKRRRRRRRRRrKGgK...','...KSGKBBBBYYBBBBKGSK...','...KGGKRRRRRRRRRrKGgK...','...KgGKrRRRRRRRRrKGgK...','...KKKKKNNNKKNNNKKKKK...','.......KNNNKKNNNK.......','......KOOOOKKOOOOK......','......KooooKKooooK......','......KKKKKKKKKKKK......','.....ZZZZZZZZZZZZZZ.....'];

export type Palette = Record<string, string>;

export const BASE_PALETTE: Palette = { K: '#2B2A33', G: '#4E8A6E', L: '#6FAE8C', g: '#3B6E57', H: '#8B4A2B', h: '#6B3820', S: '#F2C9A0', s: '#D9A57E', W: '#FFF9EC', P: '#E89A8A', y: '#F7D27A', Y: '#E0A43A', R: '#B5523B', r: '#8E3E2C', B: '#6B4A2B', N: '#4A3A2A', O: '#7A4E2E', o: '#5A3A24', T: '#8B5E34', F: '#E0A43A', f: '#B07A1E', Z: 'rgba(43,42,51,0.18)', Q: 'rgba(247,210,122,0.55)' };

export const SPRITE_W = 24;
export const SPRITE_H = 28;

/** Level 1-3 -> stage 1, 4-7 -> 2, 8+ -> 3. */
export function stageForLevel(level: number): 1 | 2 | 3 {
  return level >= 8 ? 3 : level >= 4 ? 2 : 1;
}

const cache = new Map<string, string>();

/** box-shadow value for a stage (0 = locked silhouette) at `px` pixel size. */
export function spriteShadow(stage: number, px: number, overrides?: Palette): string {
  const key = `${stage}:${px}:${JSON.stringify(overrides ?? {})}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const g = ROWS.map((r) => r.split(''));
  const put = (x: number, y: number, c: string) => { if (g[y]) g[y][x] = c; };
  for (let y = 5; y <= 23; y++) put(21, y, 'T');
  put(20, 19, 'S');
  [20, 21, 22].forEach((x) => put(x, 24, 'B'));
  [19, 20, 21, 22, 23].forEach((x, i) => { put(x, 25, 'F'); put(x, 26, i % 2 ? 'f' : 'F'); put(x, 27, i % 2 ? 'F' : 'f'); });
  if (stage >= 2 || stage === 0) { put(21, 2, 'y'); put(20, 3, 'y'); put(21, 3, 'Y'); put(22, 3, 'y'); put(21, 4, 'y'); }
  if (stage === 3) { [[21, 1], [19, 3], [23, 3], [20, 2], [22, 2], [20, 4], [22, 4]].forEach(([x, y]) => put(x, y, 'Q')); }
  const pal: Palette = { ...BASE_PALETTE };
  if (stage === 1) { pal.G = '#8C7A5B'; pal.L = '#A8957A'; pal.g = '#6E5E44'; pal.y = '#C9C1B0'; pal.Y = '#A9A091'; }
  if (stage === 3) { pal.G = '#3D5A8A'; pal.L = '#F7D27A'; pal.g = '#2C4370'; pal.R = '#7A3E6E'; pal.r = '#5C2E53'; }
  if (overrides) Object.assign(pal, overrides);
  const out: string[] = [];
  g.forEach((row, yy) => row.forEach((c, x) => {
    if (c === '.') return;
    let col: string | undefined = pal[c];
    if (stage === 0 && c !== 'Z') col = '#CFC3A8';
    if (col) out.push(`${(x + 1) * px}px ${(yy + 1) * px}px 0 0 ${col}`);
  }));
  const res = out.join(',');
  cache.set(key, res);
  return res;
}
