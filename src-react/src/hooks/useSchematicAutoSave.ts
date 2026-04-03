import { useEffect, useRef, useCallback } from "react";
import { useSchematicStore } from "@/stores/schematic-store";
import { toProjectDocumentBundle } from "@/components/pcb/types";
import { usePcbStore } from "@/stores/pcb-store";
import { saveSheetContent } from "@/lib/api/design-api";
import type { SchematicDocument } from "@/components/pcb/types";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 1000;

export function useSchematicAutoSave(
  onStatusChange: (status: SaveStatus) => void,
): void {
  const designId = useSchematicStore((s) => s.persisted.designId);
  const documentId = useSchematicStore((s) => s.persisted.document?.id ?? null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedJsonRef = useRef<string | null>(null);
  const prevDocRef = useRef<SchematicDocument | null>(null);
  const onStatusRef = useRef(onStatusChange);
  onStatusRef.current = onStatusChange;

  const saveNow = useCallback(async () => {
    const { persisted } = useSchematicStore.getState();
    const doc = persisted.document;
    const designId = persisted.designId;
    const pcbDoc = usePcbStore.getState().document;

    if (!doc || !designId) return;

    const projectDoc = toProjectDocumentBundle(doc, pcbDoc);
    const json = JSON.stringify(projectDoc);

    if (json === lastSavedJsonRef.current) return;

    onStatusRef.current("saving");
    try {
      await saveSheetContent(designId, 0, projectDoc);
      lastSavedJsonRef.current = json;
      onStatusRef.current("saved");
    } catch {
      onStatusRef.current("error");
    }
  }, []);

  useEffect(() => {
    if (!designId || !documentId) {
      lastSavedJsonRef.current = null;
      return;
    }

    const { persisted } = useSchematicStore.getState();
    const pcbDoc = usePcbStore.getState().document;
    if (!persisted.document) {
      lastSavedJsonRef.current = null;
      return;
    }

    lastSavedJsonRef.current = JSON.stringify(
      toProjectDocumentBundle(persisted.document, pcbDoc),
    );
  }, [
    designId,
    documentId,
  ]);

  useEffect(() => {
    const unsubscribe = useSchematicStore.subscribe((state) => {
      const doc = state.persisted.document;

      if (doc === prevDocRef.current) return;
      prevDocRef.current = doc;

      if (!doc) return;

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        void saveNow();
      }, DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [saveNow]);
}
