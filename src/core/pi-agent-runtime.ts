import { createHash } from "node:crypto";

import { Agent, type AgentEvent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Message, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { Service, type Context } from "@deepseek-ai/cordis";

import type { AgentConnection, AgentEdition, AgentPermissionMode } from "../contracts.js";
import type {
	AgentFactory,
	AgentHandle,
	CreateAgentOptions,
	HarnessAgent,
	HarnessAgentStatus,
	ResumeAgentOptions,
} from "./agent-registry.js";
import { ContextCompactor } from "./context-compaction.js";
import type { SessionLease } from "./session-store.js";

export interface AgentRunOptions {
	readonly sessionId?: string;
	readonly connection?: AgentConnection;
	readonly workspacePath?: string;
	readonly permissionMode?: AgentPermissionMode;
	readonly edition?: AgentEdition;
}

export interface AgentRunResult {
	readonly sessionId: string;
	readonly model: {
		readonly provider: string;
		readonly id: string;
	};
	readonly text: string;
	readonly messageCount: number;
}

function isPersistableMessage(message: AgentMessage): message is Message {
	return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
}

function assistantText(message: AgentMessage | undefined): string {
	if (!message || message.role !== "assistant") return "";
	return (message as AssistantMessage).content
		.filter((block): block is Extract<AssistantMessage["content"][number], { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("");
}

/**
 * Pi uses explicit `undefined` for some optional protocol fields. JSONL has a
 * stricter contract: optional protocol fields are omitted, while arbitrary
 * tool arguments/details remain untouched and are validated by the store.
 */
function durableUsage(usage: AssistantMessage["usage"]): Record<string, unknown> {
	return {
		input: usage.input,
		output: usage.output,
		cacheRead: usage.cacheRead,
		cacheWrite: usage.cacheWrite,
		totalTokens: usage.totalTokens,
		cost: {
			input: usage.cost.input,
			output: usage.cost.output,
			cacheRead: usage.cost.cacheRead,
			cacheWrite: usage.cost.cacheWrite,
			total: usage.cost.total,
		},
		...(usage.cacheWrite1h === undefined ? {} : { cacheWrite1h: usage.cacheWrite1h }),
		...(usage.reasoning === undefined ? {} : { reasoning: usage.reasoning }),
	};
}

function durableContent(content: UserMessage["content"] | ToolResultMessage["content"]): unknown {
	if (typeof content === "string") return content;
	return content.map((block) => {
		if (block.type === "text") {
			return { type: "text", text: block.text, ...(block.textSignature === undefined ? {} : { textSignature: block.textSignature }) };
		}
		return { type: "image", data: block.data, mimeType: block.mimeType };
	});
}

function durableAssistantContent(content: AssistantMessage["content"]): unknown {
	return content.map((block) => {
		if (block.type === "text") {
			return { type: "text", text: block.text, ...(block.textSignature === undefined ? {} : { textSignature: block.textSignature }) };
		}
		if (block.type === "thinking") {
			return {
				type: "thinking",
				thinking: block.thinking,
				...(block.thinkingSignature === undefined ? {} : { thinkingSignature: block.thinkingSignature }),
				...(block.redacted === undefined ? {} : { redacted: block.redacted }),
			};
		}
		return {
			type: "toolCall",
			id: block.id,
			name: block.name,
			arguments: block.arguments,
			...(block.thoughtSignature === undefined ? {} : { thoughtSignature: block.thoughtSignature }),
			...(block.namespace === undefined ? {} : { namespace: block.namespace }),
		};
	});
}

function durableDiagnostics(diagnostics: NonNullable<AssistantMessage["diagnostics"]>): unknown {
	return diagnostics.map((diagnostic) => ({
		type: diagnostic.type,
		timestamp: diagnostic.timestamp,
		...(diagnostic.error === undefined
			? {}
			: {
					error: {
						message: diagnostic.error.message,
						...(diagnostic.error.name === undefined ? {} : { name: diagnostic.error.name }),
						...(diagnostic.error.stack === undefined ? {} : { stack: diagnostic.error.stack }),
						...(diagnostic.error.code === undefined ? {} : { code: diagnostic.error.code }),
					},
				}),
		...(diagnostic.details === undefined ? {} : { details: diagnostic.details }),
	}));
}

function durableMessage(message: Message): unknown {
	if (message.role === "user") {
		return { role: "user", content: durableContent(message.content), timestamp: message.timestamp };
	}
	if (message.role === "toolResult") {
		return {
			role: "toolResult",
			toolCallId: message.toolCallId,
			toolName: message.toolName,
			content: durableContent(message.content),
			isError: message.isError,
			timestamp: message.timestamp,
			...(message.details === undefined ? {} : { details: message.details }),
			...(message.usage === undefined ? {} : { usage: durableUsage(message.usage) }),
			...(message.addedToolNames === undefined ? {} : { addedToolNames: message.addedToolNames }),
		};
	}
	return {
		role: "assistant",
		content: durableAssistantContent(message.content),
		api: message.api,
		provider: message.provider,
		model: message.model,
		usage: durableUsage(message.usage),
		stopReason: message.stopReason,
		timestamp: message.timestamp,
		...(message.responseModel === undefined ? {} : { responseModel: message.responseModel }),
		...(message.responseId === undefined ? {} : { responseId: message.responseId }),
		...(message.providerThinkingLevel === undefined ? {} : { providerThinkingLevel: message.providerThinkingLevel }),
		...(message.diagnostics === undefined ? {} : { diagnostics: durableDiagnostics(message.diagnostics) }),
		...(message.deferred === undefined
			? {}
			: {
					deferred: {
						provider: message.deferred.provider,
						modelId: message.deferred.modelId,
						api: message.deferred.api,
						id: message.deferred.id,
						...(message.deferred.expiresAt === undefined ? {} : { expiresAt: message.deferred.expiresAt }),
						...(message.deferred.pollAfterMs === undefined ? {} : { pollAfterMs: message.deferred.pollAfterMs }),
						...(message.deferred.data === undefined ? {} : { data: message.deferred.data }),
					},
				}),
		...(message.errorMessage === undefined ? {} : { errorMessage: message.errorMessage }),
		...(message.rawStopReason === undefined ? {} : { rawStopReason: message.rawStopReason }),
		...(message.endTurn === undefined ? {} : { endTurn: message.endTurn }),
	};
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function redactError(error: unknown, secrets: readonly (string | undefined)[]): Error {
	const source = error instanceof Error ? error.message : String(error);
	let message = source;
	for (const secret of secrets) {
		if (secret && message.includes(secret)) message = message.split(secret).join("[redacted]");
	}
	const sanitized = new Error(message);
	if (error instanceof Error) sanitized.name = error.name;
	return sanitized;
}

function redactDurable(value: unknown, secrets: readonly (string | undefined)[]): unknown {
	if (typeof value === "string") {
		let redacted = value;
		for (const secret of secrets) {
			if (secret && redacted.includes(secret)) redacted = redacted.split(secret).join("[redacted]");
		}
		return redacted;
	}
	if (value instanceof Error) {
		const sanitized = redactError(value, secrets);
		if (value.stack) sanitized.stack = redactDurable(value.stack, secrets) as string;
		return sanitized;
	}
	if (Array.isArray(value)) return value.map((item) => redactDurable(item, secrets));
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDurable(item, secrets)]));
}

/** Pi Agent Core implementation of DSH's replaceable AgentFactory seam. */
export class PiAgentLoop extends Service implements AgentFactory {
	private readonly active = new Map<string, Agent>();
	private readonly abortRequested = new Set<string>();
	private readonly pending = new Set<Promise<AgentRunResult>>();
	private readonly pendingSessions = new Set<string>();
	private readonly factoryOperations = new Set<Promise<AgentHandle>>();
	private readonly handles = new Set<AgentHandle>();
	private shutdownPromise: Promise<void> | undefined;
	private closed = false;

	constructor(ctx: import("@deepseek-ai/cordis").Context) {
		super(ctx, "agentLoop");
	}

	createAgent(_ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
		return this.trackFactoryOperation(this.createAgentInternal(options));
	}

	private async createAgentInternal(options: CreateAgentOptions): Promise<AgentHandle> {
		this.assertFactoryActive();
		if (await this.ctx.sessions.exists(options.sessionId)) {
			throw new Error(`Session already exists: ${options.sessionId}`);
		}
		await this.ctx.sessions.create(options.sessionId);
		this.assertFactoryActive();
		return this.createHandle(options.sessionId);
	}

	resume(_ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle> {
		return this.trackFactoryOperation(this.resumeInternal(options));
	}

	private async resumeInternal(options: ResumeAgentOptions): Promise<AgentHandle> {
		this.assertFactoryActive();
		if (!(await this.ctx.sessions.exists(options.resumeSessionId))) {
			throw new Error(`Unknown session: ${options.resumeSessionId}`);
		}
		this.assertFactoryActive();
		return this.createHandle(options.resumeSessionId);
	}

	isRunning(sessionId: string): boolean {
		return this.active.has(sessionId);
	}

	abort(sessionId: string): boolean {
		const agent = this.active.get(sessionId);
		if (!agent && !this.pendingSessions.has(sessionId)) return false;
		this.abortRequested.add(sessionId);
		agent?.abort();
		return true;
	}

	/** Stop all foreground runs before dependencies such as tools/models/sessions unload. */
	shutdown(): Promise<void> {
		if (this.shutdownPromise) return this.shutdownPromise;
		this.closed = true;
		for (const sessionId of this.pendingSessions) this.abortRequested.add(sessionId);
		for (const [sessionId, agent] of this.active) {
			this.abortRequested.add(sessionId);
			agent.abort();
		}
		this.shutdownPromise = (async () => {
			await Promise.allSettled([...this.factoryOperations]);
			await Promise.allSettled([...this.handles].map((handle) => handle.dispose()));
			await Promise.allSettled([...this.pending]);
		})();
		return this.shutdownPromise;
	}

	run(prompt: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
		if (this.closed) return Promise.reject(new Error("Agent runtime is shutting down."));
		if (options.sessionId && this.pendingSessions.has(options.sessionId)) {
			return Promise.reject(new Error(`Session ${options.sessionId} already has an active run.`));
		}
		if (options.sessionId) this.pendingSessions.add(options.sessionId);
		const operation = this.runInternal(prompt, options);
		this.pending.add(operation);
		operation.then(
			() => {
				this.pending.delete(operation);
				if (options.sessionId) {
					this.pendingSessions.delete(options.sessionId);
					this.abortRequested.delete(options.sessionId);
				}
			},
			() => {
				this.pending.delete(operation);
				if (options.sessionId) {
					this.pendingSessions.delete(options.sessionId);
					this.abortRequested.delete(options.sessionId);
				}
			},
		);
		return operation;
	}

	private async runInternal(prompt: string, options: AgentRunOptions): Promise<AgentRunResult> {
		if (prompt.trim().length === 0) throw new Error("Prompt cannot be empty.");
		const sessionId = options.sessionId ?? (await this.ctx.sessions.create());
		if (this.closed) throw new Error("Agent runtime is shutting down.");
		if (options.sessionId && !(await this.ctx.sessions.exists(sessionId))) {
			throw new Error(`Unknown session: ${sessionId}`);
		}
		if (this.active.has(sessionId)) throw new Error(`Session ${sessionId} already has an active run.`);

		const lease = await this.ctx.sessions.acquire(sessionId);
		let unsubscribe: (() => void) | undefined;
		let requestApiKey = options.connection?.apiKey;
		try {
			this.assertRunMayStart(sessionId);
			const settings = this.ctx.settings.value.agent;
			const configuredApiKey = settings.apiKeyEnv === undefined ? undefined : (process.env[settings.apiKeyEnv] || undefined);
			const connection: AgentConnection = options.connection ?? {
				provider: settings.provider,
				model: settings.model,
				...(settings.baseUrl === undefined ? {} : { baseUrl: settings.baseUrl }),
				...(configuredApiKey === undefined ? {} : { apiKey: configuredApiKey }),
			};
			requestApiKey = connection.apiKey;
			const resolved = this.ctx.llm.resolveConnection(connection);
			const model = resolved.model;
			const [previousMessages, compaction] = await Promise.all([
				this.ctx.sessions.readMessages(sessionId),
				this.ctx.sessions.readCompaction(sessionId),
			]);
			const compactor = new ContextCompactor({
				model,
				stream: resolved.stream,
				initial: compaction,
				onCompacted: async ({ summary, coveredMessages, tokensBefore }) => {
					await lease.append("context/compacted", {
						summary: redactDurable(summary, [requestApiKey]) as string,
						coveredMessages,
						tokensBefore,
					});
				},
			});
			const systemPrompt = this.ctx.systemPrompt.render() || settings.systemPrompt;
			const workspacePath = options.workspacePath ?? process.cwd();
			const permissionMode = options.permissionMode ?? "ask";
			const edition = options.edition ?? "standard";
			const tools = [...this.ctx.tools.list({ workspacePath, permissionMode, edition, connection })];
			const agent = new Agent({
				initialState: {
					systemPrompt,
					model,
					messages: previousMessages,
					tools,
					thinkingLevel: settings.thinkingLevel ?? "off",
				},
				streamFn: resolved.stream,
				transformContext: (messages, signal) => compactor.transform(messages, signal),
				sessionId,
				toolExecution: settings.toolExecution ?? "parallel",
				beforeToolCall: async ({ toolCall, args }, signal) => {
					const decision = await this.ctx.tools.authorize(
						{
							sessionId,
							toolCallId: toolCall.id,
							toolName: toolCall.name,
							args: redactDurable(args, [requestApiKey]),
							workspacePath,
							permissionMode,
						},
						signal,
					);
					if (decision.allow) return undefined;
					return {
						block: true,
						reason: decision.reason,
						...(decision.terminate === undefined ? {} : { terminate: decision.terminate }),
					};
				},
			});

			this.assertRunMayStart(sessionId);
			this.active.set(sessionId, agent);
			unsubscribe = agent.subscribe(async (event) => this.onAgentEvent(lease, event, requestApiKey));
			await lease.append("run/started", {
				provider: model.provider,
				model: model.id,
				toolNames: tools.map((tool) => tool.name),
				systemPromptSha256: sha256(systemPrompt),
				thinkingLevel: settings.thinkingLevel ?? "off",
				toolExecution: settings.toolExecution ?? "parallel",
			});
			this.assertRunMayStart(sessionId);
			await agent.prompt(prompt);
			if (agent.state.errorMessage) {
				throw new Error(agent.state.errorMessage);
			}
			const lastAssistant = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
			const result: AgentRunResult = {
				sessionId,
				model: { provider: model.provider, id: model.id },
				text: redactDurable(assistantText(lastAssistant), [requestApiKey]) as string,
				messageCount: agent.state.messages.length,
			};
			await lease.append("run/finished", {
				messageCount: result.messageCount,
				error: agent.state.errorMessage ?? null,
			});
			this.ctx.emit("piharness/run-completed", result);
			return result;
		} catch (error) {
			const exposed = redactError(error, [requestApiKey]);
			await lease.append("agent/error", {
				message: exposed.message,
			});
			throw exposed;
		} finally {
			unsubscribe?.();
			this.active.delete(sessionId);
			this.abortRequested.delete(sessionId);
			await lease.release();
		}
	}

	private async onAgentEvent(lease: SessionLease, event: AgentEvent, requestApiKey?: string): Promise<void> {
		const { sessionId } = lease;
		switch (event.type) {
			case "message_end":
				if (isPersistableMessage(event.message)) {
					await lease.append(this.messageEventType(event.message), {
						message: redactDurable(durableMessage(event.message), [requestApiKey]),
					});
				}
				break;
			case "tool_execution_start":
				await lease.append("tool/call", {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: redactDurable(event.args, [requestApiKey]),
				});
				break;
			case "tool_execution_end":
				// Tool-result messages are the durable source of truth; this is live only.
				break;
			default:
				break;
		}
		this.ctx.emit("piharness/agent-event", sessionId, redactDurable(event, [requestApiKey]) as AgentEvent);
	}

	private assertRunMayStart(sessionId: string): void {
		if (this.closed) throw new Error("Agent runtime is shutting down.");
		if (this.abortRequested.has(sessionId)) throw new Error("Agent run aborted.");
	}

	private assertFactoryActive(): void {
		if (this.closed) throw new Error("Agent factory is shutting down.");
	}

	private trackFactoryOperation(operation: Promise<AgentHandle>): Promise<AgentHandle> {
		this.factoryOperations.add(operation);
		operation.then(
			() => this.factoryOperations.delete(operation),
			() => this.factoryOperations.delete(operation),
		);
		return operation;
	}

	private messageEventType(message: Message): "user/message" | "assistant/message" | "tool/result" {
		switch (message.role) {
			case "user":
				return "user/message";
			case "assistant":
				return "assistant/message";
			case "toolResult":
				return "tool/result";
		}
	}

	private createHandle(sessionId: string): AgentHandle {
		let status: HarnessAgentStatus = "idle";
		let current: Promise<AgentRunResult> | undefined;
		const agent: HarnessAgent = {
			id: sessionId,
			get status() {
				return status;
			},
			send: (prompt, options = {}) => {
				if (status === "disposed") return Promise.reject(new Error(`Agent ${sessionId} is disposed.`));
				if (status === "busy") return Promise.reject(new Error(`Agent ${sessionId} is already busy.`));
				status = "busy";
				const operation = this.run(prompt, { sessionId, ...options });
				current = operation;
				operation.then(
					() => {
						if (status !== "disposed") status = "idle";
						if (current === operation) current = undefined;
					},
					() => {
						if (status !== "disposed") status = "idle";
						if (current === operation) current = undefined;
					},
				);
				return operation;
			},
			cancel: () => status === "busy" && this.abort(sessionId),
			whenIdle: async () => {
				await current?.then(
					() => undefined,
					() => undefined,
				);
			},
		};
		let disposal: Promise<void> | undefined;
		const handle: AgentHandle = {
			agent,
			dispose: () => {
				if (disposal) return disposal;
				disposal = (async () => {
					this.handles.delete(handle);
					status = "disposed";
					this.abort(sessionId);
					await agent.whenIdle();
				})();
				return disposal;
			},
		};
		this.handles.add(handle);
		return handle;
	}
}

/** @deprecated Use PiAgentLoop through `ctx.agents`; retained for source compatibility. */
export { PiAgentLoop as PiAgentRuntime };
