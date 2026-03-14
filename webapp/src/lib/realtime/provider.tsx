import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  type RealtimeClientChannel,
  type RealtimeServerEvent,
  isRealtimeServerEvent,
} from "@shared/realtime";
import { API_BASE_URL } from "@/lib/api";
import { useAuth, useSession } from "@/lib/auth-client";
import type { Notification } from "@/types";
import {
  incrementUnreadCountCache,
  prependNotificationCache,
  setUnreadCountCache,
} from "./notifications-cache";

type RealtimeStatus = "idle" | "connecting" | "connected" | "degraded";
type RealtimeListener = (event: RealtimeServerEvent) => void;

type RealtimeContextValue = {
  status: RealtimeStatus;
  subscribeChannel: (channel: RealtimeClientChannel) => () => void;
  addEventListener: (listener: RealtimeListener) => () => void;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);
const configuredRealtimeFlag = import.meta.env.VITE_REALTIME_ENABLED?.trim().toLowerCase() ?? "";

function isRealtimeTransportEnabled(): boolean {
  if (configuredRealtimeFlag === "true") {
    return true;
  }
  if (configuredRealtimeFlag === "false") {
    return false;
  }
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return false;
  }

  const { hostname } = window.location;
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "0.0.0.0"
  );
}

function buildRealtimeUrl(): string {
  const baseUrl = new URL(API_BASE_URL);
  baseUrl.pathname = "/api/realtime/ws";
  baseUrl.search = "";
  baseUrl.hash = "";
  baseUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
  return baseUrl.toString();
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { hasLiveSession } = useAuth();
  const realtimeTransportEnabled = isRealtimeTransportEnabled();
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const listenersRef = useRef(new Set<RealtimeListener>());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectSessionKeyRef = useRef<string | null>(null);
  const channelRefCounts = useRef(new Map<RealtimeClientChannel, number>());
  const sessionUserId = session?.user?.id ?? null;
  const hasRealtimeSession = Boolean(sessionUserId && hasLiveSession);

  const applyGlobalEvent = useCallback(
    (event: RealtimeServerEvent) => {
      if (!sessionUserId) {
        return;
      }

      if (event.type === "notification.created" && event.notification.userId === sessionUserId) {
        prependNotificationCache(queryClient, sessionUserId, event.notification as Notification);
        if (!event.notification.read) {
          incrementUnreadCountCache(queryClient, sessionUserId, 1);
        }
      }

      if (event.type === "notification.unread_count" && event.userId === sessionUserId) {
        setUnreadCountCache(queryClient, sessionUserId, event.count);
      }
    },
    [queryClient, sessionUserId]
  );

  const dispatchEvent = useCallback(
    (event: RealtimeServerEvent) => {
      applyGlobalEvent(event);
      for (const listener of listenersRef.current) {
        listener(event);
      }
    },
    [applyGlobalEvent]
  );

  const sendMessage = useCallback((payload: unknown) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(payload));
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const subscribeChannel = useCallback(
    (channel: RealtimeClientChannel) => {
      const currentCount = channelRefCounts.current.get(channel) ?? 0;
      channelRefCounts.current.set(channel, currentCount + 1);
      if (currentCount === 0) {
        sendMessage({ type: "subscribe", channel });
      }

      return () => {
        const nextCount = (channelRefCounts.current.get(channel) ?? 1) - 1;
        if (nextCount <= 0) {
          channelRefCounts.current.delete(channel);
          sendMessage({ type: "unsubscribe", channel });
          return;
        }
        channelRefCounts.current.set(channel, nextCount);
      };
    },
    [sendMessage]
  );

  const addEventListener = useCallback((listener: RealtimeListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!realtimeTransportEnabled || !hasRealtimeSession || !sessionUserId) {
      clearReconnectTimer();
      reconnectAttemptRef.current = 0;
      reconnectSessionKeyRef.current = null;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setStatus("idle");
      return;
    }

    const sessionKey = `${sessionUserId}:${hasLiveSession ? "live" : "cached"}`;
    reconnectSessionKeyRef.current = sessionKey;
    let cancelled = false;

    const connect = () => {
      if (cancelled) {
        return;
      }

      setStatus((prev) => (prev === "connected" ? prev : "connecting"));
      const socket = new WebSocket(buildRealtimeUrl());
      wsRef.current = socket;

      socket.onopen = () => {
        reconnectAttemptRef.current = 0;
      };

      socket.onmessage = (message) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(message.data);
        } catch {
          return;
        }

        if (!isRealtimeServerEvent(parsed)) {
          return;
        }

        if (parsed.type === "system.connected") {
          setStatus(parsed.degraded ? "degraded" : "connected");
          for (const channel of channelRefCounts.current.keys()) {
            socket.send(JSON.stringify({ type: "subscribe", channel }));
          }
        } else if (parsed.type === "system.ping") {
          setStatus((prev) => (prev === "degraded" ? prev : "connected"));
        }

        dispatchEvent(parsed);
      };

      socket.onerror = () => {
        setStatus("degraded");
      };

      socket.onclose = () => {
        if (wsRef.current === socket) {
          wsRef.current = null;
        }
        if (cancelled || reconnectSessionKeyRef.current !== sessionKey) {
          return;
        }
        reconnectAttemptRef.current += 1;
        setStatus(reconnectAttemptRef.current >= 2 ? "degraded" : "connecting");
        clearReconnectTimer();
        const delayMs = Math.min(1000 * 2 ** (reconnectAttemptRef.current - 1), 10_000);
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, delayMs);
      };
    };

    connect();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [
    clearReconnectTimer,
    dispatchEvent,
    hasLiveSession,
    hasRealtimeSession,
    realtimeTransportEnabled,
    sessionUserId,
  ]);

  useEffect(() => {
    if (status !== "connected") {
      return;
    }

    const pingIntervalId = window.setInterval(() => {
      sendMessage({ type: "system.ping" });
    }, 25_000);

    return () => {
      window.clearInterval(pingIntervalId);
    };
  }, [sendMessage, status]);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      status,
      subscribeChannel,
      addEventListener,
    }),
    [addEventListener, status, subscribeChannel]
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error("useRealtime must be used within RealtimeProvider");
  }
  return context;
}

export function useRealtimeEventListener(listener: RealtimeListener): void {
  const { addEventListener } = useRealtime();
  const listenerRef = useRef(listener);

  useEffect(() => {
    listenerRef.current = listener;
  }, [listener]);

  useEffect(() => {
    return addEventListener((event) => listenerRef.current(event));
  }, [addEventListener]);
}

export function useRealtimeChannels(
  channels: RealtimeClientChannel[],
  enabled = true
): void {
  const { subscribeChannel } = useRealtime();
  const channelKey = channels.join("|");

  useEffect(() => {
    if (!enabled || channelKey.length === 0) {
      return;
    }

    const unsubscribers = channels.map((channel) => subscribeChannel(channel));
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [channelKey, enabled, subscribeChannel]);
}
