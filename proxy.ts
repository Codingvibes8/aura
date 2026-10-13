import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next 16 route proxy (replaces middleware.ts).
 * - Refreshes the Supabase session on every matched request.
 * - Gates the interpreter console behind login (professional tool).
 *   All other routes stay open so the demo works out of the box.
 */
export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request);

  // Gate the console only when auth is actually available — otherwise the
  // demo deployment (no Supabase env) would lock the page with no way in.
  const authAvailable = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (authAvailable && request.nextUrl.pathname.startsWith("/interpreter") && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", "/interpreter");
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|js)$).*)"],
};
