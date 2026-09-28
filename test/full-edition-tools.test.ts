import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createApp } from "../src/bootstrap.js";
import { initProfile, loadProfile } from "../src/profile.js";
import { tempWorkspace } from "./helpers.js";

describe("BuildMe full edition", () => {
	it("keeps the standard tool set small and enables DSH-style capability families only in full mode", async () => {
		const fixture = await tempWorkspace();
		const profile = join(fixture.dir, "profile");
		await mkdir(profile);
		await initProfile(profile, "BuildMe");
		const app = await createApp(await loadProfile(profile));
		try {
			const standard = app.ctx.tools.list({ workspacePath: fixture.dir, permissionMode: "bypass", edition: "standard" }).map((tool) => tool.name);
			const full = app.ctx.tools.list({ workspacePath: fixture.dir, permissionMode: "bypass", edition: "full" });
			expect(standard).not.toContain("files_search");
			expect(full.map((tool) => tool.name)).toEqual(expect.arrayContaining([
				"files_search", "web_fetch", "todo_manage", "plan_manage", "skill_catalog", "delegate_task", "workflow_run",
			]));

			const todos = full.find((tool) => tool.name === "todo_manage");
			if (!todos) throw new Error("Missing todo_manage");
			await todos.execute("todo-1", { action: "replace", items: [{ text: "Ship BuildMe full mode" }] });
			expect(JSON.parse(await readFile(join(fixture.dir, ".buildme", "todos.json"), "utf8"))).toEqual([
				{ text: "Ship BuildMe full mode", done: false },
			]);
		} finally {
			await app.stop();
			await fixture.cleanup();
		}
	});
});
