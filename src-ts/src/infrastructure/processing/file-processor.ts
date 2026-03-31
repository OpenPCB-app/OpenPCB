/**
 * File Processor Interface
 *
 * Base interface for file processing plugins (thumbnails, optimization, etc.)
 */

export interface FileProcessor {
  /** Check if this processor can handle the given MIME type */
  canProcess(mimeType: string): boolean;

  /** Process the file buffer and return results */
  process(buffer: Buffer, options: ProcessingOptions): Promise<ProcessingResult>;
}

export interface ProcessingOptions {
  /** Generate thumbnail */
  generateThumbnail?: boolean;
  /** Thumbnail dimensions */
  thumbnailSize?: { width: number; height: number };
  /** Optimize/compress the file */
  optimize?: boolean;
  /** Target format for conversion */
  format?: string;
  /** Quality for lossy formats (0-100) */
  quality?: number;
}

export interface ProcessingResult {
  /** Generated thumbnail buffer */
  thumbnail?: Buffer;
  /** Thumbnail MIME type */
  thumbnailMimeType?: string;
  /** Optimized version of the file */
  optimized?: Buffer;
  /** Extracted metadata */
  metadata: FileProcessingMetadata;
}

export interface FileProcessingMetadata {
  /** Image/video width */
  width?: number;
  /** Image/video height */
  height?: number;
  /** Audio/video duration in seconds */
  duration?: number;
  /** Number of pages (PDF) */
  pageCount?: number;
  /** Author/creator */
  author?: string;
  /** Document title */
  title?: string;
  /** Color space */
  colorSpace?: string;
  /** Has transparency */
  hasAlpha?: boolean;
  /** EXIF data for images */
  exif?: Record<string, unknown>;
  /** Any additional metadata */
  [key: string]: unknown;
}

/** Default thumbnail size */
export const DEFAULT_THUMBNAIL_SIZE = { width: 200, height: 200 };

/** Default processing options */
export const DEFAULT_PROCESSING_OPTIONS: ProcessingOptions = {
  generateThumbnail: true,
  thumbnailSize: DEFAULT_THUMBNAIL_SIZE,
  optimize: false,
  quality: 80,
};
