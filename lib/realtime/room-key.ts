/**
 * In-memory room keys for private rooms (Phase 8.2).
 *
 * Keys live only in module memory — never localStorage, never the server.
 * Leaving the room (or reloading) drops them; rejoining re-prompts.
 */

import { deriveRoomKey } from "./crypto";

const keys = new Map<string, CryptoKey>();

export async function unlockRoom(roomId: string, passphrase: string): Promise<void> {
  keys.set(roomId, await deriveRoomKey(passphrase, roomId));
}

export function lockRoom(roomId: string): void {
  keys.delete(roomId);
}

export function roomKey(roomId: string): CryptoKey | undefined {
  return keys.get(roomId);
}

export function isRoomUnlocked(roomId: string): boolean {
  return keys.has(roomId);
}
