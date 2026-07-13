import { agentSpec } from "../../../lib/agent-protocol";

export const runtime = "edge";

export async function GET(request: Request) {
  return Response.json(agentSpec(new URL(request.url).origin), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}

