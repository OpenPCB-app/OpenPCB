/**
 * Content Target Registry
 *
 * Manages registration and lookup of content targets.
 * Modules register their targets at activation time.
 */

import type { ContentTarget, TargetRegistrationOptions } from "./content-target.interface";
import type { RegisteredTargetInfo, TargetRef } from "./types";
import { TargetNotFoundError } from "./errors";

/**
 * Registry for content targets
 */
export class ContentTargetRegistry {
  private targets = new Map<string, ContentTarget>();

  /**
   * Register a content target
   *
   * @throws Error if target type already registered and override=false
   */
  register(target: ContentTarget, options?: TargetRegistrationOptions): void {
    const existing = this.targets.get(target.targetType);

    if (existing && !options?.override) {
      throw new Error(
        `Target type '${target.targetType}' already registered. Use override=true to replace.`
      );
    }

    this.targets.set(target.targetType, target);
    console.log(
      `[ContentTargetRegistry] Registered target: ${target.targetType} (${target.label})`
    );
  }

  /**
   * Unregister a content target
   */
  unregister(targetType: string): boolean {
    const removed = this.targets.delete(targetType);
    if (removed) {
      console.log(`[ContentTargetRegistry] Unregistered target: ${targetType}`);
    }
    return removed;
  }

  /**
   * Get a registered target by type
   *
   * @throws TargetNotFoundError if not registered
   */
  get(targetType: string): ContentTarget {
    const target = this.targets.get(targetType);
    if (!target) {
      throw new TargetNotFoundError(targetType);
    }
    return target;
  }

  /**
   * Get a target if registered, or null
   */
  getOrNull(targetType: string): ContentTarget | null {
    return this.targets.get(targetType) ?? null;
  }

  /**
   * Check if a target type is registered
   */
  has(targetType: string): boolean {
    return this.targets.has(targetType);
  }

  /**
   * Resolve a target reference to its target implementation
   *
   * @throws TargetNotFoundError if not registered or target doesn't exist
   */
  async resolve(ref: TargetRef): Promise<ContentTarget> {
    const target = this.get(ref.targetType);

    // Verify the target ID exists
    const exists = await target.exists(ref.targetId);
    if (!exists) {
      throw new TargetNotFoundError(ref.targetType, ref.targetId);
    }

    return target;
  }

  /**
   * Get info about all registered targets
   */
  listTargets(): RegisteredTargetInfo[] {
    return Array.from(this.targets.values()).map((target) => ({
      targetType: target.targetType,
      label: target.label,
      description: target.description,
      supportedModes: target.supportedModes,
    }));
  }

  /**
   * Get all registered target types
   */
  getTargetTypes(): string[] {
    return Array.from(this.targets.keys());
  }

  /**
   * Clear all registrations (for testing)
   */
  clear(): void {
    this.targets.clear();
  }
}

// Singleton instance
let instance: ContentTargetRegistry | null = null;

/**
 * Get the global content target registry
 */
export function getContentTargetRegistry(): ContentTargetRegistry {
  if (!instance) {
    instance = new ContentTargetRegistry();
  }
  return instance;
}

/**
 * Initialize the content target registry
 */
export function initializeContentTargetRegistry(): ContentTargetRegistry {
  if (!instance) {
    instance = new ContentTargetRegistry();
  }
  return instance;
}
