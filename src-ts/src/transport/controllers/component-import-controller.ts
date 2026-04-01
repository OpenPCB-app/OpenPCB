import type { RouteContext } from "../router";
import { ResponseBuilder } from "../../core/utils/response-builder";
import type { ComponentImportService, ImportFileInput } from "../../domain/services/component-import-service";
import type { DatabaseAccess } from "../../db";
import { parseKicadSymbolLib } from "../../infrastructure/parsers/kicad/kicad-symbol-parser";
import { parseKicadFootprint } from "../../infrastructure/parsers/kicad/kicad-footprint-parser";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

interface ConfirmImportRequest {
    files: ImportFileInput[];
    groups: ConfirmedImportGroup[];
}

interface ConfirmedImportGroup {
    familyLabel: string;
    canonicalKey: string;
    categoryPath?: string;
    symbolFileName: string | null;
    variants: ConfirmedImportVariant[];
}

interface ConfirmedImportVariant {
    canonicalCode: string;
    humanLabel: string;
    mountType: "smd" | "through_hole" | "virtual";
    footprintFileNames: string[];
    model3dFileNames: string[];
}

interface ParseKicadRequest {
    content: string;
    fileName?: string;
}

export class ComponentImportController {
    constructor(
        private importService: ComponentImportService,
        private db: DatabaseAccess,
    ) {}

