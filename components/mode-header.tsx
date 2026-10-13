"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ear, Headset, Users, Video } from "lucide-react";
import { ConnectionStatus } from "@/components/connection-status";
import { AuthButton } from "@/components/auth-button";
import { SettingsPanel } from "@/components/settings-panel";
import { SosInterpreter } from "@/components/sos-interpreter";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/realtime/schema";

const NAV = [
  { href: "/", label: "Overview", icon: null },
  { href: "/dhh", label: "DHH View", icon: Ear },
  { href: "/hearing", label: "Hearing View", icon: Users },
  { href: "/face-to-face", label: "Face-to-Face", icon: Video },
  { href: "/interpreter", label: "Interpreter", icon: Headset },
];

function roleForPath(pathname: string): Role {
  if (pathname.startsWith("/interpreter")) return "interpreter";
  if (pathname.startsWith("/hearing")) return "hearing";
  if (pathname.startsWith("/dhh")) return "dhh";
  return "dhh";
}

export function ModeHeader() {
  const pathname = usePathname();
  const role = roleForPath(pathname);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md font-bold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <path d="M12 3a7 7 0 0 0-7 7c0 2 .8 3.4 1.8 4.6.9 1 1.7 1.9 1.7 3.4h7c0-1.5.8-2.4 1.7-3.4C18.2 13.4 19 12 19 10a7 7 0 0 0-7-7Z" />
              <path d="M9 21h6" />
            </svg>
          </span>
          Aura
        </Link>

        <nav aria-label="Modes" className="ms-2 hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {Icon && <Icon className="size-4" aria-hidden="true" />}
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ms-auto flex items-center gap-2">
          <ConnectionStatus role={role} />
          <SosInterpreter compact role={role} />
          <SettingsPanel />
          <AuthButton />
        </div>
      </div>
    </header>
  );
}
