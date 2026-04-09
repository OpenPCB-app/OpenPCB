/**
 * Code templates for module scaffolding
 */

import type { ScaffoldOptions, ModuleManifest } from "./types.js";
import { toPascalCase, toCamelCase } from "./utils.js";

export function generateManifest(opts: ScaffoldOptions): ModuleManifest {
    return {
        id: opts.id,
        label: opts.label,
        version: opts.version,
        apiVersion: 2,
        namespace: opts.namespace,
        kind: opts.kind,
        tags: opts.tags,
        runner: {
            mode: "inproc",
        },
        fs: {
            root: `/modules/${opts.id}`,
            permissions: ["read", "write"],
        },
        db: {
            prefix: opts.id.replace(/-/g, "_"),
            migrations: true,
            rawAccess: true,
        },
        coreCapabilities: ["projects", "contentEditor", "toolRegistry"],
        ui: {
            moduleEntry: "ts/module.ts",
            primarySpace: opts.kind === "space" || opts.hasReactUI ? "react/Space.tsx" : undefined,
            registerAsSpaceInTopBar: opts.kind === "space",
            sidebarLabel: opts.kind === "space" ? opts.label : undefined,
        },
        dependsOn: [],
        exports: {
            services: [],
            widgets: [],
        },
        defaultPinned: false,
    };
}

export function generateReactComponent(opts: ScaffoldOptions): string {
    const componentName = `${toPascalCase(opts.id)}Space`;

    if (opts.kind === "space" || opts.hasReactUI) {
        return `import type { ReactElement } from "react";
import type { ModuleSpaceProps } from "@modules/_kit/createModule";

export function ${componentName}({ moduleId, namespace }: ModuleSpaceProps): ReactElement {
    return (
        <div className="space-y-4 rounded-lg border border-dashed p-4">
            <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    ${opts.label} Space
                </p>
                <span className="text-xs text-muted-foreground">{namespace}</span>
            </div>
            <div className="text-sm text-muted-foreground">
                <p>Module ID: {moduleId}</p>
            </div>
            <p className="text-sm text-muted-foreground">
                Update <code>modules/${opts.id}/react/Space.tsx</code> to customize this space.
            </p>
        </div>
    );
}
`;
    }

    // Non-space module without React UI
    return `import type { ReactElement } from "react";

/** ${opts.label} module (${opts.kind}) - No primary UI */
export function ${componentName}(): ReactElement {
    return (
        <div className="space-y-2 rounded-lg border border-dashed p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                ${opts.label} (${opts.kind})
            </p>
            <p className="text-sm text-muted-foreground">
                This is a ${opts.kind} module without a primary space UI.
            </p>
        </div>
    );
}
`;
}

export function generateModuleEntry(opts: ScaffoldOptions): string {
    const componentName = `${toPascalCase(opts.id)}Space`;
    const constName = toCamelCase(opts.id) + "Module";

    let endpointsSection = "";
    if (opts.hasHttpEndpoints) {
        endpointsSection = `
    // HTTP and WebSocket endpoints
    endpoints(ctx, http, ws) {
        // HTTP endpoint example
        http.get("/example", async (req) => {
            const url = new URL(req.url);
            const name = url.searchParams.get("name") || "World";

            ctx.logger.info(\`Example endpoint called with name: \${name}\`);
            ctx.events.emit("exampleCalled", { name });

            return new Response(JSON.stringify({
                message: \`Hello, \${name} from ${opts.label}!\`,
                timestamp: new Date().toISOString(),
            }), {
                headers: { "Content-Type": "application/json" },
            });
        });

        // WebSocket message handler example
        ws.on("echo", async (msg, client) => {
            ctx.logger.info("Echo message received:", msg.payload);
            client.send({
                type: "echo",
                payload: msg.payload,
            });
        });

        // WebSocket with event bus integration
        ws.on("subscribe", async (msg, client) => {
            ctx.events.on("exampleCalled", (data) => {
                client.send({
                    type: "event",
                    channel: "exampleCalled",
                    payload: data,
                });
            });
        });

        // TODO: Add your HTTP and WebSocket endpoints here
    },
`;
    }

    const spaceComponentLine =
        opts.kind === "space" || opts.hasReactUI
            ? `spaceComponent: ${componentName},`
            : `// spaceComponent: ${componentName}, // Uncomment if this module has a primary space`;

    return `import { createModuleV2 } from "@modules/_kit/createModule";
import { ${componentName} } from "../react/Space";

/**
 * ${opts.label} Module
 * Kind: ${opts.kind}
 * Namespace: ${opts.namespace}
 */
export const ${constName} = createModuleV2("${opts.id}", {
    label: "${opts.label}",
    namespace: "${opts.namespace}",
    version: "${opts.version}",
    kind: "${opts.kind}",
    ${spaceComponentLine}
${endpointsSection}
    // Lifecycle hooks
    onActivate: async (ctx) => {
        ctx.logger.info("${opts.label} module activated");
    },

    onDeactivate: async (ctx) => {
        ctx.logger.info("${opts.label} module deactivated");
    },

    // Services (for service/integration modules)
    // services: (ctx) => ({
    //     "${opts.namespace}.exampleService": async (input: unknown) => {
    //         return { result: "success" };
    //     },
    // }),

    // Widgets
    // widgets: {
    //     "example-widget": ExampleWidget,
    // },
});

export default ${constName};
`;
}
