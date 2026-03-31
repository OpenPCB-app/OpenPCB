/**
 * Processor Registry
 *
 * Central registry for file processors. Matches MIME types to appropriate processors.
 */

import type { FileProcessor } from "./file-processor";
import { ImageProcessor } from "./image-processor";
import { PDFProcessor } from "./pdf-processor";

export class ProcessorRegistry {
  private processors: FileProcessor[] = [];
  private static instance: ProcessorRegistry | null = null;

  private constructor() {
    this.registerDefaults();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ProcessorRegistry {
    if (!ProcessorRegistry.instance) {
      ProcessorRegistry.instance = new ProcessorRegistry();
    }
    return ProcessorRegistry.instance;
  }

  /**
   * Reset singleton (for testing)
   */
  static reset(): void {
    ProcessorRegistry.instance = null;
  }

  /**
   * Register default processors
   */
  private registerDefaults(): void {
    this.register(new ImageProcessor());
    this.register(new PDFProcessor());
  }

  /**
   * Register a processor
   */
  register(processor: FileProcessor): void {
    this.processors.push(processor);
  }

  /**
   * Get processor for a MIME type
   * @returns Processor or null if no processor can handle the type
   */
  getProcessor(mimeType: string): FileProcessor | null {
    for (const processor of this.processors) {
      if (processor.canProcess(mimeType)) {
        return processor;
      }
    }
    return null;
  }

  /**
   * Check if a MIME type can be processed
   */
  canProcess(mimeType: string): boolean {
    return this.getProcessor(mimeType) !== null;
  }

  /**
   * Get all registered processors
   */
  getProcessors(): ReadonlyArray<FileProcessor> {
    return this.processors;
  }
}

// Export default instance getter
export function getProcessorRegistry(): ProcessorRegistry {
  return ProcessorRegistry.getInstance();
}
