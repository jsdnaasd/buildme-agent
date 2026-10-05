import { createHash, randomUUID } from "node:crypto";
import { access, chmod, cp, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, Notification, safeStorage, session, shell } from "electron";

import { applyProxyFromEnv, createApp, hasProxyEnv, initProfile, loadProfile, proxyUrlFromPac } from "../dist/index.js";
import { ACTIVE_API_KEY_ENV, DshEngine, dshRoute, fullEditionPrompt } from "./dsh-engine.mjs";
import { CAPABILITIES, ALL_CAPABILITIES, resolveCapabilities, toggleCapability, CapabilityUsageStore, TraceStore, redactTrace } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const APP_NAME = "BuildMe";
const LEGACY_APP_NAME = "我的 Agent";
const CONFIG_FILE = "desktop-settings.json";
const PROFILE_FILE = "profile.json";
const PROFILE_DIR = "profile";
const DSH_HOME_DIR = "dsh";
const FULL_SESSIONS_FILE = "full-sessions.json";
const DEFAULT_CONNECTION_ID = "deepseek-default";
const DEFAULT_PROVIDER = "deepseek";
const DEFAULT_MODEL = "deepseek-v4-flash";
const PERMISSION_MODES = new Set(["ask", "workspace-write", "bypass"]);
const THEMES = new Set(["system", "light", "dark"]);
const EDITIONS = new Set(["standard", "full"]);
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const MARKET_URLS = Object.freeze({
  "pi-community-popular": "https://pi.dev/packages",
  "pi-community-github": "https://github.com/search?q=topic%3Api-coding-agent&type=repositories&s=stars&o=desc",
  "pi-community-reddit": "https://www.reddit.com/r/PiCodingAgent/top/?t=month",
});

const PROVIDER_API_KEY_ENV = Object.freeze({
  "ai-gateway": "AI_GATEWAY_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  "ant-ling": "ANT_LING_API_KEY",
  baseten: "BASETEN_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  "cloudflare-ai-gateway": "CLOUDFLARE_API_KEY",
  "cloudflare-workers-ai": "CLOUDFLARE_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  google: "GEMINI_API_KEY",
  "google-vertex": "GOOGLE_CLOUD_API_KEY",
  groq: "GROQ_API_KEY",
  huggingface: "HF_TOKEN",
  "kimi-coding": "KIMI_API_KEY",
  minimax: "MINIMAX_API_KEY",
  "minimax-cn": "MINIMAX_CN_API_KEY",
  mistral: "MISTRAL_API_KEY",
  moonshotai: "MOONSHOT_API_KEY",
  "moonshotai-cn": "MOONSHOT_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  openai: "OPENAI_API_KEY",
  "openai-compatible": "OPENAI_API_KEY",
  opencode: "OPENCODE_API_KEY",
  "opencode-go": "OPENCODE_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  "qwen-token-plan": "QWEN_TOKEN_PLAN_API_KEY",
  "qwen-token-plan-cn": "QWEN_TOKEN_PLAN_CN_API_KEY",
  "qwen-token-plan-individual": "QWEN_TOKEN_PLAN_API_KEY",
  together: "TOGETHER_API_KEY",
  "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
  xai: "XAI_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
  "xiaomi-token-plan-ams": "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
  "xiaomi-token-plan-cn": "XIAOMI_TOKEN_PLAN_CN_API_KEY",
  "xiaomi-token-plan-sgp": "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
  zai: "ZAI_API_KEY",
  "zai-coding-cn": "ZAI_CODING_CN_API_KEY",
  "azure-openai": "AZURE_OPENAI_API_KEY",
  "azure-openai-responses": "AZURE_OPENAI_API_KEY",
});

let mainWindow;
let harnessApp;
let harnessPromise;
let stopStream;
let stopApprovals;
let stopTrace;
let traceStore;
let capabilityUsage;
let quitting = false;
let profilePathPromise;
const pendingApprovals = new Map();
/** Full edition (DSH engine) state. */
let dshEngine;
let dshEngineFingerprint;
let activeFullSessionId;
/** Sessions whose current turn was started from the BuildMe composer. */
const desktopRunningSessions = new Set();
let fullRunPending = false;
const scheduleResumedEngines = new WeakSet();

function appDataPath(name) {
  return join(app.getPath("userData"), name);
}

function getTraceStore() {
  traceStore ??= new TraceStore(appDataPath("traces"));
  return traceStore;
}

function getCapabilityUsage() {
  capabilityUsage ??= new CapabilityUsageStore(appDataPath("capability-usage.json"));
  return capabilityUsage;
}

async function capabilityState(config) {
  return {
    capabilities: config.capabilities ?? ["core"],
    capabilityOnboarding: config.capabilities === undefined,
    capabilityRegistry: CAPABILITIES,
    capabilityUsage: await getCapabilityUsage().counts(),
  };
}

