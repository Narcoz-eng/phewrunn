import WebSocket from "ws";

const DEFAULT_BASE_URL = "https://phewrunn.vercel.app";
const DEFAULT_TOKEN_ADDRESS = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const DEFAULT_CHAIN_TYPE = "solana";
const DEFAULT_RUNS = 5;
const DEFAULT_CHURN_RUNS = 8;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_STABILITY_MS = 20_000;

const BASE_URL = process.env.LIVE_PANEL_BENCH_BASE_URL?.trim() || DEFAULT_BASE_URL;
const TOKEN_ADDRESS = process.env.LIVE_PANEL_BENCH_TOKEN_ADDRESS?.trim() || DEFAULT_TOKEN_ADDRESS;
const CHAIN_TYPE = process.env.LIVE_PANEL_BENCH_CHAIN_TYPE?.trim() || DEFAULT_CHAIN_TYPE;
const HELIUS_WSS_URL = process.env.LIVE_PANEL_BENCH_HELIUS_WSS_URL?.trim() || null;
const RUNS = parsePositiveInt(process.env.LIVE_PANEL_BENCH_RUNS, DEFAULT_RUNS);
const CHURN_RUNS = parsePositiveInt(process.env.LIVE_PANEL_BENCH_CHURN_RUNS, DEFAULT_CHURN_RUNS);
const TIMEOUT_MS = parsePositiveInt(process.env.LIVE_PANEL_BENCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
const STABILITY_MS = parsePositiveInt(process.env.LIVE_PANEL_BENCH_STABILITY_MS, DEFAULT_STABILITY_MS);

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarize(values) {
  return {
    count: values.length,
    avgMs: average(values),
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    minMs: values.length ? Math.min(...values) : null,
    maxMs: values.length ? Math.max(...values) : null,
  };
}

function buildPanelLiveUrl() {
  const query = new URLSearchParams({
    tokenAddress: TOKEN_ADDRESS,
    chainType: CHAIN_TYPE,
  });
  return `${BASE_URL}/api/posts/chart/live?${query.toString()}`;
}

function buildPanelTradesUrl() {
  const query = new URLSearchParams({
    tokenAddress: TOKEN_ADDRESS,
    chainType: CHAIN_TYPE,
    limit: "10",
  });
  return `${BASE_URL}/api/posts/chart/trades?${query.toString()}`;
}

async function runPanelColdStart(timeoutMs) {
  const startedAtMs = Date.now();
  const response = await fetch(buildPanelLiveUrl(), {
    headers: {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Panel SSE request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let firstTradeVisibleAtMs = null;
  let firstCandleSignalAtMs = null;
  const tradeTransportLagMs = [];
  let reconnectCount = 0;
  let lastStatus = null;

  const close = async () => {
    try {
      await reader.cancel();
    } catch {}
  };

  try {
    while (Date.now() - startedAtMs <= timeoutMs) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex >= 0) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        separatorIndex = buffer.indexOf("\n\n");

        const parsed = parseSseEvent(rawEvent);
        if (!parsed) {
          continue;
        }

        if (parsed.event === "status" && parsed.data) {
          lastStatus = parsed.data;
          if (parsed.data.connected === false) {
            reconnectCount += 1;
          }
        }

        if (parsed.event === "snapshot" && parsed.data) {
          const trades = Array.isArray(parsed.data.trades) ? parsed.data.trades : [];
          const latestPrice = parsed.data.latestPrice ?? null;
          if (!firstTradeVisibleAtMs && trades.length > 0) {
            firstTradeVisibleAtMs = Date.now();
          }
          if (!firstCandleSignalAtMs && (latestPrice || trades.some((trade) => Number.isFinite(trade?.priceUsd)))) {
            firstCandleSignalAtMs = Date.now();
          }
          for (const trade of trades) {
            if (Number.isFinite(trade?.receivedAtMs)) {
              tradeTransportLagMs.push(Date.now() - trade.receivedAtMs);
            }
          }
        }

        if (parsed.event === "trade" && parsed.data) {
          if (!firstTradeVisibleAtMs) {
            firstTradeVisibleAtMs = Date.now();
          }
          if (!firstCandleSignalAtMs && Number.isFinite(parsed.data.priceUsd)) {
            firstCandleSignalAtMs = Date.now();
          }
          if (Number.isFinite(parsed.data.receivedAtMs)) {
            tradeTransportLagMs.push(Date.now() - parsed.data.receivedAtMs);
          }
        }

        if (parsed.event === "price" && parsed.data && !firstCandleSignalAtMs) {
          firstCandleSignalAtMs = Date.now();
        }

        if (firstTradeVisibleAtMs && firstCandleSignalAtMs) {
          return {
            firstTradeVisibleMs: firstTradeVisibleAtMs - startedAtMs,
            firstCandleSignalMs: firstCandleSignalAtMs - startedAtMs,
            tradeTransportLagSummary: summarize(tradeTransportLagMs),
            reconnectCount,
            lastStatus,
          };
        }
      }
    }
  } finally {
    await close();
  }

  return {
    firstTradeVisibleMs: firstTradeVisibleAtMs ? firstTradeVisibleAtMs - startedAtMs : null,
    firstCandleSignalMs: firstCandleSignalAtMs ? firstCandleSignalAtMs - startedAtMs : null,
    tradeTransportLagSummary: summarize(tradeTransportLagMs),
    reconnectCount,
    lastStatus,
  };
}

async function runPanelStability(windowMs) {
  const startedAtMs = Date.now();
  const response = await fetch(buildPanelLiveUrl(), {
    headers: {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Panel SSE request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let tradeEvents = 0;
  let priceEvents = 0;
  let reconnectCount = 0;
  let firstTradeVisibleAtMs = null;
  const tradeInterArrivalMs = [];
  const priceInterArrivalMs = [];
  let lastTradeArrivalAtMs = null;
  let lastPriceArrivalAtMs = null;
  const tradeTransportLagMs = [];

  const close = async () => {
    try {
      await reader.cancel();
    } catch {}
  };

  try {
    while (Date.now() - startedAtMs <= windowMs) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex >= 0) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        separatorIndex = buffer.indexOf("\n\n");

        const parsed = parseSseEvent(rawEvent);
        if (!parsed) {
          continue;
        }

        const nowMs = Date.now();
        if (parsed.event === "status" && parsed.data?.connected === false) {
          reconnectCount += 1;
        }

        if (parsed.event === "snapshot" && parsed.data) {
          const trades = Array.isArray(parsed.data.trades) ? parsed.data.trades : [];
          const latestPrice = parsed.data.latestPrice ?? null;
          if (!firstTradeVisibleAtMs && trades.length > 0) {
            firstTradeVisibleAtMs = nowMs;
          }
          if (trades.length > 0) {
            tradeEvents += trades.length;
            for (const trade of trades) {
              if (lastTradeArrivalAtMs !== null) {
                tradeInterArrivalMs.push(nowMs - lastTradeArrivalAtMs);
              }
              lastTradeArrivalAtMs = nowMs;
              if (Number.isFinite(trade?.receivedAtMs)) {
                tradeTransportLagMs.push(nowMs - trade.receivedAtMs);
              }
            }
          }
          if (latestPrice) {
            priceEvents += 1;
            if (lastPriceArrivalAtMs !== null) {
              priceInterArrivalMs.push(nowMs - lastPriceArrivalAtMs);
            }
            lastPriceArrivalAtMs = nowMs;
          }
        }

        if (parsed.event === "trade" && parsed.data) {
          if (!firstTradeVisibleAtMs) {
            firstTradeVisibleAtMs = nowMs;
          }
          tradeEvents += 1;
          if (lastTradeArrivalAtMs !== null) {
            tradeInterArrivalMs.push(nowMs - lastTradeArrivalAtMs);
          }
          lastTradeArrivalAtMs = nowMs;
          if (Number.isFinite(parsed.data.receivedAtMs)) {
            tradeTransportLagMs.push(nowMs - parsed.data.receivedAtMs);
          }
        }

        if (parsed.event === "price" && parsed.data) {
          priceEvents += 1;
          if (lastPriceArrivalAtMs !== null) {
            priceInterArrivalMs.push(nowMs - lastPriceArrivalAtMs);
          }
          lastPriceArrivalAtMs = nowMs;
        }
      }
    }
  } finally {
    await close();
  }

  return {
    firstTradeVisibleMs: firstTradeVisibleAtMs ? firstTradeVisibleAtMs - startedAtMs : null,
    tradeEvents,
    priceEvents,
    reconnectCount,
    tradeInterArrivalSummary: summarize(tradeInterArrivalMs),
    priceInterArrivalSummary: summarize(priceInterArrivalMs),
    tradeTransportLagSummary: summarize(tradeTransportLagMs),
  };
}

function parseSseEvent(rawEvent) {
  const lines = rawEvent.split(/\r?\n/);
  let event = "message";
  const dataLines = [];
  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (!dataLines.length) {
    return null;
  }

  try {
    return {
      event,
      data: JSON.parse(dataLines.join("\n")),
    };
  } catch {
    return null;
  }
}

async function runHeliusColdStart(timeoutMs, mode) {
  if (!HELIUS_WSS_URL) {
    return null;
  }

  return await new Promise((resolve, reject) => {
    const startedAtMs = Date.now();
    const ws = new WebSocket(HELIUS_WSS_URL);
    let settled = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {}
      resolve(payload);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {}
      reject(error);
    };

    const timeout = setTimeout(() => {
      finish({
        firstEventMs: null,
        eventCount: 0,
      });
    }, timeoutMs);

    ws.on("open", () => {
      ws.send(JSON.stringify(buildHeliusSubscriptionMessage(mode)));
    });

    ws.on("message", (buffer) => {
      try {
        const payload = JSON.parse(buffer.toString());
        if (isHeliusNotification(payload, mode)) {
          clearTimeout(timeout);
          finish({
            firstEventMs: Date.now() - startedAtMs,
            eventCount: 1,
          });
          return;
        }
      } catch {}
    });

    ws.on("error", fail);
    ws.on("close", () => {
      clearTimeout(timeout);
      if (!settled) {
        finish({
          firstEventMs: null,
          eventCount: 0,
        });
      }
    });
  });
}

