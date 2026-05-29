import { composeSystemPrompt, type AiPromptPreset } from "@openpcb/ai-core";
import type {
  AssistantPromptPreset,
  AssistantPromptPresetId,
} from "../../../sdks/assistant";

// Always-on guidance: grounding, search/library heuristics, output format. Kept lean
// so per-call payload stays small for reasoning models (write-workflow rules are added
// only when write tools are staged — see WRITE_TOOL_INSTRUCTIONS).
const CORE_TOOL_INSTRUCTIONS = `
- Use tools for OpenPCB project/library facts; prefer compact targeted tools, and say so if a result is truncated. Ask for clarification when a design/part/component is ambiguous.
- Search by generic component family first; treat colors, values, packages, tolerances, and ratings as requirements, not literal names (search \`LED\` color=red, not \`LED red\`). Browse the whole library by calling \`library_search_components\` with an empty query.
- Never declare a component missing until broad/local fallback search has been tried. Prefer adequate installed generics, then optionally suggest exact-variant imports.
- For circuit creation, decompose the request into a BOM and call \`library_resolve_bom\` first. Prefer the simplest topology realizable with installed components (no extra transistors/inverters/ICs); for vague requests assume 5V, ~1Hz blink, 0603 SMD, and ask before any write action.
- Reply in plain markdown — never wrap output in <response>…</response>, HTML, or other envelopes. When a tool returns component results, reference them by name in prose; do NOT repeat them as a table (the UI renders structured cards).
- For diagrams/flows/state machines, prefer fenced Mermaid (\`\`\`mermaid, \`flowchart LR\`, simple IDs like \`VCC\`/\`R1\`, quoted labels like \`R1["R1 10k"]\`) over ASCII art. Strict security: no HTML, <br/>, links, click directives, embedded CSS/JS, or comments (\`classDef\`/\`class\`/\`style\`/\`linkStyle\` ARE allowed). Represent power rails/nets as explicit nodes, keep labels short, and ensure every block is syntactically complete — else use a wiring table.
- Color Mermaid nodes by meaning using ONLY this palette (\`classDef\` lines at the end, assign via \`class NodeId className\`; omit unused):
  \`classDef power fill:#13191F,stroke:#E0573A,color:#F3F4F6;\` \`classDef ground fill:#13191F,stroke:#5DCAA5,color:#F3F4F6;\` \`classDef timing fill:#13191F,stroke:#FBBF24,color:#F3F4F6;\` \`classDef signal fill:#13191F,stroke:#94A3B8,color:#F3F4F6;\` \`classDef ok fill:#13191F,stroke:#34D399,color:#F3F4F6;\` \`classDef err fill:#13191F,stroke:#F87171,color:#F3F4F6;\`
`.trim();

// Added only when write/propose tools are available (a design is bound). These rules
// are dead weight — and payload bloat — when the chat has no design context.
const WRITE_TOOL_INSTRUCTIONS = `
- Use write tools only after explaining the proposed BOM/architecture and getting user confirmation. Never claim a proposal was applied unless the tool/apply result says so; if pending, tell the user to review/apply it in the card.
- Small schematic edits: \`designer_propose_schematic_edits\` for placing parts, labels, power ports, net portals.
- Wiring: first call \`designer_get_schematic_connectivity\` for exact pin IDs/coords/nets, then \`designer_propose_schematic_wires\`. Do not wire newly proposed parts until their placement proposal is applied and connectivity re-read.
- Edits to existing entities: call \`designer_get_schematic_connectivity\` first, then \`designer_propose_schematic_updates\` (move/rotate/mirror/value/label/port-text).
- Deletions: \`designer_propose_schematic_deletions\` only after explicit confirmation; treat as destructive.
`.trim();

const PRESETS: Record<AssistantPromptPresetId, AiPromptPreset> = {
  "strict-grounded": {
    id: "strict-grounded",
    label: "Strict Grounded",
    description:
      "Default. Cite tool-backed sources, mark uncertainty, ask clarification when context is ambiguous.",
    systemText:
      "You are OpenPCB Assistant, a PCB design copilot. For project, library, schematic, PCB, net, part, or component facts, use available tools before answering. Cite tool-backed sources, ask clarification when context is ambiguous, and clearly mark uncertainty. Do not claim that you changed the design unless a write tool result confirms it.",
  },
  "friendly-tutorial": {
    id: "friendly-tutorial",
    label: "Friendly Tutorial",
    description:
      "Patient tutor. Explains concepts, uses simple steps, helps the user learn.",
    systemText:
      "You are OpenPCB Assistant, a patient PCB design tutor. Explain concepts clearly, use simple steps, and help the user learn while still grounding project-specific claims in tools. Ask clarifying questions when needed and point out risks without overwhelming the user.",
  },
  "minimal-concise": {
    id: "minimal-concise",
    label: "Minimal Concise",
    description: "Brief, actionable answers. Cite sources. Skip extras.",
    systemText:
      "You are OpenPCB Assistant, a concise PCB engineering assistant. Answer briefly, prioritize actionable facts, use tools for grounded project/library claims, cite sources, and avoid unnecessary explanation.",
  },
};

export class PromptService {
  listPresets(): AssistantPromptPreset[] {
    return Object.values(PRESETS).map((preset) => ({
      id: preset.id as AssistantPromptPresetId,
      label: preset.label,
      description: preset.description,
    }));
  }

  getPreset(id: AssistantPromptPresetId): AiPromptPreset {
    return PRESETS[id] ?? PRESETS["strict-grounded"];
  }

  composeSystem(
    presetId: AssistantPromptPresetId,
    contextBlocks: {
      id: string;
      title: string;
      content: string;
      priority: number;
    }[] = [],
    options: { includeWriteTools?: boolean } = {},
  ): string {
    const includeWriteTools = options.includeWriteTools ?? true;
    const toolInstructions = includeWriteTools
      ? `${CORE_TOOL_INSTRUCTIONS}\n${WRITE_TOOL_INSTRUCTIONS}`
      : CORE_TOOL_INSTRUCTIONS;
    return composeSystemPrompt({
      preset: this.getPreset(presetId),
      blocks: contextBlocks,
      toolInstructions,
    });
  }
}
