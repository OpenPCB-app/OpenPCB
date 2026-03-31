import type { ToolSpec } from "@shared/types/tool-spec.types";
import type { ToolHandler } from "@shared/types/tool.types";
import type { DatabaseAccess } from "../../../../db";
import { requireWorkspaceContext } from "../tool-guards";
import { pickFields, fieldsInputSchema } from "./shared/field-selection";

export const getContextToolSpec: ToolSpec = {
  name: "core.get_context",
  scope: "core",
  version: "1.0",
  description: "Get information about the current workspace, project, and chat context.",
  inputSchema: {
    type: "object",
    properties: {
      ...fieldsInputSchema,
    },
    additionalProperties: true,
  },
  guards: [requireWorkspaceContext()],
};

interface GetContextArgs {
  workspace_id: string;
  project_id?: string;
  chat_id?: string;
  fields?: string[];
}

interface WorkspaceSection {
  id: string;
  name: string;
}

interface ProjectSection {
  id: string;
  name: string;
  description: string | null;
  status: string;
}

interface ChatSection {
  id: string;
  title: string | null;
}

interface GetContextResponse {
  workspace: Partial<WorkspaceSection>;
  project?: Partial<ProjectSection>;
  chat?: Partial<ChatSection>;
}

export function createGetContextHandler(db: DatabaseAccess): ToolHandler {
  return {
    execute: async (args: Record<string, unknown>) => {
      const { workspace_id, project_id, chat_id, fields } = args as unknown as GetContextArgs;

      const workspace = await db.workspaces.findById(workspace_id);
      if (!workspace) {
        return {
          success: false,
          error: { code: "NOT_FOUND", message: `Workspace ${workspace_id} not found` },
        };
      }

      const sanitizedWorkspace: WorkspaceSection = {
        id: workspace.id,
        name: workspace.name,
      };

      const result: GetContextResponse = {
        workspace: pickFields(sanitizedWorkspace, fields),
      };

      if (project_id) {
        const project = await db.projects.findById(project_id);
        if (!project) {
          return {
            success: false,
            error: {
              code: "NOT_FOUND",
              message: `Project ${project_id} not found`,
            },
          };
        }

        if (project.workspaceId !== workspace_id) {
          return {
            success: false,
            error: {
              code: "FORBIDDEN",
              message: `Project ${project_id} does not belong to workspace ${workspace_id}`,
            },
          };
        }

        const sanitizedProject: ProjectSection = {
          id: project.id,
          name: project.name,
          description: project.description ?? null,
          status: project.status,
        };

        result.project = pickFields(sanitizedProject, fields);
      }

      if (chat_id) {
        const chat = await db.chats.findById(chat_id);
        if (!chat) {
          return {
            success: false,
            error: {
              code: "NOT_FOUND",
              message: `Chat ${chat_id} not found`,
            },
          };
        }

        if (chat.workspaceId !== workspace_id) {
          return {
            success: false,
            error: {
              code: "FORBIDDEN",
              message: `Chat ${chat_id} does not belong to workspace ${workspace_id}`,
            },
          };
        }

        const sanitizedChat: ChatSection = {
          id: chat.id,
          title: chat.title ?? null,
        };

        result.chat = pickFields(sanitizedChat, fields);
      }

      return {
        success: true,
        data: result,
      };
    },
  };
}
