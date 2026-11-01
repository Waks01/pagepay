export const TAB_ORDER = [
  { name: 'home', label: 'Home', icon: 'home', iconOutline: 'home-outline' },
  { name: 'catalog', label: 'Catalog', icon: 'book', iconOutline: 'book-outline' },
  { name: 'study', label: 'Study', icon: 'school', iconOutline: 'school-outline' },
  { name: 'wallet', label: 'Wallet', icon: 'wallet', iconOutline: 'wallet-outline' },
  { name: 'profile', label: 'Profile', icon: 'person', iconOutline: 'person-outline' },
  { name: 'premium', label: 'Premium', icon: 'diamond', iconOutline: 'diamond-outline' },
  { name: 'notification', label: 'Alerts', icon: 'notifications', iconOutline: 'notifications-outline' },
  { name: 'community', label: 'Community', icon: 'people', iconOutline: 'people-outline' },
  { name: 'tasks', label: 'Tasks', icon: 'briefcase', iconOutline: 'briefcase-outline' },
] as const;

export const VISIBLE_TABS = 4;

export type TabName = (typeof TAB_ORDER)[number]['name'];
