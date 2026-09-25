import { fromJsonSchema, type McpServer } from "@modelcontextprotocol/server";
import {
  CORE_TOOL_INSTRUCTIONS,
  WRITE_TOOL_INSTRUCTIONS,
} from "../prompt-service";

/**
 * Guided workflows, surfaced as slash commands in MCP clients.
 *
 * The bodies reuse the same instruction blocks the in-app assistant runs on
 * (`prompt-service.ts`), so an external agent inherits the grounding rules that
 * were tuned here: search by generic family first, prefer `compile_circuit`,
 * batch wires into one call, and never claim a change without a tool result
 * confirming it. Duplicating those rules in prose would let the two surfaces
 * drift apart silently.
 */

function userText(text: string) {
  return {
    messages: [
      { role: "user" as const, content: { type: "text" as const, text } },
    ],
  };
}

export function registerPrompts(
  server: McpServer,
  options: { allowWrites: boolean },
): void {
  // A build workflow the client cannot execute (no write tools listed) would
  // only produce a transcript of refusals.
  if (options.allowWrites) registerBuildPrompt(server);
  registerReadPrompts(server);
}

function registerBuildPrompt(server: McpServer): void {
  server.registerPrompt(
    "openpcb-build-circuit",
    {
      title: "Build a circuit in OpenPCB",
      description:
        "Settle the electrical requirements, resolve a BOM from the installed library, create/choose a design, then place, wire and verify the parts.",
      argsSchema: fromJsonSchema<{ spec: string }>({
        type: "object",
        properties: {
          spec: {
            type: "string",
            description:
              "What to build, with the requirements you know, e.g. 'red LED indicator driven from a 3.3 V GPIO, 0805 parts'.",
          },
        },
        required: ["spec"],
      }),
    },
    ({ spec }) =>
      userText(
        [
          `Build this circuit in OpenPCB: ${spec}`,
          "",
          "Follow these rules:",
          CORE_TOOL_INSTRUCTIONS,
          WRITE_TOOL_INSTRUCTIONS,
          "",
          "Before building, ask the user for anything electrical or manufacturing-critical the request leaves open (supply/logic voltage, currents and ratings, packages the assembly depends on, connector pinouts); choose only reversible layout details yourself and say what you chose.",
          "If no design is open, create one. Once the requirements are settled, finish the build — placed, wired and verified with designer_verify_build — before summarising.",
        ].join("\n"),
      ),
  );
}

function registerReadPrompts(server: McpServer): void {
  server.registerPrompt(
    "openpcb-review-schematic",
    {
      title: "Review the current schematic",
      description:
        "Read the connectivity, run ERC, and report concrete problems with the design.",
    },
    () =>
      userText(
        [
          "Review the schematic currently open in OpenPCB.",
          "",
          "1. Call designer_get_design_summary, then designer_get_schematic_connectivity.",
          "2. Call designer_run_erc.",
          "3. Report two separate groups: ERC findings (exactly what designer_run_erc reported), and engineering observations (heuristics such as missing decoupling or pull-ups, or a value that seems wrong for its role) — each with its evidence, and saying when the component data is not enough to be sure.",
          "",
          "Ground every claim in a tool result — cite the reference designators and net names you saw. Never present an observation as a rule violation. Do not propose edits unless asked; this is a review.",
          "",
          CORE_TOOL_INSTRUCTIONS,
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "openpcb-drc-triage",
    {
      title: "Triage DRC violations",
      description:
        "Run DRC on the open board and group the violations by root cause, most severe first.",
    },
    () =>
      userText(
        [
          "Triage the DRC state of the board currently open in OpenPCB.",
          "",
          "1. Call designer_get_pcb_state for the board setup and net classes.",
          "2. Call designer_run_drc.",
          "3. Group violations by root cause rather than listing them one by one — e.g. 'clearance too tight for the default net class', 'unrouted power net', 'annular ring below fab minimum'. Order by severity.",
          "4. For each group, say what would fix it and whether the fix is a rule change or a layout change.",
          "",
          "Report the active, waived and hidden counts from designer_run_drc; never call the board clean while anything is waived or hidden. Waiving or ignoring rules is the user's decision — only on their explicit request.",
          "OpenPCB is the authoritative DRC engine — never compute clearances yourself, and re-run designer_run_drc after any change.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "openpcb-bom-check",
    {
      title: "Check the BOM",
      description:
        "Read the BOM and flag rows that would block ordering or assembly.",
    },
    () =>
      userText(
        [
          "Check the bill of materials of the design currently open in OpenPCB.",
          "",
          "1. Call designer_get_bom.",
          "2. Flag: rows with no MPN, parts marked DNP that still look required, duplicate reference designators, values that do not match the component's package or rating, and any row the projection warned about.",
          "3. Finish with the count of orderable vs. blocked lines.",
          "",
          "Report only what the BOM data supports — do not invent part numbers or suppliers.",
        ].join("\n"),
      ),
  );
}
