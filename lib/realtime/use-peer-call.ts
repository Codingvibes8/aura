"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime } from "@/components/realtime-provider";

/**
 * Minimal 1:1 WebRTC video call (Phase 5.3 VRS).
 *
 * Signaling travels over the existing room channel (`signal` messages);
 * media is peer-to-peer with a public STUN server for NAT traversal.
 * Same-machine and same-LAN calls work out of the box; symmetric NATs
 * need a TURN server (Phase 8 hardening).
 *
 * The caller creates the offer; the callee answers on first offer.
 * Only the first remote peer is wired for video — additional room peers
 * stay caption-only (mesh is future work).
 */

export type CallState = "idle" | "calling" | "in-call" | "error";

const STUN_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export function usePeerCall() {
  const { sendSignal, onMessage, clientId } = useRealtime();
  const [callState, setCallState] = useState<CallState>("idle");
  const [remotePeerId, setRemotePeerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const stateRef = useRef<CallState>("idle");

  useEffect(() => {
    stateRef.current = callState;
  }, [callState]);

  const teardown = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setRemotePeerId(null);
  }, []);

  const ensurePeerConnection = useCallback(
    (targetId: string, stream: MediaStream) => {
      if (pcRef.current) return pcRef.current;
      const pc = new RTCPeerConnection(STUN_SERVERS);
      pcRef.current = pc;
      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }
      pc.ontrack = (event) => {
        const [incoming] = event.streams;
        if (incoming) setRemoteStream(incoming);
      };
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal(targetId, { candidate: event.candidate });
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") setCallState("in-call");
        else if (pc.connectionState === "failed") {
          setError("Video connection failed — a TURN server may be required on this network.");
          setCallState("error");
        }
      };
      return pc;
    },
    [sendSignal]
  );

  const startLocalMedia = useCallback(async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localRef.current = stream;
      setLocalStream(stream);
      return stream;
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Camera/microphone access denied."
          : "Could not start camera/microphone."
      );
      setCallState("error");
      return null;
    }
  }, []);

  /** Interpreter side: warm up the camera before / without an offer. */
  const preview = useCallback(async () => {
    setError(null);
    return startLocalMedia();
  }, [startLocalMedia]);

  /** Caller side: ring a specific peer with a video offer. */
  const call = useCallback(
    async (targetId: string) => {
      setError(null);
      setCallState("calling");
      setRemotePeerId(targetId);
      const stream = await startLocalMedia();
      if (!stream) return;
      try {
        const pc = ensurePeerConnection(targetId, stream);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal(targetId, { sdp: pc.localDescription });
      } catch {
        setError("Could not create the video offer.");
        setCallState("error");
      }
    },
    [ensurePeerConnection, sendSignal, startLocalMedia]
  );

  const hangUp = useCallback(() => {
    teardown();
    setCallState("idle");
    setError(null);
  }, [teardown]);

  /* Callee side: answer inbound offers, apply answers + ICE */
  useEffect(() => {
    return onMessage((msg) => {
      if (msg.type !== "signal") return;
      const fromId = msg.fromId;
      const data = msg.data as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } | null;
      if (!data || fromId === clientId) return;

      const handle = async () => {
        try {
          if (data.sdp) {
            // Inbound offer → answer it (callee). Inbound answer → apply (caller).
            if (data.sdp.type === "offer") {
              setRemotePeerId(fromId);
              let stream = localRef.current;
              if (!stream) {
                stream = await startLocalMedia();
                if (!stream) return;
              }
              const pc = ensurePeerConnection(fromId, stream);
              await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              sendSignal(fromId, { sdp: pc.localDescription });
              setCallState("in-call");
            } else if (data.sdp.type === "answer") {
              if (pcRef.current && stateRef.current !== "idle") {
                await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
              }
            }
          } else if (data.candidate) {
            if (pcRef.current && stateRef.current !== "idle") {
              await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => undefined);
            }
          }
        } catch {
          setError("Video negotiation failed.");
          setCallState("error");
        }
      };
      void handle();
    });
  }, [onMessage, clientId, ensurePeerConnection, sendSignal, startLocalMedia]);

  useEffect(() => teardown, [teardown]);

  return { callState, remotePeerId, error, localStream, remoteStream, call, hangUp, preview };
}
