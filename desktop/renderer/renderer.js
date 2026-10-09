const api = window.personalAgent;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const PROVIDERS = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat", name: "DeepSeek" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-5", name: "OpenAI" },
  anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-5", name: "Anthropic" },
  google: { baseUrl: "https://generativelanguage.googleapis.com", model: "gemini-2.5-pro", name: "Google Gemini" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-5", name: "OpenRouter" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", name: "Groq" },
  mistral: { baseUrl: "https://api.mistral.ai/v1", model: "mistral-large-latest", name: "Mistral AI" },
  xai: { baseUrl: "https://api.x.ai/v1", model: "grok-4", name: "xAI" },
  dashscope: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3-coder-plus", name: "通义千问" },
  ark: { baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-1-6", name: "火山方舟" },
  moonshot: { baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2", name: "月之暗面" },
  zhipu: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.5", name: "智谱 GLM" },
  minimax: { baseUrl: "https://api.minimax.chat/v1", model: "MiniMax-M2", name: "MiniMax" },
  siliconflow: { baseUrl: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V3.1", name: "硅基流动" },
  ollama: { baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3", name: "Ollama" },
  lmstudio: { baseUrl: "http://127.0.0.1:1234/v1", model: "local-model", name: "LM Studio" },
  "openai-compatible": { baseUrl: "", model: "", name: "中转站" },
};

const PERMISSIONS = {
  ask: "每次询问",
  "workspace-write": "工作区内自动执行",
  bypass: "完全访问（不审批）",
};

const elements = {
  apiKey: $("#api-key"),
  pasteApiKey: $("#paste-api-key"),
  baseUrl: $("#base-url"),
  chatTitle: $("#chat-title"),
  composer: $("#composer"),
  connectionName: $("#connection-name"),
  connectionProfile: $("#connection-profile"),
  connectionState: $("#connection-state"),
  messages: $("#messages"),
  model: $("#model"),
  modelLabel: $("#model-label"),
  permissionChip: $("#permission-chip"),
  permissionLabel: $("#permission-label"),
  permissionMenu: $("#permission-menu"),
  pluginMarketDialog: $("#plugin-market-dialog"),
  prompt: $("#prompt"),
  provider: $("#provider"),
  send: $("#send"),
  sessionList: $("#session-list"),
  settingsDialog: $("#settings-dialog"),
  status: $("#status"),
  workspaceLabel: $("#workspace-label"),
  approvalDialog: $("#approval-dialog"),
  approvalTool: $("#approval-tool"),
  approvalArguments: $("#approval-arguments"),
  apiKeyLabel: $("#api-key-label"),
  connectionAuthCopy: $("#connection-auth-copy"),
  fullEdition: $("#full-edition"),
  editionChip: $("#edition-chip"),
};

let appState = {
  configured: false,
  connections: [],
  catalog: [],
  activeConnectionId: null,
  permissionMode: "ask",
  theme: "system",
  recordRawRequests: true,
  edition: "standard",
  fullTools: [],
  workspace: null,
};
let editingConnectionId = null;
let previousProvider = "deepseek";
let selectedSession;
let activeSession;
let isRunning = false;
let cancelRequested = false;
let streamingNode;
let streamingText = "";
let streamingThought;
let responseBoundary = false, reasoningBoundary = false;
let currentApproval;
const approvalQueue = [];
const communityPanel = window.createCommunityPanel(api);
const xray = window.createXray(api, { onExperiment: (turn, usage) => comparisons.openReading(turn, usage) });
const explanations = window.createExplanations(api);
let sessionSelection = 0;
window.createAchievements(api, { onTurn: (turn) => xray.openTurn(turn) });
const comparisons = window.createComparisons(api, {
  onTurn: (turn, tab) => xray.openTurn(turn, tab),
  onShow: () => { communityPanel.hide(); $("#xray-close").click(); closeSidebar(); },
  onClose: () => { $("#xray-close").click(); void xray.setSession(selectedSession, appState.edition); },
  onState: (state) => { mergeState(state); syncWorkspace(); },
});
$("#community-entry").addEventListener("click", () => comparisons.close());
const capabilities = window.createCapabilities(api, {
  onCompare: (example) => comparisons.open(example),
  onChange: mergeState,
  onExample: (text) => { comparisons.close(); elements.prompt.value = text; autoSizePrompt(); elements.prompt.focus(); },
});

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function setStatus(text = "", kind = "normal") {
  elements.status.textContent = text;
  elements.status.classList.toggle("error", kind === "error");
}

function mergeState(result) {
  const value = result?.state || result;
  if (!value || typeof value !== "object") return;
  const patch = {};
  for (const key of ["communityUrl", "name", "configured", "connections", "activeConnectionId", "catalog", "workspace", "permissionMode", "theme", "edition", "fullTools", "recordRawRequests", "capabilities", "capabilityRegistry", "capabilityOnboarding", "capabilityUsage"]) {
    if (value[key] !== undefined) patch[key] = value[key];
  }
  appState = { ...appState, ...patch };
  communityPanel.sync(appState);
  capabilities.sync(appState);
  explanations.sync(appState);
}

function activeConnection() {
  return appState.connections.find((connection) => connection.id === appState.activeConnectionId) || appState.connections[0] || null;
}

function scrollToLatest() {
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function appendMessage(role, text, { streaming = false, reasoning } = {}) {
  const node = document.createElement("article");
  const safeRole = ["user", "assistant", "tool"].includes(role) ? role : "assistant";
  node.className = `message ${safeRole}${streaming ? " streaming" : ""}`;
  if (safeRole === "assistant") window.renderMarkdown(node, text);
  else node.textContent = text;
  if (reasoning) elements.messages.append(reasoningNode(reasoning).details);
  elements.messages.append(node);
  scrollToLatest();
  return node;
}

function reasoningNode(text = "", streaming = false) {
  const details = document.createElement("details"), summary = document.createElement("summary"), content = document.createElement("div");
  details.className = "message-reasoning";
  summary.textContent = streaming ? "正在思考 · 模型返回" : "思考过程 · 模型返回";
  content.className = "reasoning-content"; content.textContent = text;
  details.append(summary, content); details.open = streaming;
  return { details, summary, content };
}

function createWelcome() {
  const welcome = document.createElement("div");
  welcome.className = "welcome";
  const mark = document.createElement("img");
  mark.className = "welcome-mark";
  mark.src = "../assets/buildme-mark.png";
  mark.alt = "";
  mark.setAttribute("aria-hidden", "true");
  const title = document.createElement("h1");
  title.textContent = "接下来做什么？";
  welcome.append(mark, title);
  return welcome;
}

function resetWelcome() {
  elements.messages.replaceChildren(createWelcome());
}

function displayMessages(items) {
  elements.messages.replaceChildren();
  if (!items.length) return resetWelcome();
  xray.bindHistory(items.map((item) => ({ ...item, node: appendMessage(item.role, item.text, { reasoning: item.reasoning }) })));
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function sessionTitle(item) {
  if (typeof item.title === "string" && item.title.trim()) return item.title.trim();
  if (typeof item.preview === "string" && item.preview.trim()) return item.preview.trim();
  return "对话";
}

function renderEmptySessions() {
  elements.sessionList.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "empty-sessions";
  empty.textContent = "还没有会话。开始一个任务后会显示在这里。";
  elements.sessionList.append(empty);
}

async function refreshSessions() {
  try {
    const items = await api.sessions();
    elements.sessionList.replaceChildren();
    if (!items.length) {
      renderEmptySessions();
      setStatus();
      return;
    }
    for (const item of items) {
      const button = document.createElement("button");
      button.className = `session${item.id === selectedSession ? " selected" : ""}`;
      button.type = "button";
      button.dataset.id = item.id;
      button.setAttribute("aria-current", item.id === selectedSession ? "page" : "false");
      const title = document.createElement("strong");
      title.textContent = sessionTitle(item);
      const time = document.createElement("time");
      time.textContent = formatDate(item.updatedAt);
      const meta = document.createElement("small");
      const count = Number.isFinite(item.turnCount)
        ? item.turnCount > 0 ? `${item.turnCount} 轮对话` : "尚未开始"
        : "";
      meta.textContent = item.health === "healthy" || !item.health ? count : "需要检查";
      if (item.health && item.health !== "healthy") meta.className = "warning";
      button.append(title, time, meta);
      button.addEventListener("click", () => selectSession(item.id, sessionTitle(item)));
      elements.sessionList.append(button);
    }
    setStatus();
  } catch (error) {
    renderEmptySessions();
    const message = errorText(error);
    if (!message.includes("运行时服务尚未就绪") && !message.includes("desktop:sessions")) setStatus(message, "error");
  }
}

async function selectSession(sessionId, title = "会话") {
  if (isRunning) return;
  comparisons.close();
  const selection = ++sessionSelection;
  try {
    selectedSession = sessionId;
    elements.chatTitle.textContent = title;
    void xray.setSession(sessionId, appState.edition);
    const items = await api.messages(sessionId);
    if (selection !== sessionSelection) return;
    displayMessages(items);
    await refreshSessions();
    closeSidebar();
  } catch (error) {
    setStatus(errorText(error), "error");
  }
}

function startNewChat() {
  if (comparisons.isOpen()) { void comparisons.newConversation(); return; }
  if (isRunning) return;
  sessionSelection += 1;
  selectedSession = undefined;
  void xray.setSession(undefined, appState.edition);
  elements.chatTitle.textContent = "新对话";
  resetWelcome();
  void refreshSessions();
  closeSidebar();
  elements.prompt.focus();
}

function syncRunning(next) {
  isRunning = next;
  cancelRequested = false;
  elements.send.disabled = false;
  elements.send.type = next ? "button" : "submit";
  elements.send.textContent = next ? "■" : "↑";
  elements.send.dataset.running = String(next);
  elements.send.setAttribute("aria-label", next ? "取消生成" : "发送消息");
  elements.send.title = next ? "取消生成" : "发送（Enter）";
  elements.prompt.disabled = next;
  $("#new-chat").disabled = next;
  setStatus(next ? "正在回应" : "");
}

async function cancelActiveRun() {
  if (!isRunning || cancelRequested) return;
  cancelRequested = true;
  elements.send.disabled = true;
  setStatus("正在取消");
  try {
    const aborted = await api.abort(activeSession);
    if (!aborted) {
      cancelRequested = false;
      elements.send.disabled = false;
      setStatus("正在回应");
    }
  } catch (error) {
    cancelRequested = false;
    elements.send.disabled = false;
    setStatus(errorText(error), "error");
  }
}

function autoSizePrompt() {
  if (!elements.prompt.style) return;
  elements.prompt.style.height = "auto";
  elements.prompt.style.height = `${Math.min(elements.prompt.scrollHeight || 28, 200)}px`;
}

function workspaceName(workspace) {
  if (!workspace) return "选择文件夹";
  if (workspace.name) return workspace.name;
  const path = workspace.path || String(workspace);
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function syncWorkspace() {
  elements.workspaceLabel.textContent = workspaceName(appState.workspace);
  $("#workspace-chip").title = appState.workspace?.path || "选择工作文件夹";
}

function syncEdition() {
  const full = appState.edition === "full";
  elements.fullEdition.classList.toggle("active", full);
  elements.fullEdition.setAttribute("aria-pressed", String(full));
  elements.fullEdition.textContent = full ? "全量版 · DSH 引擎" : "Build 模式 · 轻量";
  elements.fullEdition.title = full
    ? "当前是全量版（DeepSeek Harness 引擎）。点击切回 Build 模式（Pi + BuildMe 插件，轻量）"
    : "当前是 Build 模式（Pi + BuildMe 插件）。点击切换到全量版：DSH 引擎，含子 Agent、工作流、网页搜索、沙箱 bash";
  if (elements.editionChip) {
    elements.editionChip.hidden = !full;
    const count = appState.fullTools.length ? `${appState.fullTools.length} 个工具 · ` : "";
    elements.editionChip.textContent = full
      ? `全量版 · DSH 引擎 · ${count}子 Agent / 工作流 / 网页搜索 / 沙箱 bash / 长期目标`
      : "";
  }
  document.body.dataset.edition = full ? "full" : "standard";
}

async function chooseWorkspace() {
  if (isRunning) return;
  try {
    const result = await api.chooseWorkspace();
    if (!result) return;
    if (typeof result === "string") appState.workspace = { path: result, name: workspaceName(result) };
    else if (result.workspace !== undefined) mergeState(result);
    else if (result.path) appState.workspace = result;
    syncWorkspace();
    setStatus("工作区已更新");
  } catch (error) {
    setStatus(errorText(error), "error");
  }
}

function closePermissionMenu({ restoreFocus = false } = {}) {
  elements.permissionMenu.hidden = true;
  elements.permissionChip.setAttribute("aria-expanded", "false");
  if (restoreFocus) elements.permissionChip.focus();
}

function openPermissionMenu() {
  elements.permissionMenu.hidden = false;
  elements.permissionChip.setAttribute("aria-expanded", "true");
  $$('[data-permission]').find((button) => button.dataset.permission === appState.permissionMode)?.focus();
}

function syncPermission() {
  const mode = PERMISSIONS[appState.permissionMode] ? appState.permissionMode : "ask";
  appState.permissionMode = mode;
  elements.permissionLabel.textContent = PERMISSIONS[mode];
  for (const button of $$('[data-permission]')) button.setAttribute("aria-checked", String(button.dataset.permission === mode));
}

async function selectPermission(mode) {
  if (!PERMISSIONS[mode]) return;
  try {
    const result = await api.setPermissionMode(mode);
    mergeState(result);
    appState.permissionMode = typeof result === "string" ? result : (result?.permissionMode ?? mode);
    if (!PERMISSIONS[appState.permissionMode]) appState.permissionMode = mode;
    syncPermission();
    closePermissionMenu({ restoreFocus: true });
    setStatus(`权限模式：${PERMISSIONS[appState.permissionMode]}`);
  } catch (error) {
    setStatus(errorText(error), "error");
  }
}

function systemTheme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(mode) {
  const safeMode = ["system", "light", "dark"].includes(mode) ? mode : "system";
  appState.theme = safeMode;
  document.documentElement.dataset.themeMode = safeMode;
  document.documentElement.dataset.theme = safeMode === "system" ? systemTheme() : safeMode;
  for (const button of $$('[data-theme-option]')) button.setAttribute("aria-checked", String(button.dataset.themeOption === safeMode));
}

async function selectTheme(mode) {
  const previous = appState.theme;
  applyTheme(mode);
  try {
    const result = await api.setTheme(mode);
    mergeState(result);
    applyTheme(typeof result === "string" ? result : (result?.theme ?? mode));
  } catch (error) {
    applyTheme(previous);
    setStatus(errorText(error), "error");
  }
}

function connectionDisplayName(connection) {
  return connection.name || `${PROVIDERS[connection.provider]?.name || connection.provider} · ${connection.model}`;
}

function catalogProviderId(item) {
  return item?.provider || item?.id || "";
}

function renderModelSuggestions(provider) {
  const datalist = $("#model-suggestions");
  const catalogItem = appState.catalog.find((item) => catalogProviderId(item) === provider);
  if (!catalogItem?.models?.length) {
    if (appState.catalog.length) datalist.replaceChildren();
    return;
  }
  datalist.replaceChildren();
  for (const model of catalogItem.models) {
    const option = document.createElement("option");
    option.value = typeof model === "string" ? model : model.id;
    if (typeof model === "object" && model.name) option.label = model.name;
    datalist.append(option);
  }
}

function renderProviderCatalog(selectedProvider) {
  if (!appState.catalog.length) return;
  elements.provider.replaceChildren();
  for (const item of appState.catalog) {
    const id = catalogProviderId(item);
    if (!id) continue;
    const option = document.createElement("option");
    option.value = id;
    option.textContent = item.label || item.name || PROVIDERS[id]?.name || id;
    elements.provider.append(option);
  }
  if (!appState.catalog.some((item) => catalogProviderId(item) === "openai-compatible")) {
    const custom = document.createElement("option");
    custom.value = "openai-compatible";
    custom.textContent = "OpenAI 兼容 / 中转站";
    elements.provider.append(custom);
  }
  if (selectedProvider && !appState.catalog.some((item) => catalogProviderId(item) === selectedProvider)) {
    const current = document.createElement("option");
    current.value = selectedProvider;
    current.textContent = PROVIDERS[selectedProvider]?.name || selectedProvider;
    elements.provider.append(current);
  }
  elements.provider.value = selectedProvider || catalogProviderId(appState.catalog[0]) || "openai-compatible";
  renderModelSuggestions(elements.provider.value);
}

function syncCredentialHint(provider) {
  if (provider === "anthropic") {
    elements.apiKeyLabel.innerHTML = "Anthropic API Key / Claude Code Token <em>留空即保留当前密钥</em>";
    elements.apiKey.placeholder = "sk-ant-api… 或 sk-ant-oat…";
    elements.connectionAuthCopy.textContent = "Claude Code 的 sk-ant-oat… Token 可直接粘贴；Pi 会使用 Claude Code 的 Bearer / OAuth 请求格式。";
    return;
  }
  if (provider === "openai-compatible") {
    elements.apiKeyLabel.innerHTML = "中转站 API Key <em>留空即保留当前密钥</em>";
    elements.apiKey.placeholder = "输入中转站 API Key";
    elements.connectionAuthCopy.textContent = "中转站使用 OpenAI Chat Completions；Base URL 填服务商给出的完整 /v1 地址。";
    return;
  }
  elements.apiKeyLabel.innerHTML = "API Key <em>留空即保留当前密钥</em>";
  elements.apiKey.placeholder = "输入 API Key";
  elements.connectionAuthCopy.textContent = "连接信息仅保存在这台设备上，密钥不会显示在界面中。";
}

function renderConnectionProfiles() {
  elements.connectionProfile.replaceChildren();
  if (!appState.connections.length) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "新连接";
    elements.connectionProfile.append(empty);
    elements.connectionProfile.disabled = true;
  } else {
    elements.connectionProfile.disabled = false;
    for (const connection of appState.connections) {
      const option = document.createElement("option");
      option.value = connection.id;
      option.textContent = connectionDisplayName(connection);
      elements.connectionProfile.append(option);
    }
  }
  elements.connectionProfile.value = editingConnectionId || appState.activeConnectionId || "";
  $("#delete-connection").disabled = !editingConnectionId;
}

function loadConnectionForm(connection) {
  const catalogDefault = appState.catalog.find((item) => catalogProviderId(item) === "deepseek") || appState.catalog[0];
  const defaultProvider = catalogProviderId(catalogDefault) || "deepseek";
  const value = connection || {
    provider: defaultProvider,
    model: catalogDefault?.models?.[0]?.id || PROVIDERS[defaultProvider]?.model || "",
    baseUrl: catalogDefault ? "" : (PROVIDERS[defaultProvider]?.baseUrl || ""),
  };
  editingConnectionId = connection?.id || null;
  elements.connectionName.value = connection?.name || "";
  renderProviderCatalog(value.provider || defaultProvider);
  elements.provider.value = value.provider || defaultProvider;
  elements.model.value = value.model || "";
  elements.baseUrl.value = value.baseUrl || "";
  elements.apiKey.value = "";
  previousProvider = elements.provider.value;
  renderModelSuggestions(elements.provider.value);
  syncCredentialHint(elements.provider.value);
  renderConnectionProfiles();
}

function syncConnectionSummary() {
  const connection = activeConnection();
  elements.modelLabel.textContent = connection?.model || "选择模型";
  const connected = Boolean(appState.configured && connection);
  $(".connection-dot").classList.toggle("connected", connected);
  elements.connectionState.textContent = connected ? "已连接" : "尚未连接";
  elements.connectionState.classList.toggle("connected", connected);
}

function openSettings() {
  $("#record-raw-requests").checked = appState.recordRawRequests;
  const connection = activeConnection();
  loadConnectionForm(connection);
  syncConnectionSummary();
  elements.settingsDialog.showModal();
}

function closeSettings() {
  elements.apiKey.value = "";
  elements.settingsDialog.close();
}

function openPluginMarket() {
  elements.pluginMarketDialog.showModal();
}

function closePluginMarket() {
  elements.pluginMarketDialog.close();
}

async function openMarket(source) {
  try {
    await api.openMarket(source);
  } catch (error) {
    setStatus(errorText(error), "error");
  }
}

function onProviderChange() {
  const catalogItem = appState.catalog.find((item) => catalogProviderId(item) === elements.provider.value);
  if (catalogItem) {
    elements.baseUrl.value = "";
    elements.model.value = catalogItem.models?.[0]?.id || "";
  } else {
    const oldPreset = PROVIDERS[previousProvider];
    const nextPreset = PROVIDERS[elements.provider.value];
    const baseWasPreset = !elements.baseUrl.value || elements.baseUrl.value === oldPreset?.baseUrl;
    const modelWasPreset = !elements.model.value || elements.model.value === oldPreset?.model;
    if (nextPreset && baseWasPreset) elements.baseUrl.value = nextPreset.baseUrl;
    if (nextPreset && modelWasPreset) elements.model.value = nextPreset.model;
  }
  previousProvider = elements.provider.value;
  renderModelSuggestions(elements.provider.value);
  syncCredentialHint(elements.provider.value);
}

function openSidebar() {
  document.body.classList.add("sidebar-open");
  $("#open-sidebar").setAttribute("aria-expanded", "true");
}

function closeSidebar() {
  document.body.classList.remove("sidebar-open");
  $("#open-sidebar").setAttribute("aria-expanded", "false");
}

function approvalSummary(request) {
  const value = request.arguments ?? request.input ?? request.args ?? {};
  if (typeof value === "string") return value.slice(0, 12000);
  try { return JSON.stringify(value, null, 2).slice(0, 12000); }
  catch { return String(value).slice(0, 12000); }
}

function showNextApproval() {
  if (currentApproval || !approvalQueue.length) return;
  currentApproval = approvalQueue.shift();
  elements.approvalTool.textContent = `${currentApproval.source ? `[${currentApproval.source}] ` : ""}${currentApproval.toolName || currentApproval.name || "工具"}`;
  elements.approvalArguments.textContent = approvalSummary(currentApproval);
  elements.approvalDialog.showModal();
  $("#allow-approval").focus();
}

async function respondToApproval(approved) {
  if (!currentApproval) return;
  const request = currentApproval;
  currentApproval = undefined;
  elements.approvalDialog.close();
  try {
    await api.respondApproval(request.requestId || request.id, approved);
  } catch (error) {
    setStatus(errorText(error), "error");
  } finally {
    showNextApproval();
  }
}

elements.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = elements.prompt.value.trim();
  if (!text || isRunning) return;
  if (appState.capabilityOnboarding && appState.edition !== "full") { capabilities.guide(); return; }
  if (!activeConnection()) {
    openSettings();
    setStatus("请先添加并选择模型连接", "error");
    return;
  }
  const requestedSession = selectedSession;
  activeSession = requestedSession;
  if (!requestedSession) elements.messages.replaceChildren();
  appendMessage("user", text);
  elements.prompt.value = "";
  autoSizePrompt();
  streamingNode = appendMessage("assistant", "", { streaming: true });
  streamingText = "";
  streamingThought = undefined; responseBoundary = false; reasoningBoundary = false;
  xray.beginRun(streamingNode);
  syncRunning(true);
  try {
    const result = await api.send({ sessionId: requestedSession, prompt: text });
    selectedSession = result.sessionId;
    if (!streamingText) window.renderMarkdown(streamingNode, result.text || "已完成。");
    streamingNode.classList.remove("streaming");
    elements.chatTitle.textContent = "会话";
  } catch (error) {
    streamingText += `${streamingText ? "\n\n" : ""}${cancelRequested ? "已取消。" : errorText(error)}`;
    window.renderMarkdown(streamingNode, streamingText);
    streamingNode.classList.remove("streaming");
    if (!cancelRequested) streamingNode.classList.add("error");
  } finally {
    xray.endRun();
    if (streamingThought) streamingThought.summary.textContent = cancelRequested ? "思考过程 · 已取消，保留已收到内容" : "思考过程 · 模型返回";
    streamingThought = undefined;
    await refreshSessions();
    activeSession = undefined;
    streamingNode = undefined;
    syncRunning(false);
    elements.prompt.focus();
  }
});

elements.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    elements.composer.requestSubmit();
  }
});
elements.prompt.addEventListener("input", autoSizePrompt);
elements.send.addEventListener("click", (event) => {
  if (!isRunning) return;
  event.preventDefault();
  void cancelActiveRun();
});

