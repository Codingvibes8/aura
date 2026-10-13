"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogIn, UserPlus } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const configured = isSupabaseConfigured();

  const emailAuth = async (mode: "signin" | "signup") => {
    setError(null);
    setNotice(null);
    if (!configured) {
      setError("Sign-in is not configured on this deployment (Supabase env vars missing).");
      return;
    }
    if (!email.trim() || !password) {
      setError("Enter an email and password.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (data.session) {
          router.replace(next);
          router.refresh();
        } else {
          setNotice("Account created — check your email to confirm, then sign in.");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const oauth = async (provider: "google" | "apple") => {
    setError(null);
    setNotice(null);
    if (!configured) {
      setError("Sign-in is not configured on this deployment (Supabase env vars missing).");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      if (error) throw error;
    } catch (e) {
      setError(e instanceof Error ? e.message : "OAuth failed.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70dvh] w-full max-w-md flex-col justify-center px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Sign in to Aura</CardTitle>
          <CardDescription>
            Sync settings, phrases, and interpreter identity across devices. The demo works
            without an account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs defaultValue="signin" aria-label="Sign in or create account">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>
            <TabsContent value="signin" className="space-y-3 pt-3">
              <EmailFields email={email} setEmail={setEmail} password={password} setPassword={setPassword} busy={busy} onSubmit={() => void emailAuth("signin")} />
              <Button type="button" className="w-full" disabled={busy} onClick={() => void emailAuth("signin")}>
                <LogIn aria-hidden="true" /> Sign in
              </Button>
            </TabsContent>
            <TabsContent value="signup" className="space-y-3 pt-3">
              <EmailFields email={email} setEmail={setEmail} password={password} setPassword={setPassword} busy={busy} onSubmit={() => void emailAuth("signup")} />
              <Button type="button" className="w-full" disabled={busy} onClick={() => void emailAuth("signup")}>
                <UserPlus aria-hidden="true" /> Create account
              </Button>
            </TabsContent>
          </Tabs>

          {error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
              {notice}
            </p>
          )}

          <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            or continue with
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => void oauth("google")}>
              Google
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void oauth("apple")}>
              Apple
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EmailFields({
  email,
  setEmail,
  password,
  setPassword,
  busy,
  onSubmit,
}: {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  busy: boolean;
  onSubmit: () => void;
}) {
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="login-email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="login-password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
