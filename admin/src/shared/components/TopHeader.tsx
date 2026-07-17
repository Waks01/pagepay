import { type ReactNode } from 'react';
import { Menu } from 'lucide-react';

interface TopHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children?: ReactNode;
  onMenuClick?: () => void;
}

export function TopHeader({ title, subtitle, actions, children, onMenuClick }: TopHeaderProps) {
  return (
    <div className="sticky top-0 z-30 border-b border-border bg-bg-card/95 px-4 py-4 backdrop-blur-sm sm:px-6 md:px-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {onMenuClick && (
            <button
              onClick={onMenuClick}
              className="cursor-pointer rounded-lg p-2 text-text-muted hover:bg-bg-hover hover:text-text-main lg:hidden"
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
          )}
          <div>
            <h1 className="text-xl font-bold text-text-main sm:text-2xl" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>{title}</h1>
            {subtitle && <p className="mt-0.5 text-sm text-text-muted">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(actions || children) && <div className="flex items-center gap-2">{actions || children}</div>}
        </div>
      </div>
    </div>
  );
}