import { spawnSync } from "node:child_process";

/**
 * Discovers models available to the current Pi installation
 * by running `pi --list-models` and parsing the output table.
 */
let cachedModels: string[] | null = null;

export function getAvailableModels(): string[] {
  if (cachedModels) {
    return cachedModels;
  }

  try {
    // Try common locations for the pi binary
    const candidates = [
      "pi",
      process.env.HOME + "/.bun/bin/pi",
      "/home/ubuntu/.bun/bin/pi",
      "/usr/local/bin/pi",
    ];
    let stdout = "";
    for (const cmd of candidates) {
      const result = spawnSync(cmd, ["--list-models"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10_000,
      });
      if (result.status === 0 && (result.stdout.trim().length > 0 || result.stderr.trim().length > 0)) {
        stdout = result.stdout.trim().length > 0 ? result.stdout : result.stderr;
        break;
      }
    }
    if (!stdout) {
      console.error("[models] Could not run pi --list-models");
      return [];
    }

    const lines = stdout.split("\n");
    const models: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Split on whitespace and take the second column (model name)
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const model = parts[1];
        if (model && !models.includes(model)) {
          models.push(model);
        }
      }
    }

    cachedModels = models;
    return models;
  } catch (err) {
    console.error("[models] Failed to discover models:", err);
    return [];
  }
}

export function clearModelCache() {
  cachedModels = null;
}
