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
  const js = async (code) => { try { return await window.webContents.executeJavaScript(code); } catch (error) { throw new Error(`Renderer check failed: ${code.slice(0, 180)}\n${error.message}`); } };
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
  } else if (phase === "read") {
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
  } else if (phase === "m5") {
    const { url } = JSON.parse(await readFile(join(root, "endpoint.json"), "utf8"));
    const stats = async () => (await fetch(url + "/_stats")).json();
    await js("document.querySelector('#comparisons').click(); waitForUI(() => document.querySelectorAll('.compare-answer').length > 0)");
    await js("document.querySelector('#compare-new').click(); waitForUI(() => !document.querySelector('#compare-new-form').hidden)");
    await js("document.querySelector('#compare-kind').value = 'model'; document.querySelector('#compare-kind').dispatchEvent(new Event('change')); document.querySelector('#compare-right-connection').value = 'right'; document.querySelector('#compare-create').click(); waitForUI(() => !document.querySelector('#compare-send-form').hidden)");
    const groups = await js("personalAgent.compareList()"); const id = groups.find(g => g.kind === "model").id;
    await js("document.querySelector('#compare-prompt').value = 'COMPARE_MODEL compare the models'; document.querySelector('#compare-send-form').requestSubmit(); waitForUI(() => document.querySelectorAll('.compare-run-status.done,.compare-run-status.error').length === 2)");
    let result = await js(`personalAgent.compareGet('${id}')`);
    assert.deepEqual(Object.values(result.group.sides).map(s => s.engine), ["pi", "pi"]);
    assert.deepEqual(result.group.sides.left.capabilities, result.group.sides.right.capabilities);
    assert.notEqual(result.group.sides.left.sessionId, result.group.sides.right.sessionId);
    assert.equal(result.group.sides.right.connection.model, "fixture-model-b");
    assert.deepEqual((await js("personalAgent.state()")).capabilities, ["core"]);
    await js(`new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('diff persistence')), 10000); const check = async () => { if ((await personalAgent.compareGet('${id}')).group.differences.left) { clearTimeout(timer); stop(); resolve(); } }; const stop = personalAgent.onCompare(check); void check(); })`);
    result = await js(`personalAgent.compareGet('${id}')`);
    assert.equal(await readFile(join(root, "workspace/input.txt"), "utf8"), "user later\n");
    assert.deepEqual((await js(`personalAgent.compareAdopt('${id}', 'left', '${result.group.differences.left.token}')`)).applied, ["input.txt"]);
    assert.equal(await readFile(join(root, "workspace/input.txt"), "utf8"), "changed by local fixture\n");
    await js("waitForUI(() => document.querySelector('#compare-summary .deep-start') && !document.querySelector('#compare-summary .deep-start').disabled)");
    await js("document.querySelector('#compare-summary .deep-start').click(); waitForUI(() => document.querySelector('#compare-summary .deep-status').textContent.includes('讲解完成'))");
    assert.match(await js("document.querySelector('#compare-summary .deep-output').textContent"), /1\..*2 次工具调用/u);
    assert.equal((await stats()).unsafeSummary, false);
    const sessionId = result.group.sides.left.sessionId, turnId = result.group.rounds[0].runs.left.turnIds[0];
    const history = await js(`personalAgent.messages('${sessionId}')`), turns = await js(`personalAgent.xrayTurns('${sessionId}', 'pi')`);
    await js(`document.querySelector('.compare-answer button').click(); waitForUI(() => document.querySelector('#xray-panel').dataset.turnId === '${turnId}' && document.querySelector('.xray-tool .xray-help-toggle'))`);
    await js("document.querySelector('.xray-tool .xray-help-toggle').click(); waitForUI(() => document.querySelector('.xray-tool .deep-start') && !document.querySelector('.xray-tool .deep-start').disabled)");
    const before = await stats();
    await js("document.querySelector('.xray-tool .deep-start').click(); waitForUI(() => document.querySelector('.xray-tool .deep-output').textContent.length > 0)");
    assert.ok(await js("document.querySelector('.xray-tool .deep-status').textContent.includes('正在')"), "must visibly stream before completion");
    await js("waitForUI(() => document.querySelector('.xray-tool .deep-status').textContent.includes('讲解完成'))");
    const after = await stats(); assert.equal(after.explanations, before.explanations + 1);
    await js("document.querySelector('.xray-tool .deep-start').click(); waitForUI(() => document.querySelector('.xray-tool .deep-status').textContent.includes('本地缓存'))");
    assert.equal((await stats()).explanations, after.explanations);
    assert.deepEqual(await js(`personalAgent.messages('${sessionId}')`), history);
    assert.deepEqual(await js(`personalAgent.xrayTurns('${sessionId}', 'pi')`), turns);
    if (process.env.BUILDME_COMPARE_SCREENSHOTS) {
      window.setSize(1360, 900);
      for (const theme of ["light", "dark"]) {
        await js(`document.documentElement.dataset.theme = '${theme}'; document.querySelector('.xray-tool .deep-output').scrollIntoView({block:'center'}); frame()`);
        await writeFile(join(process.env.BUILDME_COMPARE_SCREENSHOTS, `deep-${theme}.png`), (await window.webContents.capturePage()).toPNG());
      }
    }
    const eventId = result.traces.left[0].events.find(e => e.type === "tool.call").id;
    await writeFile(join(root, "explanation-identity.json"), JSON.stringify({ turnId, eventId, sessionId }));
    await js("document.querySelector('.xray-model .xray-help-toggle').click(); waitForUI(() => document.querySelector('.xray-model .deep-start'))");
    await writeFile(join(root, "behavior.json"), JSON.stringify({ mode: "error" }));
    await js("document.querySelector('.xray-model .deep-start').click(); waitForUI(() => document.querySelector('.xray-model .deep-status').textContent.includes('讲解失败'))");
    await writeFile(join(root, "behavior.json"), JSON.stringify({ mode: "slow" }));
    await js("document.querySelector('.xray-model .deep-start').click(); waitForUI(() => document.querySelector('.xray-model .deep-output').textContent.length > 0)");
    await js("document.querySelector('.xray-model .deep-cancel').click(); waitForUI(() => document.querySelector('.xray-model .deep-status').textContent.includes('已取消'))");
    await writeFile(join(root, "behavior.json"), JSON.stringify({ mode: "normal" }));
    const { id: harnessId } = JSON.parse(await readFile(join(root, "identity.json"), "utf8"));
    await js(`(async () => { const seen = new Set(); let resolve; const ready = new Promise(done => { resolve = done; }); const off = personalAgent.onCompare(event => { if (event.groupId === '${harnessId}' && event.type === 'stream') { seen.add(event.side); if (seen.size === 2) resolve(); } }); await personalAgent.compareSend('${harnessId}', 'COMPARE_CANCEL cancel both engines'); await ready; off(); await personalAgent.compareStop('${harnessId}'); })()`);
    assert.deepEqual(Object.values((await js(`personalAgent.compareGet('${harnessId}')`)).group.rounds.at(-1).runs).map(r => r.status), ["aborted", "aborted"]);
    await js(`(async () => { let resolve; const ready = new Promise(done => { resolve = done; }); const off = personalAgent.onCompare(async event => { if (event.groupId === '${id}' && event.type === 'changed') { const group = (await personalAgent.compareGet('${id}')).group; if (Object.values(group.rounds.at(-1).runs).every(r => r.status !== 'running')) resolve(); } }); await personalAgent.compareSend('${id}', 'COMPARE_FAILURE one model fails'); await ready; off(); })()`);
    assert.deepEqual(Object.values((await js(`personalAgent.compareGet('${id}')`)).group.rounds.at(-1).runs).map(r => r.status), ["done", "error"]);
    const achievements = await js("personalAgent.achievements()");
    assert.ok(achievements.achievements.some(a => a.id === 'explain-deep')); assert.ok(achievements.achievements.some(a => a.id === 'compare-summary'));
    console.log("COMPARE_SMOKE " + JSON.stringify({ phase, twoPiModels: true, adoptConfirmed: true, summaryPrivate: true, explanationStreamCacheCancelError: true, unchangedChatAndTurns: true, cancelPiAndDsh: true, singleModelFailure: true }));
  } else {
    const identity = JSON.parse(await readFile(join(root, "explanation-identity.json"), "utf8"));
    const { url } = JSON.parse(await readFile(join(root, "endpoint.json"), "utf8"));
    const before = await (await fetch(url + "/_stats")).json();
    const notice = await js(`new Promise((resolve, reject) => { const off = personalAgent.onExplanation(event => { if (event.requestId !== 'restore-explanation') return; if (event.type === 'done') { off(); resolve(event); } if (event.type === 'error') { off(); reject(new Error(event.message)); } }); void personalAgent.explain('restore-explanation', ${JSON.stringify({ kind: "event", turnId: identity.turnId, eventId: identity.eventId })}); })`);
    assert.equal(notice.cached, true); assert.equal((await (await fetch(url + "/_stats")).json()).explanations, before.explanations);
    console.log("COMPARE_SMOKE " + JSON.stringify({ phase, persistedExplanationCache: true, noModelCall: true }));
  }
  app.quit();
}
void import(pathToFileURL(join(project, "desktop/main.mjs")).href).catch((error) => { console.error(error); app.exit(1); });
