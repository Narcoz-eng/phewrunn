import { createHash, createHmac, randomUUID } from "node:crypto";
import { env } from "../env.js";

export const COMMUNITY_ASSET_KIND_VALUES = [
  "logo",
  "banner",
  "mascot",
  "reference_meme",
] as const;

export type CommunityAssetKind = (typeof COMMUNITY_ASSET_KIND_VALUES)[number];

type CommunityAssetStorageConfig = {
  endpoint: URL;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
  uploadExpiresSeconds: number;
};

function normalizeStorageEndpoint(rawEndpoint: string): URL {
  const endpoint = new URL(rawEndpoint);
  endpoint.pathname = "";
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}

export type CommunityAssetStorageDiagnostics = {
  configured: boolean;
  healthy: boolean;
  partialConfig: boolean;
  endpoint: string | null;
  endpointHost: string | null;
  bucket: string | null;
  publicBaseUrl: string | null;
  publicBaseHost: string | null;
  issues: string[];
};

function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string, encoding: "hex" | undefined = undefined): Buffer | string {
  const digest = createHmac("sha256", key).update(value).digest();
  return encoding === "hex" ? digest.toString("hex") : digest;
}

function encodeS3Path(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function compactFilename(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const dotIndex = trimmed.lastIndexOf(".");
  const ext = dotIndex >= 0 ? trimmed.slice(dotIndex + 1) : "";
  const stem = (dotIndex >= 0 ? trimmed.slice(0, dotIndex) : trimmed)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "asset";
  return ext ? `${stem}.${ext.slice(0, 10)}` : stem;
}

function formatAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function getSignatureKey(secret: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp) as Buffer;
  const kRegion = hmac(kDate, region) as Buffer;
  const kService = hmac(kRegion, "s3") as Buffer;
  return hmac(kService, "aws4_request") as Buffer;
}

function getStorageConfig(): CommunityAssetStorageConfig | null {
  const endpoint = env.COMMUNITY_ASSET_STORAGE_ENDPOINT;
  const region = env.COMMUNITY_ASSET_STORAGE_REGION;
  const bucket = env.COMMUNITY_ASSET_STORAGE_BUCKET;
  const accessKeyId = env.COMMUNITY_ASSET_ACCESS_KEY_ID;
  const secretAccessKey = env.COMMUNITY_ASSET_SECRET_ACCESS_KEY;
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const uploadExpiresRaw = Number.parseInt(env.COMMUNITY_ASSET_UPLOAD_EXPIRES_SECONDS ?? "600", 10);
  const uploadExpiresSeconds = Number.isFinite(uploadExpiresRaw)
    ? Math.max(60, Math.min(uploadExpiresRaw, 3600))
    : 600;

  const publicBaseUrl =
    env.COMMUNITY_ASSET_PUBLIC_BASE_URL?.replace(/\/+$/, "") ||
    `${endpoint.replace(/\/+$/, "")}/${bucket}`;

  return {
    endpoint: normalizeStorageEndpoint(endpoint),
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl,
    uploadExpiresSeconds,
  };
}

export function getCommunityAssetStorageDiagnostics(): CommunityAssetStorageDiagnostics {
  const rawEndpoint = env.COMMUNITY_ASSET_STORAGE_ENDPOINT?.trim() ?? null;
  const rawRegion = env.COMMUNITY_ASSET_STORAGE_REGION?.trim() ?? null;
  const rawBucket = env.COMMUNITY_ASSET_STORAGE_BUCKET?.trim() ?? null;
  const rawAccessKeyId = env.COMMUNITY_ASSET_ACCESS_KEY_ID?.trim() ?? null;
  const rawSecretAccessKey = env.COMMUNITY_ASSET_SECRET_ACCESS_KEY?.trim() ?? null;
  const rawPublicBaseUrl = env.COMMUNITY_ASSET_PUBLIC_BASE_URL?.trim() ?? null;

  const providedCount = [
    rawEndpoint,
    rawRegion,
    rawBucket,
    rawAccessKeyId,
    rawSecretAccessKey,
  ].filter(Boolean).length;
  const partialConfig = providedCount > 0 && providedCount < 5;
  const config = getStorageConfig();
  const issues: string[] = [];

  let endpointHost: string | null = null;
  let publicBaseHost: string | null = null;
  if (rawEndpoint) {
    try {
      endpointHost = new URL(rawEndpoint).host;
      const endpointPath = new URL(rawEndpoint).pathname.replace(/\/+$/, "");
      if (endpointPath && endpointPath !== "") {
        issues.push("storage_endpoint_includes_path");
      }
    } catch {
      issues.push("invalid_endpoint_url");
    }
  }
  if (rawPublicBaseUrl) {
    try {
      publicBaseHost = new URL(rawPublicBaseUrl).host;
    } catch {
      issues.push("invalid_public_base_url");
    }
  }

  if (partialConfig) {
    issues.push("partial_storage_config");
  }

  if (config && !rawPublicBaseUrl) {
    issues.push("missing_public_base_url");
  }

  if (
    rawPublicBaseUrl &&
    publicBaseHost &&
    endpointHost &&
    publicBaseHost === endpointHost
  ) {
    issues.push("public_base_uses_storage_api_host");
  }

  if (rawPublicBaseUrl?.includes("cloudflarestorage.com")) {
    issues.push("public_base_points_at_r2_api_endpoint");
  }

  return {
    configured: Boolean(config),
    healthy: Boolean(config) && issues.length === 0,
    partialConfig,
    endpoint: rawEndpoint,
    endpointHost,
    bucket: rawBucket,
    publicBaseUrl: rawPublicBaseUrl,
    publicBaseHost,
    issues,
  };
}

