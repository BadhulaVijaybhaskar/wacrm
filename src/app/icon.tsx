import { ImageResponse } from "next/og";

// Astra Chat (AC) mark — neutral text lockup for favicon / app icon.
// No upstream brand colors or glyphs.

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f172a",
          borderRadius: 6,
          color: "#f8fafc",
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "-0.04em",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        AC
      </div>
    ),
    { ...size },
  );
}
