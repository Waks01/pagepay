import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  DollarSign,
  FileText,
  Shield,
  Settings,
  ScrollText,
  LogOut,
  X,
  ListTodo,
  BarChart3,
  Brain,
  UserCog,
  MessageSquare,
  TrendingUp,
} from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { adminApi } from "@/lib/api";

const NAV_ITEMS = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
  { label: "Analytics", icon: BarChart3, path: "/analytics" },
  { label: "Ad Analytics", icon: TrendingUp, path: "/ads" },
  { label: "Users", icon: Users, path: "/users" },
  { label: "Admin Users", icon: UserCog, path: "/admins" },
  { label: "Finance", icon: DollarSign, path: "/finance" },
  { label: "Content", icon: FileText, path: "/content" },
  { label: "Community", icon: MessageSquare, path: "/community" },
  { label: "Tasks", icon: ListTodo, path: "/tasks" },
  { label: "Fraud", icon: Shield, path: "/fraud" },
  { label: "AI Health", icon: Brain, path: "/ai-health" },
  { label: "Config", icon: Settings, path: "/config" },
  { label: "Audit Logs", icon: ScrollText, path: "/logs" },
];

interface SidebarProps {
  /**
   * Fired after a nav link or the logout button is clicked. The mobile
   * drawer uses this to close itself after navigation. Desktop can omit.
   */
  onNavigate?: () => void;
  /**
   * When provided, renders an X close button in the panel header. The
   * mobile drawer passes this; the desktop sidebar omits it.
   */
  onClose?: () => void;
}

/**
 * Sidebar panel. Renders the nav + wordmark + logout. Does NOT own its
 * positioning — the parent decides whether this is the fixed desktop
 * aside or the body of the mobile overlay drawer.
 */
export function Sidebar({ onNavigate, onClose }: SidebarProps) {
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const handleLogout = async () => {
    // Call backend logout endpoint to clear httpOnly cookie
    try {
      await adminApi.post("/admin/auth/logout");
    } catch (err) {
      // Even if backend fails, clear client state
      console.error("Logout error:", err);
    }
    // Clear client-side auth state
    logout();
    navigate("/login");
    onNavigate?.();
  };

  return (
    <div className="flex h-full w-64 flex-col bg-bg-card text-text-main">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-5">
        <div className="flex items-center gap-2">
          <span
            className="text-xl font-bold text-text-main"
            style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}
          >
            PagePay
          </span>
          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-white">
            Admin
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg p-2 text-text-muted hover:bg-bg-hover hover:text-text-main"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <nav className="sidebar-nav flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            className={({ isActive }) =>
              [
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-white"
                  : "text-text-muted hover:text-text-main hover:bg-bg-hover",
              ].join(" ")
            }
          >
            <item.icon size={18} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <button
          onClick={handleLogout}
          className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <LogOut size={18} />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );
}
