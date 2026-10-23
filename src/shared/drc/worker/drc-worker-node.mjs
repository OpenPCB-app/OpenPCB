import { register } from "tsx/esm/api";

// Source Node workers need their own loader before evaluating TypeScript.
register();
await import("./drc-worker.ts");
