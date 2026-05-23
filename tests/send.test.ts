import { describe, it, expect } from "bun:test";
import {
	rpcCommand,
	sendToAgent,
	steerAgent,
} from "../extensions/multi-agent/send.js";
import { handleAgentProcessClose } from "../extensions/multi-agent/spawn.js";
import type { Agent } from "../extensions/multi-agent/state.js";

function makeAgent(
	overrides: Partial<Agent> = {},
	onWrite?: (agent: Agent, chunk: string) => void,
) {
	const writes: string[] = [];
	let agent: Agent;
	agent = {
		id: "lead",
		proc: { exitCode: null, signalCode: null } as any,
		stdin: {
			destroyed: false,
			closed: false,
			writableDestroyed: false,
			writableEnded: false,
			writableFinished: false,
			write(chunk: string, callback?: (err?: Error | null) => void) {
				writes.push(chunk);
				onWrite?.(agent, chunk);
				callback?.();
				return true;
			},
		} as any,
		status: "idle",
		accumulatedText: "previous answer",
		history: [],
		events: [],
		buffer: "",
		worktreePath: "/tmp/pi-worktree-lead",
		children: [],
		_rpcRequests: new Map(),
		...overrides,
	};
	if (!onWrite) {
		onWrite = (a, chunk) => {
			const command = JSON.parse(chunk);
			if (command.type !== "prompt") return;
			queueMicrotask(() => {
				const pending = a._rpcRequests?.get(command.id);
				if (!pending) return;
				clearTimeout(pending.timer);
				a._rpcRequests?.delete(command.id);
				pending.resolve(true);
			});
		};
	}
	return { agent, writes };
}

