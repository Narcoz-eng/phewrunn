export type TradeExecutionStepKey =
  | "quote_ready"
  | "awaiting_signature"
  | "source_swap"
  | "bridge"
  | "destination_swap"
  | "receiving"
  | "settled"
  | "failed";

export type TradeExecutionStepTone = "idle" | "active" | "complete" | "error";

export type TradeExecutionStepViewModel = {
  key: TradeExecutionStepKey;
  label: string;
  description: string;
  tone: TradeExecutionStepTone;
};

export type TradeExecutionViewModel = {
  current: TradeExecutionStepKey;
  headline: string;
  detail: string;
  tone: Exclude<TradeExecutionStepTone, "idle">;
  steps: TradeExecutionStepViewModel[];
};

type TradeExecutionStageDefinition = {
  label: string;
  description: string;
};

const BASE_EXECUTION_STEPS: TradeExecutionStageDefinition[] = [
  {
    label: "Sign",
    description: "Approve the route in your wallet.",
  },
  {
    label: "Swap",
    description: "Broadcast the trade to the source chain.",
  },
  {
    label: "Receive",
    description: "Wait for settlement and token receipt.",
  },
];

const CROSS_CHAIN_EXECUTION_STEPS: TradeExecutionStageDefinition[] = [
  {
    label: "Sign",
    description: "Approve the route in your wallet.",
  },
  {
    label: "Source",
    description: "Swap on the source chain.",
  },
  {
    label: "Bridge",
    description: "Move funds to the destination chain.",
  },
  {
    label: "Receive",
    description: "Settle into the destination token.",
  },
];

export function getTradeExecutionStatusCopy(
  current: TradeExecutionStepKey,
  side: "buy" | "sell",
  tokenSymbol: string
): Pick<TradeExecutionViewModel, "headline" | "detail" | "tone"> {
  const sideLabel = side === "buy" ? "buy" : "sell";
  switch (current) {
    case "quote_ready":
      return {
        headline: "Route locked",
        detail: `Route is ready for your ${sideLabel} order.`,
        tone: "active",
      };
    case "awaiting_signature":
      return {
        headline: "Awaiting signature",
        detail: `Sign to continue the ${sideLabel} order for ${tokenSymbol}.`,
        tone: "active",
      };
    case "source_swap":
      return {
        headline: "Sending trade",
        detail: "Broadcasting the signed transaction to the chain.",
        tone: "active",
      };
    case "bridge":
      return {
        headline: "Bridge in progress",
        detail: "Funds are moving across chains.",
        tone: "active",
      };
    case "destination_swap":
      return {
        headline: "Destination swap",
        detail: "Executing the destination-side route.",
        tone: "active",
      };
    case "receiving":
      return {
        headline: "Confirming settlement",
        detail: "Waiting for on-chain confirmation and receipt.",
        tone: "active",
      };
    case "settled":
      return {
        headline: "Trade settled",
        detail: `${tokenSymbol} is now reflected in the execution flow.`,
        tone: "complete",
      };
    case "failed":
      return {
        headline: "Execution failed",
        detail: "The trade stopped before final settlement.",
        tone: "error",
      };
    default:
      return {
        headline: "Execution active",
        detail: "Trade is progressing on-chain.",
        tone: "active",
      };
  }
}

export function buildTradeExecutionViewModel(args: {
  current: TradeExecutionStepKey;
  side: "buy" | "sell";
  tokenSymbol: string;
  crossChain?: boolean;
  failureDetail?: string | null;
  failureStep?: TradeExecutionStepKey | null;
}): TradeExecutionViewModel {
  const { current, side, tokenSymbol, crossChain = false, failureDetail = null, failureStep = null } = args;
  const sequence = crossChain ? CROSS_CHAIN_EXECUTION_STEPS : BASE_EXECUTION_STEPS;
  const { headline, detail, tone } = getTradeExecutionStatusCopy(current, side, tokenSymbol);

  const orderedKeys: TradeExecutionStepKey[] = crossChain
    ? ["awaiting_signature", "source_swap", "bridge", "receiving"]
    : ["awaiting_signature", "source_swap", "receiving"];
  const currentIndex =
    current === "failed" && failureStep ? orderedKeys.indexOf(failureStep) : orderedKeys.indexOf(current);

  const steps = sequence.map((step, index) => {
    const key = orderedKeys[index] ?? "receiving";
    let stepTone: TradeExecutionStepTone = "idle";
    if (current === "failed") {
      stepTone = index < Math.max(0, currentIndex) ? "complete" : "idle";
      if (index === Math.max(0, currentIndex)) {
        stepTone = "error";
      }
    } else if (current === "settled") {
      stepTone = "complete";
    } else if (currentIndex > index) {
      stepTone = "complete";
    } else if (currentIndex === index) {
      stepTone = "active";
    }

    return {
      key,
      label: step.label,
      description:
        current === "failed" && stepTone === "error" && failureDetail
          ? failureDetail
          : step.description,
      tone: stepTone,
    };
  });

  return {
    current,
    headline,
    detail: current === "failed" && failureDetail ? failureDetail : detail,
    tone,
    steps,
  };
}
