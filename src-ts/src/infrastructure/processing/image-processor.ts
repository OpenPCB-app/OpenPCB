/**
 * Image Processor
 *
 * Handles image processing using sharp library.
 * Supports thumbnail generation, optimization, and metadata extraction.
 */

import type {
  FileProcessor,
  ProcessingOptions,
  ProcessingResult,
  FileProcessingMetadata,
} from "./file-processor";
import { DEFAULT_THUMBNAIL_SIZE } from "./file-processor";

// Image MIME types this processor handles
const SUPPORTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/tiff",
  "image/svg+xml",
];

export class ImageProcessor implements FileProcessor {
  canProcess(mimeType: string): boolean {
    return SUPPORTED_TYPES.includes(mimeType.toLowerCase());
  }

  async process(buffer: Buffer, options: ProcessingOptions): Promise<ProcessingResult> {
    // Dynamic import sharp to avoid issues if not installed
    const sharp = await this.getSharp();
    if (!sharp) {
      return { metadata: {} };
    }

    const image = sharp(buffer);
    const metadata = await this.extractMetadata(image);
    const result: ProcessingResult = { metadata };

    // Generate thumbnail if requested
    if (options.generateThumbnail) {
      const size = options.thumbnailSize || DEFAULT_THUMBNAIL_SIZE;
      try {
        const thumbnail = await image
          .clone()
          .resize(size.width, size.height, {
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 80 })
          .toBuffer();

        result.thumbnail = thumbnail;
        result.thumbnailMimeType = "image/jpeg";
      } catch (err) {
        console.warn("Failed to generate thumbnail:", err);
      }
    }

    // Optimize if requested
    if (options.optimize) {
      try {
        const quality = options.quality ?? 80;
        let optimized = image.clone();

        // Determine output format based on input or requested format
        const format = options.format?.toLowerCase();
        if (format === "webp" || (!format && metadata.width && metadata.width > 100)) {
          optimized = optimized.webp({ quality });
        } else if (format === "avif") {
          optimized = optimized.avif({ quality });
        } else {
          optimized = optimized.jpeg({ quality, progressive: true });
        }

        result.optimized = await optimized.toBuffer();
      } catch (err) {
        console.warn("Failed to optimize image:", err);
      }
    }

    return result;
  }

  private async extractMetadata(image: any): Promise<FileProcessingMetadata> {
    try {
      const meta = await image.metadata();
      const result: FileProcessingMetadata = {
        width: meta.width,
        height: meta.height,
        colorSpace: meta.space,
        hasAlpha: meta.hasAlpha,
      };

      // Extract EXIF if available
      if (meta.exif) {
        try {
          // Basic EXIF parsing - would need exif-reader for full parsing
          result.exif = { raw: true };
        } catch {
          // Ignore EXIF parsing errors
        }
      }

      return result;
    } catch (err) {
      console.warn("Failed to extract image metadata:", err);
      return {};
    }
  }

  private async getSharp(): Promise<any | null> {
    try {
      const sharp = await import("sharp");
      return sharp.default;
    } catch {
      console.warn("Sharp library not available, image processing disabled");
      return null;
    }
  }
}
