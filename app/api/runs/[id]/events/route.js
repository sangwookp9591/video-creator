import { getJob } from "../../../../../src/runs.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function sse(event, data) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(request, { params }) {
  const { id } = await params;
  const job = getJob(id);

  if (!job) {
    return Response.json({ error: "run을 찾을 수 없습니다" }, { status: 404 });
  }

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const write = (item) => {
        if (!closed) controller.enqueue(sse(item.event, item.data));
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        job.emitter.off("event", write);
        try {
          controller.close();
        } catch {}
      };
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15_000);

      for (const item of job.events) write(item);
      job.emitter.on("event", write);
      request.signal.addEventListener("abort", cleanup, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
