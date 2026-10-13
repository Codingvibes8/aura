import { ImageResponse } from "next/og";

/** Phase 9.1 — Apple touch icon (180px PNG served at /apple-icon). */
export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#4f46e5",
          borderRadius: "40px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: "10px", height: "84px" }}>
          {[34, 60, 84, 60, 34].map((h, i) => (
            <div
              key={i}
              style={{ width: "16px", height: `${h}px`, background: "white", borderRadius: "8px" }}
            />
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}
