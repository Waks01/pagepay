import { Menu } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

interface NavbarProps {
  onMenuClick: () => void;
}

/**
 * Top app bar shown above the routed content on every viewport.
 * Holds global controls: hamburger menu (mobile only) and theme toggle.
 */
export function Navbar({ onMenuClick }: NavbarProps) {
  return (
    <header
      className="fixed top-0 left-0 right-0 z-20 flex h-14 items-center justify-between
                 border-b border-border bg-bg-card/95 px-4 backdrop-blur-sm
                 sm:px-6 md:left-64"
    >
      <button
        onClick={onMenuClick}
        className="cursor-pointer rounded-lg p-2 text-text-muted hover:bg-bg-hover hover:text-text-main md:hidden"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>
      <div className="flex-1 md:flex-none" />
      <ThemeToggle />
    </header>
  );
}
