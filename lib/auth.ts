import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { getBindings } from "./runtime-env";

export interface AuthIdentity {
  subjectKey: string;
  displayName: string;
  email: string | null;
  provider: "google" | "apple" | "supabase" | "chatgpt";
}

export interface PendingCookie {
  name: string;
  value: string;
  options: CookieOptions;
}

const requestCookieUpdates = new WeakMap<Request, PendingCookie[]>();

export function getSupabaseConfig() {
  try {
    const env = getBindings();
    const url = typeof env.SUPABASE_URL === "string" ? env.SUPABASE_URL.trim() : "";
    const key = typeof env.SUPABASE_PUBLISHABLE_KEY === "string" ? env.SUPABASE_PUBLISHABLE_KEY.trim() : "";
    return url && key ? { url, key } : null;
  } catch {
    return null;
  }
}

function safeDecode(value: string | null) {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function chatGPTIdentity(headerBag: Headers): AuthIdentity | null {
  const email = headerBag.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!email) return null;
  const fullName =
    headerBag.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8"
      ? safeDecode(headerBag.get("oai-authenticated-user-full-name"))
      : null;
  return {
    subjectKey: `chatgpt:${email}`,
    displayName: fullName || email.split("@")[0] || "登录玩家",
    email,
    provider: "chatgpt",
  };
}

function identityFromSupabase(user: {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}): AuthIdentity {
  const metadata = user.user_metadata ?? {};
  const provider = user.app_metadata?.provider;
  const displayName =
    (typeof metadata.full_name === "string" && metadata.full_name.trim()) ||
    (typeof metadata.name === "string" && metadata.name.trim()) ||
    user.email?.split("@")[0] ||
    "登录玩家";
  return {
    subjectKey: `supabase:${user.id}`,
    displayName: displayName.slice(0, 48),
    email: user.email ?? null,
    provider: provider === "google" || provider === "apple" ? provider : "supabase",
  };
}

function identityFromClaims(claims: Record<string, unknown>): AuthIdentity | null {
  if (typeof claims.sub !== "string" || !claims.sub) return null;
  const appMetadata =
    claims.app_metadata && typeof claims.app_metadata === "object"
      ? (claims.app_metadata as Record<string, unknown>)
      : undefined;
  const userMetadata =
    claims.user_metadata && typeof claims.user_metadata === "object"
      ? (claims.user_metadata as Record<string, unknown>)
      : undefined;
  return identityFromSupabase({
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
    app_metadata: appMetadata,
    user_metadata: userMetadata,
  });
}

function parseCookieHeader(header: string | null) {
  if (!header) return [];
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      return {
        name: separator >= 0 ? part.slice(0, separator) : part,
        value: separator >= 0 ? part.slice(separator + 1) : "",
      };
    });
}

export function createRouteSupabaseClient(request: Request) {
  const config = getSupabaseConfig();
  if (!config) return null;
  const pendingCookies: PendingCookie[] = [];
  const client = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => parseCookieHeader(request.headers.get("cookie")),
      setAll: (values) => {
        pendingCookies.push(...values);
      },
    },
  });
  return { client, pendingCookies };
}

export async function getRequestIdentity(request: Request): Promise<AuthIdentity | null> {
  const setup = createRouteSupabaseClient(request);
  if (setup) {
    try {
      const { data, error } = await setup.client.auth.getClaims();
      const identity = !error && data?.claims ? identityFromClaims(data.claims as Record<string, unknown>) : null;
      if (identity) return identity;
    } catch {
      // A configured identity provider may be temporarily unavailable; SIWC
      // remains a safe optional fallback for ChatGPT-hosted visitors.
    } finally {
      if (setup.pendingCookies.length) requestCookieUpdates.set(request, setup.pendingCookies);
    }
  }
  return chatGPTIdentity(request.headers);
}

export function takePendingAuthCookies(request: Request) {
  const values = requestCookieUpdates.get(request) ?? [];
  requestCookieUpdates.delete(request);
  return values;
}

export async function getCurrentAuthIdentity(): Promise<AuthIdentity | null> {
  const requestHeaders = await headers();
  const config = getSupabaseConfig();
  if (config) {
    try {
      const cookieStore = await cookies();
      const client = createServerClient(config.url, config.key, {
        cookies: {
          getAll: () => cookieStore.getAll().map(({ name, value }) => ({ name, value })),
          setAll: (values) => {
            try {
              for (const { name, value, options } of values) cookieStore.set(name, value, options);
            } catch {
              // Some server-component renderers do not allow cookie writes.
              // API route requests still persist refreshes via takePendingAuthCookies.
            }
          },
        },
      });
      const { data, error } = await client.auth.getClaims();
      const identity = !error && data?.claims ? identityFromClaims(data.claims as Record<string, unknown>) : null;
      if (identity) return identity;
    } catch {
      // Fall through to optional Sites identity headers.
    }
  }
  return chatGPTIdentity(requestHeaders);
}

export function safeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://mouju.local");
    if (url.origin !== "https://mouju.local") return "/";
    if (url.pathname.startsWith("/auth/")) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