async function runHeliusStability(windowMs, mode) {
  if (!HELIUS_WSS_URL) {
    return null;
  }

  return await new Promise((resolve, reject) => {
    const startedAtMs = Date.now();
    const ws = new WebSocket(HELIUS_WSS_URL);
    let settled = false;
    let firstEventAtMs = null;
    let eventCount = 0;
    let reconnectCount = 0;
    let lastArrivalAtMs = null;
    const interArrivalMs = [];

    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {}
      resolve({
        firstEventMs: firstEventAtMs ? firstEventAtMs - startedAtMs : null,
        eventCount,
        reconnectCount,
        interArrivalSummary: summarize(interArrivalMs),
      });
    };

    const timeout = setTimeout(finish, windowMs);

    ws.on("open", () => {
      ws.send(JSON.stringify(buildHeliusSubscriptionMessage(mode)));
    });

    ws.on("message", (buffer) => {
      try {
        const payload = JSON.parse(buffer.toString());
        if (isHeliusNotification(payload, mode)) {
          const nowMs = Date.now();
          if (!firstEventAtMs) {
            firstEventAtMs = nowMs;
          }
          eventCount += 1;
          if (lastArrivalAtMs !== null) {
            interArrivalMs.push(nowMs - lastArrivalAtMs);
          }
          lastArrivalAtMs = nowMs;
        }
      } catch {}
    });

    ws.on("error", (error) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    ws.on("close", () => {
      reconnectCount += 1;
      clearTimeout(timeout);
      finish();
    });
  });
}

