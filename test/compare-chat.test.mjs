import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { URL } from "node:url";
import { parseHTML } from "linkedom";
import MarkdownIt from "markdown-it";
import { describe, expect, it, vi } from "vitest";

const html = await readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8");
const source = await readFile(new URL("../desktop/renderer/compare.js", import.meta.url), "utf8");
const markdownSource = await readFile(new URL("../desktop/renderer/markdown.js", import.meta.url), "utf8");
function group(id = "group-1") {
  return { id, title: id, kind: "harness", workspace: { source: "/workspace", excluded: [], expired: false, readOnly: false }, sides: {
    left: { engine: "pi", sessionId: `${id}-pi`, connection: { model: "same-model" } }, right: { engine: "dsh", sessionId: `${id}-dsh`, connection: { model: "same-model" } },
  }, rounds: [], differences: {} };
}
function details(group) {
  const metric = { tools: [], usage: "exact", modelCalls: 1, toolCalls: 0 };
  return globalThis.structuredClone({ group, traces: { left: [], right: [] }, metrics: { left: metric, right: metric }, differences: Object.fromEntries(["modelCalls", "toolCalls", "subagents", "compactions", "tokens", "durationMs", "files"].map(k => [k, {}])) });
}
function mount(groups = []) {
  const { window, document } = parseHTML(html);
  Object.defineProperty(window.HTMLSelectElement.prototype, "value", { configurable: true, get() { return this._value || ""; }, set(v) { this._value = v; } });
  Object.defineProperties(window.HTMLElement.prototype, {
    scrollHeight: { configurable: true, get() { return 1200; } },
    clientHeight: { configurable: true, get() { return 300; } },
  });
  const frames = []; let notice;
  window.communityAvailable = () => false;
  const api = {
    state: vi.fn(async () => ({ workspace: { path: "/workspace" }, activeConnectionId: "model", connections: [{ id: "model", model: "same-model", provider: "local" }] })),
    compareList: vi.fn(async () => groups.map(g => ({ id: g.id, title: g.title }))),
    compareGet: vi.fn(async id => details(groups.find(g => g.id === id))),
    compareCreate: vi.fn(async () => { const g = group(); groups.unshift(g); return globalThis.structuredClone(g); }),
    compareSend: vi.fn(async (id, prompt) => {
      const g = groups.find(g => g.id === id), run = () => ({ status: "running", text: "", turnIds: [] });
      g.rounds.push({ id: `round-${g.rounds.length + 1}`, prompt, runs: { left: run(), right: run() } }); return globalThis.structuredClone(g);
    }),
    compareStop: vi.fn(async id => { for (const run of Object.values(groups.find(g => g.id === id).rounds.at(-1).runs)) run.status = "aborted"; }),
    xrayTurn: vi.fn(async id => ({ id })),
    onCompare: fn => { notice = fn; },
  };
  const context = vm.createContext({ window, document, requestAnimationFrame: fn => { frames.push(fn); return frames.length; } });
  window.markdownit = MarkdownIt; vm.runInContext(markdownSource, context);
  vm.runInContext(source, context);
  const onTurn = vi.fn(), comparison = window.createComparisons(api, { onTurn });
  const $ = s => document.querySelector(s), frame = () => { while (frames.length) frames.shift()(); };
  const idle = async () => { await vi.waitFor(() => expect($("#compare-dialog").dataset.busy).toBe("false")); frame(); };
  $("#compare-send-form").requestSubmit = () => $("#compare-send-form").onsubmit({ preventDefault() {} });
  const send = async text => { $("#compare-prompt").value = text; $("#compare-send-form").requestSubmit(); await idle(); };
  const complete = async (g, text = "answer") => {
    for (const [side, run] of Object.entries(g.rounds.at(-1).runs)) { run.status = "done"; run.text = `${side} ${text}`; run.turnIds = [`${side}-turn`]; }
    notice({ type: "changed", groupId: g.id });
    await vi.waitFor(() => expect($("#compare-send").disabled).toBe(false)); frame();
  };
  return { window, document, api, comparison, groups, $, frame, idle, send, complete, onTurn, emit: event => notice(event) };
}

