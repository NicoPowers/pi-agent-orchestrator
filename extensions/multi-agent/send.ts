import { type Agent, log } from "./state.js";

export async function sendToAgent(agent: Agent, message: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  log("send", `Agent '${agent.id}' queuing send`);
  while (agent._currentSend) {
    if (signal?.aborted) throw new Error("Aborted");
    try {
      await agent._currentSend;
    } catch {
      /* ignore previous errors */
    }
  }

  const perform = async () => {
    if (agent.status === "error" || agent.status === "exited") {
      throw new Error(`Agent is ${agent.status}`);
    }

    agent.history.push({ role: "user", text: message });
    agent.accumulatedText = "";

    const cmd = { type: "prompt", message };
    agent.stdin.write(JSON.stringify(cmd) + "\n");
    log("send", `Agent '${agent.id}' prompt written`);

    await new Promise<void>((resolve, reject) => {
      agent._nextTurn = { resolve, reject };
      agent._turnTimer = setTimeout(() => {
        reject(new Error(`Timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            reject(new Error("Aborted"));
          },
          { once: true },
        );
      }
    });

    if (agent._turnTimer) {
      clearTimeout(agent._turnTimer);
      agent._turnTimer = undefined;
    }
    agent._nextTurn = undefined;
    log("send", `Agent '${agent.id}' send resolved`);
  };

  agent._currentSend = perform();
  try {
    await agent._currentSend;
  } finally {
    agent._currentSend = undefined;
  }
}
