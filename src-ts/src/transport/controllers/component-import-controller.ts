import type { RouteContext } from "../router";
import { ResponseBuilder } from "../../core/utils/response-builder";
import type {
  IComponentImportService,
  ImportFileInput,
} from "../../domain/services/component-import-service";
import type { IComponentZipImportService } from "../../domain/services/component-zip-import-service";
import { parseKicadSymbolLib } from "../../infrastructure/parsers/kicad/kicad-symbol-parser";
import { parseKicadFootprint } from "../../infrastructure/parsers/kicad/kicad-footprint-parser";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

interface ParseKicadRequest {
  content: string;
  fileName?: string;
}

export class ComponentImportController {
  constructor(
    private readonly importService: IComponentImportService,
    private readonly zipImportService: IComponentZipImportService,
  ) {}

  async parseSymbol(ctx: RouteContext): Promise<Response> {
    try {
      const body = (await ctx.req.json()) as ParseKicadRequest;
      if (typeof body?.content !== "string" || body.content.trim().length === 0) {
        return ResponseBuilder.badRequest("Missing KiCAD symbol content");
      }

      const parsed = parseKicadSymbolLib(body.content);
      if (parsed.symbols.length === 0) {
        return ResponseBuilder.badRequest("No symbols found in .kicad_sym file");
      }
      if (parsed.symbols.length > 1) {
        return ResponseBuilder.badRequest(
          `Multiple symbols found in .kicad_sym file (${parsed.symbols.map((s) => s.name).join(", ")}). Please import a file containing exactly one symbol.`,
        );
      }

      return ResponseBuilder.success({
        symbol: parsed.symbols[0],
        availableSymbols: parsed.symbols.map((s) => s.name),
        fileName: body.fileName ?? null,
      });
    } catch (err) {
      return ResponseBuilder.error(
        "KICAD_SYMBOL_PARSE_FAILED",
        err instanceof Error ? err.message : "Failed to parse KiCAD symbol",
        400,
      );
    }
  }

  async parseFootprint(ctx: RouteContext): Promise<Response> {
    try {
      const body = (await ctx.req.json()) as ParseKicadRequest;
      if (typeof body?.content !== "string" || body.content.trim().length === 0) {
        return ResponseBuilder.badRequest("Missing KiCAD footprint content");
      }

      const footprint = parseKicadFootprint(body.content);
      return ResponseBuilder.success({
        footprint,
        fileName: body.fileName ?? null,
      });
    } catch (err) {
      return ResponseBuilder.error(
        "KICAD_FOOTPRINT_PARSE_FAILED",
        err instanceof Error ? err.message : "Failed to parse KiCAD footprint",
        400,
      );
    }
  }

  async importComponents(ctx: RouteContext): Promise<Response> {
    try {
      const contentType = ctx.req.headers.get("content-type") || "";
      if (!contentType.includes("multipart/form-data")) {
        return ResponseBuilder.badRequest("Content-Type must be multipart/form-data");
      }

      const formData = await ctx.req.formData();
      const uploadedFiles: File[] = [];
      for (const value of formData.values()) {
        if (isUploadedFile(value)) {
          uploadedFiles.push(value);
        }
      }

      if (uploadedFiles.length === 0) {
        return ResponseBuilder.badRequest("No import files provided");
      }

      for (const file of uploadedFiles) {
        if (file.size > MAX_FILE_SIZE) {
          return ResponseBuilder.badRequest(`File ${file.name} exceeds 50MB limit`);
        }
      }

      const zipFiles = uploadedFiles.filter((file) => file.name.endsWith(".zip"));
      if (zipFiles.length > 1 || (zipFiles.length === 1 && uploadedFiles.length > 1)) {
        return ResponseBuilder.badRequest(
          "Upload either one ZIP archive or a set of KiCad source files",
        );
      }

      const result = zipFiles[0]
        ? await this.zipImportService.importZip(zipFiles[0])
        : await this.importService.importFiles(
            await Promise.all(
              uploadedFiles.map(async (file) => ({
                fileName: file.name,
                content: isTextImportFile(file.name) ? await file.text() : undefined,
              } satisfies ImportFileInput)),
            ),
          );

      return ResponseBuilder.created({
        import: result,
        message: `Imported ${result.components.length} component${result.components.length === 1 ? "" : "s"}`,
      });
    } catch (err) {
      return ResponseBuilder.error(
        "IMPORT_FAILED",
        err instanceof Error ? err.message : "Failed to import components",
        500,
      );
    }
  }
}

function isTextImportFile(fileName: string): boolean {
  return fileName.endsWith(".kicad_sym") || fileName.endsWith(".kicad_mod");
}

function isUploadedFile(value: FormDataEntryValue): value is File {
  return typeof value !== "string";
}