describe("双路聊天工作区", () => {
  it("renders both streamed and restored answers as Markdown", async () => {
    const h = mount(); await h.comparison.open(); await h.send("比较");
    const text = "## 回答\n\n**结论**\n\n| 项 | 值 |\n|---|---|\n| 状态 | 完成 |";
    for (const side of ["left", "right"]) {
      h.emit({ type: "stream", groupId: "group-1", side, delta: text.slice(0, 12) }); h.frame();
      h.emit({ type: "stream", groupId: "group-1", side, delta: text.slice(12) }); h.frame();
    }
    expect(h.document.querySelectorAll(".compare-answer-text h2")).toHaveLength(2);
    expect(h.document.querySelectorAll(".compare-answer-text table")).toHaveLength(2);
    await h.complete(h.groups[0], `\n\n${text}`);
    const restored = mount(h.groups); await restored.comparison.open();
    expect(restored.document.querySelectorAll(".compare-answer-text strong")).toHaveLength(2);
    expect(restored.document.querySelectorAll(".compare-answer-text table")).toHaveLength(2);
  });

  it("sends three follow-ups to the same two sessions, retaining both message histories and a usable composer", async () => {
    const h = mount(); await h.comparison.open();
    expect(h.$("#compare-dialog").tagName).toBe("SECTION"); expect(h.$(".workspace").dataset.mode).toBe("compare");
    expect(h.$("#compare-send-form").hidden).toBe(false); expect(h.document.querySelectorAll(".compare-lane")).toHaveLength(2);
    expect(h.api.compareCreate).not.toHaveBeenCalled();
    h.$("#compare-kind").value = "model"; await h.comparison.newConversation();
    expect(h.$("#compare-settings-panel").hidden).toBe(false);
    h.$("#compare-kind").value = "harness"; await h.comparison.newConversation();
    expect(h.$("#compare-settings-panel").hidden).toBe(true);
    for (const text of ["第一问", "继续解释", "再给个例子"]) { await h.send(text); await h.complete(h.groups[0], text); }
    expect(h.$('.compare-messages[data-side="left"]').scrollTop).toBe(1200);
    expect(h.api.compareCreate).toHaveBeenCalledTimes(1);
    expect(h.api.compareSend.mock.calls).toEqual([["group-1", "第一问"], ["group-1", "继续解释"], ["group-1", "再给个例子"]]);
    for (const lane of h.document.querySelectorAll(".compare-lane")) {
      expect(lane.querySelectorAll(".compare-question")).toHaveLength(3); expect(lane.querySelectorAll(".compare-answer")).toHaveLength(3);
      expect(lane.textContent).toContain("第一问"); expect(lane.textContent).toContain("再给个例子");
    }
    h.$(".compare-answer button").click(); await h.idle(); expect(h.onTurn).toHaveBeenCalledWith({ id: "left-turn" }, "timeline");
    expect(h.$("#compare-dialog").hidden).toBe(false);
  });

  it("streams each side independently, preserves a draft while busy, and keeps a scrolled-up lane in place", async () => {
    const h = mount(); await h.comparison.open(); await h.send("第一问");
    const left = h.$('.compare-messages[data-side="left"]'), right = h.$('.compare-messages[data-side="right"]');
    for (const lane of [left, right]) { Object.defineProperty(lane, "scrollHeight", { value: 1200 }); Object.defineProperty(lane, "clientHeight", { value: 300 }); }
    left.scrollTop = 100; right.scrollTop = 900;
    h.$("#compare-prompt").value = "还没发送的追问";
    h.emit({ type: "stream", groupId: "group-1", side: "left", kind: "reasoning", delta: "左侧思考" });
    h.emit({ type: "stream", groupId: "group-1", side: "right", kind: "reasoning", delta: "右侧思考" });
    h.emit({ type: "stream", groupId: "group-1", side: "left", delta: "左侧正在答" });
    h.emit({ type: "stream", groupId: "group-1", side: "right", delta: "右侧独立答" }); h.frame();
    expect(h.$('.compare-lane-left .compare-answer-text').textContent.trimEnd()).toBe("左侧正在答");
    expect(h.$('.compare-lane-right .compare-answer-text').textContent.trimEnd()).toBe("右侧独立答");
    expect(h.$('.compare-lane-left .reasoning-content').textContent).toBe("左侧思考");
    expect(h.$('.compare-lane-right .reasoning-content').textContent).toBe("右侧思考");
    expect(left.scrollTop).toBe(100); expect(right.scrollTop).toBe(1200);
    expect(h.$("#compare-prompt").disabled).toBe(false); expect(h.$("#compare-send").disabled).toBe(true);
    h.$("#compare-send-form").requestSubmit(); expect(h.api.compareSend).toHaveBeenCalledTimes(1);
    h.$("#compare-stop").click(); await h.idle();
    expect(h.api.compareStop).toHaveBeenCalledWith("group-1"); expect(h.$("#compare-prompt").value).toBe("还没发送的追问");
    expect(h.$("#compare-send").disabled).toBe(false);
  });

  it("restores persisted conversations, keeps drafts per conversation and does not erase a failed send", async () => {
    const a = group("a"), b = group("b"), h = mount([a, b]); await h.comparison.open();
    await h.send("旧问题"); await h.complete(a);
    h.$("#compare-prompt").value = "a 的草稿";
    h.document.querySelectorAll(".compare-history-item")[1].click(); await h.idle();
    expect(h.$("#compare-prompt").value).toBe(""); h.$("#compare-prompt").value = "b 的草稿";
    h.document.querySelectorAll(".compare-history-item")[0].click(); await h.idle();
    expect(h.$("#compare-prompt").value).toBe("a 的草稿");
    h.api.compareSend.mockRejectedValueOnce(new Error("连接失败")); await h.send("失败后保留");
    expect(h.$("#compare-prompt").value).toBe("失败后保留"); expect(h.$("#compare-status").textContent).toBe("连接失败");
    h.comparison.close(); expect(h.$("#compare-dialog").hidden).toBe(true); expect(h.$(".workspace").dataset.mode).toBeUndefined();
    const restored = mount([a, b]); await restored.comparison.open(); expect(restored.document.querySelectorAll(".compare-answer")).toHaveLength(2);
    await restored.send("重启后追问"); expect(restored.api.compareCreate).not.toHaveBeenCalled(); expect(a.rounds).toHaveLength(2);
  });

  it("uses Enter to send, keeps Shift+Enter and IME composition, and permits continuing after a one-sided failure", async () => {
    const h = mount(); await h.comparison.open();
    const key = values => { const e = new h.window.Event("keydown", { cancelable: true }); Object.assign(e, { key: "Enter", ...values }); h.$("#compare-prompt").dispatchEvent(e); return e; };
    h.$("#compare-prompt").value = "键盘发送";
    expect(key({ shiftKey: true }).defaultPrevented).toBe(false); expect(key({ isComposing: true }).defaultPrevented).toBe(false);
    expect(h.api.compareSend).not.toHaveBeenCalled(); expect(key({}).defaultPrevented).toBe(true); await h.idle();
    await h.complete(h.groups[0]);
    const round = h.groups[0].rounds[0]; round.runs.right.status = "error"; round.runs.right.error = "右侧连接失败";
    h.emit({ type: "changed", groupId: "group-1" }); await vi.waitFor(() => expect(h.$('.compare-lane-right .compare-error').textContent).toBe("右侧连接失败"));
    expect(h.$("#compare-send").disabled).toBe(false); await h.send("继续"); expect(h.groups[0].rounds).toHaveLength(2);
  });
});