$("#new-chat").addEventListener("click", startNewChat);
$("#refresh-sessions").addEventListener("click", () => void refreshSessions());
$("#workspace-chip").addEventListener("click", () => void chooseWorkspace());
elements.permissionChip.addEventListener("click", () => elements.permissionMenu.hidden ? openPermissionMenu() : closePermissionMenu());
for (const button of $$('[data-permission]')) button.addEventListener("click", () => void selectPermission(button.dataset.permission));
for (const selector of ["#settings", "#header-settings", "#model-chip"]) $(selector).addEventListener("click", openSettings);
elements.fullEdition.addEventListener("click", async () => {
  if (isRunning) return;
  elements.fullEdition.disabled = true;
  try {
    const next = appState.edition === "full" ? "standard" : "full";
    if (next === "full") setStatus("正在启动 DSH 引擎…");
    const result = typeof api.setEdition === "function"
      ? await api.setEdition(next)
      : await api.openFullEdition();
    mergeState(result);
    syncEdition();
    startNewChat();
    setStatus(next === "full" ? "已切换到全量版（DSH 引擎）" : "已切回 Build 模式");
  } catch (error) {
    setStatus(errorText(error), "error");
  } finally {
    elements.fullEdition.disabled = false;
  }
});
$("#plugin-market").addEventListener("click", openPluginMarket);
$("#close-plugin-market").addEventListener("click", closePluginMarket);
$("#open-pi-community-popular").addEventListener("click", () => void openMarket("pi-community-popular"));
$("#open-pi-community-github").addEventListener("click", () => void openMarket("pi-community-github"));
$("#open-pi-community-reddit").addEventListener("click", () => void openMarket("pi-community-reddit"));
$("#close-settings").addEventListener("click", closeSettings);
$("#cancel-settings").addEventListener("click", closeSettings);
elements.pasteApiKey.addEventListener("click", async () => {
  try {
    const value = await api.readClipboardText();
    if (typeof value !== "string" || !value) {
      setStatus("剪贴板中没有可粘贴的文本", "error");
      return;
    }
    const start = elements.apiKey.selectionStart ?? elements.apiKey.value.length;
    const end = elements.apiKey.selectionEnd ?? elements.apiKey.value.length;
    if (typeof elements.apiKey.setRangeText === "function") elements.apiKey.setRangeText(value, start, end, "end");
    else elements.apiKey.value = `${elements.apiKey.value.slice(0, start)}${value}${elements.apiKey.value.slice(end)}`;
    elements.apiKey.focus();
  } catch (error) {
    setStatus(errorText(error), "error");
  }
});
elements.provider.addEventListener("change", onProviderChange);
for (const button of $$('[data-theme-option]')) button.addEventListener("click", () => void selectTheme(button.dataset.themeOption));
$("#record-raw-requests").addEventListener("change", async (event) => {
  const checkbox = event.target;
  checkbox.disabled = true;
  try {
    appState.recordRawRequests = await api.setRecordRawRequests(checkbox.checked);
    setStatus("X 光记录设置已保存，下一回合生效。");
  } catch (error) {
    checkbox.checked = appState.recordRawRequests;
    setStatus(errorText(error), "error");
  } finally {
    checkbox.disabled = false;
  }
});

