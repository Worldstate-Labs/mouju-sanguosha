import { agentSpec } from "../../../lib/agent-protocol";

export const runtime = "edge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  return Response.json({
    protocol: "mouju-agent/1.0",
    skill: `${url.origin}/api/agent-skill`,
    spec: `${url.origin}/api/agent-spec`,
    ...agentSpec(url.origin),
  });
}

