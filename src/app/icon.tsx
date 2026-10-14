import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: 64, height: 64, display: "flex", alignItems: "center", justifyContent: "center", background: "#0b5fd6", color: "#fff", fontSize: 44, fontWeight: 800, borderRadius: 14 }}>
        D
      </div>
    ),
    size,
  );
}