elements.connectionProfile.addEventListener("change", async () => {
  const id = elements.connectionProfile.value;
  if (!id) return;
  try {
    const result = await api.selectConnection(id);
    mergeState(result);
    appState.activeConnectionId = result?.activeConnectionId || appState.activeConnectionId || id;
    loadConnectionForm(appState.connections.find((item) => item.id === id));
    syncConnectionSummary();
  } catch (error) { setStatus(errorText(error), "error"); }
});

$("#new-connection").addEventListener("click", () => loadConnectionForm(null));
$("#delete-connection").addEventListener("click", async () => {
  if (!editingConnectionId) return;
  try {
    const id = editingConnectionId;
    const result = await api.deleteConnection(id);
    mergeState(result);
    if (!result?.connections) appState.connections = appState.connections.filter((item) => item.id !== id);
    if (appState.activeConnectionId === id) appState.activeConnectionId = appState.connections[0]?.id || null;
    loadConnectionForm(activeConnection());
    syncConnectionSummary();
    setStatus("连接已删除");
  } catch (error) { setStatus(errorText(error), "error"); }
});

elements.settingsDialog.addEventListener("click", (event) => { if (event.target === elements.settingsDialog) closeSettings(); });
elements.pluginMarketDialog.addEventListener("click", (event) => { if (event.target === elements.pluginMarketDialog) closePluginMarket(); });
$("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const connection = {
    ...(editingConnectionId ? { id: editingConnectionId } : {}),
    ...(elements.connectionName.value.trim() ? { name: elements.connectionName.value.trim() } : {}),
    provider: elements.provider.value,
    model: elements.model.value.trim(),
    baseUrl: elements.baseUrl.value.trim() || undefined,
    ...(elements.apiKey.value.trim() ? { apiKey: elements.apiKey.value.trim() } : {}),
  };
  if (!connection.model) {
    elements.model.focus();
    setStatus("请输入模型 ID", "error");
    return;
  }
  try {
    const result = await api.saveConnection(connection);
    mergeState(result);
    const saved = result?.connection || (result?.id ? result : null);
    if (!result?.connections && saved?.id) {
      appState.connections = [...appState.connections.filter((item) => item.id !== saved.id), saved];
      appState.activeConnectionId = saved.id;
    }
    appState.configured = result?.configured ?? true;
    editingConnectionId = result?.activeConnectionId || saved?.id || editingConnectionId;
    loadConnectionForm(activeConnection() || saved);
    syncConnectionSummary();
    closeSettings();
    setStatus("模型连接已保存");
  } catch (error) { setStatus(errorText(error), "error"); }
});

