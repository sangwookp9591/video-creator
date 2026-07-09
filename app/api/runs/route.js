import { listRuns, startRun } from "../../../src/runs.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ runs: listRuns() });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const run = startRun(body ?? {});
    return Response.json({ run }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error?.message ?? "실행 시작 실패" }, { status: 400 });
  }
}
