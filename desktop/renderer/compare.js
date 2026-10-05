(() => {
  const $ = (s) => document.querySelector(s);
  const node = (tag, text, cls = "") => { const el = document.createElement(tag); el.className = cls; if (text !== undefined) el.textContent = text; return el; };
  const statuses = { running: "运行中", done: "完成", error: "失败", aborted: "已取消", interrupted: "应用中断" };
  window.createComparisons = (api, { onTurn }) => {
    const dialog = $("#compare-dialog"), history = $("#compare-history"), content = $("#compare-content");
    let selected, data, pending = false, generation = 0, animation;
    const outputs = {};
    const status = (text) => { $("#compare-status").textContent = text; };
    function busy(value) {
      pending = value; dialog.dataset.busy = String(value);
      $("#compare-create").disabled = value; $("#compare-new").disabled = value;
      const running = Object.values(data?.group.rounds.at(-1)?.runs ?? {}).some((run) => run.status === "running");
      $("#compare-send").disabled = value || running || Boolean(data?.group.workspace.expired);
    }
    async function action(fn) { if (pending) return; busy(true); try { await fn(); } catch (error) { status(error.message); } finally { busy(false); } }
    async function list() {
      const groups = await api.compareList(); history.replaceChildren();
      for (const group of groups) { const button = node("button", `⚖ ${group.title}`, "compare-history-item"); button.type = "button"; button.setAttribute("aria-current", String(group.id === selected)); button.onclick = () => void action(() => select(group.id)); history.append(button); }
      return groups;
    }
    async function select(id) {
      selected = id; const version = ++generation; const result = await api.compareGet(id);
      if (version !== generation) return;
      data = result; render(); await list();
    }
    function showChanges(side) {
      const preview = data.group.differences[side]; if (!preview) return;
      const detail = $("#compare-changes"); detail.replaceChildren(node("h3", `${side === "left" ? "左侧" : "右侧"}完整改动清单 · ${preview.changes.length} 项`));
      for (const change of preview.changes) {
        const entry = node("details"), label = node("summary", `${{ added: "新增", modified: "修改", deleted: "删除" }[change.kind]} · ${change.path}${change.binary ? " · 二进制" : ""}`);
        entry.append(label, node("pre", change.blocked || change.diff || "二进制内容已变化。")); detail.append(entry);
      }
      if (!data.group.workspace.expired && !data.group.workspace.readOnly && preview.changes.length) {
        const adopt = node("button", "采用这侧的全部改动", "primary-button"); adopt.type = "button";
        adopt.disabled = Object.values(data.group.rounds.at(-1)?.runs ?? {}).some((r) => r.status === "running") || preview.changes.some((c) => c.blocked);
        adopt.onclick = () => void action(async () => {
          const result = await api.compareAdopt(selected, side, preview.token);
          status(result.cancelled ? "已取消采用。" : result.conflicts.length ? `发现冲突，未写回任何文件：${result.conflicts.join("、")}` : `已采用 ${result.applied.length} 项改动。`);
        }); detail.append(adopt);
      }
      detail.hidden = false;
    }
    function render() {
      const { group, metrics, differences } = data; content.replaceChildren();
      $("#compare-summary").replaceChildren();
      if (group.rounds.length && !Object.values(group.rounds.at(-1).runs).some(run => run.status === "running")) window.addDeepExplanation?.($("#compare-summary"), { kind: "comparison", compareGroupId: group.id }, "让 BuildMe 总结两边的差别"); $("#compare-changes").hidden = true;
      $("#compare-new-form").hidden = true; $("#compare-send-form").hidden = false;
      $("#compare-delete").hidden = false; $("#compare-inspect").hidden = !group.rounds.length;
      status(group.workspace.expired ? "副本已过期，仅保留回答与差异记录。" : group.workspace.readOnly ? "工作区超过 300 MB：两侧强制只读，禁止写入和命令。" : "两侧使用独立工作区副本。采用改动前会核对真实文件。" );
      content.append(node("p", `${group.workspace.source} · 排除 ${group.workspace.excluded.length} 项（含依赖目录、链接及大文件）`, "compare-meta"));
      const exclusion = node("details"); exclusion.append(node("summary", "查看复制时排除的路径"), node("pre", group.workspace.excluded.join("\n") || "无")); content.append(exclusion);
      for (const [index, round] of group.rounds.entries()) {
        const section = node("section", undefined, "compare-round"); section.append(node("h3", `第 ${index + 1} 回合`), node("p", round.prompt, "compare-question"));
        const columns = node("div", undefined, "compare-columns");
        for (const side of ["left", "right"]) {
          const config = group.sides[side], run = round.runs[side], card = node("article", undefined, "compare-answer");
          card.append(node("h4", `${side === "left" ? "左侧" : "右侧"} · ${config.engine.toUpperCase()} · ${config.connection.model}`), node("span", statuses[run.status], `compare-run-status ${run.status}`));
          const text = node("pre", run.text || (run.status === "running" ? "等待模型…" : "没有回答内容")); card.append(text);
          if (round === group.rounds.at(-1)) outputs[side] = text;
          if (run.error) card.append(node("p", run.error, "compare-error"));
          if (run.turnIds[0]) { const inspect = node("button", "查看此回合 X 光", "secondary-button"); inspect.onclick = () => void action(async () => { const turn = await api.xrayTurn(run.turnIds[0]); if (!turn) throw new Error("该回合的 X 光历史已被清理。"); dialog.close(); await onTurn(turn); }); card.append(inspect); }
          columns.append(card);
        }
        section.append(columns); content.append(section);
      }
      if (group.rounds.length) {
        const table = node("table", undefined, "compare-metrics"); const head = node("tr"); for (const label of ["统计（含已记录子回合）", "左侧", "右侧", "右 − 左"]) head.append(node("th", label)); table.append(head);
        for (const [key, label] of Object.entries({ modelCalls: "模型调用", toolCalls: "工具调用", subagents: "子任务", compactions: "压缩 / 裁剪", tokens: "Tokens（含已报告缓存）", durationMs: "总耗时（秒）", files: "文件变化" })) {
          const row = node("tr"); const fmt = (v) => v === undefined ? "不可用" : key === "durationMs" ? (v / 1000).toFixed(2) : v.toLocaleString("zh-CN");
          const difference = differences[key]; row.append(node("th", label), node("td", fmt(metrics.left[key])), node("td", fmt(metrics.right[key])), node("td", difference.delta === undefined ? "—" : `${fmt(difference.delta)}${difference.percent === undefined ? "" : ` (${difference.percent > 0 ? "+" : ""}${difference.percent.toFixed(1)}%)`}`)); table.append(row);
        }
        content.append(table);
        for (const side of ["left", "right"]) {
          const unique = metrics[side].tools.filter((name) => !metrics[side === "left" ? "right" : "left"].tools.includes(name));
          content.append(node("p", `${side === "left" ? "左" : "右"}侧独有：${unique.join("、") || "无"}；全部工具：${metrics[side].tools.join("、") || "无已记录调用"} · 用量${{ exact: "精确", estimated: "估算", none: "不可用" }[metrics[side].usage]}`));
          const files = node("button", `查看${side === "left" ? "左" : "右"}侧文件变化`, "secondary-button"); files.onclick = () => showChanges(side); content.append(files);
        }
      }
      const running = Object.values(group.rounds.at(-1)?.runs ?? {}).some((run) => run.status === "running");
      $("#compare-send").disabled = pending || running || group.workspace.expired;
      $("#compare-stop").hidden = !running; $("#compare-prompt").disabled = group.workspace.expired;
    }
    async function inspect() {
      const box = $("#compare-timeline"); box.replaceChildren(node("h3", "并列 X 光 · 按各自模型 round 展示"));
      const records = {};
      for (const side of ["left", "right"]) {
        records[side] = new Map();
        for (const turn of data.traces[side] ?? []) if (turn) {
          let round = 1;
          for (const event of turn.events) {
            if (event.round) round = event.round;
            if (!records[side].has(round)) records[side].set(round, []);
            records[side].get(round).push({ turn, event });
          }
        }
      }
      const rounds = [...new Set([...records.left.keys(), ...records.right.keys()])].sort((a, b) => a - b);
      for (const round of rounds) {
        box.append(node("h4", `Round ${round}`)); const columns = node("div", undefined, "compare-columns");
        for (const side of ["left", "right"]) {
          const column = node("div", undefined, "compare-timeline-side"); column.append(node("strong", side === "left" ? "左侧" : "右侧"));
          for (const { turn, event } of records[side].get(round) ?? []) {
            const signature = `${event.type}:${event.name ?? ""}`, other = side === "left" ? "right" : "left";
            const unique = !(records[other].get(round) ?? []).some(({ event: e }) => `${e.type}:${e.name ?? ""}` === signature);
            const entry = node("details", undefined, unique ? "compare-one-side" : ""); entry.append(node("summary", `${event.type}${event.name ? ` · ${event.name}` : ""}${turn.parentTurnId ? " · 子任务" : ""}${unique ? " · 仅此侧" : ""}`), node("pre", JSON.stringify(event, null, 2))); column.append(entry);
          }
          if (!records[side].has(round)) column.append(node("p", "此侧没有这一 round 的记录。"));
          columns.append(column);
        }
        box.append(columns);
      }
      box.hidden = false; await api.compareXrayOpened(selected);
    }
    async function fresh() {
      selected = undefined; data = undefined; generation++; $("#compare-summary").replaceChildren(); content.replaceChildren(); $("#compare-new-form").hidden = false; $("#compare-send-form").hidden = true; $("#compare-delete").hidden = true; $("#compare-inspect").hidden = true; $("#compare-changes").hidden = true; $("#compare-timeline").hidden = true;
      const state = await api.state();
      for (const side of ["left", "right"]) { const select = $(`#compare-${side}-connection`); select.replaceChildren(); for (const c of state.connections) { const option = node("option", `${c.name || c.provider} · ${c.model}`); option.value = c.id; select.append(option); } select.value = state.activeConnectionId; }
      status($("#compare-kind").value === "model" ? "相同 Pi 能力与工作区基线，比较明确选择的两个模型。单次结果不能代表普遍优劣。" : "同模型下比较两种 harness 的表现。随机输出差异不能全部归因于 harness。"); await list();
    }
    async function open() { dialog.showModal(); const groups = await list(); if (selected) await select(selected); else if (groups.length) await select(groups[0].id); else await fresh(); }
    $("#comparisons").onclick = () => void action(open);
    $("#compare-close").onclick = () => dialog.close();
    $("#compare-new").onclick = () => void action(fresh);
    $("#compare-kind").onchange = () => { $("#compare-right-choice").hidden = $("#compare-kind").value !== "model"; status($("#compare-kind").value === "model" ? "相同 Pi 能力与基线，比较两条明确选择的模型连接。" : "同模型下比较两种 harness 的表现。随机输出差异不能全部归因于 harness。"); };
    $("#compare-create").onclick = () => void action(async () => { const group = await api.compareCreate({ kind: $("#compare-kind").value, leftConnectionId: $("#compare-left-connection").value, rightConnectionId: $("#compare-right-connection").value, piAll: $("#compare-pi-all").checked }); await select(group.id); });
    $("#compare-send-form").onsubmit = (event) => { event.preventDefault(); void action(async () => { const text = $("#compare-prompt").value.trim(); if (!text) return; await api.compareSend(selected, text); $("#compare-prompt").value = ""; await select(selected); }); };
    $("#compare-stop").onclick = () => void action(async () => { await api.compareStop(selected); await select(selected); });
    $("#compare-delete").onclick = () => void action(async () => { if (!window.confirm("删除此对比记录及两个副本？真实工作区不受影响。")) return; await api.compareDelete(selected); await fresh(); });
    $("#compare-inspect").onclick = () => void action(inspect);
    api.onCompare((event) => {
      if (event.groupId !== selected || !data) return;
      if (event.type === "stream") {
        const run = data.group.rounds.at(-1)?.runs[event.side]; if (!run) return;
        run.text += event.delta;
        if (!animation) animation = requestAnimationFrame(() => { animation = undefined; for (const side of ["left", "right"]) if (outputs[side]) outputs[side].textContent = data.group.rounds.at(-1).runs[side].text; });
      } else void select(selected).catch((error) => status(error.message));
    });
    return { open: (example) => action(async () => { if (example) { dialog.showModal(); await fresh(); $("#compare-prompt").value = example; } else await open(); }) };
  };
})();
