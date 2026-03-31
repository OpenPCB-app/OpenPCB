import type { ToolSpec } from "@shared/types/tool-spec.types";
import type { ToolHandler } from "@shared/types/tool.types";
import type { DatabaseAccess } from "../../../../db";
import { requireWorkspaceContext } from "../tool-guards";
import { pickFields, fieldsInputSchema, applyFieldSelection } from "./shared/field-selection";
import type { Project } from "../../../../db/schema/project";

export const listProjectsToolSpec: ToolSpec = {
  name: "core.list_projects",
  scope: "core",
  version: "1.0",
  description: "List projects in the current workspace.",
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["active", "archived"],
        description: "Filter by project status. Defaults to all projects.",
      },
      ...fieldsInputSchema,
    },
    additionalProperties: true,
  },
  guards: [requireWorkspaceContext()],
};

export const getProjectToolSpec: ToolSpec = {
  name: "core.get_project",
  scope: "core",
  version: "1.0",
  description: "Get details of a specific project.",
  inputSchema: {
    type: "object",
    properties: {
      project_id: {
        type: "string",
        description: "The ID of the project to retrieve.",
      },
      ...fieldsInputSchema,
    },
    required: ["project_id"],
    additionalProperties: true,
  },
  guards: [requireWorkspaceContext()],
};

function sanitizeProject(project: Project): Partial<Project> {
  const { aiConfig, ragConfig, ...rest } = project;
  return rest;
}

export function createListProjectsHandler(db: DatabaseAccess): ToolHandler {
  return {
    execute: async (args: Record<string, unknown>) => {
      const workspaceId = args.workspace_id as string;
      const status = args.status as string | undefined;
      const fields = args.fields as string[] | undefined;

      let projects: Project[];
      if (status === "active") {
        projects = await db.projects.findActiveByWorkspace(workspaceId);
      } else {
        projects = await db.projects.findByWorkspace(workspaceId);
        if (status === "archived") {
          projects = projects.filter((p) => p.status === "archived");
        }
      }

      const sanitizedProjects = projects.map((p) =>
        fields ? p : sanitizeProject(p)
      );

      return {
        success: true,
        data: applyFieldSelection(sanitizedProjects, fields),
      };
    },
  };
}

export function createGetProjectHandler(db: DatabaseAccess): ToolHandler {
  return {
    execute: async (args: Record<string, unknown>) => {
      const workspaceId = args.workspace_id as string;
      const projectId = args.project_id as string;
      const fields = args.fields as string[] | undefined;

      const project = await db.projects.findById(projectId);
      if (!project) {
        return {
          success: false,
          error: { code: "NOT_FOUND", message: `Project ${projectId} not found` },
        };
      }

      if (project.workspaceId !== workspaceId) {
        return {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: `Project ${projectId} does not belong to workspace ${workspaceId}`,
          },
        };
      }

      const baseProject = fields ? project : sanitizeProject(project);

      return {
        success: true,
        data: pickFields(baseProject, fields),
      };
    },
  };
}
