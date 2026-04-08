import { createModuleV2 } from "@modules/_kit/createModule";
import { ComponentLibrarySpace } from "../react/Space";

/**
 * Component Library Module
 * Kind: space
 * Namespace: space.componentlibrary
 */
export const componentLibraryModule = createModuleV2("component-library", {
    label: "Component Library",
    namespace: "space.componentlibrary",
    version: "0.1.0",
    kind: "space",
    spaceComponent: ComponentLibrarySpace,

    // HTTP and WebSocket endpoints
    endpoints(ctx, http, ws) {
        // HTTP endpoint example
        http.get("/example", async (req) => {
            const url = new URL(req.url);
            const name = url.searchParams.get("name") || "World";

            ctx.logger.info(`Example endpoint called with name: ${name}`);
            ctx.events.emit("exampleCalled", { name });

            return new Response(JSON.stringify({
                message: `Hello, ${name} from Component Library!`,
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

    // Lifecycle hooks
    onActivate: async (ctx) => {
        ctx.logger.info("Component Library module activated");
    },

    onDeactivate: async (ctx) => {
        ctx.logger.info("Component Library module deactivated");
    },

    // Services (for service/integration modules)
    // services: (ctx) => ({
    //     "space.componentlibrary.exampleService": async (input: unknown) => {
    //         return { result: "success" };
    //     },
    // }),

    // Widgets
    // widgets: {
    //     "example-widget": ExampleWidget,
    // },
});

export default componentLibraryModule;
