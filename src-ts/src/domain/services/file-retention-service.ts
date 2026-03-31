/**
 * File Retention Service
 *
 * Manages retention policies and automatic file cleanup.
 * Supports age-based deletion and trash cleanup.
 */

import type { DatabaseAccess } from "../../db";
import type { FileService } from "./file-service";
import type { FileRetentionPolicy, RetentionRule, RetentionAction } from "../../db/schema/file-retention-policy";
import { ValidationError, NotFoundError } from "../../core/errors";
import { toISO } from "../../core/utils/time";

export interface CreatePolicyInput {
  workspaceId: string;
  name: string;
  description?: string;
  rules: RetentionRule[];
  enabled?: boolean;
}

export interface UpdatePolicyInput {
  name?: string;
  description?: string;
  rules?: RetentionRule[];
  enabled?: boolean;
}

export interface RetentionPolicyRecord {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  rules: RetentionRule[];
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RetentionReport {
  policyId: string;
  policyName: string;
  workspaceId: string;
  filesProcessed: number;
  filesDeleted: number;
  bytesFreed: number;
  errors: string[];
  executedAt: string;
}

export interface IFileRetentionService {
  createPolicy(input: CreatePolicyInput): Promise<RetentionPolicyRecord>;
  listPolicies(workspaceId: string): Promise<RetentionPolicyRecord[]>;
  getPolicy(id: string): Promise<RetentionPolicyRecord | null>;
  updatePolicy(id: string, input: UpdatePolicyInput): Promise<RetentionPolicyRecord>;
  deletePolicy(id: string): Promise<void>;
  applyPolicies(workspaceId?: string): Promise<RetentionReport[]>;
  applyPolicy(policyId: string): Promise<RetentionReport>;
}

export class FileRetentionService implements IFileRetentionService {
  constructor(
    private db: DatabaseAccess,
    private fileService: FileService
  ) {}

  async createPolicy(input: CreatePolicyInput): Promise<RetentionPolicyRecord> {
    if (!input.name || input.name.trim() === "") {
      throw new ValidationError("Policy name is required");
    }

    if (!input.rules || input.rules.length === 0) {
      throw new ValidationError("At least one rule is required");
    }

    this.validateRules(input.rules);

    const policy = await this.db.retentionPolicies.create({
      workspaceId: input.workspaceId,
      name: input.name.trim(),
      description: input.description ?? null,
      rules: input.rules,
      enabled: input.enabled ?? true,
      lastRunAt: null,
    });

    return this.toPolicyRecord(policy);
  }

  async listPolicies(workspaceId: string): Promise<RetentionPolicyRecord[]> {
    const policies = await this.db.retentionPolicies.findByWorkspace(workspaceId);
    return policies.map(p => this.toPolicyRecord(p));
  }

  async getPolicy(id: string): Promise<RetentionPolicyRecord | null> {
    const policy = await this.db.retentionPolicies.findById(id);
    return policy ? this.toPolicyRecord(policy) : null;
  }

  async updatePolicy(id: string, input: UpdatePolicyInput): Promise<RetentionPolicyRecord> {
    const existing = await this.db.retentionPolicies.findById(id);
    if (!existing) {
      throw new NotFoundError("RetentionPolicy", id);
    }

    if (input.rules) {
      this.validateRules(input.rules);
    }

    const updates: Partial<FileRetentionPolicy> = {};
    if (input.name !== undefined) updates.name = input.name.trim();
    if (input.description !== undefined) updates.description = input.description;
    if (input.rules !== undefined) updates.rules = input.rules;
    if (input.enabled !== undefined) updates.enabled = input.enabled;

    const updated = await this.db.retentionPolicies.update(id, updates);
    return this.toPolicyRecord(updated);
  }

  async deletePolicy(id: string): Promise<void> {
    const existing = await this.db.retentionPolicies.findById(id);
    if (!existing) {
      throw new NotFoundError("RetentionPolicy", id);
    }
    await this.db.retentionPolicies.delete(id);
  }

