import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { OUT_ROOT } from "../../../../src/runs.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

function safeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "mascot";
}

export async function POST(request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!file || typeof file === "string") {
      return Response.json({ error: "업로드할 이미지 파일이 없습니다" }, { status: 400 });
    }
    if (!TYPES[file.type]) {
      return Response.json({ error: "PNG, JPG, WEBP 이미지만 업로드할 수 있습니다" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ error: "이미지는 8MB 이하만 업로드할 수 있습니다" }, { status: 400 });
    }

    const dir = path.join(OUT_ROOT, "mascots");
    fs.mkdirSync(dir, { recursive: true });

    const ext = TYPES[file.type];
    const base = safeName(file.name.replace(/\.[^.]+$/, ""));
    const filename = `${Date.now()}-${crypto.randomUUID()}-${base}${ext}`;
    const target = path.join(dir, filename);
    fs.writeFileSync(target, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });

    return Response.json({
      url: `/out/mascots/${encodeURIComponent(filename)}`,
      name: file.name,
      size: file.size,
      type: file.type,
    });
  } catch (error) {
    return Response.json({ error: error?.message ?? "마스코트 업로드 실패" }, { status: 500 });
  }
}
