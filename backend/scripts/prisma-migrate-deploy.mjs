import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const currentDir = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(currentDir, "..");
const schemaPath = "prisma/schema.prisma";
const envFilePath = resolve(backendDir, ".env");
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

function parseDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const content = readFileSync(filePath, "utf8");
  const entries = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key) continue;
    entries[key] = value;
  }

  return entries;
}

function runPrismaMigrate(extraEnv = {}) {
  return spawnSync(
    npxCommand,
    ["prisma@6", "migrate", "deploy", "--schema", schemaPath],
    {
      cwd: backendDir,
      env: {
        ...process.env,
        ...extraEnv,
      },
      encoding: "utf8",
      stdio: "pipe",
    }
  );
}

function writeResult(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

const envFile = parseDotEnv(envFilePath);
const databaseUrl = process.env.DATABASE_URL ?? envFile.DATABASE_URL ?? "";
const directUrl = process.env.DIRECT_URL ?? envFile.DIRECT_URL ?? "";

const primary = runPrismaMigrate();
writeResult(primary);

if (primary.status === 0) {
  process.exit(0);
}

const output = `${primary.stdout ?? ""}\n${primary.stderr ?? ""}`;
const shouldRetryWithPooler =
  Boolean(databaseUrl) &&
  Boolean(directUrl) &&
  databaseUrl !== directUrl &&
  /P1001|Can't reach database server|schema engine error/i.test(output);

if (!shouldRetryWithPooler) {
  process.exit(primary.status ?? 1);
}

console.warn("[prisma-migrate] Primary migrate failed. Retrying with DIRECT_URL set to DATABASE_URL.");

const retry = runPrismaMigrate({
  DIRECT_URL: databaseUrl,
});
writeResult(retry);
process.exit(retry.status ?? 1);
