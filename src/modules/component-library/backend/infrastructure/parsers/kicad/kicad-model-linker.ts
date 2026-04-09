export type Model3DLinkStatus =
  | "valid"
  | "missing_target"
  | "orphan_asset"
  | "shared_body";

export interface Model3DClassification {
  footprintName: string;
  modelFileName: string;
  status: Model3DLinkStatus;
}

/**
 * Classify 3D model links between footprints and available model files.
 *
 * - valid: single footprint references an existing model
 * - shared_body: multiple footprints reference same existing model
 * - missing_target: footprint references a model not in availableModelFiles
 * - orphan_asset: model file exists but no footprint references it
 */
export function classifyModel3DLinks(
  footprints: Array<{
    name: string;
    model3dRefs: Array<{ resolvedFileName: string }>;
  }>,
  availableModelFiles: string[],
): Model3DClassification[] {
  const availableSet = new Set(availableModelFiles);

  // Build map: modelFileName -> footprint names referencing it
  const modelToFootprints = new Map<string, string[]>();
  for (const fp of footprints) {
    for (const ref of fp.model3dRefs) {
      const existing = modelToFootprints.get(ref.resolvedFileName);
      if (existing) {
        existing.push(fp.name);
      } else {
        modelToFootprints.set(ref.resolvedFileName, [fp.name]);
      }
    }
  }

  const results: Model3DClassification[] = [];

  // Classify each footprint's model references
  for (const fp of footprints) {
    for (const ref of fp.model3dRefs) {
      const inAvailable = availableSet.has(ref.resolvedFileName);
      const refCount = modelToFootprints.get(ref.resolvedFileName)?.length ?? 0;

      let status: Model3DLinkStatus;
      if (!inAvailable) {
        status = "missing_target";
      } else if (refCount > 1) {
        status = "shared_body";
      } else {
        status = "valid";
      }

      results.push({
        footprintName: fp.name,
        modelFileName: ref.resolvedFileName,
        status,
      });
    }
  }

  // Find orphan assets — models not referenced by any footprint
  const referencedModels = new Set(modelToFootprints.keys());
  for (const modelFile of availableModelFiles) {
    if (!referencedModels.has(modelFile)) {
      results.push({
        footprintName: "",
        modelFileName: modelFile,
        status: "orphan_asset",
      });
    }
  }

  return results;
}
