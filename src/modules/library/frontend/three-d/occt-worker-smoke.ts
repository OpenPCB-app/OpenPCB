// @ts-expect-error occt-import-js does not publish TypeScript declarations.
import occtImportJs from "occt-import-js";
import occtWasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";

export type OcctInitResult = { status: "ok" } | { status: "error"; message: string };

type OcctImportJsInit = (options?: {
  locateFile?: (path: string, prefix: string) => string;
}) => Promise<unknown>;

const initOcctImportJs = occtImportJs as OcctImportJsInit;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function initOcct(): Promise<OcctInitResult> {
  try {
    await initOcctImportJs({
      locateFile: (assetPath) => (assetPath.endsWith(".wasm") ? occtWasmUrl : assetPath),
    });

    return { status: "ok" };
  } catch (error: unknown) {
    return { status: "error", message: getErrorMessage(error) };
  }
}