$("#open-sidebar").addEventListener("click", openSidebar);
$("#close-sidebar").addEventListener("click", closeSidebar);
$("#sidebar-backdrop").addEventListener("click", closeSidebar);
$("#allow-approval").addEventListener("click", () => void respondToApproval(true));
$("#deny-approval").addEventListener("click", () => void respondToApproval(false));
elements.approvalDialog.addEventListener("cancel", (event) => event.preventDefault());

document.addEventListener("click", (event) => {
  if (elements.permissionMenu.hidden) return;
  if (!elements.permissionMenu.contains(event.target) && !elements.permissionChip.contains(event.target)) closePermissionMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!elements.permissionMenu.hidden) closePermissionMenu({ restoreFocus: true });
    else closeSidebar();
    return;
  }
  if (!(event.metaKey || event.ctrlKey)) return;
  if (event.key.toLowerCase() === "n") { event.preventDefault(); startNewChat(); }
  else if (event.key === ",") { event.preventDefault(); openSettings(); }
  else if (event.key.toLowerCase() === "o" && event.shiftKey) { event.preventDefault(); void chooseWorkspace(); }
  else if (event.key.toLowerCase() === "k") { event.preventDefault(); elements.prompt.focus(); }
});

const colorScheme = window.matchMedia?.("(prefers-color-scheme: dark)");
colorScheme?.addEventListener?.("change", () => { if (appState.theme === "system") applyTheme("system"); });