export function isCommunityAssetStorageConfigured(): boolean {
  return Boolean(getStorageConfig());
}

export function buildCommunityAssetObjectKey(params: {
  tokenAddress: string;
  kind: CommunityAssetKind;
  fileName: string;
}): string {
  const cleanedAddress = params.tokenAddress.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "token";
  const cleanedName = compactFilename(params.fileName);
  const now = new Date();
  const dateSegment = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `community-assets/${cleanedAddress}/${params.kind}/${dateSegment}-${randomUUID()}-${cleanedName}`;
}

export function buildCommunityAssetPublicUrl(objectKey: string): string {
  const config = getStorageConfig();
  if (!config) {
    throw new Error("COMMUNITY_ASSET_STORAGE_NOT_CONFIGURED");
  }
  return `${config.publicBaseUrl}/${encodeS3Path(objectKey)}`;
}

export function createCommunityAssetUpload(params: {
  objectKey: string;
  contentType: string;
  now?: Date;
}): {
  uploadUrl: string;
  headers: Record<string, string>;
  publicUrl: string;
  expiresAt: string;
} {
  const config = getStorageConfig();
  if (!config) {
    throw new Error("COMMUNITY_ASSET_STORAGE_NOT_CONFIGURED");
  }

  const timestamp = params.now ?? new Date();
  const { amzDate, dateStamp } = formatAmzDate(timestamp);
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const canonicalUri = `/${config.bucket}/${encodeS3Path(params.objectKey)}`;
  const host = config.endpoint.host;
  const signedHeaders = "content-type;host";
  const searchParams = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(config.uploadExpiresSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  });
  const canonicalQuery = searchParams
    .toString()
    .split("&")
    .sort()
    .join("&");
  const canonicalHeaders = `content-type:${params.contentType}\nhost:${host}\n`;
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hmac(
    getSignatureKey(config.secretAccessKey, dateStamp, config.region),
    stringToSign,
    "hex",
  ) as string;
  searchParams.set("X-Amz-Signature", signature);

  const endpointBase = config.endpoint.toString().replace(/\/+$/, "");
  return {
    uploadUrl: `${endpointBase}${canonicalUri}?${searchParams.toString()}`,
    headers: {
      "Content-Type": params.contentType,
    },
    publicUrl: buildCommunityAssetPublicUrl(params.objectKey),
    expiresAt: new Date(timestamp.getTime() + config.uploadExpiresSeconds * 1000).toISOString(),
  };
}

export async function uploadCommunityAssetObject(params: {
  objectKey: string;
  contentType: string;
  body: Uint8Array;
}): Promise<{ publicUrl: string }> {
  const upload = createCommunityAssetUpload({
    objectKey: params.objectKey,
    contentType: params.contentType,
  });
  const response = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: upload.headers,
    body: params.body,
  });
  if (!response.ok) {
    throw new Error(`Community asset upload failed with ${response.status}`);
  }
  return { publicUrl: upload.publicUrl };
}

function buildSignedStorageRequest(params: {
  method: "GET" | "DELETE";
  objectKey: string;
  now?: Date;
}) {
  const config = getStorageConfig();
  if (!config) {
    throw new Error("COMMUNITY_ASSET_STORAGE_NOT_CONFIGURED");
  }

  const timestamp = params.now ?? new Date();
  const { amzDate, dateStamp } = formatAmzDate(timestamp);
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const canonicalUri = `/${config.bucket}/${encodeS3Path(params.objectKey)}`;
  const payloadHash = sha256Hex("");
  const canonicalHeaders = [
    `host:${config.endpoint.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ].join("\n") + "\n";
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    params.method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hmac(
    getSignatureKey(config.secretAccessKey, dateStamp, config.region),
    stringToSign,
    "hex",
  ) as string;
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  return {
    url: `${config.endpoint.toString().replace(/\/+$/, "")}${canonicalUri}`,
    headers: {
      Authorization: authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
  };
}

export async function fetchCommunityAssetObject(objectKey: string): Promise<Response> {
  const request = buildSignedStorageRequest({ method: "GET", objectKey });
  return fetch(request.url, {
    method: "GET",
    headers: request.headers,
  });
}

export async function deleteCommunityAssetObject(objectKey: string): Promise<void> {
  const request = buildSignedStorageRequest({ method: "DELETE", objectKey });
  const response = await fetch(request.url, {
    method: "DELETE",
    headers: request.headers,
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Community asset delete failed with ${response.status}`);
  }
}
