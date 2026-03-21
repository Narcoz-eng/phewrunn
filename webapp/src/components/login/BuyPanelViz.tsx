import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Shield, TrendingUp, Zap } from "lucide-react";

interface MockToken {
  token: string;
  price: string;
  amount: string;
  fee: string;
}

const MOCK_TOKENS: MockToken[] = [
  { token: "$SOL", price: "$183.40", amount: "5.46 SOL", fee: "$5.00" },
  { token: "$BONK", price: "$0.0000224", amount: "22M BONK", fee: "$3.20" },
  { token: "$WIF", price: "$1.82", amount: "549.45 WIF", fee: "$5.00" },
];

const FLOW_STEPS = [
  { key: "post", label: "Your Call", sub: "Signal posted" },
  { key: "route", label: "Phew Route", sub: "Best price found" },
  { key: "exec", label: "Trade Fired", sub: "0.5% → you" },
] as const;

const FEATURES = [
  { icon: Zap, text: "0.5% fee on every routed buy" },
  { icon: Shield, text: "MEV protection built-in" },
  { icon: TrendingUp, text: "Best DEX price always" },
] as const;

export function BuyPanelViz() {
  const [activeStep, setActiveStep] = useState<number>(0);
  const [tokenIdx, setTokenIdx] = useState<number>(0);
  const [vol, setVol] = useState<number>(47832);

  useEffect(() => {
    const iv = window.setInterval(() => {
      setActiveStep((s) => (s + 1) % 3);
    }, 900);
    return () => window.clearInterval(iv);
  }, []);

  useEffect(() => {
    const iv = window.setInterval(() => {
      setTokenIdx((i) => (i + 1) % MOCK_TOKENS.length);
      setVol((v) => v + Math.floor(Math.random() * 600 + 200));
    }, 3200);
    return () => window.clearInterval(iv);
  }, []);

  const token = MOCK_TOKENS[tokenIdx]!;

  return (
    <div className="rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-border/40 flex items-center justify-between">
        <div>
          <h3 className="font-heading font-bold text-sm">Buy Panel</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">How your calls generate income</p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-gain border border-gain/20 bg-gain/8 rounded-full px-2.5 py-1">
          <span className="w-1.5 h-1.5 rounded-full bg-gain animate-pulse inline-block" />
          Active
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Flow steps */}
        <div className="flex items-center gap-1">
          {FLOW_STEPS.map((step, i) => (
            <div key={step.key} className="flex items-center gap-1 flex-1 min-w-0">
              <motion.div
                className="flex-1 rounded-xl border p-2.5 text-center min-w-0"
                animate={{
                  borderColor: activeStep === i ? "hsl(var(--primary)/0.5)" : "hsl(var(--border)/0.5)",
                  backgroundColor: activeStep === i ? "hsl(var(--primary)/0.08)" : "hsl(var(--card)/0.4)",
                }}
                transition={{ duration: 0.3 }}
              >
                <div className={`text-[11px] font-semibold truncate ${activeStep === i ? "text-primary" : "text-foreground"}`}>
                  {step.label}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{step.sub}</div>
              </motion.div>
              {i < 2 ? (
                <motion.div
                  animate={{ opacity: activeStep > i ? 1 : 0.25 }}
                  transition={{ duration: 0.3 }}
                  className="flex-shrink-0"
                >
                  <ArrowRight className="w-3 h-3 text-primary" />
                </motion.div>
              ) : null}
            </div>
          ))}
        </div>

        {/* Mock buy panel card */}
        <div className="rounded-xl border border-border/50 bg-background/50 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-[9px] font-bold text-primary">B</span>
              </div>
              <AnimatePresence mode="wait">
                <motion.span
                  key={tokenIdx}
                  className="text-sm font-mono font-bold"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.2 }}
                >
                  Buy {token.token}
                </motion.span>
              </AnimatePresence>
            </div>
            <span className="text-[11px] text-muted-foreground">via Phew</span>
          </div>

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Entry price</span>
            <AnimatePresence mode="wait">
              <motion.span
                key={tokenIdx}
                className="font-mono font-semibold"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {token.price}
              </motion.span>
            </AnimatePresence>
          </div>

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Amount out</span>
            <AnimatePresence mode="wait">
              <motion.span
                key={tokenIdx}
                className="font-mono"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {token.amount}
              </motion.span>
            </AnimatePresence>
          </div>

          {/* Creator fee highlight */}
          <div className="flex items-center justify-between rounded-lg bg-gain/8 border border-gain/20 px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-[11px] text-gain">
              <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
              Creator fee
            </div>
            <AnimatePresence mode="wait">
              <motion.span
                key={tokenIdx}
                className="text-[11px] font-mono font-bold text-gain"
                initial={{ scale: 1.1, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {token.fee} → you
              </motion.span>
            </AnimatePresence>
          </div>
        </div>

        {/* Live volume */}
        <div className="flex items-center justify-between text-[11px] px-0.5">
          <span className="text-muted-foreground">Volume routed today</span>
          <motion.span
            key={vol}
            className="font-mono font-semibold tabular-nums"
            initial={{ scale: 1.08 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.15 }}
          >
            ${vol.toLocaleString()}
          </motion.span>
        </div>

        {/* Features */}
        <div className="grid grid-cols-3 gap-2">
          {FEATURES.map(({ icon: Icon, text }) => (
            <div
              key={text}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-border/40 bg-card/40 p-2.5 text-center"
            >
              <Icon className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] text-muted-foreground leading-tight">{text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
