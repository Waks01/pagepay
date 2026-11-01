import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  isAuthenticated: boolean;
  role: string | null;
  permissions: string[];
  setAuth: (role: string, permissions: string[]) => void;
  logout: () => void;
  clearAuth: () => void;
  hasPermission: (permission: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      role: null,
      permissions: [],
      setAuth: (role, permissions) => {
        set({ isAuthenticated: true, role, permissions });
      },
      logout: () => {
        set({ isAuthenticated: false, role: null, permissions: [] });
      },
      clearAuth: () => {
        set({ isAuthenticated: false, role: null, permissions: [] });
      },
      hasPermission: (permission: string) => {
        const { permissions, role } = get();
        if (role === 'super_admin') return true;
        return permissions.includes('*') || permissions.includes(permission);
      },
    }),
    {
      name: 'admin-auth-storage', // localStorage key
    }
  )
);
