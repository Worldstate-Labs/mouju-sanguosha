import { NextResponse } from "next/server";
import { createRouteSupabaseClient, safeReturnPath } from "../../../lib/auth";

export const runtime = "edge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeReturnPath(url.searchParams.get("next"));
  const setup = createRouteSupabaseClient(request);
  if (!setup) {
    return NextResponse.redirect(new URL(`/signin-with-chatgpt?return_to=${encodeURIComponent(next)}`, url.origin));
  }
  const callback = new URL("/auth/callback", url.origin);
  callback.searchParams.set("next", next);
  const { data, error } = await setup.client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback.toString(), skipBrowserRedirect: true },
  });
  if (error || !data.url) return NextResponse.redirect(new URL(`/?auth_error=google`, url.origin));
  const response = NextResponse.redirect(data.url);
  for (const cookie of setup.pendingCookies) response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}

