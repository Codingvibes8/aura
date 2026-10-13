/**
 * ICE server configuration for WebRTC (Phase 8.5).
 *
 * Public STUN works for same-machine/LAN/symmetric-friendly NATs.
 * Symmetric NATs and restrictive firewalls need TURN — configure via env:
 *   NEXT_PUBLIC_TURN_URLS=turn:turn.example.com:3478
 *   NEXT_PUBLIC_TURN_USERNAME=user
 *   NEXT_PUBLIC_TURN_CREDENTIAL=secret
 */

export function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const turnUrls = (process.env.NEXT_PUBLIC_TURN_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (turnUrls.length > 0) {
    servers.push({
      urls: turnUrls,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME || undefined,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || undefined,
    });
  }
  return servers;
}

export function getRtcConfig(): RTCConfiguration {
  return { iceServers: getIceServers() };
}
