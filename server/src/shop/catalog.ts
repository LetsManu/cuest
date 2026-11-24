import type { ShopItem } from '../domain/types.js';
import { copy } from '../copy.js';

const n = copy.shop.items;

export const CATALOG: readonly ShopItem[] = [
  { id: 'hood_ember', kind: 'wardrobe', name: n.hood_ember, cost: 40, slot: 'hood', palette: { G: '#B5523B', L: '#D47A5E', g: '#8E3E2C' } },
  { id: 'hood_night', kind: 'wardrobe', name: n.hood_night, cost: 70, slot: 'hood', palette: { G: '#3D5A8A', L: '#F7D27A', g: '#2C4370' } },
  { id: 'scarf_teal', kind: 'wardrobe', name: n.scarf_teal, cost: 25, slot: 'scarf', palette: { y: '#7CC4BF', Y: '#3E8E8A' } },
  { id: 'broom_gold', kind: 'wardrobe', name: n.broom_gold, cost: 80, slot: 'broom', palette: { T: '#B07A1E', F: '#F7D27A', f: '#E0A43A' } },
  { id: 'lantern', kind: 'decor', name: n.lantern, cost: 30 },
  { id: 'flowers', kind: 'decor', name: n.flowers, cost: 20 },
  { id: 'cat', kind: 'decor', name: n.cat, cost: 60 },
  { id: 'fountain', kind: 'decor', name: n.fountain, cost: 90 },
  { id: 'rest_token', kind: 'helper', name: n.rest_token, cost: 50 },
  { id: 'mystery_chest', kind: 'helper', name: n.mystery_chest, cost: 40 },
  { id: 'xp_potion', kind: 'helper', name: n.xp_potion, cost: 70 },
];

export function findItem(id: string): ShopItem | null {
  return CATALOG.find((i) => i.id === id) ?? null;
}
