import { createContext, useContext } from "react";

export const PrivyAvailableContext = createContext<boolean>(false);
export const PrivyProviderInstanceContext = createContext<string | null>(null);

export function usePrivyAvailable() {
  return useContext(PrivyAvailableContext);
}

export function usePrivyProviderInstanceId() {
  return useContext(PrivyProviderInstanceContext);
}
