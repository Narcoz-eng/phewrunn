import net from "node:net";
import tls from "node:tls";
import { randomUUID } from "node:crypto";
import {
  type RealtimeClientChannel,
  type RealtimeClientMessage,
  type RealtimeEventInput,
  type RealtimeServerEvent,
  type RealtimeTopic,
  parseRealtimeClientMessage,
} from "../../../shared/realtime.js";
import { redisPublish } from "./redis.js";

type SocketContext = {
  raw: unknown;
  send(source: string): void;
  close(code?: number, reason?: string): void;
};

type RealtimeConnection = {
  id: string;
  userId: string;
  socket: SocketContext;
  channels: Set<RealtimeClientChannel>;
  topics: Set<RealtimeTopic>;
  connectedAtMs: number;
  lastSeenAtMs: number;
};

type RespValue = string | number | null | RespValue[];

type PubSubEnvelope = {
  origin: string;
  topic: RealtimeTopic;
  event: RealtimeServerEvent;
};

const REALTIME_PUBSUB_PATTERN = "realtime:*";
const REALTIME_PUBSUB_PREFIX = "realtime:";
const REDIS_TCP_URL = process.env.REDIS_URL?.trim() || null;
const REALTIME_INSTANCE_ID =
  process.env.REALTIME_INSTANCE_ID?.trim() || randomUUID().slice(0, 12);
const REDIS_SUBSCRIBER_CONNECT_TIMEOUT_MS = 2_000;
const REDIS_SUBSCRIBER_COMMAND_TIMEOUT_MS = 6_000;
const REDIS_SUBSCRIBER_RECONNECT_BASE_MS = 1_000;
const REDIS_SUBSCRIBER_RECONNECT_MAX_MS = 12_000;
const REALTIME_SLOW_FANOUT_WARN_MS =
  Number.parseInt(process.env.REALTIME_SLOW_FANOUT_WARN_MS || "", 10) ||
  (process.env.NODE_ENV === "production" ? 40 : 80);

const connections = new Map<string, RealtimeConnection>();
const topicSubscriptions = new Map<RealtimeTopic, Set<string>>();
let redisSubscriberSocket: net.Socket | tls.TLSSocket | null = null;
let redisSubscriberBuffer = Buffer.alloc(0);
let redisSubscriberReady = false;
let redisSubscriberReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let redisSubscriberReconnectAttempt = 0;
let redisSubscriberStarting = false;
let redisSubscriberLastError: string | null = null;

function logRealtime(message: string, extra?: Record<string, unknown>): void {
  console.info("[realtime]", { message, ...extra });
}