async function waitForNextTurn(agent: Agent) {
	for (let i = 0; i < 20; i++) {
		if (agent._nextTurn) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("agent turn was not started");
}

async function waitForWrites(writes: string[], count: number) {
	for (let i = 0; i < 20; i++) {
		if (writes.length >= count) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error(`expected ${count} write(s), saw ${writes.length}`);
}

async function waitForStatus(agent: Agent, status: Agent["status"]) {
	for (let i = 0; i < 20; i++) {
		if (agent.status === status) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error(`expected status ${status}, saw ${agent.status}`);
}

describe("sendToAgent", () => {
	it("writes prompt RPC, records user history, and clears previous text", async () => {
		const { agent, writes } = makeAgent();

		const send = sendToAgent(agent, "hello", 1_000);
		await waitForNextTurn(agent);
		agent._nextTurn!.resolve();
		await send;

		expect(writes).toHaveLength(1);
		const command = JSON.parse(writes[0]!.trim());
		expect(command).toMatchObject({ type: "prompt", message: "hello" });
		expect(command.id).toStartWith("rpc_");
		expect(agent.history).toEqual([{ role: "user", text: "hello" }]);
		expect(agent.accumulatedText).toBe("");
		expect(agent._currentSend).toBeUndefined();
		expect(agent._nextTurn).toBeUndefined();
	});

	it("records a visible user-message event before prompt completion", async () => {
		const { agent, writes } = makeAgent({}, () => {
			/* Leave prompt preflight pending so the message remains in flight. */
		});

		const send = sendToAgent(agent, "pending handoff", 10).catch(() => {});
		await waitForWrites(writes, 1);

		expect(agent.events).toContainEqual(
			expect.objectContaining({
				type: "user_message",
				event: expect.objectContaining({
					type: "user_message",
					message: "pending handoff",
				}),
			}),
		);

		await send;
	});

	it("sets writing status and pending send metadata before prompt preflight resolves", async () => {
		const { agent, writes } = makeAgent({}, () => {
			/* Keep preflight pending. */
		});

		const send = sendToAgent(agent, "inspect me", 10).catch(() => {});
		await waitForWrites(writes, 1);

		expect(agent.status).toBe("writing");
		expect(agent.pendingSend).toMatchObject({
			message: "inspect me",
			timeoutMs: 10,
			status: "writing",
		});
		expect(typeof agent.pendingSend?.startedAt).toBe("number");

		await send;
	});

	it("moves to waiting after preflight succeeds and clears pending send on turn completion", async () => {
		const { agent } = makeAgent({}, (a, chunk) => {
			const command = JSON.parse(chunk);
			queueMicrotask(() => {
				const pending = a._rpcRequests?.get(command.id);
				if (!pending) return;
				clearTimeout(pending.timer);
				a._rpcRequests?.delete(command.id);
				pending.resolve(true);
			});
		});

		const send = sendToAgent(agent, "wait for model", 1_000);
		await waitForStatus(agent, "waiting");
		expect(agent.pendingSend).toMatchObject({
			message: "wait for model",
			timeoutMs: 1_000,
			status: "waiting",
		});

		agent._nextTurn!.resolve();
		await send;

		expect(agent.status).toBe("idle");
		expect(agent.pendingSend).toBeUndefined();
	});

	it("serializes concurrent sends so prompts do not overlap", async () => {
		const { agent, writes } = makeAgent();

		const first = sendToAgent(agent, "first", 1_000);
		await waitForNextTurn(agent);
		const firstTurn = agent._nextTurn!;

		const second = sendToAgent(agent, "second", 1_000);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(writes).toHaveLength(1);

		firstTurn.resolve();
		await first;
		await waitForNextTurn(agent);
		expect(writes).toHaveLength(2);
		expect(JSON.parse(writes[1]!.trim())).toMatchObject({
			type: "prompt",
			message: "second",
		});

		agent._nextTurn!.resolve();
		await second;
		expect(agent.history.map((entry) => entry.text)).toEqual([
			"first",
			"second",
		]);
	});

	it("rejects immediately for exited agents without writing", async () => {
		const { agent, writes } = makeAgent({ status: "exited" });

		await expect(sendToAgent(agent, "hello", 1_000)).rejects.toThrow(
			"Agent is exited",
		);
		expect(writes).toHaveLength(0);
	});

	it("turns broken stdin writes into API errors instead of uncaught exceptions", async () => {
		const brokenPipe = Object.assign(new Error("write EPIPE"), {
			code: "EPIPE",
		});
		const { agent } = makeAgent({
			stdin: {
				write(_chunk: string, callback?: (err?: Error | null) => void) {
					callback?.(brokenPipe);
					return false;
				},
			} as any,
		});

		await expect(sendToAgent(agent, "hello", 1_000)).rejects.toThrow(
			"input stream is closed (EPIPE)",
		);
		expect(agent.status).toBe("exited");
		expect(agent._nextTurn).toBeUndefined();
	});

	it("clears pending RPC requests when stdin is broken", async () => {
		const brokenPipe = Object.assign(new Error("write EPIPE"), {
			code: "EPIPE",
		});
		const { agent } = makeAgent({
			stdin: {
				write(_chunk: string, callback?: (err?: Error | null) => void) {
					callback?.(brokenPipe);
					return false;
				},
			} as any,
		});

		await expect(
			rpcCommand(agent, { type: "get-runtime-tools" }, 1_000),
		).rejects.toThrow("input stream is closed (EPIPE)");
		expect(agent.status).toBe("exited");
		expect(agent._rpcRequests?.size).toBe(0);
	});

	it("rejects immediately when the RPC prompt preflight response fails", async () => {
		let commandId: string | undefined;
		const { agent } = makeAgent({}, (a, chunk) => {
			const command = JSON.parse(chunk);
			commandId = command.id;
			queueMicrotask(() => {
				const pending = a._rpcRequests?.get(command.id);
				if (!pending) return;
				clearTimeout(pending.timer);
				a._rpcRequests?.delete(command.id);
				pending.reject(new Error("No API key found for moonshotai."));
			});
		});

		await expect(sendToAgent(agent, "hello", 10_000)).rejects.toThrow(
			"No API key found for moonshotai.",
		);
		expect(commandId).toStartWith("rpc_");
		expect(agent.status).toBe("error");
		expect(agent.events).toContainEqual(
			expect.objectContaining({
				type: "send_error",
				event: expect.objectContaining({
					type: "send_error",
					phase: "preflight",
					error: "No API key found for moonshotai.",
				}),
			}),
		);
		expect(agent.pendingSend).toBeUndefined();
		expect(agent._nextTurn).toBeUndefined();
		expect(agent._currentSend).toBeUndefined();
	});

	it("waits for agent_end after RPC prompt preflight succeeds", async () => {
		const { agent } = makeAgent({}, (a, chunk) => {
			const command = JSON.parse(chunk);
			queueMicrotask(() => {
				const pending = a._rpcRequests?.get(command.id);
				if (!pending) return;
				clearTimeout(pending.timer);
				a._rpcRequests?.delete(command.id);
				pending.resolve(true);
			});
			setTimeout(() => {
				a.accumulatedText = "OK";
				a._nextTurn?.resolve();
			}, 5);
		});

		await sendToAgent(agent, "hello", 10_000);

		expect(agent.history).toContainEqual({ role: "user", text: "hello" });
		expect(agent.accumulatedText).toBe("OK");
	});

	it("records a timeout error event when prompt preflight never responds", async () => {
		const { agent } = makeAgent({}, () => {
			/* Keep preflight pending until RPC timeout. */
		});

		await expect(sendToAgent(agent, "timeout", 1)).rejects.toThrow("timed out");

		expect(agent.status).toBe("error");
		expect(agent.events).toContainEqual(
			expect.objectContaining({
				type: "send_error",
				event: expect.objectContaining({
					type: "send_error",
					phase: "preflight",
				}),
			}),
		);
	});

	it("marks the agent exited and records a terminal event when the process closes", async () => {
		const { agent } = makeAgent();
		let rejected: Error | undefined;
		agent._nextTurn = {
			resolve: () => {},
			reject: (err) => {
				rejected = err;
			},
		};

		handleAgentProcessClose(agent, 7);

		expect(agent.status).toBe("exited");
		expect(rejected?.message).toContain("exited with code 7");
		expect(agent.events).toContainEqual(
			expect.objectContaining({
				type: "agent_exit",
				event: expect.objectContaining({
					type: "agent_exit",
					code: 7,
				}),
			}),
		);
	});
});

describe("steerAgent", () => {
	it("records a visible steer event before writing the steering command", async () => {
		let eventCountWhenWritten = -1;
		const { agent, writes } = makeAgent({}, (a) => {
			eventCountWhenWritten = a.events.length;
		});

		await steerAgent(agent, "look at the handoff artifact");

		expect(writes).toHaveLength(1);
		expect(JSON.parse(writes[0]!.trim())).toMatchObject({
			type: "steer",
			message: "look at the handoff artifact",
		});
		expect(eventCountWhenWritten).toBe(1);
		expect(agent.events).toContainEqual(
			expect.objectContaining({
				type: "steer_message",
				event: expect.objectContaining({
					type: "steer_message",
					message: "look at the handoff artifact",
				}),
			}),
		);
	});
});
