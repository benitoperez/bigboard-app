"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Bottom tab bar - SPEC.md section 10.
 *
 * The spec calls for four tabs: Home, Players, Selected, Account. Selected
 * lands with build order step 9; listing a tab that 404s is worse than
 * adding it when the screen exists, so it is absent until then.
 */
const TABS = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/players", label: "Players", icon: PlayersIcon },
  { href: "/account", label: "Account", icon: AccountIcon },
] as const;

export function TabBar() {
  const pathname = usePathname();

  // No chrome on the login screen - there is nowhere to navigate to yet.
  if (pathname.startsWith("/login")) return null;

  return (
    <nav
      aria-label="Main"
      className="safe-bottom sticky bottom-0 z-10 border-t border-border bg-card/95 backdrop-blur"
    >
      <ul className="mx-auto flex max-w-lg">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={
                  "flex min-h-tap-large flex-col items-center justify-center gap-1 py-2 " +
                  (active ? "text-primary" : "text-muted-foreground")
                }
              >
                <Icon />
                <span className="text-[11px] font-semibold tracking-wide">
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const iconProps = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function HomeIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function PlayersIcon() {
  return (
    <svg {...iconProps}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  );
}