function warnRealtime(message: string, extra?: Record<string, unknown>): void {
  console.warn("[realtime]", { message, ...extra });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function topicForUser(userId: string): RealtimeTopic {
  return `user:${userId}`;
}

function topicForChannel(userId: string, channel: RealtimeClientChannel): RealtimeTopic {
  if (channel === "feed.latest") {
    return "feed:latest";
  }
  return `feed:following:${userId}`;
}

function encodeRespCommand(args: Array<string | number>): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`, "utf8")];
  for (const arg of args) {
    const value = String(arg);
    const valueBuffer = Buffer.from(value, "utf8");
    parts.push(Buffer.from(`$${valueBuffer.length}\r\n`, "utf8"));
    parts.push(valueBuffer);
    parts.push(Buffer.from("\r\n", "utf8"));
  }
  return Buffer.concat(parts);
}

function parseRespValue(
  buffer: Buffer,
  start = 0
): { value: RespValue; nextOffset: number } | null {
  if (start >= buffer.length) {
    return null;
  }

  const firstByte = buffer[start];
  if (typeof firstByte !== "number") {
    return null;
  }

  const prefix = String.fromCharCode(firstByte);
  const readLine = (offset: number): { line: string; nextOffset: number } | null => {
    const end = buffer.indexOf("\r\n", offset);
    if (end === -1) {
      return null;
    }
    return {
      line: buffer.toString("utf8", offset, end),
      nextOffset: end + 2,
    };
  };

  const header = readLine(start + 1);
  if (!header) {
    return null;
  }

  if (prefix === "+") {
    return { value: header.line, nextOffset: header.nextOffset };
  }

  if (prefix === "-") {
    throw new Error(header.line);
  }

  if (prefix === ":") {
    const parsed = Number(header.line);
    return { value: Number.isFinite(parsed) ? parsed : 0, nextOffset: header.nextOffset };
  }

  if (prefix === "$") {
    const length = Number(header.line);
    if (length === -1) {
      return { value: null, nextOffset: header.nextOffset };
    }
    if (!Number.isFinite(length) || length < 0) {
      throw new Error(`Invalid bulk string length: ${header.line}`);
    }
    const end = header.nextOffset + length;
    if (buffer.length < end + 2) {
      return null;
    }
    return {
      value: buffer.toString("utf8", header.nextOffset, end),
      nextOffset: end + 2,
    };
  }

  if (prefix === "*") {
    const count = Number(header.line);
    if (count === -1) {
      return { value: null, nextOffset: header.nextOffset };
    }
    if (!Number.isFinite(count) || count < 0) {
      throw new Error(`Invalid array length: ${header.line}`);
    }
    let offset = header.nextOffset;
    const items: RespValue[] = [];
    for (let index = 0; index < count; index += 1) {
      const nested = parseRespValue(buffer, offset);
      if (!nested) {
        return null;
      }
      items.push(nested.value);
      offset = nested.nextOffset;
    }
    return {
      value: items,
      nextOffset: offset,
    };
  }

  throw new Error(`Unsupported RESP prefix: ${prefix}`);
}

function createRedisSubscriberSocket(url: URL): Promise<net.Socket | tls.TLSSocket> {
  const port = Number(url.port || "6379");
  const host = url.hostname;
  const useTls = url.protocol === "rediss:";

  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = useTls
      ? tls.connect({
          host,
          port,
          servername: host,
        })
      : net.createConnection({ host, port });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy(new Error("Redis realtime subscriber connect timeout"));
      reject(new Error("Redis realtime subscriber connect timeout"));
    }, REDIS_SUBSCRIBER_CONNECT_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timer);
      socket.off("error", onError);
      socket.off("connect", onConnect);
      if (socket instanceof tls.TLSSocket) {
        socket.off("secureConnect", onConnect);
      }
    };

    const onError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onConnect = () => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.setTimeout(REDIS_SUBSCRIBER_COMMAND_TIMEOUT_MS);
      resolve(socket);
    };

    socket.on("error", onError);
    if (useTls) {
      (socket as tls.TLSSocket).on("secureConnect", onConnect);
    } else {
      socket.on("connect", onConnect);
    }
  });
}

async function writeResp(socket: net.Socket | tls.TLSSocket, args: Array<string | number>): Promise<void> {
  const payload = encodeRespCommand(args);
  await new Promise<void>((resolve, reject) => {
    socket.write(payload, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function addTopicSubscription(topic: RealtimeTopic, connectionId: string): void {
  const current = topicSubscriptions.get(topic) ?? new Set<string>();
  current.add(connectionId);
  topicSubscriptions.set(topic, current);
}

function removeTopicSubscription(topic: RealtimeTopic, connectionId: string): void {
  const current = topicSubscriptions.get(topic);
  if (!current) return;
  current.delete(connectionId);
  if (current.size === 0) {
    topicSubscriptions.delete(topic);
  }
}

function sendEventToConnection(connection: RealtimeConnection, event: RealtimeServerEvent): void {
  try {
    connection.socket.send(JSON.stringify(event));
    connection.lastSeenAtMs = Date.now();
  } catch (error) {
    warnRealtime("failed to send websocket event", {
      connectionId: connection.id,
      userId: connection.userId,
      type: event.type,
      message: error instanceof Error ? error.message : String(error),
    });
    unregisterRealtimeConnection(connection.id);
  }
}

function broadcastTopicLocally(topic: RealtimeTopic, event: RealtimeServerEvent): void {
  const startedAt = Date.now();
  const subscribedConnectionIds = topicSubscriptions.get(topic);
  if (!subscribedConnectionIds || subscribedConnectionIds.size === 0) {
    return;
  }

  for (const connectionId of subscribedConnectionIds) {
    const connection = connections.get(connectionId);
    if (!connection) {
      continue;
    }
    sendEventToConnection(connection, event);
  }

  const durationMs = Date.now() - startedAt;
  if (durationMs >= REALTIME_SLOW_FANOUT_WARN_MS) {
    warnRealtime("slow local realtime fanout", {
      topic,
      type: event.type,
      connectionCount: subscribedConnectionIds.size,
      durationMs,
    });
  }
}

function scheduleRedisSubscriberReconnect(): void {
  if (!REDIS_TCP_URL || redisSubscriberReconnectTimer) {
    return;
  }

  const delayMs = Math.min(
    REDIS_SUBSCRIBER_RECONNECT_BASE_MS * Math.max(1, 2 ** redisSubscriberReconnectAttempt),
    REDIS_SUBSCRIBER_RECONNECT_MAX_MS
  );
  redisSubscriberReconnectTimer = setTimeout(() => {
    redisSubscriberReconnectTimer = null;
    redisSubscriberReconnectAttempt += 1;
    void ensureRealtimeRedisSubscriber();
  }, delayMs);
}

function teardownRedisSubscriber(reason: string, error?: unknown): void {
  if (redisSubscriberSocket) {
    redisSubscriberSocket.removeAllListeners();
    redisSubscriberSocket.destroy();
    redisSubscriberSocket = null;
  }
  redisSubscriberBuffer = Buffer.alloc(0);
  redisSubscriberReady = false;
  redisSubscriberLastError =
    error instanceof Error ? error.message : typeof error === "string" ? error : reason;
  warnRealtime("redis realtime subscriber unavailable", {
    reason,
    error: redisSubscriberLastError,
  });
  scheduleRedisSubscriberReconnect();
}

function handleRedisPubSubPayload(payload: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return;
  }
  if (!isRecord(parsed)) {
    return;
  }
  const topic = parsed.topic;
  const origin = parsed.origin;
  const event = parsed.event;
  if (
    typeof topic !== "string" ||
    !topic.startsWith("user:") &&
      topic !== "feed:latest" &&
      !topic.startsWith("feed:following:")
  ) {
    return;
  }
  if (origin === REALTIME_INSTANCE_ID) {
    return;
  }
  if (!isRecord(event) || typeof event.type !== "string") {
    return;
  }

  broadcastTopicLocally(topic as RealtimeTopic, event as RealtimeServerEvent);
}

function processRedisSubscriberBuffer(): void {
  while (redisSubscriberBuffer.length > 0) {
    let parsed: { value: RespValue; nextOffset: number } | null = null;
    try {
      parsed = parseRespValue(redisSubscriberBuffer, 0);
    } catch (error) {
      teardownRedisSubscriber("parse_failure", error);
      return;
    }

    if (!parsed) {
      return;
    }

    redisSubscriberBuffer = redisSubscriberBuffer.subarray(parsed.nextOffset);
    const value = parsed.value;
    if (!Array.isArray(value) || value.length < 3) {
      continue;
    }

    const kind = value[0];
    if (kind === "psubscribe") {
      redisSubscriberReady = true;
      redisSubscriberReconnectAttempt = 0;
      logRealtime("redis realtime subscriber ready", {
        pattern: value[1],
      });
      continue;
    }

    if (kind === "pmessage" && typeof value[3] === "string") {
      handleRedisPubSubPayload(value[3]);
    }
  }
}

async function ensureRealtimeRedisSubscriber(): Promise<void> {
  if (!REDIS_TCP_URL || redisSubscriberStarting || redisSubscriberSocket) {
    return;
  }

  let url: URL;
  try {
    url = new URL(REDIS_TCP_URL);
  } catch {
    warnRealtime("invalid REDIS_URL for realtime pubsub");
    return;
  }
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    warnRealtime("unsupported REDIS_URL protocol for realtime pubsub", {
      protocol: url.protocol,
    });
    return;
  }

  redisSubscriberStarting = true;
  try {
    const socket = await createRedisSubscriberSocket(url);
    const username = decodeURIComponent(url.username || "");
    const password = decodeURIComponent(url.password || "");

    if (password) {
      await writeResp(
        socket,
        username && username !== "default"
          ? ["AUTH", username, password]
          : ["AUTH", password]
      );
    }

    if (url.pathname && url.pathname !== "/") {
      const dbIndex = Number(url.pathname.replace("/", ""));
      if (Number.isFinite(dbIndex) && dbIndex >= 0) {
        await writeResp(socket, ["SELECT", dbIndex]);
      }
    }

    await writeResp(socket, ["PSUBSCRIBE", REALTIME_PUBSUB_PATTERN]);
    socket.on("data", (chunk: Buffer) => {
      redisSubscriberBuffer = Buffer.concat([redisSubscriberBuffer, chunk]);
      processRedisSubscriberBuffer();
    });
    socket.on("error", (error) => {
      teardownRedisSubscriber("socket_error", error);
    });
    socket.on("close", () => {
      teardownRedisSubscriber("socket_closed");
    });
    redisSubscriberSocket = socket;
  } catch (error) {
    teardownRedisSubscriber("connect_failed", error);
  } finally {
    redisSubscriberStarting = false;
  }
}

function buildRealtimePubSubChannel(topic: RealtimeTopic): string {
  return `${REALTIME_PUBSUB_PREFIX}${topic}`;
}

function buildRealtimeEvent(event: RealtimeEventInput): RealtimeServerEvent {
  return {
    ...event,
    eventId: randomUUID(),
    sentAt: new Date().toISOString(),
  };
}

async function publishPubSubEnvelope(topic: RealtimeTopic, event: RealtimeServerEvent): Promise<void> {
  const envelope: PubSubEnvelope = {
    origin: REALTIME_INSTANCE_ID,
    topic,
    event,
  };
  await redisPublish(buildRealtimePubSubChannel(topic), JSON.stringify(envelope));
}

export function registerRealtimeConnection(params: {
  connectionId?: string;
  userId: string;
  socket: SocketContext;
}): string {
  const connectionId = params.connectionId || randomUUID();
  const connection: RealtimeConnection = {
    id: connectionId,
    userId: params.userId,
    socket: params.socket,
    channels: new Set<RealtimeClientChannel>(),
    topics: new Set<RealtimeTopic>(),
    connectedAtMs: Date.now(),
    lastSeenAtMs: Date.now(),
  };

  connections.set(connectionId, connection);
  const userTopic = topicForUser(params.userId);
  addTopicSubscription(userTopic, connectionId);
  connection.topics.add(userTopic);
  if (REDIS_TCP_URL) {
    void ensureRealtimeRedisSubscriber();
  }
  logRealtime("websocket connected", {
    connectionId,
    userId: params.userId,
    activeConnections: connections.size,
  });
  return connectionId;
}

export function unregisterRealtimeConnection(connectionId: string): void {
  const connection = connections.get(connectionId);
  if (!connection) {
    return;
  }

  for (const topic of connection.topics) {
    removeTopicSubscription(topic, connectionId);
  }
  connections.delete(connectionId);
  logRealtime("websocket disconnected", {
    connectionId,
    userId: connection.userId,
    activeConnections: connections.size,
    connectedForMs: Date.now() - connection.connectedAtMs,
  });
}

export function subscribeRealtimeChannel(
  connectionId: string,
  channel: RealtimeClientChannel
): void {
  const connection = connections.get(connectionId);
  if (!connection) {
    return;
  }

  const topic = topicForChannel(connection.userId, channel);
  connection.channels.add(channel);
  connection.topics.add(topic);
  addTopicSubscription(topic, connectionId);
}

export function unsubscribeRealtimeChannel(
  connectionId: string,
  channel: RealtimeClientChannel
): void {
  const connection = connections.get(connectionId);
  if (!connection) {
    return;
  }

  const topic = topicForChannel(connection.userId, channel);
  connection.channels.delete(channel);
  connection.topics.delete(topic);
  removeTopicSubscription(topic, connectionId);
}

export function handleRealtimeClientMessage(
  connectionId: string,
  rawMessage: string
): RealtimeClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    return null;
  }

  const message = parseRealtimeClientMessage(parsed);
  if (!message) {
    return null;
  }

  if (message.type === "subscribe") {
    subscribeRealtimeChannel(connectionId, message.channel);
  } else if (message.type === "unsubscribe") {
    unsubscribeRealtimeChannel(connectionId, message.channel);
  }
  return message;
}

export function getRealtimeConnectedEvent(params: {
  connectionId: string;
  channels?: RealtimeClientChannel[];
}): RealtimeServerEvent {
  return buildRealtimeEvent({
    type: "system.connected",
    connectionId: params.connectionId,
    degraded: Boolean(REDIS_TCP_URL) && !redisSubscriberReady,
    channels: params.channels ?? [],
  });
}

export function getRealtimePingEvent(connectionId: string): RealtimeServerEvent {
  return buildRealtimeEvent({
    type: "system.ping",
    connectionId,
  });
}

export async function publishRealtimeEvent(params: {
  topics: RealtimeTopic[];
  event: RealtimeEventInput;
}): Promise<void> {
  const event = buildRealtimeEvent(params.event);
  const uniqueTopics = new Set(params.topics);
  for (const topic of uniqueTopics) {
    broadcastTopicLocally(topic, event);
  }

  if (!REDIS_TCP_URL) {
    return;
  }

  await Promise.allSettled(
    Array.from(uniqueTopics).map((topic) => publishPubSubEnvelope(topic, event))
  );
}

export function getRealtimeStateSnapshot(): {
  instanceId: string;
  activeConnections: number;
  redisSubscriberReady: boolean;
  redisSubscriberLastError: string | null;
} {
  return {
    instanceId: REALTIME_INSTANCE_ID,
    activeConnections: connections.size,
    redisSubscriberReady,
    redisSubscriberLastError,
  };
}
