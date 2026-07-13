import { AsyncLocalStorage } from "node:async_hooks";

export interface RuntimeBindings {
  DB?: D1Database;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  [key: string]: unknown;
}

const bindings = new AsyncLocalStorage<RuntimeBindings>();

export function runWithBindings<T>(env: RuntimeBindings, callback: () => T): T {
  return bindings.run(env, callback);
}

export function getBindings(): RuntimeBindings {
  const current = bindings.getStore();
  if (!current) throw new Error("Runtime bindings are unavailable outside a Worker request");
  return current;
}
