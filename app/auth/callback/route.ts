import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * OAuth callback: exchanges the auth code for a session, then redirects.
 * PKCE flow — the code verifier lives in cookies, so this must run
 * server-side on the same origin. Session cookies are set on the redirect
 * response; the proxy refresh keeps them alive afterwards.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  const redirect = (pathname: string) => {
    url.pathname = pathname;
    if (pathname === "/login") url.searchParams.set("error", "oauth");
    else url.searchParams.delete("next");
    return NextResponse.redirect(url);
  };

  if (!code) return redirect("/login");

  const response = NextResponse.redirect(new URL(next, request.url));
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return redirect("/login");
  return response;
}
