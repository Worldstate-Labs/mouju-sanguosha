import { NextResponse } from "next/server";
import { createRouteSupabaseClient, safeReturnPath } from "../../../lib/auth";

export const runtime = "edge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeReturnPath(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const setup = createRouteSupabaseClient(request);
  if (!setup || !code) return NextResponse.redirect(new URL(`/?auth_error=callback`, url.origin));
  const { error } = await setup.client.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL(`/?auth_error=callback`, url.origin));
  const response = NextResponse.redirect(new URL(next, url.origin));
  for (const cookie of setup.pendingCookies) response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
}

