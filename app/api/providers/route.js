import { getProviderStatus } from "../../../src/providers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getProviderStatus());
}
