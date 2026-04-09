import type { DatabaseAccess } from "../../db";
import { and, eq, isNull } from "drizzle-orm";
import type { Design } from "../../db/schema/design";
import type { DesignSheetRow } from "../../db/schema/design-sheet";
import { design as designTable } from "../../db/schema/design";
import { designSheet as designSheetTable } from "../../db/schema/design-sheet";
import { NotFoundError, ValidationError } from "../../core/errors";
import type {
  CreateDesignInput,
  UpdateDesignInput,
} from "@shared/types/design.types";
import type {
  ProjectDocumentBundle,
  SchematicProjectDocument,
} from "@shared/types/pcb.types";

const MAX_CONTENT_SIZE_BYTES = 5 * 1024 * 1024; // 5MB hard limit

export interface SheetContentResult {
  sheet: Omit<DesignSheetRow, "content">;
  content: ProjectDocumentBundle;
}

function isLegacySchematicDocument(
  content: unknown,
): content is SchematicProjectDocument {
  return (
    typeof content === "object" &&
    content !== null &&
    "symbols" in content &&
    "wires" in content &&
    "labels" in content
  );
}

function isProjectDocumentBundle(
  content: unknown,
): content is ProjectDocumentBundle {
  return (
    typeof content === "object" &&
    content !== null &&
    "docs" in content &&
    "formatVersion" in content
  );
}

function toProjectDocumentBundle(content: unknown): ProjectDocumentBundle {
  if (isProjectDocumentBundle(content)) {
    return content;
  }

  if (isLegacySchematicDocument(content)) {
    return {
      formatVersion: "pcb.project-document-bundle/v1",
      docs: {
        schematic: content,
        pcb: null,
      },
    };
  }

  throw new ValidationError("Invalid design sheet content format");
}

export interface IDesignService {
  listByScope(workspaceId: string, projectId: string | null): Promise<Design[]>;
  listByProject(projectId: string): Promise<Design[]>;
  get(id: string): Promise<Design>;
  create(input: CreateDesignInput): Promise<Design>;
  update(id: string, input: UpdateDesignInput): Promise<Design>;
  delete(id: string): Promise<void>;
  getSheetContent(
    designId: string,
    sheetIndex: number,
  ): Promise<SheetContentResult | null>;
  saveSheetContent(
    designId: string,
    sheetIndex: number,
    content: ProjectDocumentBundle,
  ): Promise<Omit<DesignSheetRow, "content">>;
}

export class DesignService implements IDesignService {
  constructor(private db: DatabaseAccess) {}

  async listByScope(
    workspaceId: string,
    projectId: string | null,
  ): Promise<Design[]> {
    return this.db.designs.findByScope(workspaceId, projectId);
  }

  async listByProject(projectId: string): Promise<Design[]> {
    const project = await this.db.projects.findById(projectId);
    if (!project || project.deletedAt) {
      throw new NotFoundError("Project", projectId);
    }
    return this.db.designs.findByScope(project.workspaceId, projectId);
  }

  async get(id: string): Promise<Design> {
    const design = await this.db.designs.findById(id);
    if (!design || design.deletedAt) {
      throw new NotFoundError("Design", id);
    }
    return design;
  }

  async create(input: CreateDesignInput): Promise<Design> {
    if (!input.name || input.name.trim() === "") {
      throw new ValidationError("Design name is required");
    }

    const workspace = await this.db.workspaces.findById(input.workspaceId);
    if (!workspace) {
      throw new NotFoundError("Workspace", input.workspaceId);
    }

    if (input.projectId) {
      const project = await this.db.projects.findById(input.projectId);
      if (!project || project.deletedAt) {
        throw new NotFoundError("Project", input.projectId);
      }

      if (project.workspaceId !== input.workspaceId) {
        throw new ValidationError(
          "Design workspace must match project workspace",
        );
      }
    }

    return this.db.designs.create({
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      sortOrder: input.sortOrder ?? null,
    });
  }

  async update(id: string, input: UpdateDesignInput): Promise<Design> {
    await this.get(id);

    if (input.name !== undefined && input.name.trim() === "") {
      throw new ValidationError("Design name cannot be empty");
    }

    return this.db.designs.update(id, {
      ...input,
      name: input.name !== undefined ? input.name.trim() : undefined,
    });
  }

  async delete(id: string): Promise<void> {
    await this.get(id);
    await this.db.designs.softDelete(id);
  }

  async getSheetContent(
    designId: string,
    sheetIndex: number,
  ): Promise<SheetContentResult | null> {
    await this.get(designId);
    const sheet = await this.db.designSheets.findByDesignAndIndex(
      designId,
      sheetIndex,
    );
    if (!sheet) {
      return null;
    }
    const { content, ...meta } = sheet;
    return { sheet: meta, content: toProjectDocumentBundle(content) };
  }

  async saveSheetContent(
    designId: string,
    sheetIndex: number,
    content: ProjectDocumentBundle,
  ): Promise<Omit<DesignSheetRow, "content">> {
    await this.get(designId);

    const serialized = JSON.stringify(content);
    if (serialized.length > MAX_CONTENT_SIZE_BYTES) {
      throw new ValidationError(
        `Sheet content exceeds 5MB limit (${(serialized.length / 1024 / 1024).toFixed(1)}MB)`,
      );
    }

    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(serialized),
    );
    const contentHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const now = new Date();
    const sheet = await this.db.transaction(async (tx) => {
      const client = tx.getClient();

      const existing = await client
        .select({ id: designSheetTable.id })
        .from(designSheetTable)
        .where(
          and(
            eq(designSheetTable.designId, designId),
            eq(designSheetTable.sheetIndex, sheetIndex),
            isNull(designSheetTable.deletedAt),
          ),
        )
        .limit(1);

      const existingSheetId = existing[0]?.id ?? null;

      if (existingSheetId) {
        await client
          .update(designSheetTable)
          .set({
            content,
            contentHash,
            updatedAt: now,
          })
          .where(eq(designSheetTable.id, existingSheetId));
      } else {
        await client.insert(designSheetTable).values({
          designId,
          sheetIndex,
          title: `Sheet ${sheetIndex + 1}`,
          content,
          contentHash,
          createdAt: now,
          updatedAt: now,
        });
      }

      await client
        .update(designTable)
        .set({ updatedAt: now } as never)
        .where(eq(designTable.id, designId));

      const latest = await client
        .select()
        .from(designSheetTable)
        .where(
          and(
            eq(designSheetTable.designId, designId),
            eq(designSheetTable.sheetIndex, sheetIndex),
            isNull(designSheetTable.deletedAt),
          ),
        )
        .limit(1);

      const row = latest[0];
      if (!row) {
        throw new ValidationError("Failed to persist design sheet content");
      }

      return row;
    });

    const { content: _content, ...meta } = sheet;
    return meta;
  }
}
