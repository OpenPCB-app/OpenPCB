import type { RouteContext } from "../router";
import type { IFolderService } from "../../domain/services/folder-service";
import { ResponseBuilder } from "../../core/utils/response-builder";
import type {
  FolderDeleteAction,
  FolderNotEmptyError,
} from "@shared/types/folder.types";
import { ValidationError } from "../../core/errors";

const VALID_DELETE_ACTIONS: FolderDeleteAction[] = [
  "move_to_root",
  "delete_chats",
];

function isValidDeleteAction(
  value: string | null,
): value is FolderDeleteAction {
  return (
    value !== null && VALID_DELETE_ACTIONS.includes(value as FolderDeleteAction)
  );
}

interface FolderNotEmptyDetails {
  code: string;
  chatCount: number;
}

function isFolderNotEmptyDetails(
  details: unknown,
): details is FolderNotEmptyDetails {
  return (
    typeof details === "object" &&
    details !== null &&
    "code" in details &&
    (details as FolderNotEmptyDetails).code === "FOLDER_NOT_EMPTY" &&
    "chatCount" in details &&
    typeof (details as FolderNotEmptyDetails).chatCount === "number"
  );
}

export class FolderController {
  constructor(private folderService: IFolderService) {}

  async list(ctx: RouteContext): Promise<Response> {
    const url = new URL(ctx.req.url);
    const workspaceId = url.searchParams.get("workspaceId")?.trim() || null;
    const projectId = url.searchParams.get("projectId")?.trim() || null;

    if (workspaceId && projectId) {
      return ResponseBuilder.badRequest(
        "Specify either workspaceId or projectId, not both",
      );
    }

    if (!workspaceId && !projectId) {
      return ResponseBuilder.badRequest(
        "Missing workspaceId or projectId query parameter",
      );
    }

    const folders = workspaceId
      ? await this.folderService.listByWorkspace(workspaceId)
      : await this.folderService.listByProject(projectId!);

    return ResponseBuilder.success({ folders });
  }

  async get(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const folder = await this.folderService.get(id);
    return ResponseBuilder.success({ folder });
  }

  async create(ctx: RouteContext): Promise<Response> {
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return ResponseBuilder.badRequest("Invalid JSON body");
    }

    const parsed = body as Record<string, unknown>;
    if (!parsed.name || typeof parsed.name !== "string") {
      return ResponseBuilder.badRequest("Folder name is required");
    }

    const folder = await this.folderService.create({
      name: parsed.name,
      workspaceId: parsed.workspaceId as string | undefined,
      projectId: parsed.projectId as string | undefined,
      sortOrder: parsed.sortOrder as number | undefined,
      icon: parsed.icon as string | undefined,
      color: parsed.color as string | undefined,
    });
    return ResponseBuilder.created({ folder });
  }

  async update(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");

    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return ResponseBuilder.badRequest("Invalid JSON body");
    }

    const parsed = body as Record<string, unknown>;
    const folder = await this.folderService.update(id, {
      name: parsed.name as string | undefined,
      sortOrder: parsed.sortOrder as number | undefined,
      icon: parsed.icon as string | undefined,
      color: parsed.color as string | undefined,
      isExpanded: parsed.isExpanded as boolean | undefined,
    });
    return ResponseBuilder.success({ folder });
  }

  async delete(ctx: RouteContext): Promise<Response> {
    const id = ctx.params.getOrThrow("id");
    const url = new URL(ctx.req.url);
    const actionParam = url.searchParams.get("action");

    if (actionParam && !isValidDeleteAction(actionParam)) {
      return ResponseBuilder.badRequest(
        `Invalid action. Must be one of: ${VALID_DELETE_ACTIONS.join(", ")}`,
      );
    }

    const action = actionParam
      ? (actionParam as FolderDeleteAction)
      : undefined;

    try {
      const result = await this.folderService.delete(id, action);
      return ResponseBuilder.success(result);
    } catch (err) {
      if (
        err instanceof ValidationError &&
        isFolderNotEmptyDetails(err.details)
      ) {
        const errorResponse: FolderNotEmptyError = {
          error: "FOLDER_NOT_EMPTY",
          chatCount: err.details.chatCount,
          message: err.message,
        };
        return ResponseBuilder.error(
          "FOLDER_NOT_EMPTY",
          err.message,
          409,
          errorResponse,
        );
      }
      throw err;
    }
  }
}
