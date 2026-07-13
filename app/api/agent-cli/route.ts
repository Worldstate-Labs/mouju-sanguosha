import { AGENT_CLI_VERSION, agentCliSource } from "../../../lib/agent-cli";

export const runtime = "edge";

export async function GET() {
  return new Response(agentCliSource(), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Disposition": `inline; filename="mouju-agent-cli-${AGENT_CLI_VERSION}.mjs"`,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
