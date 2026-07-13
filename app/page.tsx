import GameClient from "./GameClient";
import { getCurrentAuthIdentity, getSupabaseConfig } from "../lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const identity = await getCurrentAuthIdentity();
  return (
    <GameClient
      initialUser={
        identity
          ? { displayName: identity.displayName, email: identity.email, provider: identity.provider }
          : null
      }
      directSocialAuth={Boolean(getSupabaseConfig())}
    />
  );
}
