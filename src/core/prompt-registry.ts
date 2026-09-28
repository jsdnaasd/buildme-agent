import { Service } from "@deepseek-ai/cordis";

export interface PromptSection {
	readonly name: string;
	readonly order: number;
	readonly text: string | (() => string);
}

/** DSH-shaped `ctx.systemPrompt` service with reversible ordered sections. */
export class SystemPromptRuntime extends Service {
	private readonly sections = new Map<string, PromptSection>();

	constructor(ctx: import("@deepseek-ai/cordis").Context) {
		super(ctx, "systemPrompt");
	}

	register(section: PromptSection): () => void {
		if (!/^[a-z][a-z0-9:/._-]*$/.test(section.name)) {
			throw new Error(`Invalid prompt section name: ${section.name}`);
		}
		if (!Number.isFinite(section.order)) throw new TypeError(`Prompt section ${section.name} needs a finite order.`);
		if (this.sections.has(section.name)) throw new Error(`Prompt section already registered: ${section.name}`);
		this.sections.set(section.name, Object.freeze({ ...section }));
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			this.sections.delete(section.name);
		};
	}

	render(): string {
		return [...this.sections.values()]
			.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
			.map((section) => (typeof section.text === "function" ? section.text() : section.text).trim())
			.filter((text) => text.length > 0)
			.join("\n\n");
	}

	list(): readonly PromptSection[] {
		return [...this.sections.values()].sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
	}
}

/** @deprecated Use SystemPromptRuntime; retained for source compatibility. */
export { SystemPromptRuntime as PromptRegistry };
