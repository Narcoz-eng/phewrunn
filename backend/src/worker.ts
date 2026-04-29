process.env.PHEW_PROCESS_ROLE = process.env.PHEW_PROCESS_ROLE?.trim() || "worker";

await import("./index.js");
