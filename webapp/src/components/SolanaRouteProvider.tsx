import type { ReactNode } from "react";
import { SolanaWalletProvider } from "@/components/SolanaWalletProvider";

export default function SolanaRouteProvider({ children }: { children: ReactNode }) {
  return <SolanaWalletProvider>{children}</SolanaWalletProvider>;
}
