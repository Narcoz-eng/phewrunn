import { getIdentityToken } from "@privy-io/react-auth";

const IDENTITY_TOKEN_ATTEMPTS = 4;
const IDENTITY_TOKEN_RETRY_DELAYS_MS = [60, 100, 160] as const;

type LinkedAccountLike = {
  type: string;
  address?: string;
  name?: string | null;
  username?: string | null;
};

export type PrivyUserLike = {
  id: string;
  email?: { address?: string } | null;
  google?: { name?: string | null } | null;
  twitter?: { name?: string | null; username?: string | null } | null;
  linkedAccounts?: LinkedAccountLike[] | null;
};

export async function getPrivyIdentityTokenFast(): Promise<string | undefined> {
  for (let attempt = 0; attempt < IDENTITY_TOKEN_ATTEMPTS; attempt += 1) {
    const token = await getIdentityToken();
    if (token) {
      return token;
    }

    const delayMs = IDENTITY_TOKEN_RETRY_DELAYS_MS[attempt];
    if (!delayMs) {
      continue;
    }

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, delayMs);
    });
  }

  return undefined;
}

export function getPrivyPrimaryEmail(user: PrivyUserLike): string | undefined {
  const directEmail = user.email?.address?.trim();
  if (directEmail) {
    return directEmail;
  }

  const linkedEmail = user.linkedAccounts
    ?.find((account) => account.type === "email")
    ?.address
    ?.trim();

  return linkedEmail || undefined;
}

export function getPrivyDisplayName(user: PrivyUserLike, email?: string): string | undefined {
  const googleName = user.google?.name?.trim();
  if (googleName) {
    return googleName;
  }

  const twitterName = user.twitter?.name?.trim();
  if (twitterName) {
    return twitterName;
  }

  const twitterUsername = user.twitter?.username?.trim();
  if (twitterUsername) {
    return twitterUsername;
  }

  const linkedName = user.linkedAccounts
    ?.find((account) => account.type.endsWith("_oauth"))
    ?.name
    ?.trim();
  if (linkedName) {
    return linkedName;
  }

  const linkedUsername = user.linkedAccounts
    ?.find((account) => account.type.endsWith("_oauth"))
    ?.username
    ?.trim();
  if (linkedUsername) {
    return linkedUsername;
  }

  if (email?.includes("@")) {
    return email.split("@")[0];
  }

  return undefined;
}
