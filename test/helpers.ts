import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { PiharnessProfile } from "../src/contracts.js";

export async function tempWorkspace(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
	const dir = await mkdtemp(join(tmpdir(), "piharness-"));
	// DSH profiles install plugin dependencies beside the profile. Tests use the
	// repository dependency generation through the same node_modules position.
	await symlink(resolve("node_modules"), join(dir, "node_modules"), "dir");
	return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export async function writeProfile(dir: string, profile: PiharnessProfile): Promise<string> {
	const path = join(dir, "profile.json");
	await writeFile(path, JSON.stringify(profile, null, 2));
	return path;
}
