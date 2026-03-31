/**
 * PDF Processor
 *
 * Handles PDF processing for metadata extraction and thumbnail generation.
 * Uses pdf-lib for metadata and optionally canvas for thumbnails.
 */

import type {
  FileProcessor,
  ProcessingOptions,
  ProcessingResult,
  FileProcessingMetadata,
} from "./file-processor";

export class PDFProcessor implements FileProcessor {
  canProcess(mimeType: string): boolean {
    return mimeType.toLowerCase() === "application/pdf";
  }

  async process(buffer: Buffer, options: ProcessingOptions): Promise<ProcessingResult> {
    const metadata = await this.extractMetadata(buffer);
    const result: ProcessingResult = { metadata };

    // Note: PDF thumbnail generation requires additional dependencies
    // (pdfjs-dist + canvas) which are optional. We only extract metadata
    // for now and leave thumbnail generation as a future enhancement.
    if (options.generateThumbnail) {
      // Thumbnail generation requires pdfjs-dist and canvas
      // Skipping for now - can be added when dependencies are available
    }

    return result;
  }

  private async extractMetadata(buffer: Buffer): Promise<FileProcessingMetadata> {
    try {
      const pdfLib = await this.getPDFLib();
      if (!pdfLib) {
        return {};
      }

      const pdfDoc = await pdfLib.PDFDocument.load(buffer, {
        ignoreEncryption: true,
      });

      const pageCount = pdfDoc.getPageCount();
      const metadata: FileProcessingMetadata = {
        pageCount,
      };

      // Extract document info
      try {
        const title = pdfDoc.getTitle();
        const author = pdfDoc.getAuthor();
        const subject = pdfDoc.getSubject();
        const creator = pdfDoc.getCreator();
        const producer = pdfDoc.getProducer();
        const creationDate = pdfDoc.getCreationDate();
        const modificationDate = pdfDoc.getModificationDate();

        if (title) metadata.title = title;
        if (author) metadata.author = author;
        if (subject) metadata.subject = subject;
        if (creator) metadata.creator = creator;
        if (producer) metadata.producer = producer;
        if (creationDate) metadata.createdAt = creationDate.toISOString();
        if (modificationDate) metadata.modifiedAt = modificationDate.toISOString();
      } catch {
        // Ignore metadata extraction errors
      }

      // Get first page dimensions
      if (pageCount > 0) {
        const firstPage = pdfDoc.getPage(0);
        const { width, height } = firstPage.getSize();
        metadata.width = Math.round(width);
        metadata.height = Math.round(height);
      }

      return metadata;
    } catch (err) {
      console.warn("Failed to extract PDF metadata:", err);
      return {};
    }
  }

  private async getPDFLib(): Promise<any | null> {
    try {
      const pdfLib = await import("pdf-lib");
      return pdfLib;
    } catch {
      console.warn("pdf-lib not available, PDF processing disabled");
      return null;
    }
  }
}
