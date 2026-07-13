import { NextResponse } from "next/server";
import { takePendingAuthCookies } from "../../../lib/auth";
import { ApiError, getRoom, handleOperation } from "../../../lib/store";

export const runtime = "edge";

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResponse(request: Request, body: unknown, status = 200) {
  const response = NextResponse.json(body, { status, headers: noStoreHeaders });
  for (const cookie of takePendingAuthCookies(request)) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  return response;
}

function errorResponse(request: Request, error: unknown) {
  if (error instanceof ApiError) {
    return jsonResponse(request, { ok: false, error: { code: error.code, message: error.message } }, error.status);
  }
  console.error("game api error", error instanceof Error ? error.message : "unknown");
  return jsonResponse(request, { ok: false, error: { code: "INTERNAL_ERROR", message: "房间服务暂时遇到问题" } }, 500);
}

export async function GET(request: Request) {
  try {
    const room = new URL(request.url).searchParams.get("room");
    return jsonResponse(request, await getRoom(request, room));
  } catch (error) {
    return errorResponse(request, error);
  }
}

export async function POST(request: Request) {
  try {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 32_768) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "请求内容过大");
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 32_768) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "请求内容过大");
    }
    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      payload = parsed as Record<string, unknown>;
    } catch {
      throw new ApiError(400, "BAD_JSON", "请求必须是 JSON 对象");
    }
    return jsonResponse(request, await handleOperation(request, payload));
  } catch (error) {
    return errorResponse(request, error);
  }
}
