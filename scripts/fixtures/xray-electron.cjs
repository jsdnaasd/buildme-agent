const { app } = require("electron");
const { readFile, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");

const [, , phase, root, project] = process.argv;
app.setPath("userData", join(root, "user-data"));
app.setPath("appData", join(root, "app-data"));
app.on("browser-window-created", (_event, window) => {
  window.hide();
  window.webContents.once("did-finish-load", () => void verify(window).catch((error) => { console.error(error); app.exit(1); }));
});

async function verify(window) {
  await window.webContents.executeJavaScript("window.personalAgent.state()");
  if (phase === "write") {
    const result = await window.webContents.executeJavaScript(`(async () => {
      const events = [];
      const off = window.personalAgent.onXray((notification) => events.push(notification));
      const result = await window.personalAgent.send({ prompt: "local verification sk-test-AAAAAAAAAAAAAAAAAAAA" });
      off();
      const summaries = await window.personalAgent.xrayTurns(result.sessionId);
      const turn = await window.personalAgent.xrayTurn(summaries[0].id);
      return { sessionId: result.sessionId, turnId: turn.id, count: turn.events.length, events, turn };
    })()`);
    assert.equal(result.turn.status, "done");
    assert.equal(result.turn.usage.toolCalls, 66);
    assert.ok(result.count >= 200);
    assert.ok(result.events.some((event) => event.type === "event" && event.event.type === "llm.request"));
    assert.ok(!JSON.stringify(result.events).includes("sk-test-AAAAAAAAAAAAAAAAAAAA"));
    await writeFile(join(root, "identity.json"), JSON.stringify({ sessionId: result.sessionId, turnId: result.turnId }));
    console.log("XRAY_SMOKE " + JSON.stringify({ phase: "write", eventCount: result.count, liveIPC: true, redacted: true }));
  } else {
    const identity = JSON.parse(await readFile(join(root, "identity.json"), "utf8"));
    const result = await window.webContents.executeJavaScript(`(async () => {
      const start = performance.now();
      const turn = await window.personalAgent.xrayTurn(${JSON.stringify(identity.turnId)});
      const queryMs = performance.now() - start;
      const summaries = await window.personalAgent.xrayTurns(${JSON.stringify(identity.sessionId)});
      return { turn, queryMs, summaries };
    })()`);
    assert.equal(result.turn.status, "done");
    assert.ok(result.turn.events.length >= 200);
    assert.equal(result.summaries.length, 1);
    assert.ok(result.queryMs < 100, `IPC query took ${result.queryMs}ms`);
    console.log("XRAY_SMOKE " + JSON.stringify({ phase: "restart", eventCount: result.turn.events.length, queryMs: result.queryMs, restored: true }));
  }
  app.quit();
}

void import(pathToFileURL(join(project, "desktop/main.mjs")).href).catch((error) => { console.error(error); app.exit(1); });
