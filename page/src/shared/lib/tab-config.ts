export const TAB_ORDER = [
  { name: 'home', label: 'Home', icon: 'home', iconOutline: 'home-outline' },
  { name: 'catalog', label: 'Catalog', icon: 'book', iconOutline: 'book-outline' },
  { name: 'study', label: 'Study', icon: 'school', iconOutline: 'school-outline' },
  { name: 'wallet', label: 'Wallet', icon: 'wallet', iconOutline: 'wallet-outline' },
  { name: 'profile', label: 'Profile', icon: 'person', iconOutline: 'person-outline' },
  { name: 'premium', label: 'Premium', icon: 'diamond', iconOutline: 'diamond-outline' },
] as const;

export const VISIBLE_TABS = 4;

export type TabName = (typeof TAB_ORDER)[number]['name'];
