import { getIdentityToken } from "@privy-io/react-auth";

const IDENTITY_TOKEN_ATTEMPTS = 4;
const IDENTITY_TOKEN_RETRY_DELAYS_MS = [70, 120, 180] as const;
const AUTH_PAYLOAD_READY_DELAYS_MS = [120, 220, 360] as const;
const IDENTITY_TOKEN_ATTEMPT_TIMEOUT_MS = 280;
const OAUTH_IDENTITY_TOKEN_TIMEOUT_MS = 220;
const QUICK_IDENTITY_TOKEN_TIMEOUT_MS = 120;

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

export type ResolvedPrivyAuthPayload = {
  user: PrivyUserLike;
  email?: string;
  name?: string;
  privyIdToken?: string;
};

async function waitFor(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

async function getIdentityTokenWithin(timeoutMs: number): Promise<string | undefined> {
  return Promise.race<string | undefined>([
    getIdentityToken().catch(() => undefined),
    waitFor(timeoutMs).then(() => undefined),
  ]);
}

function hasOAuthIdentity(user: PrivyUserLike): boolean {
  if (user.twitter?.username || user.twitter?.name) {
    return true;
  }

  return Boolean(
    user.linkedAccounts?.some((account) => account.type.endsWith("_oauth"))
  );
}

export async function getPrivyIdentityTokenFast(): Promise<string | undefined> {
  for (let attempt = 0; attempt < IDENTITY_TOKEN_ATTEMPTS; attempt += 1) {
    const token = await getIdentityTokenWithin(IDENTITY_TOKEN_ATTEMPT_TIMEOUT_MS);
    if (token) {
      return token;
    }

    const delayMs = IDENTITY_TOKEN_RETRY_DELAYS_MS[attempt];
    if (!delayMs) {
      continue;
    }

    await waitFor(delayMs);
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

export async function resolvePrivyAuthPayload({
  user,
  getLatestUser,
}: {
  user: PrivyUserLike;
  getLatestUser?: () => PrivyUserLike | null | undefined;
}): Promise<ResolvedPrivyAuthPayload> {
  let latestUser = getLatestUser?.() ?? user;
  let email = getPrivyPrimaryEmail(latestUser);
  let name = getPrivyDisplayName(latestUser, email);

  // If Privy has already surfaced a verified email, do not hold up sign-in waiting
  // for an identity token. The backend can verify from privyUserId/email if needed.
  if (email) {
    const quickPrivyIdToken = await getIdentityTokenWithin(QUICK_IDENTITY_TOKEN_TIMEOUT_MS);
    return {
      user: latestUser,
      email,
      name,
      privyIdToken: quickPrivyIdToken,
    };
  }

  // X / OAuth-only logins often return before the identity token is ready.
  // The backend can safely resolve the Privy user by id, so avoid holding the
  // UI open through the full retry budget when we already know the provider identity.
  if (hasOAuthIdentity(latestUser)) {
    const quickPrivyIdToken = await getIdentityTokenWithin(OAUTH_IDENTITY_TOKEN_TIMEOUT_MS);
    return {
      user: latestUser,
      email,
      name,
      privyIdToken: quickPrivyIdToken,
    };
  }

  let privyIdToken = await getPrivyIdentityTokenFast();
  if (privyIdToken) {
    return {
      user: latestUser,
      email,
      name,
      privyIdToken,
    };
  }

  for (const delayMs of AUTH_PAYLOAD_READY_DELAYS_MS) {
    await waitFor(delayMs);
    latestUser = getLatestUser?.() ?? latestUser;
    email = getPrivyPrimaryEmail(latestUser);
    name = getPrivyDisplayName(latestUser, email);

    if (email) {
      break;
    }

    if (!privyIdToken) {
      privyIdToken = await getPrivyIdentityTokenFast();
    }

    if (privyIdToken) {
      break;
    }
  }

  return {
    user: latestUser,
    email,
    name,
    privyIdToken,
  };
}
