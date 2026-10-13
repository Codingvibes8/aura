import type { MetadataRoute } from "next";

/**
 * Phase 9.1 — Web App Manifest. Makes Aura installable (standalone,
 * themed) on Android/desktop; iOS uses apple-icon + meta tags.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Aura — Accessible Live Communication",
    short_name: "Aura",
    description:
      "Live captions, ambient sound alerts, and on-demand interpreters for Deaf/Hard-of-Hearing and hearing conversations.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0b0f",
    theme_color: "#4f46e5",
    categories: ["accessibility", "communication", "medical"],
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
