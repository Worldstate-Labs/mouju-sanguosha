import { NextResponse } from "next/server";
import { createRouteSupabaseClient, safeReturnPath } from "../../../lib/auth";

export const runtime = "edge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeReturnPath(url.searchParams.get("next"));
  const setup = createRouteSupabaseClient(request);
  if (!setup) {
    return NextResponse.redirect(new URL(`/signout-with-chatgpt?return_to=${encodeURIComponent(next)}`, url.origin));
  }
  // A public Sites visitor may carry a Supabase session, a dispatcher-owned
  // ChatGPT session, or both. Clear Supabase cookies and then pass through the
  // dispatcher sign-out whenever its trusted identity header is present.
  await setup.client.auth.signOut({ scope: "local" });
  const destination = request.headers.get("oai-authenticated-user-email")
    ? new URL(`/signout-with-chatgpt?return_to=${encodeURIComponent(next)}`, url.origin)
    : new URL(next, url.origin);
  const response = NextResponse.redirect(destination);
  for (const cookie of setup.pendingCookies) response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}
