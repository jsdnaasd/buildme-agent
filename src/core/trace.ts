export type TraceEngine = "pi" | "dsh";

export interface TraceTurn {
	readonly id: string;                 // turn id，ulid/uuid
	readonly engine: TraceEngine;
	readonly sessionId: string;
	readonly turnIndex: number;          // 本会话第几回合，从 1 开始
	readonly compareGroupId?: string;    // 属于对比组时填写
	readonly parentTurnId?: string;
	readonly parentToolCallId?: string;
	readonly startedAt: string;          // ISO 时间
	endedAt?: string;
	status: "running" | "done" | "error" | "aborted";
	readonly userPrompt: string;
	readonly model: { provider: string; id: string; contextWindow?: number };
	readonly capabilities?: readonly string[];   // 仅 pi：本回合开启的能力 id
	readonly fidelity: TraceFidelity;
	promptSegments: PromptSegment[];
	events: TraceEvent[];
	usage: TraceUsage;                   // 本回合累计
	errorMessage?: string;
}

export interface TraceFidelity {
	readonly promptSegments: boolean;    // 能否拿到分段的系统提示词
	readonly rawRequest: boolean;        // 能否拿到发给模型的原始请求
	readonly usage: "exact" | "estimated" | "none";
	readonly subagents: boolean;
	readonly compaction: boolean;
	readonly approvals: boolean;
}

export interface PromptSegment {
	readonly name: string;               // ctx.systemPrompt 注册时的 section name
	readonly source: "base" | "capability" | "workspace" | "persona" | "skill-catalog" | "dsh" | "other";
	readonly capabilityId?: string;
	readonly sourcePath?: string;        // 来源文件的路径（如 bundles/base/prompts/xxx.md），没有就不填
	readonly text: string;
	readonly chars: number;
	readonly estTokens: number;
}

export interface TraceUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	estimatedCostCny?: number;           // 有单价信息时填写，没有就不填
	modelCalls: number;
	toolCalls: number;
	durationMs: number;
}

export type TraceEvent =
	| { type: "llm.request"; id: string; at: string; round: number;
	    messageCount: number; toolNames: string[];
	    context: ContextBreakdown;       // 本次请求的上下文构成
	    raw?: unknown; rawTruncated?: boolean }                  // 脱敏后的原始请求，可能被截断，见 §4.6
	| { type: "llm.response"; id: string; at: string; round: number; durationMs: number;
	    stopReason?: string; usage?: { input: number; output: number; cacheRead?: number };
	    textPreview: string; toolCalls: { toolCallId: string; name: string }[] }
	| { type: "tool.call"; id: string; at: string; round: number; toolCallId: string;
	    name: string; args: unknown; capabilityId?: string; parallelGroup?: number }
	| { type: "tool.approval"; id: string; at: string; toolCallId: string;
	    decision: "auto-allow" | "user-allow" | "user-deny" | "policy-deny" | "cancelled" | "timeout";
	    permissionMode: string; reason?: string }
	| { type: "tool.result"; id: string; at: string; toolCallId: string; durationMs: number;
	    isError: boolean; resultPreview: string; resultBytes: number; truncated: boolean; result?: string }
	| { type: "skill.catalog"; id: string; at: string; toolCallId?: string; skills: { name: string; description: string; builtin: boolean }[] }
	| { type: "skill.load"; id: string; at: string; toolCallId?: string; name: string; path?: string; chars: number; builtin: boolean }
	| { type: "context.compacted"; id: string; at: string; tokensBefore: number; tokensAfter?: number;
	    coveredMessages: number; summaryPreview: string }
	| { type: "context.clipped"; id: string; at: string; toolCallId?: string; charsBefore: number; charsAfter: number }
	| { type: "context.overflow"; id: string; at: string; estTokens: number; limit: number }   // 压缩关闭时超限
	| { type: "subagent.start"; id: string; at: string; childTurnId: string; kind: string; task: string; toolCallId?: string; stepIndex?: number }
	| { type: "subagent.end"; id: string; at: string; childTurnId: string; durationMs: number; resultPreview: string; isError: boolean; toolCallId?: string }
	| { type: "workflow.step"; id: string; at: string; toolCallId?: string; stepIndex: number; title: string; status: "start" | "end" | "error" }
	| { type: "error"; id: string; at: string; message: string };

export interface ContextBreakdown {
	readonly systemPrompt: number;       // 估算 token
	readonly toolDefinitions: number;
	readonly userMessages: number;
	readonly assistantMessages: number;
	readonly toolResults: number;
	readonly summary: number;            // 压缩摘要
	readonly total: number;
	readonly limit: number;              // 模型上下文窗口减去回复预留
}

export type TraceEventInput = TraceEvent extends infer E
	? E extends TraceEvent ? Omit<E, "id" | "at"> : never
	: never;

export type TraceNotification =
	| { type: "turn-start"; turn: TraceTurn }
	| { type: "event"; turnId: string; event: TraceEvent }
	| { type: "turn-end"; turn: TraceTurn };

export type TraceTurnSummary = Omit<TraceTurn, "events" | "promptSegments" | "userPrompt">;

export function traceSummary(turn: TraceTurn): TraceTurnSummary {
	return {
		id: turn.id, engine: turn.engine, sessionId: turn.sessionId, turnIndex: turn.turnIndex,
		startedAt: turn.startedAt, status: turn.status, model: { ...turn.model }, fidelity: { ...turn.fidelity }, usage: { ...turn.usage },
		...(turn.endedAt === undefined ? {} : { endedAt: turn.endedAt }),
		...(turn.compareGroupId === undefined ? {} : { compareGroupId: turn.compareGroupId }),
		...(turn.parentTurnId === undefined ? {} : { parentTurnId: turn.parentTurnId }),
		...(turn.parentToolCallId === undefined ? {} : { parentToolCallId: turn.parentToolCallId }),
		...(turn.capabilities === undefined ? {} : { capabilities: [...turn.capabilities] }),
		...(turn.errorMessage === undefined ? {} : { errorMessage: turn.errorMessage }),
	};
}

export function updateTraceUsage(usage: TraceUsage, event: TraceEvent): void {
	if (event.type === "llm.request") usage.modelCalls += 1;
	if (event.type === "tool.call") usage.toolCalls += 1;
	if (event.type === "llm.response" && event.usage) {
		usage.inputTokens += event.usage.input;
		usage.outputTokens += event.usage.output;
		usage.cacheReadTokens = (usage.cacheReadTokens ?? 0) + (event.usage.cacheRead ?? 0);
	}
}

export function estimateTokens(text: string): number {
	let cjk = 0;
	let other = 0;
	for (const char of text) {
		if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char)) cjk += 1;
		else other += 1;
	}
	return cjk + Math.ceil(other / 4);
}
