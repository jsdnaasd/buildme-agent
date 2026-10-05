import console from "node:console";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

class FakeClassList {
  values = new Set();
  add(...names) { for (const name of names) this.values.add(name); }
  remove(...names) { for (const name of names) this.values.delete(name); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const next = force === undefined ? !this.values.has(name) : Boolean(force);
    if (next) this.values.add(name); else this.values.delete(name);
    return next;
  }
}

class FakeElement {
  attributes = new Map();
  children = [];
  classList = new FakeClassList();
  dataset = {};
  disabled = false;
  hidden = false;
  listeners = new Map();
  open = false;
  scrollHeight = 28;
  scrollTop = 0;
  style = {};
  textContent = "";
  title = "";
  type = "";
  value = "";
  #className = "";

  set className(value) {
    this.#className = value;
    this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean));
  }
  get className() { return this.#className; }

  addEventListener(name, listener) { this.listeners.set(name, listener); }
  append(...children) { this.children.push(...children); this.scrollHeight = Math.max(28, this.children.length * 20); }
  close() { this.open = false; }
  contains(target) { return target === this || this.children.some((child) => child.contains?.(target)); }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  replaceChildren(...children) { this.children = [...children]; this.scrollHeight = Math.max(28, this.children.length * 20); }
  requestSubmit() { return this.listeners.get("submit")?.({ preventDefault() {} }); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
}

const selectors = [
  "#agent-name", "#allow-approval", "#api-key", "#api-key-label", "#paste-api-key", "#approval-arguments", "#approval-dialog", "#approval-tool",
  "#base-url", "#cancel-settings", "#chat-title", "#close-settings", "#close-sidebar", "#composer",
  "#connection-auth-copy", "#connection-auth-hint", "#connection-name", "#connection-profile", "#connection-state", "#delete-connection", "#deny-approval",
  "#header-settings", "#full-edition", "#messages", "#model", "#model-chip", "#model-label", "#model-suggestions",
  "#new-chat", "#new-connection", "#open-sidebar", "#permission-chip", "#permission-label", "#permission-menu", "#plugin-market", "#plugin-market-dialog", "#close-plugin-market",
  "#open-pi-community-popular", "#open-pi-community-github", "#open-pi-community-reddit",
  "#prompt", "#provider", "#refresh-sessions", "#send", "#session-list", "#settings", "#settings-dialog",
  "#record-raw-requests", "#settings-form", "#sidebar-backdrop", "#status", "#workspace-chip",
  "#workspace-label", ".connection-dot",
];

async function rendererFixture(overrides = {}) {
  const elements = new Map(selectors.map((selector) => [selector, new FakeElement()]));
  const permissionButtons = ["ask", "workspace-write", "bypass"].map((mode) => {
    const element = new FakeElement();
    element.dataset.permission = mode;
    return element;
  });
  const themeButtons = ["system", "light", "dark"].map((mode) => {
    const element = new FakeElement();
    element.dataset.themeOption = mode;
    return element;
  });
  elements.get("#permission-menu").hidden = true;
  elements.get("#send").type = "submit";
  elements.get("#send").textContent = "↑";

  let streamListener;
  let approvalListener;
  let completeSend;
  const initialState = {
    activeConnectionId: "primary",
    catalog: [
      { provider: "openai", label: "OpenAI", models: [{ id: "gpt-5", name: "GPT 5" }] },
      { provider: "anthropic", label: "Anthropic", models: [{ id: "claude-sonnet-4-5" }] },
      { provider: "deepseek", label: "DeepSeek", models: [{ id: "deepseek-chat" }] },
    ],
    configured: true,
    connections: [{ id: "primary", name: "主要模型", provider: "openai", model: "gpt-5", baseUrl: "https://api.openai.com/v1" }],
    name: "BuildMe",
    permissionMode: "ask",
    theme: "dark",
    workspace: { path: "/Users/me/Project", name: "Project" },
  };
  const api = {
    abort: vi.fn(async () => true),
    chooseWorkspace: vi.fn(async () => ({ workspace: { path: "/tmp/Next", name: "Next" } })),
    deleteConnection: vi.fn(async () => ({ connections: [], activeConnectionId: null, configured: false })),
    messages: vi.fn(async () => []),
    onApproval: vi.fn((listener) => { approvalListener = listener; return () => undefined; }),
    onStream: vi.fn((listener) => { streamListener = listener; return () => undefined; }),
    openMarket: vi.fn(async () => undefined),
    openFullEdition: vi.fn(async () => ({ reused: false })),
    readClipboardText: vi.fn(async () => "clipboard-key"),
    respondApproval: vi.fn(async () => ({ accepted: true })),
    saveConnection: vi.fn(async (connection) => ({
      activeConnectionId: "saved",
      configured: true,
      connections: [{ ...connection, apiKey: undefined, id: "saved" }],
    })),
    selectConnection: vi.fn(async (id) => ({ activeConnectionId: id })),
    send: vi.fn(() => new Promise((resolve) => { completeSend = resolve; })),
    sessions: vi.fn(async () => []),
    setPermissionMode: vi.fn(async (permissionMode) => permissionMode),
    setTheme: vi.fn(async (theme) => theme),
    state: vi.fn(async () => initialState),
    ...overrides,
  };

  const body = new FakeElement();
  const documentElement = new FakeElement();
  const documentListeners = new Map();
  const document = {
    body,
    documentElement,
    addEventListener: (name, listener) => documentListeners.set(name, listener),
    createElement: () => new FakeElement(),
    querySelector: (selector) => elements.get(selector),
    querySelectorAll: (selector) => selector === "[data-permission]" ? permissionButtons : selector === "[data-theme-option]" ? themeButtons : [],
  };
  const media = { matches: true, addEventListener: vi.fn() };
  const xray = { setSession: vi.fn(), bindHistory: vi.fn(), beginRun: vi.fn(), endRun: vi.fn() };
  const context = vm.createContext({
    console,
    document,
    Error,
    String,
    window: { matchMedia: vi.fn(() => media), personalAgent: api, createCapabilities: () => ({ sync() {}, guide() {} }), createXray: () => xray },
  });
  const source = await readFile(new URL("../desktop/renderer/renderer.js", import.meta.url), "utf8");
  vm.runInContext(source, context, { filename: "desktop/renderer/renderer.js" });
  await vi.waitFor(() => expect(api.state).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(api.sessions).toHaveBeenCalledOnce());

  return {
    api,
    xray,
    approvalButtons: { allow: elements.get("#allow-approval"), deny: elements.get("#deny-approval") },
    completeSend: (result) => completeSend(result),
    document,
    element: (selector) => elements.get(selector),
    emitApproval: (request) => approvalListener(request),
    emitStream: (event) => streamListener(event),
    permissionButtons,
    themeButtons,
  };
}

function fire(element, type, event = {}) {
  return element.listeners.get(type)?.({ preventDefault() {}, target: element, ...event });
}

describe("Desktop renderer", () => {
  it("keeps personal branding and exposes the workspace, permission, model, and theme controls", async () => {
    const html = await readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8");
    expect(html).toContain("BuildMe");
    expect(html).toContain("Build to understand. Understand to build. Learn Agents by building yours.");
    expect(html).toContain('data-permission="bypass"');
    expect(html).toContain("完全访问（不审批）");
    expect(html).toContain('data-theme-option="light"');
    expect(html).toContain('id="workspace-chip"');
    expect(html).toContain('id="plugin-market"');
    expect(html).toContain("Pi 社区热门插件");
    expect(html).toContain("GitHub 热门");
    expect(html).not.toContain("OpenAI Plugins &amp; Apps");
    expect(html).not.toMatch(/deepseek harness/i);
    expect(html).toContain('src="../assets/buildme-mark.png"');
    expect(html).not.toContain('id="welcome-folder"');
    expect(html).not.toContain('id="welcome-settings"');
    expect(html).not.toMatch(/<img[^>]+src=["']https?:/i);
  });


  it("shows user conversation turns instead of the internal event total", async () => {
    const fixture = await rendererFixture({
      sessions: vi.fn(async () => [{
        id: "three-turns",
        updatedAt: "2026-09-16T00:00:00.000Z",
        health: "healthy",
        eventCount: 83,
        turnCount: 3,
      }]),
    });
    await vi.waitFor(() => expect(fixture.element("#session-list").children).toHaveLength(1));
    const session = fixture.element("#session-list").children[0];
    expect(session.children[2].textContent).toBe("3 轮对话");
    expect(session.children[2].textContent).not.toContain("83");
  });


  it("opens the BuildMe Full edition through the privileged desktop bridge", async () => {
    const fixture = await rendererFixture();
    await fire(fixture.element("#full-edition"), "click");
    expect(fixture.api.openFullEdition).toHaveBeenCalledOnce();
  });

  it("opens the plugin market and routes Pi community directories through Desktop", async () => {
    const fixture = await rendererFixture();
    fire(fixture.element("#plugin-market"), "click");
    expect(fixture.element("#plugin-market-dialog").open).toBe(true);
    fire(fixture.element("#open-pi-community-popular"), "click");
    fire(fixture.element("#open-pi-community-github"), "click");
    fire(fixture.element("#open-pi-community-reddit"), "click");
    await vi.waitFor(() => expect(fixture.api.openMarket).toHaveBeenNthCalledWith(1, "pi-community-popular"));
    expect(fixture.api.openMarket).toHaveBeenNthCalledWith(2, "pi-community-github");
    expect(fixture.api.openMarket).toHaveBeenNthCalledWith(3, "pi-community-reddit");
  });

  it("hydrates catalog, workspace, active model, permission, and dark theme from state", async () => {
    const fixture = await rendererFixture();
    expect(fixture.element("#workspace-label").textContent).toBe("Project");
    expect(fixture.element("#model-label").textContent).toBe("gpt-5");
    expect(fixture.element("#permission-label").textContent).toBe("每次询问");
    expect(fixture.document.documentElement.dataset.theme).toBe("dark");

    await fire(fixture.element("#settings"), "click");
    const providers = fixture.element("#provider").children.map((option) => option.value);
    expect(providers).toEqual(["openai", "anthropic", "deepseek", "openai-compatible"]);
    expect(fixture.element("#model-suggestions").children[0].value).toBe("gpt-5");
  });


  it("uses Pi catalog defaults for built-in providers without leaking a previous provider Base URL", async () => {
    const fixture = await rendererFixture();
    fire(fixture.element("#settings"), "click");
    fire(fixture.element("#new-connection"), "click");
    expect(fixture.element("#provider").value).toBe("deepseek");
    expect(fixture.element("#model").value).toBe("deepseek-chat");
    expect(fixture.element("#base-url").value).toBe("");

    fixture.element("#base-url").value = "https://api.deepseek.com";
    fixture.element("#provider").value = "anthropic";
    fire(fixture.element("#provider"), "change");
    expect(fixture.element("#base-url").value).toBe("");
    expect(fixture.element("#model").value).toBe("claude-sonnet-4-5");
    expect(fixture.element("#api-key").placeholder).toContain("sk-ant-oat");
    expect(fixture.element("#connection-auth-copy").textContent).toContain("Claude Code");
  });

  it("persists workspace, permission mode, and light theme through the desktop API", async () => {
    const fixture = await rendererFixture();
    fire(fixture.element("#workspace-chip"), "click");
    await vi.waitFor(() => expect(fixture.api.chooseWorkspace).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(fixture.element("#workspace-label").textContent).toBe("Next"));

    fire(fixture.permissionButtons[2], "click");
    await vi.waitFor(() => expect(fixture.api.setPermissionMode).toHaveBeenCalledWith("bypass"));
    await vi.waitFor(() => expect(fixture.element("#permission-label").textContent).toBe("完全访问（不审批）"));

    fire(fixture.themeButtons[1], "click");
    await vi.waitFor(() => expect(fixture.api.setTheme).toHaveBeenCalledWith("light"));
    expect(fixture.document.documentElement.dataset.theme).toBe("light");
  });

  it("saves a mainstream or relay connection without rendering its API key", async () => {
    const fixture = await rendererFixture();
    fire(fixture.element("#settings"), "click");
    fire(fixture.element("#new-connection"), "click");
    fixture.element("#connection-name").value = "公司中转";
    fixture.element("#provider").value = "openai-compatible";
    fixture.element("#model").value = "company/model-v2";
    fixture.element("#base-url").value = "https://relay.example/v1";
    fixture.element("#api-key").value = "TOKEN";

    await fire(fixture.element("#settings-form"), "submit");
    expect(fixture.api.saveConnection).toHaveBeenCalledWith({
      name: "公司中转",
      provider: "openai-compatible",
      model: "company/model-v2",
      baseUrl: "https://relay.example/v1",
      apiKey: "TOKEN",
    });
    expect(fixture.element("#api-key").value).toBe("");
    expect(fixture.element("#model-label").textContent).toBe("company/model-v2");
  });

  it("pastes an API key from the system clipboard with the explicit paste control", async () => {
    const fixture = await rendererFixture();
    fire(fixture.element("#settings"), "click");
    fixture.element("#api-key").value = "sk-ant-";
    fixture.element("#api-key").selectionStart = 7;
    fixture.element("#api-key").selectionEnd = 7;
    await fire(fixture.element("#paste-api-key"), "click");
    expect(fixture.api.readClipboardText).toHaveBeenCalledOnce();
    expect(fixture.element("#api-key").value).toBe("sk-ant-clipboard-key");
    expect(fixture.element("#api-key").focused).toBe(true);
  });


  it("allows Pi adapters to resolve environment or OAuth credentials when Desktop has no stored key", async () => {
    const fixture = await rendererFixture({
      state: vi.fn(async () => ({
        activeConnectionId: "oauth",
        catalog: [{ id: "openai-codex", name: "OpenAI Codex", models: [{ id: "codex-model" }] }],
        configured: false,
        connections: [{ id: "oauth", name: "Codex", provider: "openai-codex", model: "codex-model" }],
        name: "BuildMe",
        permissionMode: "ask",
        theme: "system",
        workspace: null,
      })),
    });
    fixture.element("#settings-dialog").close();
    fixture.element("#prompt").value = "use oauth";
    const submission = fire(fixture.element("#composer"), "submit");
    await vi.waitFor(() => expect(fixture.api.send).toHaveBeenCalledWith({ sessionId: undefined, prompt: "use oauth" }));
    fixture.completeSend({ sessionId: "oauth-session", text: "done" });
    await submission;
  });

  it("binds a new chat to the first stream session and turns Send into Cancel", async () => {
    const fixture = await rendererFixture();
    const prompt = fixture.element("#prompt");
    const composer = fixture.element("#composer");
    const send = fixture.element("#send");
    prompt.value = "new question";

    const submission = fire(composer, "submit");
    await vi.waitFor(() => expect(fixture.api.send).toHaveBeenCalledWith({ sessionId: undefined, prompt: "new question" }));
    expect(send.type).toBe("button");
    expect(send.textContent).toBe("■");
    expect(fixture.xray.beginRun).toHaveBeenCalledWith(fixture.element("#messages").children.at(-1));

    fixture.emitStream({ type: "text", sessionId: "new-session", delta: "streamed answer" });
    expect(fixture.element("#messages").children.at(-1).textContent).toBe("streamed answer");
    await fire(send, "click");
    await vi.waitFor(() => expect(fixture.api.abort).toHaveBeenCalledWith("new-session"));
    fixture.completeSend({ sessionId: "new-session", text: "streamed answer", messageCount: 2 });
    await submission;
    expect(send.type).toBe("submit");
    expect(send.textContent).toBe("↑");
    expect(fixture.xray.endRun).toHaveBeenCalledOnce();
  });

  it("shows ask-mode tool approvals and returns the explicit decision", async () => {
    const fixture = await rendererFixture();
    fixture.emitApproval({ requestId: "approval-1", toolName: "write_file", arguments: { path: "/tmp/a.txt" } });
    expect(fixture.element("#approval-dialog").open).toBe(true);
    expect(fixture.element("#approval-tool").textContent).toBe("write_file");
    expect(fixture.element("#approval-arguments").textContent).toContain("/tmp/a.txt");
    fire(fixture.approvalButtons.allow, "click");
    await vi.waitFor(() => expect(fixture.api.respondApproval).toHaveBeenCalledWith("approval-1", true));
    expect(fixture.element("#approval-dialog").open).toBe(false);
  });
});
