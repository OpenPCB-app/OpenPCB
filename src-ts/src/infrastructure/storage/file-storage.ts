import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export interface FileStorageConfig {
  basePath: string;
}

export interface StoredFileInfo {
  storagePath: string;
  checksum: string;
  sizeBytes: number;
}

export class FileStorage {
  private basePath: string;

  constructor(config: FileStorageConfig) {
    this.basePath = config.basePath;
    this.ensureBasePathExists();
  }

  private ensureBasePathExists(): void {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  private getShardedPath(checksum: string): string {
    const shard1 = checksum.substring(0, 2);
    const shard2 = checksum.substring(2, 4);
    return path.join(this.basePath, shard1, shard2);
  }

  private getFullPath(checksum: string): string {
    const shardedPath = this.getShardedPath(checksum);
    return path.join(shardedPath, checksum);
  }

  async store(buffer: Buffer): Promise<StoredFileInfo> {
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
    const fullPath = this.getFullPath(checksum);
    const relativePath = path.relative(this.basePath, fullPath);

    if (fs.existsSync(fullPath)) {
      return {
        storagePath: relativePath,
        checksum,
        sizeBytes: buffer.length,
      };
    }

    const shardedPath = this.getShardedPath(checksum);
    if (!fs.existsSync(shardedPath)) {
      fs.mkdirSync(shardedPath, { recursive: true });
    }

    const tempPath = `${fullPath}.uploading`;
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, fullPath);

    return {
      storagePath: relativePath,
      checksum,
      sizeBytes: buffer.length,
    };
  }

  async read(storagePath: string): Promise<Buffer> {
    const fullPath = path.join(this.basePath, storagePath);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${storagePath}`);
    }

    return fs.readFileSync(fullPath);
  }

  async exists(storagePath: string): Promise<boolean> {
    const fullPath = path.join(this.basePath, storagePath);
    return fs.existsSync(fullPath);
  }

  async delete(storagePath: string): Promise<void> {
    const fullPath = path.join(this.basePath, storagePath);
    
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  async computeChecksum(buffer: Buffer): Promise<string> {
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }
}
