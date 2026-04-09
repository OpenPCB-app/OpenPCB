import { z } from "./base";
import { UUIDv7Schema, TimestampSchema } from "./common";

export const DesignSchema = z
  .object({
    id: UUIDv7Schema,
    workspaceId: UUIDv7Schema,
    projectId: UUIDv7Schema.nullable().optional(),
    name: z.string().min(1).max(100),
    description: z.string().nullable().optional(),
    sortOrder: z.number().int().nullable().optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    deletedAt: TimestampSchema.nullable().optional(),
  })
  .openapi("Design");

export const CreateDesignInputSchema = z
  .object({
    workspaceId: UUIDv7Schema,
    projectId: UUIDv7Schema.nullable().optional(),
    name: z.string().min(1).max(100),
    description: z.string().optional(),
    sortOrder: z.number().int().optional(),
  })
  .openapi("CreateDesignInput");

export const UpdateDesignInputSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().nullable().optional(),
    sortOrder: z.number().int().nullable().optional(),
  })
  .openapi("UpdateDesignInput");

export const DesignResponseSchema = z
  .object({
    design: DesignSchema,
  })
  .openapi("DesignResponse");

export const DesignListResponseSchema = z
  .object({
    designs: z.array(DesignSchema),
  })
  .openapi("DesignListResponse");