    async parseSymbol(ctx: RouteContext): Promise<Response> {
        try {
            const body = await ctx.req.json() as ParseKicadRequest;
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
            const body = await ctx.req.json() as ParseKicadRequest;
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

    async previewImport(ctx: RouteContext): Promise<Response> {
        try {
            const contentType = ctx.req.headers.get("content-type") || "";
            if (!contentType.includes("multipart/form-data")) {
                return ResponseBuilder.badRequest("Content-Type must be multipart/form-data");
            }

            const formData = await ctx.req.formData();
            const files: ImportFileInput[] = [];
            const modelFiles: string[] = [];

            // Collect all uploaded files
            for (const [key, value] of formData.entries()) {
                if (typeof value === "object" && value && "name" in value && "text" in value) {
                    const file = value as File;
                    if (file.size > MAX_FILE_SIZE) {
                        return ResponseBuilder.badRequest(`File ${file.name} exceeds 50MB limit`);
                    }

                    const fileName = file.name;
                    const content = await file.text();

                    // Categorize by extension
                    if (fileName.endsWith(".kicad_sym") || fileName.endsWith(".kicad_mod")) {
                        files.push({ fileName, content });
                    } else if (fileName.match(/\.(step|stp|wrl)$/i)) {
                        modelFiles.push(fileName);
                    }
                }
            }

            if (files.length === 0) {
                return ResponseBuilder.badRequest("No KiCAD symbol or footprint files provided");
            }

            // Generate preview using import service
            const preview = this.importService.generatePreview(files, modelFiles);

            return ResponseBuilder.success({ preview });
        } catch (err) {
            return ResponseBuilder.error(
                "IMPORT_PREVIEW_FAILED",
                err instanceof Error ? err.message : "Failed to generate import preview",
                500,
            );
        }
    }

    async confirmImport(ctx: RouteContext): Promise<Response> {
        try {
            const body = await ctx.req.json() as ConfirmImportRequest;

            if (!body.files || !body.groups || body.groups.length === 0) {
                return ResponseBuilder.badRequest("Missing files or groups to import");
            }

            // Build file lookup maps
            const filesByName = new Map<string, ImportFileInput>();
            for (const f of body.files) {
                filesByName.set(f.fileName, f);
            }

            const createdFamilyIds: string[] = [];

            // Process each group
            for (const group of body.groups) {
                try {
                    // Parse symbol if present
                    let symbolData: Record<string, unknown> = {
                        referencePrefix: "",
                        pinDefinitions: [],
                        properties: {},
                    };
                    const sourceFileNames: string[] = [];
                    const sourceHashes: Record<string, string> = {};
                    const kicadIdentifiers: Record<string, string> = {};
                    const heuristicDecisions: string[] = [];

                    if (group.symbolFileName) {
                        const symbolFile = filesByName.get(group.symbolFileName);
                        if (symbolFile) {
                            const parsed = parseKicadSymbolLib(symbolFile.content);
                            if (parsed.symbols.length > 0) {
                                const sym = parsed.symbols[0]!;
                                symbolData = {
                                    referencePrefix: sym.properties["Reference"] ?? "",
                                    pinDefinitions: sym.pins.map((p) => ({
                                        number: p.number,
                                        name: p.name,
                                        electricalType: p.electricalType,
                                        unit: p.unit,
                                    })),
                                    properties: sym.properties,
                                    bodyGraphics: sym.bodyGraphics,
                                    rawKicadSource: sym.rawSource,
                                };
                                kicadIdentifiers[symbolFile.fileName] = sym.name;
                            }
                            sourceFileNames.push(symbolFile.fileName);
                            sourceHashes[symbolFile.fileName] = await this.hashContent(symbolFile.content);
                        }
                    }

                    // Create component family
                    const family = await this.db.componentFamilies.create({
                        canonicalKey: group.canonicalKey,
                        displayLabel: group.familyLabel,
                        description: "",
                        scope: "workspace",
                        symbolData,
                        categoryPath: group.categoryPath,
                    });

                    createdFamilyIds.push(family.id);

                    // Process each variant
                    for (const variantData of group.variants) {
                        const variant = await this.db.componentFamilies.createVariant({
                            familyId: family.id,
                            canonicalCode: variantData.canonicalCode,
                            humanLabel: variantData.humanLabel,
                            mountType: variantData.mountType,
                            isDefault: false,
                        });

                        // Process footprints for this variant
                        for (const fpFileName of variantData.footprintFileNames) {
                            const fpFile = filesByName.get(fpFileName);
                            if (!fpFile) continue;

                            const parsedFp = parseKicadFootprint(fpFile.content);

                            // Store full KiCAD payload
                            const kicadPayload = {
                                name: parsedFp.name,
                                description: parsedFp.description,
                                tags: parsedFp.tags,
                                pads: parsedFp.pads,
                                graphics: parsedFp.graphics,
                                attributes: parsedFp.attributes,
                                rawKicadSource: parsedFp.rawSource,
                            };

                            const footprint = await this.db.componentFamilies.createFootprint({
                                variantId: variant.id,
                                label: parsedFp.name || "Default",
                                isDefault: false,
                                kicadPayload,
                            });

                            // Add footprint source to provenance
                            sourceFileNames.push(fpFileName);
                            sourceHashes[fpFileName] = await this.hashContent(fpFile.content);
                            kicadIdentifiers[fpFileName] = parsedFp.name;

                            // Process 3D models
                            for (const modelRef of parsedFp.model3dRefs) {
                                const isLinked = variantData.model3dFileNames.includes(modelRef.resolvedFileName);
                                const linkStatus = isLinked ? "valid" : "missing_target";

                                await this.db.componentFamilies.createModel3d({
                                    footprintOptionId: footprint.id,
                                    fileName: modelRef.resolvedFileName,
                                    linkStatus,
                                    isDefault: false,
                                });
                            }
                        }
                    }

                    // Create provenance record
                    await this.db.componentProvenance.create({
                        familyId: family.id,
                        sourceFileNames,
                        sourceHashes,
                        importTimestamp: new Date().toISOString(),
                        kicadIdentifiers,
                        heuristicDecisions,
                    });
                } catch (err) {
                    console.error(`Failed to import group ${group.canonicalKey}:`, err);
                    // Continue with next group instead of failing entire import
                }
            }

            return ResponseBuilder.success({
                familyIds: createdFamilyIds,
                message: `Successfully imported ${createdFamilyIds.length} component families`,
            });
        } catch (err) {
            return ResponseBuilder.error(
                "IMPORT_FAILED",
                err instanceof Error ? err.message : "Failed to confirm import",
                500,
            );
        }
    }

    private async hashContent(content: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(content);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    }
}
