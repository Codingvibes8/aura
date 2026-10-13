# Supabase setup for Aura (Phase 6)

Aura's auth, profiles, synced settings, and cloud phrases run on Supabase.
Without these steps the app still works fully — auth/cloud features no-op
gracefully and everything stays local.

## 1. Create the project

1. Go to https://supabase.com → New project.
2. Note the **Project URL** and **anon public key** (Settings → API).

## 2. Run the schema

Open the SQL editor and run `supabase/migrations/0001_aura.sql` (creates
`profiles`, `user_settings`, `custom_phrases` with owner-only RLS).

## 3. Configure the app

Add to `.env.local` (see `.env.example`):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xyzcompany.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

Restart `npm run dev`.

## 4. Auth providers (optional)

- **Email/password**: enabled by default. Confirm-email behavior is under
  Authentication → Sign In / Sign Up (disable confirmations for local dev).
- **Google**: Authentication → Providers → Google (needs a Google OAuth client).
- **Apple**: Authentication → Providers → Apple (needs Apple credentials).

The login page offers email + Google + Apple; unconfigured providers surface
Supabase's error message instead of failing silently.

## 5. Route policy

`proxy.ts` refreshes sessions everywhere and gates `/interpreter` behind
login (redirects to `/login?next=/interpreter`). All other routes stay open
so the demo works without an account.

## Tables

| Table | Purpose | RLS |
|---|---|---|
| `profiles` | display name, role, language | owner-only |
| `user_settings` | a11y flags, TTS voice/rate, ambient sensitivity | owner-only |
| `custom_phrases` | cloud quick phrases | owner-only |
