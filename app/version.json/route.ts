// Emitted at build time as /version.json (static export). Open tabs poll it to detect new deploys.
export const dynamic = "force-static";

export function GET() {
  return Response.json({ buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "unknown" });
}
