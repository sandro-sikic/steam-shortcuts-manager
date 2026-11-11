import type { ReactNode } from 'react';

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const RefreshIcon = () => (
  <Icon>
    <path d="M20 11a8 8 0 0 0-14.9-3M4 5v4h4" />
    <path d="M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const AlertIcon = () => (
  <Icon>
    <path d="M12 4 2.5 20h19L12 4Z" />
    <path d="M12 10v4.5M12 17.5v.01" />
  </Icon>
);

export const SyncIcon = () => (
  <Icon>
    <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
    <path d="M21 4v4h-4" />
    <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
    <path d="M3 20v-4h4" />
  </Icon>
);

export const GearIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" />
  </Icon>
);

export const ArrowLeftIcon = () => (
  <Icon>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);

/** The app mark: three stacked game cards. */
export const Logo = () => (
  <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
    <rect x="3" y="9" width="17" height="20" rx="4" fill="currentColor" opacity="0.28" transform="rotate(-9 11 19)" />
    <rect x="8" y="5" width="17" height="21" rx="4" fill="currentColor" opacity="0.55" transform="rotate(-2 16 15)" />
    <rect x="13" y="4" width="16" height="22" rx="4" fill="currentColor" transform="rotate(7 21 15)" />
  </svg>
);
