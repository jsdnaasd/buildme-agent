import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import electron from "electron";
const project = resolve("."), root = await mkdtemp(join(tmpdir(), "buildme-compare-electron-"));
const server = createServer(async (req, res) => {
  let body = ""; for await (const chunk of req) body += chunk;
  const request = JSON.parse(body), tools = request.tools ?? [], pi = tools.some((t) => t.function.name === "workspace_info");
  const index = request.messages.findLastIndex((m) => m.role === "user" && JSON.stringify(m.content).includes("COMPARE_"));
  const results = request.messages.slice(index).filter((m) => m.role === "tool");
  let delta = { content: "Local deterministic comparison complete." }, reason = "stop";
  if (tools.length && results.length < 2) {
    const args = results.length === 0 ? { [pi ? "path" : "file_path"]: "input.txt" } : { [pi ? "path" : "file_path"]: "input.txt", content: "changed by local fixture\n" };
    delta = { tool_calls: [{ index: 0, id: `fixture-${results.length}`, type: "function", function: { name: results.length === 0 ? "read" : "write", arguments: JSON.stringify(args) } }] }; reason = "tool_calls";
  }
  if (tools.length && JSON.stringify(request.messages.slice(index)).includes("COMPARE_COMMAND")) {
    if (results.length === 0) {
      delta = { tool_calls: [{ index: 0, id: "fixture-command", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: `printf safe > inside.txt; if printf escaped > '${join(root, "workspace/input.txt")}'; then echo ESCAPED; else echo CONFINED; fi`, ...(pi ? {} : { description: "Verify local comparison sandbox file boundary" }) }) } }] }; reason = "tool_calls";
    } else { delta = { content: "Local sandbox command complete" }; reason = "stop"; }
  }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const send = (value) => res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture-model", ...value })}\n\n`);
  send({ choices: [{ index: 0, delta: { role: "assistant", ...delta }, finish_reason: null }] });
  send({ choices: [{ index: 0, delta: {}, finish_reason: reason }], usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 } }); res.end("data: [DONE]\n\n");
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
try {
  for (const dir of ["user-data", "app-data", "workspace"]) await mkdir(join(root, dir));
  await writeFile(join(root, "workspace/input.txt"), "baseline\n");
  const connection = { provider: "openai-compatible", model: "fixture-model", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: "fixture-key-not-real" };
  await writeFile(join(root, "user-data/desktop-settings.json"), JSON.stringify({ connections: [{ ...connection, id: "left", name: "Local A" }, { ...connection, id: "right", name: "Local B" }], activeConnectionId: "left", workspacePath: join(root, "workspace"), permissionMode: "workspace-write", edition: "standard", capabilities: ["core"] }));
  for (const phase of ["write", "read"]) {
    const env = { ...process.env, HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", all_proxy: "", http_proxy: "", https_proxy: "", NO_PROXY: "127.0.0.1,localhost", DEEPSEEK_API_KEY: "" }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [join(project, "scripts/fixtures/compare-electron.cjs"), phase, root, project], { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", (data) => { output += data; }); child.stderr.on("data", (data) => { output += data; });
    const timer = setTimeout(() => child.kill(), 90000);
    try {
      const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
      assert.equal(code, 0, output); const result = output.split("\n").find((line) => line.startsWith("COMPARE_SMOKE ")); assert.ok(result, output); console.log(result);
    } finally { clearTimeout(timer); }
  }
} finally { server.closeAllConnections(); await new Promise((done) => server.close(done)); await rm(root, { recursive: true, force: true }); }