  async applyPolicies(workspaceId?: string): Promise<RetentionReport[]> {
    const policies = workspaceId
      ? await this.db.retentionPolicies.findEnabledByWorkspace(workspaceId)
      : await this.db.retentionPolicies.findAllEnabled();

    const reports: RetentionReport[] = [];

    for (const policy of policies) {
      try {
        const report = await this.applyPolicy(policy.id);
        reports.push(report);
      } catch (err) {
        reports.push({
          policyId: policy.id,
          policyName: policy.name,
          workspaceId: policy.workspaceId,
          filesProcessed: 0,
          filesDeleted: 0,
          bytesFreed: 0,
          errors: [err instanceof Error ? err.message : String(err)],
          executedAt: new Date().toISOString(),
        });
      }
    }

    return reports;
  }

  async applyPolicy(policyId: string): Promise<RetentionReport> {
    const policy = await this.db.retentionPolicies.findById(policyId);
    if (!policy) {
      throw new NotFoundError("RetentionPolicy", policyId);
    }

    const report: RetentionReport = {
      policyId: policy.id,
      policyName: policy.name,
      workspaceId: policy.workspaceId,
      filesProcessed: 0,
      filesDeleted: 0,
      bytesFreed: 0,
      errors: [],
      executedAt: new Date().toISOString(),
    };

    for (const rule of policy.rules) {
      try {
        const ruleResult = await this.applyRule(policy.workspaceId, rule);
        report.filesProcessed += ruleResult.processed;
        report.filesDeleted += ruleResult.deleted;
        report.bytesFreed += ruleResult.bytesFreed;
      } catch (err) {
        report.errors.push(
          `Rule ${rule.type}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Update last run timestamp
    await this.db.retentionPolicies.updateLastRun(policyId);

    return report;
  }

  // Private helpers

  private async applyRule(
    workspaceId: string,
    rule: RetentionRule
  ): Promise<{ processed: number; deleted: number; bytesFreed: number }> {
    let processed = 0;
    let deleted = 0;
    let bytesFreed = 0;

    if (rule.type === "age" && rule.condition.olderThanDays) {
      // Find files older than specified days
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - rule.condition.olderThanDays);

      const files = await this.fileService.list({
        workspaceId,
        status: rule.condition.status || undefined,
        toDate: cutoffDate.toISOString(),
      });

      processed = files.length;

      for (const file of files) {
        if (rule.action === "delete") {
          await this.fileService.hardDelete(file.id);
          deleted++;
          bytesFreed += file.sizeBytes;
        }
      }
    }

    if (rule.type === "status" && rule.condition.status === "trashed") {
      // Find trashed files
      const files = await this.fileService.list({
        workspaceId,
        status: "trashed",
      });

      // Apply age filter if specified
      const cutoffDate = rule.condition.olderThanDays
        ? new Date(Date.now() - rule.condition.olderThanDays * 24 * 60 * 60 * 1000)
        : null;

      const filesToProcess = cutoffDate
        ? files.filter(f => f.trashedAt && new Date(f.trashedAt) < cutoffDate)
        : files;

      processed = filesToProcess.length;

      for (const file of filesToProcess) {
        if (rule.action === "delete") {
          await this.fileService.hardDelete(file.id);
          deleted++;
          bytesFreed += file.sizeBytes;
        }
      }
    }

    return { processed, deleted, bytesFreed };
  }

  private validateRules(rules: RetentionRule[]): void {
    for (const rule of rules) {
      if (!["age", "size", "status"].includes(rule.type)) {
        throw new ValidationError(`Invalid rule type: ${rule.type}`);
      }

      if (!["delete", "archive", "notify"].includes(rule.action)) {
        throw new ValidationError(`Invalid rule action: ${rule.action}`);
      }

      if (rule.type === "age" && !rule.condition.olderThanDays) {
        throw new ValidationError("Age rule requires olderThanDays condition");
      }

      if (rule.type === "status" && !rule.condition.status) {
        throw new ValidationError("Status rule requires status condition");
      }
    }
  }

  private toPolicyRecord(policy: FileRetentionPolicy): RetentionPolicyRecord {
    return {
      id: policy.id,
      workspaceId: policy.workspaceId,
      name: policy.name,
      description: policy.description,
      rules: policy.rules,
      enabled: policy.enabled,
      lastRunAt: policy.lastRunAt?.toISOString() ?? null,
      createdAt: policy.createdAt.toISOString(),
      updatedAt: policy.updatedAt.toISOString(),
    };
  }
}