async function migrateLegacyUserData() {
  const legacyRoot = join(app.getPath("appData"), LEGACY_APP_NAME);
  const targetRoot = app.getPath("userData");
  if (legacyRoot === targetRoot) return;
  for (const entry of [CONFIG_FILE, PROFILE_FILE, PROFILE_DIR]) {
    const source = join(legacyRoot, entry);
    const target = join(targetRoot, entry);
    try {
      await access(target);
      continue;
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
    }
    try {
      await access(source);
      await mkdir(dirname(target), { recursive: true });
      await cp(source, target, { recursive: true, errorOnExist: true });
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
    }
  }
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return fallback;
    throw new Error(`本地设置读取失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function defaultConnection(apiKey) {
  return {
    id: DEFAULT_CONNECTION_ID,
    name: "DeepSeek",
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    ...(apiKey ? { apiKey } : {}),
  };
}

function decryptApiKey(value) {
  const encrypted = optionalString(value?.apiKeyEncrypted);
  if (encrypted) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("系统密钥存储当前不可用，模型密钥尚未解锁。");
    try {
      return optionalString(safeStorage.decryptString(Buffer.from(encrypted, "base64")));
    } catch (error) {
      throw new Error(`模型密钥解密失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return optionalString(value?.apiKey);
}

function normalizeStoredConnection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const id = optionalString(value.id);
  const provider = optionalString(value.provider);
  const model = optionalString(value.model);
  if (!id || !provider || !model) return undefined;
  const apiKey = decryptApiKey(value);
  return {
    id,
    name: optionalString(value.name) ?? `${provider} / ${model}`,
    provider,
    model,
    ...(optionalString(value.baseUrl) ? { baseUrl: value.baseUrl.trim() } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

function normalizeConfig(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const legacyKey = optionalString(source.deepseekApiKey);
  const hasConnectionList = Array.isArray(source.connections);
  const seen = new Set();
  const connections = (hasConnectionList ? source.connections : [])
    .map(normalizeStoredConnection)
    .filter((connection) => {
      if (!connection || seen.has(connection.id)) return false;
      seen.add(connection.id);
      return true;
    });
  if (!hasConnectionList && connections.length === 0) connections.push(defaultConnection(legacyKey));
  else if (legacyKey && !connections.some((connection) => connection.apiKey)) connections[0].apiKey = legacyKey;
  const requestedActive = optionalString(source.activeConnectionId);
  const activeConnectionId = connections.some((connection) => connection.id === requestedActive)
    ? requestedActive
    : connections[0]?.id;
  return {
    schemaVersion: 2,
    connections,
    ...(activeConnectionId ? { activeConnectionId } : {}),
    ...(optionalString(source.workspacePath) ? { workspacePath: source.workspacePath.trim() } : {}),
    permissionMode: PERMISSION_MODES.has(source.permissionMode) ? source.permissionMode : "ask",
    theme: THEMES.has(source.theme) ? source.theme : "system",
    edition: EDITIONS.has(source.edition) ? source.edition : "standard",
    recordRawRequests: source.recordRawRequests !== false,
    ...(source.capabilities !== undefined ? { capabilities: resolveCapabilities(source.capabilities) } : {}),
  };
}

async function getConfig() {
  return normalizeConfig(await readJson(appDataPath(CONFIG_FILE), {}));
}

async function saveConfig(config) {
  const normalized = normalizeConfig(config);
  const connections = normalized.connections.map(({ apiKey, ...connection }) => {
    if (!apiKey) return connection;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("系统密钥存储当前不可用，模型密钥尚未保存。");
    return { ...connection, apiKeyEncrypted: safeStorage.encryptString(apiKey).toString("base64") };
  });
  await writePrivateJson(appDataPath(CONFIG_FILE), { ...normalized, connections });
  return normalized;
}

function activeConnection(config) {
  return config.connections.find((connection) => connection.id === config.activeConnectionId);
}

function apiKeyEnvironment(provider) {
  return PROVIDER_API_KEY_ENV[provider.toLowerCase()];
}

function resolvedApiKey(connection) {
  if (!connection) return undefined;
  if (connection.apiKey) return connection.apiKey;
  const variable = apiKeyEnvironment(connection.provider);
  return variable ? optionalString(process.env[variable]) : undefined;
}

function publicConnection(connection, config, configured = Boolean(resolvedApiKey(connection) || connection.baseUrl)) {
  return {
    id: connection.id,
    name: connection.name,
    provider: connection.provider,
    model: connection.model,
    ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
    configured,
    active: connection.id === config.activeConnectionId,
  };
}

function publicWorkspace(config) {
  return config.workspacePath ? { path: config.workspacePath, name: basename(config.workspacePath) } : null;
}

function isDefaultLegacyAllowList(entry) {
	return entry?.id === "policy.allow-list"
		&& Array.isArray(entry.config?.allowed)
		&& entry.config.allowed.length === 1
		&& entry.config.allowed[0] === "workspace_info";
}

async function migrateLegacyDesktopProfile(path) {
	const profile = await readJson(path, null);
	if (!profile || profile.schemaVersion !== 1 || !Array.isArray(profile.plugins)) return;
	const migrated = [];
	const ids = new Set();
	let changed = false;
	for (const sourceEntry of profile.plugins) {
		if (!sourceEntry || typeof sourceEntry !== "object") continue;
		if (isDefaultLegacyAllowList(sourceEntry)) {
			changed = true;
			continue;
		}
		const entry = sourceEntry.id === "model.pi-ai-deepseek"
			? { ...sourceEntry, id: "model.pi-ai-builtins" }
			: sourceEntry;
		if (entry !== sourceEntry) changed = true;
		if (typeof entry.id === "string" && ids.has(entry.id)) {
			changed = true;
			continue;
		}
		if (typeof entry.id === "string") ids.add(entry.id);
		migrated.push(entry);
	}
	for (const id of ["tool.workspace-tools-pi", "tool.document-tools", "tool.full-edition-tools", "policy.permission-mode"]) {
		if (ids.has(id)) continue;
		migrated.push({ id });
		ids.add(id);
		changed = true;
	}
	if (changed) await writePrivateJson(path, { ...profile, plugins: migrated });
}

async function resolveProfilePath() {
  const legacyPath = appDataPath(PROFILE_FILE);
  try {
    await access(legacyPath);
		await migrateLegacyDesktopProfile(legacyPath);
    return legacyPath;
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
  }
  return initProfile(appDataPath(PROFILE_DIR), APP_NAME);
}

function ensureProfile() {
	if (!profilePathPromise) {
		profilePathPromise = resolveProfilePath().catch((error) => {
			profilePathPromise = undefined;
			throw error;
		});
	}
	return profilePathPromise;
}

function approvalPayload(request, requestId) {
  const source = request && typeof request === "object" ? request : {};
  return {
    requestId,
    ...(optionalString(source.sessionId) ? { sessionId: source.sessionId.trim() } : {}),
    ...(optionalString(source.toolCallId) ? { toolCallId: source.toolCallId.trim() } : {}),
    toolName: optionalString(source.toolName) ?? "工具",
    ...(source.args === undefined ? {} : { args: source.args }),
    ...(optionalString(source.workspacePath) ? { workspacePath: source.workspacePath.trim() } : {}),
    permissionMode: PERMISSION_MODES.has(source.permissionMode) ? source.permissionMode : "ask",
  };
}

function settleApproval(requestId, allow) {
  const pending = pendingApprovals.get(requestId);
  if (!pending) return false;
  pendingApprovals.delete(requestId);
  clearTimeout(pending.timer);
  pending.resolve(allow);
  return true;
}

function settleAllApprovals() {
  for (const requestId of [...pendingApprovals.keys()]) settleApproval(requestId, false);
}

async function requestToolApproval(request) {
  const config = await getConfig();
  if (config.permissionMode === "bypass") return true;
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const requestId = optionalString(request?.requestId) ?? randomUUID();
  if (pendingApprovals.has(requestId)) settleApproval(requestId, false);
  return new Promise((resolveApproval) => {
    const timer = setTimeout(() => settleApproval(requestId, false), APPROVAL_TIMEOUT_MS);
    timer.unref?.();
    pendingApprovals.set(requestId, { resolve: resolveApproval, timer });
    mainWindow.webContents.send("desktop:approval", approvalPayload(request, requestId));
  });
}

// ── Full edition: the real DeepSeek Harness engine behind the BuildMe UI ──

function sendToWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

async function stopDshEngine() {
  const engine = dshEngine;
  dshEngine = undefined;
  dshEngineFingerprint = undefined;
  activeFullSessionId = undefined;
  if (engine) await engine.stop().catch(() => engine.kill());
}

/** Pi catalog provider ids, used to tell catalog providers from hand-declared relays. */
async function catalogProviderIds() {
  try {
    const runtime = await ensureHarness();
    const llm = findRuntimeService(runtime, "llm");
    return typeof llm?.catalog === "function" ? new Set(llm.catalog().map((provider) => provider.id)) : undefined;
  } catch {
    return undefined;
  }
}

/** Start (or reuse) the DSH engine for the active connection. */
async function ensureDshEngine(config) {
  const selected = activeConnection(config);
  if (!selected) throw new Error("请先添加并选择一个模型连接。");
  const route = dshRoute(selected, await catalogProviderIds());
  const apiKey = resolvedApiKey(selected);
  if (!apiKey && route.provider === "deepseek-official") throw new Error("全量版需要 DeepSeek API Key，请在「模型与偏好」中填写。");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([route.provider, route.model, route.piAiProviders ?? null, apiKey ?? ""]))
    .digest("hex");
  if (dshEngine && dshEngineFingerprint !== fingerprint) await stopDshEngine();
  if (!dshEngine) {
    dshEngineFingerprint = fingerprint;
    dshEngine = new DshEngine({
      dshHome: appDataPath(DSH_HOME_DIR),
      bridgePath: join(here, "..", "dist", "full", "dsh-bridge.js"),
      systemPrompt: await fullEditionPrompt(join(here, "..", "bundles", "base", "prompts")),
      cwd: config.workspacePath ?? app.getPath("home"),
      nodePath: process.execPath,
      ...(route.piAiProviders ? { piAiProviders: route.piAiProviders } : {}),
      env: {
        ...(apiKey ? { [ACTIVE_API_KEY_ENV]: apiKey } : {}),
        // DSH's native DeepSeek adapter and its web_search read this variable.
        ...(apiKey && selected.provider === "deepseek" ? { DEEPSEEK_API_KEY: apiKey } : {}),
      },
      onStream: (event) => {
        if (event && typeof event.sessionId === "string") activeFullSessionId = event.sessionId;
        sendToWindow("desktop:stream", event);
      },
      onStatus: ({ sessionId, status }) => {
        if (status !== "idle" || typeof sessionId !== "string") return;
        if (desktopRunningSessions.has(sessionId) || (fullRunPending && sessionId === activeFullSessionId)) return;
        // A turn nobody started from the composer: a scheduled reminder fired.
        sendToWindow("desktop:stream", { type: "background-done", sessionId });
        void notifyBackgroundTurn(sessionId);
      },
      onApproval: async (request) => requestToolApproval({ ...request, permissionMode: (await getConfig()).permissionMode }),
      onLog: (line) => { if (!line.includes("reasoning")) console.error(`[DSH] ${line}`); },
    });
  }
  const engine = dshEngine;
  await engine.start();
  if (!scheduleResumedEngines.has(engine)) {
    scheduleResumedEngines.add(engine);
    void resumeScheduledSessions(engine, route);
  }
  return { engine, selected, route };
}

/**
 * Reminders only fire in live sessions. After the engine starts, bring every
 * session with pending reminders live: overdue ones are delivered at once and
 * the rest fire on time while BuildMe keeps running (also with the window closed on macOS).
 */
async function resumeScheduledSessions(engine, route) {
  try {
    const resumed = await engine.request("schedule/resume-pending", { provider: route.provider, model: route.model });
    if (resumed.length) console.error(`[DSH] 已恢复 ${resumed.length} 个有待办提醒的会话`);
  } catch (error) {
    console.error(`[DSH] 恢复定时提醒失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** In full edition the engine starts with the app, so reminders run without a prompt. */
async function startFullEditionInBackground() {
  try {
    const config = await getConfig();
    if (config.edition === "full") await ensureDshEngine(config);
  } catch (error) {
    console.error(`[DSH] 全量版后台启动失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function notifyBackgroundTurn(sessionId) {
  if (!Notification.isSupported()) return;
  const title = (await readFullSessionIndex())[sessionId]?.title ?? "对话";
  const notification = new Notification({ title: "BuildMe 定时任务已完成", body: `会话「${title}」有新的回复。` });
  notification.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.webContents.send("desktop:stream", { type: "open-session", sessionId });
  });
  notification.show();
}

async function readFullSessionIndex() {
  const index = await readJson(appDataPath(FULL_SESSIONS_FILE), {});
  return index && typeof index === "object" && !Array.isArray(index) ? index : {};
}

async function recordFullSession(sessionId, prompt) {
  const index = await readFullSessionIndex();
  const current = index[sessionId] ?? {};
  index[sessionId] = {
    title: current.title ?? prompt.replace(/\s+/g, " ").slice(0, 40),
    turnCount: (Number.isFinite(current.turnCount) ? current.turnCount : 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  await writePrivateJson(appDataPath(FULL_SESSIONS_FILE), index);
}

async function fullSessions() {
  const config = await getConfig();
  let engine;
  try {
    ({ engine } = await ensureDshEngine(config));
  } catch {
    return [];
  }
  const [items, index] = await Promise.all([engine.request("session/list"), readFullSessionIndex()]);
  return items
    .map((item) => {
      const known = index[item.id] ?? {};
      return {
        id: item.id,
        title: known.title ?? "对话",
        createdAt: item.createdAt,
        updatedAt: known.updatedAt ?? item.createdAt,
        turnCount: Number.isFinite(known.turnCount) ? known.turnCount : undefined,
        health: "healthy",
      };
    })
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

async function fullSend(prompt, requestedSession) {
  const config = await getConfig();
  const { engine, route } = await ensureDshEngine(config);
  activeFullSessionId = requestedSession;
  fullRunPending = true;
  if (requestedSession) desktopRunningSessions.add(requestedSession);
  let result;
  try {
    result = await engine.request("session/run", {
      ...(requestedSession ? { sessionId: requestedSession } : {}),
      provider: route.provider,
      model: route.model,
      text: prompt,
      cwd: config.workspacePath ?? app.getPath("home"),
      permissionMode: config.permissionMode,
    });
  } finally {
    fullRunPending = false;
    if (requestedSession) desktopRunningSessions.delete(requestedSession);
    activeFullSessionId = undefined;
  }
  await recordFullSession(result.sessionId, prompt);
  if (result.reason === "error") throw new Error(result.error || "DSH 运行失败。");
  return { sessionId: result.sessionId, text: result.text, cancelled: result.reason === "cancelled" };
}

function ensureHarness() {
  if (harnessApp) return Promise.resolve(harnessApp);
  if (harnessPromise) return harnessPromise;

  harnessPromise = (async () => {
    const profile = await loadProfile(await ensureProfile());
    const runtime = await createApp(profile);
    stopStream = runtime.ctx.on("piharness/agent-event", (sessionId, event) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        mainWindow.webContents.send("desktop:stream", { type: "text", sessionId, delta: event.assistantMessageEvent.delta });
        return;
      }
      if (event.type === "tool_execution_start") {
        mainWindow.webContents.send("desktop:stream", { type: "tool", sessionId, name: event.toolName });
      }
    });
    stopApprovals = runtime.ctx.on("piharness/tool-approval-request", requestToolApproval);
    stopTrace = runtime.ctx.on("piharness/trace", (notification) => {
      try {
        const safe = redactTrace(notification);
        void getTraceStore().accept(safe);
        if (safe.type === "turn-end" && safe.turn.engine === "pi") {
          void getCapabilityUsage().accept(safe.turn).then(async () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("desktop:capability-usage", await getCapabilityUsage().counts());
          }).catch(() => console.warn("[能力] 本回合使用次数未能保存。"));
        }
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("desktop:xray", safe);
      } catch {
        console.warn("[X 光] 桌面记录失败，本回合的观察数据可能不完整。");
      }
    });
    harnessApp = runtime;
    return runtime;
  })().catch((error) => {
    harnessPromise = undefined;
    throw error;
  });
  return harnessPromise;
}

function findRuntimeService(runtime, name) {
  const direct = runtime.ctx[name] ?? runtime.ctx.get?.(name, false);
  if (direct) return direct;
  const loader = runtime.ctx.loader ?? runtime.ctx.get?.("loader", false);
  if (typeof loader?.entries !== "function") return undefined;
  for (const entry of loader.entries()) {
    const service = entry?.fiber?.ctx?.[name] ?? entry?.fiber?.ctx?.get?.(name, false);
    if (service) return service;
  }
  return undefined;
}

async function requireRuntimeService(name, timeoutMs = 5000) {
  const runtime = await ensureHarness();
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const service = findRuntimeService(runtime, name);
    if (service) return service;
    if (Date.now() >= deadline) throw new Error(`运行时服务尚未就绪：${name}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
}

function messageText(message) {
  if (!message || typeof message !== "object") return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      if (block.type === "text") return typeof block.text === "string" ? block.text : "";
      if (block.type === "toolCall") return `正在使用：${typeof block.name === "string" ? block.name : "工具"}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

async function sessionMessages(sessionId) {
  const sessions = await requireRuntimeService("sessions");
  const events = await sessions.read(sessionId);
  let turnIndex = 0;
  return events.flatMap((event) => {
    if (event.type === "user/message") turnIndex += 1;
    if (event.type !== "user/message" && event.type !== "assistant/message" && event.type !== "tool/result") return [];
    const message = event.data && typeof event.data === "object" ? event.data.message : undefined;
    const text = messageText(message);
    if (!text) return [];
    return [{
      id: event.id,
      role: event.type === "user/message" ? "user" : event.type === "assistant/message" ? "assistant" : "tool",
      text,
      at: event.at,
      turnIndex,
    }];
  });
}

function parsePrompt(value) {
  if (typeof value !== "string") throw new Error("消息格式不正确。");
  const prompt = value.trim();
  if (!prompt) throw new Error("请输入消息。");
  if (prompt.length > 100000) throw new Error("消息过长。");
  return prompt;
}

function parseSessionId(value) {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error("会话标识不正确。");
  }
  return value;
}

function requireSessionId(value) {
  const sessionId = parseSessionId(value);
  if (!sessionId) throw new Error("请选择一个会话。");
  return sessionId;
}

function requiredConnectionField(value, label, maximum = 256) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空。`);
  const result = value.trim();
  if (result.length > maximum) throw new Error(`${label}过长。`);
  return result;
}

function parseConnectionId(value) {
  const id = requiredConnectionField(value, "连接标识", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new Error("连接标识格式不正确。");
  return id;
}

function parseBaseUrl(value) {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw new Error("Base URL 格式不正确。");
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Base URL 格式不正确。");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Base URL 仅支持 HTTP 或 HTTPS。");
  return parsed.toString().replace(/\/$/, "");
}

async function desktopState() {
  const config = await getConfig();
  const [profile, runtime] = await Promise.all([loadProfile(await ensureProfile()), ensureHarness()]);
  const connections = await Promise.all(config.connections.map(async (connection) => {
    let configured = Boolean(resolvedApiKey(connection) || connection.baseUrl);
    if (!configured && typeof runtime.ctx.llm?.authSummary === "function") {
      try {
        configured = (await runtime.ctx.llm.authSummary(connection.provider)) !== "provider is not registered or configured";
      } catch {
        configured = false;
      }
    }
    return publicConnection(connection, config, configured);
  }));
  const catalog = typeof runtime.ctx.llm?.catalog === "function"
    ? runtime.ctx.llm.catalog().map((provider) => ({
        id: provider.id,
        name: provider.name,
        models: provider.models.map((model) => ({
          id: model.id,
          name: model.name,
          api: model.api,
          reasoning: model.reasoning,
          input: [...model.input],
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
        })),
      }))
    : [];
  return {
    name: profile.profile.settings.name,
    configured: Boolean(connections.find((connection) => connection.active)?.configured),
    connections,
    activeConnectionId: config.activeConnectionId ?? null,
    workspace: publicWorkspace(config),
    permissionMode: config.permissionMode,
    theme: config.theme,
    edition: config.edition,
    recordRawRequests: config.recordRawRequests,
    ...await capabilityState(config),
    fullTools: config.edition === "full" && dshEngine?.running
      ? await dshEngine.request("tools/list").then((tools) => tools.map((tool) => tool.name), () => [])
      : [],
    catalog,
  };
}

async function saveConnection(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("模型连接格式不正确。");
  const config = await getConfig();
  const suppliedId = payload.id === undefined ? undefined : parseConnectionId(payload.id);
  const index = suppliedId === undefined ? -1 : config.connections.findIndex((connection) => connection.id === suppliedId);
  const current = index >= 0 ? config.connections[index] : undefined;
  const id = suppliedId ?? randomUUID();
  const provider = requiredConnectionField(payload.provider ?? current?.provider, "Provider", 128);
  const model = requiredConnectionField(payload.model ?? current?.model, "模型标识", 256);
  const name = requiredConnectionField(payload.name ?? current?.name ?? `${provider} / ${model}`, "连接名称", 128);
  const baseUrl = Object.hasOwn(payload, "baseUrl") ? parseBaseUrl(payload.baseUrl) : current?.baseUrl;
  let apiKey = current?.apiKey;
  if (Object.hasOwn(payload, "apiKey")) {
    if (typeof payload.apiKey !== "string") throw new Error("密钥格式不正确。");
    if (payload.apiKey.length > 100000) throw new Error("密钥过长。");
    apiKey = optionalString(payload.apiKey);
  }
  const connection = { id, name, provider, model, ...(baseUrl ? { baseUrl } : {}), ...(apiKey ? { apiKey } : {}) };
  if (index >= 0) config.connections[index] = connection;
  else config.connections.push(connection);
  if (payload.makeActive === true || !config.activeConnectionId || !current) config.activeConnectionId = id;
  const saved = await saveConfig(config);
  return desktopState();
}

async function deleteConnection(value) {
  const id = parseConnectionId(value);
  const config = await getConfig();
  const nextConnections = config.connections.filter((connection) => connection.id !== id);
  if (nextConnections.length === config.connections.length) throw new Error("模型连接不存在。");
  config.connections = nextConnections;
  if (config.activeConnectionId === id) config.activeConnectionId = nextConnections[0]?.id;
  const saved = await saveConfig(config);
  return desktopState();
}

async function selectConnection(value) {
  const id = parseConnectionId(value);
  const config = await getConfig();
  if (!config.connections.some((connection) => connection.id === id)) throw new Error("模型连接不存在。");
  config.activeConnectionId = id;
  const saved = await saveConfig(config);
  return desktopState();
}

async function normalizeWorkspacePath(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("工作区路径格式不正确。");
  const path = await realpath(resolve(value.trim()));
  const details = await stat(path);
  if (!details.isDirectory()) throw new Error("工作区必须是文件夹。");
  return path;
}

async function setWorkspace(value) {
  const config = await getConfig();
  if (value === null || value === undefined || value === "") {
    delete config.workspacePath;
    await saveConfig(config);
    return null;
  }
  const path = await normalizeWorkspacePath(value);
  config.workspacePath = path;
  await saveConfig(config);
  return { path, name: basename(path) };
}

async function chooseWorkspace() {
  const config = await getConfig();
  const options = {
    title: "选择 Agent 工作区",
    buttonLabel: "选择文件夹",
    properties: ["openDirectory", "createDirectory"],
    ...(config.workspacePath ? { defaultPath: config.workspacePath } : {}),
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return publicWorkspace(config);
  return setWorkspace(result.filePaths[0]);
}

async function setPermissionMode(value) {
  if (!PERMISSION_MODES.has(value)) throw new Error("权限模式不正确。");
  const config = await getConfig();
  config.permissionMode = value;
  await saveConfig(config);
  return value;
}

async function setTheme(value) {
  if (!THEMES.has(value)) throw new Error("主题设置不正确。");
  const config = await getConfig();
  config.theme = value;
  await saveConfig(config);
  nativeTheme.themeSource = value;
  return value;
}

async function setEdition(value) {
  if (!EDITIONS.has(value)) throw new Error("版本模式不正确。");
  const config = await getConfig();
  if (value === "full") await ensureDshEngine(config);
  else await stopDshEngine();
  config.edition = value;
  await saveConfig(config);
  return desktopState();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    title: APP_NAME,
    backgroundColor: "#101214",
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.on("closed", () => {
    settleAllApprovals();
    mainWindow = undefined;
  });
  mainWindow.loadFile(join(here, "renderer", "index.html"));
}

ipcMain.handle("desktop:state", () => desktopState());
ipcMain.handle("desktop:catalog", async () => {
  const runtime = await ensureHarness();
  const llm = findRuntimeService(runtime, "llm");
  return typeof llm?.catalog === "function" ? llm.catalog() : [];
});
ipcMain.handle("desktop:sessions", async () => {
  if ((await getConfig()).edition === "full") return fullSessions();
  const sessions = await requireRuntimeService("sessions");
  return sessions.list();
});
ipcMain.handle("desktop:messages", async (_event, sessionId) => {
  const id = requireSessionId(sessionId);
  if ((await getConfig()).edition === "full") {
    const { engine } = await ensureDshEngine(await getConfig());
    return engine.request("session/messages", { sessionId: id });
  }
  return sessionMessages(id);
});
ipcMain.handle("desktop:xray-turns", async (_event, sessionId) => {
  const config = await getConfig();
  return getTraceStore().turns(config.edition === "full" ? "dsh" : "pi", requireSessionId(sessionId));
});
ipcMain.handle("desktop:xray-turn", (_event, turnId) => getTraceStore().turn(requireSessionId(turnId)));
ipcMain.handle("desktop:xray-prompt-source", async (_event, turnId, segmentIndex, open) => {
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || typeof open !== "boolean") throw new Error("提示词来源参数不正确。");
  const turn = await getTraceStore().turn(requireSessionId(turnId));
  const source = turn?.promptSegments[segmentIndex]?.sourcePath;
  if (!source) throw new Error("这段提示词没有记录来源路径。");
  if (!isAbsolute(source) && !source.startsWith("bundles/")) throw new Error("相对路径缺少原始目录，请复制路径查找。");
  const path = await realpath(isAbsolute(source) ? source : resolve(here, "..", source));
  const bundles = await realpath(join(here, "..", "bundles"));
  const withinBundles = relative(bundles, path);
  const readOnly = withinBundles !== ".." && !withinBundles.startsWith(`..${sep}`) && !isAbsolute(withinBundles);
  if (!isAbsolute(source) && !readOnly) throw new Error("来源路径不在内置提示词目录中。");
  if (!(await stat(path)).isFile() || ![".md", ".txt", ".json", ".yaml", ".yml", ".toml"].includes(extname(path).toLowerCase())) throw new Error("仅支持打开提示词文本文件，请复制路径查找。");
  if (open) {
    if (readOnly) throw new Error("内置文件只提供路径复制。");
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  }
  return { path, readOnly };
});
ipcMain.handle("desktop:set-record-raw-requests", async (_event, enabled) => {
  if (typeof enabled !== "boolean") throw new Error("原始请求记录选项不正确。");
  await saveConfig({ ...await getConfig(), recordRawRequests: enabled });
  return enabled;
});
ipcMain.handle("desktop:set-capability", async (_event, id, enabled) => {
  if (typeof id !== "string" || typeof enabled !== "boolean") throw new Error("能力配置格式不正确。");
  const config = await getConfig();
  const capabilities = toggleCapability(config.capabilities ?? ["core"], id, enabled);
  const saved = await saveConfig({ ...config, capabilities });
  return capabilityState(saved);
});
ipcMain.handle("desktop:choose-capabilities", async (_event, choice) => {
  if (choice !== "minimal" && choice !== "all") throw new Error("请选择最小能力或全部能力。");
  const saved = await saveConfig({ ...await getConfig(), capabilities: choice === "all" ? ALL_CAPABILITIES : ["core"] });
  return capabilityState(saved);
});
ipcMain.handle("desktop:send", async (_event, payload) => {
  const prompt = parsePrompt(payload?.prompt);
  const requestedSession = parseSessionId(payload?.sessionId);
  const config = await getConfig();
  if (config.edition === "full") return fullSend(prompt, requestedSession);
  const selected = activeConnection(config);
  if (!selected) throw new Error("请先添加并选择一个模型连接。");
  const apiKey = resolvedApiKey(selected);
  const llm = await requireRuntimeService("llm");
  const agents = await requireRuntimeService("agents");
  const knownProvider = typeof llm.catalog === "function"
    && llm.catalog().some((provider) => provider.id === selected.provider);
  if (!knownProvider && !selected.baseUrl) throw new Error("未知 Provider 需要配置 Base URL。");
  try {
    return await agents.run(prompt, {
      ...(requestedSession ? { sessionId: requestedSession } : {}),
      connection: {
        provider: selected.provider,
        model: selected.model,
        ...(apiKey ? { apiKey } : {}),
        ...(selected.baseUrl ? { baseUrl: selected.baseUrl } : {}),
      },
      ...(config.workspacePath ? { workspacePath: config.workspacePath } : {}),
      permissionMode: config.permissionMode,
      edition: "full",
      capabilities: config.capabilities ?? ["core"],
      recordRawRequests: config.recordRawRequests,
    });
  } finally {
    await traceStore?.flush();
  }
});
ipcMain.handle("desktop:abort", async (_event, sessionId) => {
  const requestedSession = parseSessionId(sessionId);
  if ((await getConfig()).edition === "full") {
    const target = requestedSession ?? activeFullSessionId;
    if (!dshEngine || !target) return { cancelled: false };
    return dshEngine.request("session/cancel", { sessionId: target });
  }
  const agents = await requireRuntimeService("agents");
  const activeSession = requestedSession
    ?? agents.list().find((agent) => agent.status === "busy")?.id;
  return agents.abort(activeSession);
});
ipcMain.handle("desktop:save-connection", (_event, payload) => saveConnection(payload));
ipcMain.handle("desktop:delete-connection", (_event, id) => deleteConnection(id));
ipcMain.handle("desktop:select-connection", (_event, id) => selectConnection(id));
ipcMain.handle("desktop:choose-workspace", () => chooseWorkspace());
ipcMain.handle("desktop:set-workspace", (_event, path) => setWorkspace(path));
ipcMain.handle("desktop:set-permission-mode", (_event, mode) => setPermissionMode(mode));
ipcMain.handle("desktop:set-theme", (_event, theme) => setTheme(theme));
ipcMain.handle("desktop:set-edition", (_event, edition) => setEdition(edition));
ipcMain.handle("desktop:approval-response", (_event, requestId, allow) => {
  const id = requiredConnectionField(requestId, "审批请求标识", 128);
  if (typeof allow !== "boolean") throw new Error("审批结果格式不正确。");
  return { accepted: settleApproval(id, allow) };
});
ipcMain.handle("desktop:read-clipboard-text", () => clipboard.readText());
ipcMain.handle("desktop:write-clipboard-text", (_event, text) => {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 16 * 1024 * 1024) throw new Error("复制内容必须是 16 MiB 以内的文本。");
  clipboard.writeText(text);
});
ipcMain.handle("desktop:open-full-edition", () => setEdition("full"));
ipcMain.handle("desktop:open-market", async (_event, id) => {
  if (typeof id !== "string" || !(id in MARKET_URLS)) throw new Error("插件市场来源不正确。");
  await shell.openExternal(MARKET_URLS[id]);
  return MARKET_URLS[id];
});

// Compatibility for the first Desktop renderer: update the active connection's key.
ipcMain.handle("desktop:save-key", async (_event, key) => {
  if (typeof key !== "string") throw new Error("密钥格式不正确。");
  const config = await getConfig();
  let connection = activeConnection(config);
  if (!connection) {
    connection = defaultConnection();
    config.connections.push(connection);
    config.activeConnectionId = connection.id;
  }
  if (key.trim()) connection.apiKey = key.trim();
  else delete connection.apiKey;
  const saved = await saveConfig(config);
  return { configured: Boolean(resolvedApiKey(activeConnection(saved))) };
});

app.setName(APP_NAME);
Menu.setApplicationMenu(Menu.buildFromTemplate([
  {
    label: APP_NAME,
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  },
  {
    label: "编辑",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
]));
/**
 * Apps opened from Finder do not inherit the shell's HTTPS_PROXY, so fall back
 * to the system proxy (e.g. Clash/V2Ray "system proxy") that Chromium resolves.
 * Model requests, web_fetch and bash child processes then all use it.
 */
async function configureNetworkProxy() {
  if (!hasProxyEnv()) {
    try {
      const proxy = proxyUrlFromPac(await session.defaultSession.resolveProxy("https://api.openalex.org"));
      if (proxy) {
        process.env.HTTPS_PROXY = proxy;
        process.env.HTTP_PROXY = proxy;
      }
    } catch (error) {
      console.warn(`读取系统代理失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  applyProxyFromEnv();
}

app.whenReady().then(async () => {
  await configureNetworkProxy();
  await migrateLegacyUserData();
  const config = await getConfig();
  nativeTheme.themeSource = config.theme;
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  createWindow();
  void startFullEditionInBackground();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  settleAllApprovals();
  if (quitting || (!harnessApp && !harnessPromise && !dshEngine)) return;
  event.preventDefault();
  quitting = true;
  const pendingHarness = harnessPromise;
  Promise.allSettled([stopStream, stopApprovals].map((stop) => Promise.resolve().then(() => stop?.())))
    .then(async () => {
      await Promise.allSettled([(harnessApp ?? await pendingHarness)?.stop(), stopDshEngine()]);
      stopTrace?.();
      await traceStore?.flush();
    })
    .catch((error) => console.error(`Agent 退出清理失败：${error instanceof Error ? error.message : String(error)}`))
    .finally(() => app.quit());
});
