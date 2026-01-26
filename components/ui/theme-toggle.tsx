import React from 'react';
import { useTheme } from '../../ThemeContext';

interface ThemeToggleProps {
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show label text */
  showLabel?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ 
  size = 'md', 
  showLabel = false,
  className = '' 
}) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  const sizeClasses = {
    sm: 'h-7 w-7',
    md: 'h-9 w-9',
    lg: 'h-11 w-11',
  };

  const iconSizes = {
    sm: 'text-[16px]',
    md: 'text-[20px]',
    lg: 'text-[24px]',
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={toggleTheme}
        className={`
          ${sizeClasses[size]}
          rounded-full
          border border-border
          bg-card hover:bg-accent
          text-foreground
          flex items-center justify-center
          transition-all duration-200
          hover:scale-105 active:scale-95
          focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background
        `}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {isDark ? (
          <span className={`material-symbols-outlined ${iconSizes[size]}`}>light_mode</span>
        ) : (
          <span className={`material-symbols-outlined ${iconSizes[size]}`}>dark_mode</span>
        )}
      </button>
      {showLabel && (
        <span className="text-sm text-muted-foreground font-medium">
          {isDark ? 'Light Mode' : 'Dark Mode'}
        </span>
      )}
    </div>
  );
};

/** 
 * A more detailed theme toggle with switch UI
 */
export const ThemeSwitch: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className={`material-symbols-outlined text-[18px] ${!isDark ? 'text-primary' : 'text-muted-foreground'}`}>
        light_mode
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={isDark}
        onClick={toggleTheme}
        className={`
          relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full
          border-2 border-transparent
          transition-colors duration-200 ease-in-out
          focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background
          ${isDark ? 'bg-primary' : 'bg-muted'}
        `}
      >
        <span
          className={`
            pointer-events-none inline-block h-5 w-5 transform rounded-full
            bg-background shadow-lg ring-0
            transition duration-200 ease-in-out
            ${isDark ? 'translate-x-5' : 'translate-x-0'}
          `}
        />
      </button>
      <span className={`material-symbols-outlined text-[18px] ${isDark ? 'text-primary' : 'text-muted-foreground'}`}>
        dark_mode
      </span>
    </div>
  );
};

/**
 * Dropdown-style theme selector with explicit options
 */
export const ThemeSelector: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-sm text-muted-foreground font-medium">Theme:</span>
      <div className="flex rounded-lg border border-border bg-card p-1">
        <button
          type="button"
          onClick={() => theme !== 'light' && toggleTheme()}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
            transition-colors duration-200
            ${theme === 'light' 
              ? 'bg-primary text-primary-foreground' 
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }
          `}
        >
          <span className="material-symbols-outlined text-[16px]">light_mode</span>
          Light
        </button>
        <button
          type="button"
          onClick={() => theme !== 'dark' && toggleTheme()}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
            transition-colors duration-200
            ${theme === 'dark' 
              ? 'bg-primary text-primary-foreground' 
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }
          `}
        >
          <span className="material-symbols-outlined text-[16px]">dark_mode</span>
          Dark
        </button>
      </div>
    </div>
  );
};
