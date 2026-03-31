/**
 * Content Target Resolver
 *
 * Facade over ContentTargetRegistry providing resolution for content editing targets.
 */

import type { ContentTarget, TargetRegistrationOptions } from "./content-target.interface";
import type { ContentTargetRegistry } from "./content-target-registry";
import { TargetNotFoundError } from "./errors";

/**
 * Facade over ContentTargetRegistry providing resolution for content editing targets
 */
export class ContentTargetResolver {
  constructor(private readonly registry: ContentTargetRegistry) {}

  /**
   * Resolve a target implementation by its type identifier
   *
   * @param targetType Unique target type identifier (e.g., "knowledge.page")
   * @returns The registered content target implementation
   * @throws TargetNotFoundError if the target type is not registered
   */
  resolve(targetType: string): ContentTarget {
    const target = this.registry.getOrNull(targetType);
    if (!target) {
      throw new TargetNotFoundError(targetType);
    }
    return target;
  }

  /**
   * Register a content target
   *
   * @param target The content target implementation to register
   * @param options Registration options
   */
  register(target: ContentTarget, options?: TargetRegistrationOptions): void {
    this.registry.register(target, options);
  }

  /**
   * Unregister a content target
   *
   * @param targetType The target type identifier to unregister
   * @returns True if the target was found and removed, false otherwise
   */
  unregister(targetType: string): boolean {
    return this.registry.unregister(targetType);
  }
}
