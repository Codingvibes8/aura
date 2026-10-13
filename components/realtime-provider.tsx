"use client";

import * as React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SignalingClient, resolveSignalingUrl, type ConnectionState } from "@/lib/realtime/SignalingClient";
import type {
  ServerMessage,
  PeerInfo,
  CaptionPayload,
  AmbientPayload,
  Role,
} from "@/lib/realtime/schema";

interface RealtimeContextValue {
  connectionState: ConnectionState;
  clientId: string | null;
  peers: PeerInfo[];
  roomId: string | null;
  roomPrivate: boolean;
  join: (roomId: string, displayName: string, role: Role, makePrivate?: boolean) => void;
  leave: () => void;
  sendSignal: (targetId: string, data: unknown) => void;
  sendCaption: (caption: Omit<CaptionPayload, "seq">) => void;
  sendAmbient: (event: AmbientPayload) => void;
  sendAudio: (pcm: ArrayBuffer | Uint8Array, kind?: "stt" | "ambient") => void;
  startStt: (opts?: { lang?: string; keywords?: string[] }) => void;
  stopStt: () => void;
  startAmbient: () => void;
  stopAmbient: () => void;
  vrsRequest: (opts: { roomId?: string; language: string; priority: "standard" | "emergency"; displayName?: string; logConsent?: boolean }) => void;
  vrsCancel: () => void;
  vrsEnd: () => void;
  vrsSetAvailable: (available: boolean, languages: string[]) => void;
  vrsDecline: (requestId: string) => void;
  /** register a listener for inbound server messages; returns an unsubscribe fn */
  onMessage: (handler: (msg: ServerMessage) => void) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("closed");
  const [clientId, setClientId] = useState<string | null>(null);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomPrivate, setRoomPrivate] = useState(false);

  const clientRef = useRef<SignalingClient | null>(null);
  const handlersRef = useRef(new Set<(msg: ServerMessage) => void>());

  const dispatch = useCallback((msg: ServerMessage) => {
    // fan out to feature listeners (captions, ambient, signals…)
    handlersRef.current.forEach((h) => h(msg));

    // connection-level state
    switch (msg.type) {
      case "welcome":
        setClientId(msg.clientId);
        setPeers(msg.peers);
        setRoomId(msg.roomId);
        setRoomPrivate(msg.private);
        break;
      case "peer-joined":
        setPeers((prev) => [...prev.filter((p) => p.id !== msg.peer.id), msg.peer]);
        break;
      case "peer-left":
        setPeers((prev) => prev.filter((p) => p.id !== msg.peerId));
        break;
      case "room-state":
        setRoomId(msg.roomId);
        setRoomPrivate(msg.private);
        break;
      case "error":
        // surfaced to listeners; connection state untouched
        break;
      default:
        break;
    }
  }, []);

  useEffect(() => {
    const handlers = handlersRef.current;
    const client = new SignalingClient({
      url: resolveSignalingUrl(),
      onMessage: dispatch,
      onStateChange: setConnectionState,
    });
    clientRef.current = client;
    client.connect();
    return () => {
      client.disconnect();
      clientRef.current = null;
      handlers.clear();
    };
  }, [dispatch]);

  const join = useCallback((roomId: string, displayName: string, role: Role, makePrivate = false) => {
    clientRef.current?.join(roomId, displayName, role, makePrivate);
  }, []);

  const leave = useCallback(() => {
    clientRef.current?.leave();
    setClientId(null);
    setPeers([]);
    setRoomId(null);
    setRoomPrivate(false);
  }, []);

  const sendSignal = useCallback((targetId: string, data: unknown) => {
    clientRef.current?.sendSignal(targetId, data);
  }, []);

  const sendCaption = useCallback((caption: Omit<CaptionPayload, "seq">) => {
    clientRef.current?.sendCaption(caption);
  }, []);

  const sendAmbient = useCallback((event: AmbientPayload) => {
    clientRef.current?.sendAmbient(event);
  }, []);

  const sendAudio = useCallback((pcm: ArrayBuffer | Uint8Array, kind?: "stt" | "ambient") => {
    clientRef.current?.sendAudio(pcm, kind);
  }, []);

  const startStt = useCallback((opts?: { lang?: string; keywords?: string[] }) => {
    clientRef.current?.startStt(opts);
  }, []);

  const stopStt = useCallback(() => {
    clientRef.current?.stopStt();
  }, []);

  const startAmbient = useCallback(() => {
    clientRef.current?.startAmbient();
  }, []);

  const stopAmbient = useCallback(() => {
    clientRef.current?.stopAmbient();
  }, []);

  const vrsRequest = useCallback(
    (opts: { roomId?: string; language: string; priority: "standard" | "emergency"; displayName?: string; logConsent?: boolean }) => {
      clientRef.current?.vrsRequest(opts);
    },
    []
  );

  const vrsCancel = useCallback(() => {
    clientRef.current?.vrsCancel();
  }, []);

  const vrsEnd = useCallback(() => {
    clientRef.current?.vrsEnd();
  }, []);

  const vrsSetAvailable = useCallback((available: boolean, languages: string[]) => {
    clientRef.current?.vrsSetAvailable(available, languages);
  }, []);

  const vrsDecline = useCallback((requestId: string) => {
    clientRef.current?.vrsDecline(requestId);
  }, []);

  const onMessage = useCallback((handler: (msg: ServerMessage) => void) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      connectionState,
      clientId,
      peers,
      roomId,
      roomPrivate,
      join,
      leave,
      sendSignal,
      sendCaption,
      sendAmbient,
      sendAudio,
      startStt,
      stopStt,
      startAmbient,
      stopAmbient,
      vrsRequest,
      vrsCancel,
      vrsEnd,
      vrsSetAvailable,
      vrsDecline,
      onMessage,
    }),
    [connectionState, clientId, peers, roomId, roomPrivate, join, leave, sendSignal, sendCaption, sendAmbient, sendAudio, startStt, stopStt, startAmbient, stopAmbient, vrsRequest, vrsCancel, vrsEnd, vrsSetAvailable, vrsDecline, onMessage]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error("useRealtime must be used within <RealtimeProvider>");
  return ctx;
}
