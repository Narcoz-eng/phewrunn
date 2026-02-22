import { usePrivy, useLogin } from "@privy-io/react-auth";
import { useAuth, syncPrivySession } from "@/lib/auth-client";

// This hook MUST only be called inside a component rendered within PrivyProvider
export function usePrivyLogin() {
  const { ready, authenticated, user, logout: privyLogout } = usePrivy();
  const { refetch } = useAuth();

  const { login } = useLogin({
    onComplete: async (params) => {
      try {
        const privyUser = params.user;
        const email =
          privyUser.email?.address ??
          (privyUser.linkedAccounts?.find(
            (a: { type: string; address?: string }) => a.type === "email"
          ) as { type: string; address?: string } | undefined)?.address ??
          "";

        if (!email) {
          console.error("[usePrivyLogin] No email found in Privy user:", privyUser);
          return;
        }

        const name = (privyUser.google as { name?: string } | undefined)?.name ?? email.split("@")[0] ?? "";

        const result = await syncPrivySession(privyUser.id, email, name);
        if (result) {
          await refetch();
        } else {
          console.error("[usePrivyLogin] Failed to sync Privy session to backend");
        }
      } catch (err) {
        console.error("[usePrivyLogin] onComplete error:", err);
      }
    },
    onError: (error) => {
      console.error("[usePrivyLogin] Privy login error:", error);
    },
  });

  return { login, ready, authenticated, user, privyLogout };
}
