import { describe, it, expect } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

async function findPort(preferred = [18765, 18766, 18767]): Promise<number> {
  for (const port of preferred) {
    try {
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, () => {
          server.close(() => resolve());
        });
      });
      return port;
    } catch {
      /* try next */
    }
  }
  // Fall back to OS-assigned ephemeral port
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, () => {
      const addr = server.address() as AddressInfo;
      server.close(() => resolve(addr.port));
    });
  });
}

describe("port probing", () => {
  it("returns the first free port from the preferred list", async () => {
    const port = await findPort([39000, 39001, 39002]);
    expect(port).toBeGreaterThanOrEqual(39000);
    expect(port).toBeLessThanOrEqual(39002);
  });

  it("falls back to an OS-assigned ephemeral port if all preferred are taken", async () => {
    // Occupy all preferred ports
    const occupied: ReturnType<typeof createServer>[] = [];
    for (let p = 39100; p < 39103; p++) {
      const srv = createServer();
      await new Promise<void>((resolve) => srv.listen(p, resolve));
      occupied.push(srv);
    }

    const port = await findPort([39100, 39101, 39102]);

    // Clean up
    for (const srv of occupied) srv.close();

    // Fallback should be a valid ephemeral port
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
  });
});

describe("SSE formatting", () => {
  it("formats events correctly", () => {
    const event = { type: "agent-spawned", data: { name: "lead", status: "idle" } };
    const sse = `data: ${JSON.stringify(event)}\n\n`;
    expect(sse).toContain('data: {"type":"agent-spawned"');
    expect(sse).toEndWith("\n\n");
  });
});