api.onStream((event) => {
  // Turns started by a scheduled reminder, not by the composer.
  if (event.type === "background-done" || event.type === "open-session") {
    void refreshSessions();
    if (event.type === "open-session" && !isRunning) void selectSession(event.sessionId);
    else if (!isRunning && event.sessionId === selectedSession) {
      void selectSession(event.sessionId);
      setStatus("定时任务有新的回复");
    }
    return;
  }
  if (!isRunning) return;
  if (!activeSession) {
    activeSession = event.sessionId;
    if (!selectedSession) selectedSession = event.sessionId;
  }
  if (event.sessionId !== activeSession) return;
  if (event.type === "response-start") { responseBoundary = true; reasoningBoundary = true; }
  if (event.type === "reasoning" && streamingNode) {
    if (!streamingThought) { streamingThought = reasoningNode("", true); streamingNode.before(streamingThought.details); }
    streamingThought.content.textContent += `${reasoningBoundary && streamingThought.content.textContent ? "\n\n" : ""}${event.delta}`;
    reasoningBoundary = false; setStatus("正在思考"); scrollToLatest();
  }
  if (event.type === "text" && streamingNode) {
    streamingText += `${responseBoundary && streamingText ? "\n\n" : ""}${event.delta}`;
    window.renderMarkdown(streamingNode, streamingText);
    responseBoundary = false;
    if (streamingThought) streamingThought.summary.textContent = "思考过程 · 模型返回";
    scrollToLatest();
  }
  if (event.type === "tool") setStatus(`正在使用 ${event.name}`);
});

if (typeof api.onApproval === "function" && typeof api.respondApproval === "function") {
  api.onApproval((request) => { approvalQueue.push(request); showNextApproval(); });
}

if (api.onApprovalClosed) api.onApprovalClosed(({ requestId }) => {
  const index = approvalQueue.findIndex((request) => request.requestId === requestId);
  if (index >= 0) approvalQueue.splice(index, 1);
  if (currentApproval?.requestId === requestId) { currentApproval = undefined; elements.approvalDialog.close(); showNextApproval(); }
});

(async () => {
  try {
    mergeState(await api.state());
    void xray.setSession(undefined, appState.edition);
    $("#agent-name").textContent = "BuildMe";
    applyTheme(appState.theme);
    syncWorkspace();
    syncEdition();
    syncPermission();
    syncConnectionSummary();
    if (!appState.configured || !activeConnection()) openSettings();
    await refreshSessions();
    capabilities.guide();
  } catch (error) { setStatus(errorText(error), "error"); }
})();
