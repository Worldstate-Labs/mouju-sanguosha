import { agentSkill } from "../../../lib/agent-skill";

export const runtime = "edge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const room = url.searchParams.get("room")?.trim().toUpperCase() || "ROOM_CODE";
  return new Response(agentSkill(url.origin, room), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": 'inline; filename="mouju-agent.skill.md"',
      "Cache-Control": "public, max-age=300",
    },
  });
}
