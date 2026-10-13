import { ImageResponse } from "next/og";

/**
 * Phase 9.1 — generated app icon (512px PNG served at /icon).
 * Indigo tile with a white sound-wave mark.
 */
export const size = {
  width: 512,
  height: 512,
};

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
          background: "#4f46e5",
          borderRadius: "112px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: "28px", height: "240px" }}>
          {[96, 168, 240, 168, 96].map((h, i) => (
            <div
              key={i}
              style={{ width: "44px", height: `${h}px`, background: "white", borderRadius: "22px" }}
            />
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}
