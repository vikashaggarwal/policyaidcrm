import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

const SIZES = new Set([180, 192, 512]);

export async function GET(request: NextRequest, ctx: { params: Promise<{ size: string }> }) {
  const { size: raw } = await ctx.params;
  const size = Number(raw);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  const maskable = request.nextUrl.searchParams.get("maskable") === "1";
  const inner = Math.round(size * (maskable ? 0.5 : 0.62)); // maskable icons keep a safe margin

  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#0b5fd6" }}>
        <div
          style={{
            width: inner, height: inner, display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: maskable ? 0 : inner * 0.22, background: "#ffffff", color: "#0b5fd6",
            fontSize: inner * 0.62, fontWeight: 800, letterSpacing: -2,
          }}
        >
          D
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
