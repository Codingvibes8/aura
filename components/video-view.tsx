"use client";

import { useEffect, useRef } from "react";
import { VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";

/** Binds a MediaStream to a <video> element (peer-call local/remote views). */
export function VideoView({
  stream,
  label,
  muted = false,
  className,
}: {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.srcObject = stream;
  }, [stream]);

  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-border bg-black", className)}>
      {stream ? (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={muted}
          aria-label={label}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full min-h-28 flex-col items-center justify-center gap-2 text-muted-foreground" role="img" aria-label={`${label} — no video`}>
          <VideoOff className="size-6" aria-hidden="true" />
          <span className="text-xs">No video</span>
        </div>
      )}
      <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[0.65rem] font-medium text-white">
        {label}
      </span>
    </div>
  );
}
