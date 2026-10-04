import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";

const plugin = (ctx) => {
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
  faux.setResponses([
    fauxAssistantMessage(Array.from({ length: 66 }, (_, index) => fauxToolCall("echo", { value: `tool ${index}` })), { stopReason: "toolUse" }),
    fauxAssistantMessage("local smoke complete"),
  ]);
  ctx.llm.register(faux.provider, "smoke");
  return ctx.tools.register({
    name: "echo", label: "Echo", description: "Local test", parameters: Type.Object({ value: Type.String() }),
    execute: async (_id, args) => ({ content: [{ type: "text", text: args.value }], details: {} }),
  });
};
plugin.inject = ["llm", "tools"];
export default plugin;
