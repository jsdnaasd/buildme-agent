const { app, dialog } = require("electron");
const { readFile, writeFile, mkdir } = require("node:fs/promises");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const [, , phase, root, project] = process.argv;
app.setPath("userData", join(root, "user-data")); app.setPath("appData", join(root, "app-data"));
dialog.showMessageBox = async () => ({ response: 1 });
app.on("browser-window-created", (_event, window) => {
  window.webContents.setBackgroundThrottling(false);
  window.webContents.once("did-finish-load", () => void verify(window).catch((error) => { console.error(error); app.exit(1); }));
});
async function verify(window) {
  const js = (code) => window.webContents.executeJavaScript(code);
  await js(`window.waitForUI = (predicate) => new Promise((resolve, reject) => {
    if (predicate() && document.querySelector('#compare-dialog').dataset.busy === 'false') return resolve();
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('UI timeout: '+predicate+' status='+document.querySelector('#compare-status').textContent+' runs='+[...document.querySelectorAll('.compare-run-status')].map(e=>e.textContent).join(','))); }, 60000);
    const observer = new MutationObserver(() => { if (predicate() && document.querySelector('#compare-dialog').dataset.busy === 'false') { clearTimeout(timer); observer.disconnect(); resolve(); } });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  }); window.frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); void 0;`);
  await js("window.personalAgent.state()");
  await js("window.approvalSources = []; window.personalAgent.onApproval(r => { approvalSources.push(r.source); void window.personalAgent.respondApproval(r.requestId, true); }); void 0;");
  if (phase === "write") {
    await js("document.querySelector('#comparisons').click(); waitForUI(() => document.querySelector('#compare-left-connection').options.length === 2)");
    await js("document.querySelector('#compare-create').click(); waitForUI(() => !document.querySelector('#compare-send-form').hidden)");
    await js("document.querySelector('#compare-prompt').value = 'COMPARE_ONE read and update input.txt'; document.querySelector('#compare-send-form').requestSubmit(); waitForUI(() => document.querySelectorAll('.compare-run-status.done,.compare-run-status.error').length === 2)");
    const id = await js("window.personalAgent.compareList().then(groups => groups[0].id)");
    let result = await js(`window.personalAgent.compareGet('${id}')`);
    assert.deepEqual(Object.values(result.group.rounds[0].runs).map((run) => run.status), ["done", "done"], JSON.stringify(result.group.rounds));
    await js(`new Promise((resolve, reject) => { const end = setTimeout(() => reject(new Error('persist timeout')), 10000); const check = async () => { const r = await personalAgent.compareGet('${id}'); if (r.group.differences.right) { clearTimeout(end); stop(); resolve(); } }; const stop = personalAgent.onCompare(check); void check(); })`);
    result = await js(`window.personalAgent.compareGet('${id}')`);
    assert.equal(result.group.sides.right.engine, "dsh"); assert.equal(result.metrics.left.toolCalls, 2); assert.equal(result.metrics.right.toolCalls, 2);
    assert.equal(result.group.differences.left.changes.length, 1); assert.equal(result.group.differences.right.changes.length, 1);
    assert.equal(await readFile(join(root, "workspace/input.txt"), "utf8"), "baseline\n");
    await js("document.querySelector('#compare-inspect').click(); waitForUI(() => !document.querySelector('#compare-timeline').hidden)");
    assert.match(await js("document.querySelector('#compare-timeline').textContent"), /llm.request/);
    await writeFile(join(root, "identity.json"), JSON.stringify({ id }));
    await writeFile(join(root, "workspace/input.txt"), "user later\n");
    const blocked = await js(`window.personalAgent.compareAdopt('${id}', 'left', '${result.group.differences.left.token}')`);
    assert.deepEqual(blocked.conflicts, ["input.txt"]); assert.equal(await readFile(join(root, "workspace/input.txt"), "utf8"), "user later\n");
    const screenshots = process.env.BUILDME_COMPARE_SCREENSHOTS;
    if (screenshots) { await mkdir(screenshots, { recursive: true }); for (const [name, width] of [["wide", 1360], ["narrow", 820]]) { window.setSize(width, 900); await js("frame()"); await writeFile(join(screenshots, name + ".png"), (await window.webContents.capturePage()).toPNG()); } }
    console.log("COMPARE_SMOKE " + JSON.stringify({ phase, realPiAndDsh: true, independentCopies: true, conflictStopped: true, parallelXray: true, realApi: false }));
  } else {
    const { id } = JSON.parse(await readFile(join(root, "identity.json"), "utf8"));
    const result = await js(`window.personalAgent.compareGet('${id}')`);
    assert.equal(result.group.rounds.length, 1); assert.equal(result.group.differences.right.changes.length, 1);
    await js("document.querySelector('#comparisons').click(); waitForUI(() => document.querySelectorAll('.compare-answer').length === 2)");
    await js("document.querySelector('#compare-prompt').value = 'COMPARE_TWO continue'; document.querySelector('#compare-send-form').requestSubmit(); waitForUI(() => document.querySelectorAll('.compare-run-status.done,.compare-run-status.error').length === 4)");
    const continued = await js(`window.personalAgent.compareGet('${id}')`);
    assert.deepEqual(Object.values(continued.group.rounds[1].runs).map((r) => r.status), ["done", "done"], JSON.stringify(continued.group.rounds[1]));
    await js("document.querySelector('#compare-prompt').value = 'COMPARE_COMMAND verify isolation'; document.querySelector('#compare-send-form').requestSubmit(); waitForUI(() => document.querySelectorAll('.compare-run-status.done,.compare-run-status.error').length === 6)");
    const commands = await js(`window.personalAgent.compareGet('${id}')`);
    assert.deepEqual(Object.values(commands.group.rounds[2].runs).map(r => r.status), ["done", "done"]);
    for (const side of ["left", "right"]) {
      const path = join(root, "user-data/comparisons/workspaces", id, side, "workspace/inside.txt");
      const outcome = commands.traces[side][0].events.find(e => e.type === "tool.result");
      assert.ok(outcome.result.includes("CONFINED"), side + ": " + outcome.result);
      assert.equal(await readFile(path, "utf8"), "safe");
    }
    assert.equal(await readFile(join(root, "workspace/input.txt"), "utf8"), "user later\n");
    assert.ok((await js("approvalSources")).some(source => source?.includes("左侧")));
    console.log("COMPARE_SMOKE " + JSON.stringify({ phase, restoredAnswersAndDiffs: true, continuedTwoSessions: true, bothCommandsConfined: true, approvalSource: true }));
  }
  app.quit();
}
void import(pathToFileURL(join(project, "desktop/main.mjs")).href).catch((error) => { console.error(error); app.exit(1); });
