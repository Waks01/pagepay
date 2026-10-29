/**
 * Cross-tab filter state for the catalog.
 *
 * Home shows category chips (Fiction, Classics, News, Study) and tapping one
 * should land the user on the Catalog tab with that filter already applied.
 * The Catalog screen reads from this store on focus so the filter survives the
 * tab switch.
 *
 * Why a Zustand store and not `router.setParams`:
 *   - setParams would re-mount the Catalog screen with a new key, throwing
 *     away its query cache and scroll position. Zustand keeps both intact.
 *   - It also lets the Catalog screen show a "filtered from Home" chip without
 *     URL state leaking into deep links.
 */

import { create } from 'zustand';

type CatalogFilterState = {
  category: string | null;
  setCategory: (c: string | null) => void;
  // Education filters shared between Home (the level grid) and Catalog
  // (the expanded grid + class picker). Keeping them in the store means
  // tapping a level on Home lands the user on Catalog already filtered,
  // without leaking the selection into the URL (which would break deep
  // links). Local-only — not persisted across app launches.
  educationLevel: string | null;
  setEducationLevel: (l: string | null) => void;
  classLevel: string | null;
  setClassLevel: (c: string | null) => void;
};

export const useCatalogFilter = create<CatalogFilterState>((set) => ({
  category: null,
  setCategory: (category) => set({ category }),
  educationLevel: null,
  setEducationLevel: (educationLevel) => set({ educationLevel }),
  classLevel: null,
  setClassLevel: (classLevel) => set({ classLevel }),
}));
