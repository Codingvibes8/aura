"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogIn, LogOut } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * Header auth control: sign-in link when anonymous, email + sign-out
 * when authenticated. Renders nothing auth-related when Supabase is
 * unconfigured (demo deployments).
 */
export function AuthButton() {
  const [email, setEmail] = useState<string | null>(null);
  // unconfigured deployments are "ready" immediately — no session to load
  const [ready, setReady] = useState(() => !isSupabaseConfigured());

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) {
        setEmail(data.session?.user.email ?? null);
        setReady(true);
      }
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  if (!ready || !isSupabaseConfigured()) return null;

  if (!email) {
    return (
      <Button type="button" variant="ghost" size="sm" asChild>
        <Link href="/login" aria-label="Sign in to sync settings across devices">
          <LogIn aria-hidden="true" /> Sign in
        </Link>
      </Button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="hidden max-w-32 truncate text-xs text-muted-foreground sm:inline" title={email}>
        {email}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Sign out (${email})`}
        onClick={() => {
          void createClient().auth.signOut().then(() => setEmail(null));
        }}
      >
        <LogOut aria-hidden="true" />
        <span className="hidden sm:inline">Sign out</span>
      </Button>
    </span>
  );
}
