import { ApiError, heartbeatAgent } from "../../../lib/store";

export const runtime = "edge";

const headers = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" };

export async function POST(request: Request) {
  try {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 8_192) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "心跳请求过大");
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 8_192) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "心跳请求过大");
    }
    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      payload = parsed as Record<string, unknown>;
    } catch {
      throw new ApiError(400, "BAD_JSON", "心跳请求必须是 JSON 对象");
    }
    return Response.json(await heartbeatAgent(request, payload), { headers });
  } catch (error) {
    if (error instanceof ApiError) {
      return Response.json(
        { ok: false, error: { code: error.code, message: error.message } },
        { status: error.status, headers },
      );
    }
    return Response.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "Agent 心跳暂时不可用" } },
      { status: 500, headers },
    );
  }
}
