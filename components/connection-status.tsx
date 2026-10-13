"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { Radio, Users, Wifi, WifiOff } from "lucide-react";
import { useRealtime } from "@/components/realtime-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/realtime/schema";

const STATE_STYLE: Record<string, { dot: string; label: string }> = {
  open: { dot: "bg-emerald-500", label: "Live" },
  connecting: { dot: "bg-amber-500 animate-pulse", label: "Connecting" },
  reconnecting: { dot: "bg-amber-500 animate-pulse", label: "Reconnecting" },
  closed: { dot: "bg-muted-foreground", label: "Offline" },
};

function randomRoomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/**
 * Phase 1 control: WebSocket status + room join/leave.
 * Two browser tabs joining the same room code sync their peer lists
 * through the signaling server — the foundation for WebRTC + captions.
 */
export function ConnectionStatus({ role: defaultRole }: { role: Role }) {
  const { connectionState, peers, roomId, join, leave, clientId } = useRealtime();
  const [open, setOpen] = useState(false);
  // Generated in the initializer — dialog content is not SSR'd, so the value
  // never appears in server HTML and cannot cause a hydration mismatch.
  const [roomCode, setRoomCode] = useState(() =>
    typeof window === "undefined" ? "" : randomRoomCode()
  );
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>(defaultRole);
  const [prevDefaultRole, setPrevDefaultRole] = useState<Role>(defaultRole);

  // Reset the suggested role when the route (and therefore defaultRole) changes.
  // State-during-render pattern from react.dev — avoids an effect cascade.
  if (prevDefaultRole !== defaultRole) {
    setPrevDefaultRole(defaultRole);
    setRole(defaultRole);
    setName("");
  }

  const namePlaceholder =
    role === "dhh" ? "DHH user" : role === "hearing" ? "Hearing user" : "Interpreter";

  const style = STATE_STYLE[connectionState] ?? STATE_STYLE.closed;
  const joined = roomId !== null;
  const roomCodeClean = roomCode.trim().toUpperCase();

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const displayName = name.trim() || namePlaceholder;
    if (!roomCodeClean || !displayName) return;
    join(roomCodeClean, displayName, role);
    setOpen(false);
  };

  const handleLeave = () => {
    leave();
    setOpen(false);
  };

  const peersWithoutSelf = useMemo(
    () => peers.filter((p) => p.id !== clientId),
    [peers, clientId]
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "gap-1.5",
            connectionState === "open" && "border-emerald-500/50"
          )}
          aria-label={`Real-time connection: ${style.label}${joined ? `, room ${roomId}` : ""}. Manage live session.`}
        >
          {connectionState === "open" ? (
            <Wifi className="size-4" aria-hidden="true" />
          ) : (
            <WifiOff className="size-4" aria-hidden="true" />
          )}
          <span className={cn("size-2 rounded-full", style.dot)} aria-hidden="true" />
          <span className="hidden sm:inline">{joined ? `Room ${roomId}` : style.label}</span>
          {joined && peersWithoutSelf.length > 0 && (
            <Badge variant="success" className="ms-0.5 px-1.5">
              <Users className="size-3" aria-hidden="true" />
              {peers.length}
            </Badge>
          )}
        </Button>
      </DialogTrigger>

      <DialogContent aria-label="Live session">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radio className="size-5 text-primary" aria-hidden="true" />
            Live session
          </DialogTitle>
          <DialogDescription>
            Join a room to sync captions, sounds, and WebRTC signals with others in real time.
          </DialogDescription>
        </DialogHeader>

        {!joined ? (
          <form onSubmit={handleJoin} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="room-code" className="text-sm font-medium">
                Room code
              </label>
              <input
                id="room-code"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase().slice(0, 64))}
                placeholder="e.g. CLINIC-1"
                className="h-11 w-full rounded-lg border border-border bg-background px-3 font-mono uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="display-name" className="text-sm font-medium">
                Display name
              </label>
              <input
                id="display-name"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 40))}
                placeholder={namePlaceholder}
                className="h-11 w-full rounded-lg border border-border bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="role" className="text-sm font-medium">
                Role
              </label>
              <select
                id="role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="h-11 w-full cursor-pointer rounded-lg border border-border bg-background px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="dhh">Deaf / Hard of Hearing</option>
                <option value="hearing">Hearing</option>
                <option value="interpreter">Interpreter</option>
              </select>
            </div>
            <Button type="submit" className="w-full" disabled={connectionState !== "open"}>
              {connectionState !== "open"
                ? `${style.label}…`
                : "Join room"}
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-secondary/50 p-3">
              <p className="text-xs text-muted-foreground">Room</p>
              <p className="font-mono text-lg font-bold tracking-widest">{roomId}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                You are <span className="font-medium text-foreground">{name.trim() || namePlaceholder}</span> · {role} ·{" "}
                <span className="font-mono">{clientId?.slice(0, 8)}</span>
              </p>
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium">
                Peers ({peers.length}/8)
              </p>
              {peersWithoutSelf.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-3 text-center text-sm text-muted-foreground">
                  Share room code <span className="font-mono font-bold">{roomId}</span> — open this
                  page in a second tab or window and join with it.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {peersWithoutSelf.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <span className="font-medium">{p.displayName}</span>
                      <Badge variant="secondary">{p.role}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Button type="button" variant="destructive" onClick={handleLeave} className="w-full">
              Leave room
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