function buildHeliusSubscriptionMessage(mode) {
  if (mode === "logs") {
    return {
      jsonrpc: "2.0",
      id: 1,
      method: "logsSubscribe",
      params: [
        {
          mentions: [TOKEN_ADDRESS],
        },
        {
          commitment: "processed",
        },
      ],
    };
  }

  return {
    jsonrpc: "2.0",
    id: 1,
    method: "transactionSubscribe",
    params: [
      {
        accountInclude: [TOKEN_ADDRESS],
        failed: false,
        vote: false,
      },
      {
        commitment: "processed",
        encoding: "jsonParsed",
        transactionDetails: "full",
        maxSupportedTransactionVersion: 0,
      },
    ],
  };
}

function isHeliusNotification(payload, mode) {
  return mode === "logs"
    ? payload?.method === "logsNotification"
    : payload?.method === "transactionNotification";
}

async function runRepeatedColdStarts(runs, worker) {
  const results = [];
  for (let index = 0; index < runs; index += 1) {
    results.push(await worker(index));
  }
  return results;
}

function extractNumbers(results, key) {
  return results
    .map((item) => item?.[key])
    .filter((value) => Number.isFinite(value));
}

async function main() {
  const output = {
    target: {
      baseUrl: BASE_URL,
      tokenAddress: TOKEN_ADDRESS,
      chainType: CHAIN_TYPE,
      tradesUrl: buildPanelTradesUrl(),
      liveUrl: buildPanelLiveUrl(),
      heliusEnabled: Boolean(HELIUS_WSS_URL),
    },
    panel: {},
    helius: {},
  };

  const panelColdStarts = await runRepeatedColdStarts(RUNS, async () => runPanelColdStart(TIMEOUT_MS));
  const panelStability = await runPanelStability(STABILITY_MS);
  output.panel = {
    coldStarts: {
      runs: panelColdStarts,
      firstTradeVisibleSummary: summarize(extractNumbers(panelColdStarts, "firstTradeVisibleMs")),
      firstCandleSignalSummary: summarize(extractNumbers(panelColdStarts, "firstCandleSignalMs")),
    },
    stability: panelStability,
  };

  if (HELIUS_WSS_URL) {
    const heliusTransactionColdStarts = await runRepeatedColdStarts(RUNS, async () =>
      runHeliusColdStart(TIMEOUT_MS, "transactions")
    );
    const heliusTransactionStability = await runHeliusStability(STABILITY_MS, "transactions");
    const heliusLogsColdStarts = await runRepeatedColdStarts(RUNS, async () =>
      runHeliusColdStart(TIMEOUT_MS, "logs")
    );
    const heliusLogsStability = await runHeliusStability(STABILITY_MS, "logs");
    output.helius = {
      transactions: {
        coldStarts: {
          runs: heliusTransactionColdStarts,
          firstEventSummary: summarize(extractNumbers(heliusTransactionColdStarts, "firstEventMs")),
        },
        stability: heliusTransactionStability,
      },
      logs: {
        coldStarts: {
          runs: heliusLogsColdStarts,
          firstEventSummary: summarize(extractNumbers(heliusLogsColdStarts, "firstEventMs")),
        },
        stability: heliusLogsStability,
      },
    };
  }

  const panelChurn = await runRepeatedColdStarts(CHURN_RUNS, async () => runPanelColdStart(TIMEOUT_MS));
  output.panel.churn = {
    firstTradeVisibleSummary: summarize(extractNumbers(panelChurn, "firstTradeVisibleMs")),
    failures: panelChurn.filter((item) => item.firstTradeVisibleMs === null).length,
  };

  if (HELIUS_WSS_URL) {
    const heliusTransactionChurn = await runRepeatedColdStarts(CHURN_RUNS, async () =>
      runHeliusColdStart(TIMEOUT_MS, "transactions")
    );
    const heliusLogsChurn = await runRepeatedColdStarts(CHURN_RUNS, async () =>
      runHeliusColdStart(TIMEOUT_MS, "logs")
    );
    output.helius.transactions.churn = {
      firstEventSummary: summarize(extractNumbers(heliusTransactionChurn, "firstEventMs")),
      failures: heliusTransactionChurn.filter((item) => item.firstEventMs === null).length,
    };
    output.helius.logs.churn = {
      firstEventSummary: summarize(extractNumbers(heliusLogsChurn, "firstEventMs")),
      failures: heliusLogsChurn.filter((item) => item.firstEventMs === null).length,
    };
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
