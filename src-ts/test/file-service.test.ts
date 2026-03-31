import { describe, it, expect, beforeEach } from "bun:test";
import { FileService, type UploadFileInput } from "../src/domain/services/file-service";
import type { FileRecord, FileWithBlob, FileStatus, FileQueryParams } from "../shared/types/file.types";

class InMemoryFileStorage {
  private blobs = new Map<string, Buffer>();
  constructor(private basePath = "files") {}

  async computeChecksum(buffer: Buffer): Promise<string> {
    const crypto = await import("crypto");
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

  async storeBuffer(buffer: Buffer): Promise<{ storagePath: string; checksum: string; sizeBytes: number }> {
    const checksum = await this.computeChecksum(buffer);
    const storagePath = `${this.basePath}/${checksum}`;
    this.blobs.set(storagePath, buffer);
    return { storagePath, checksum, sizeBytes: buffer.length };
  }

  async store(buffer: Buffer) {
    return this.storeBuffer(buffer);
  }

  async read(storagePath: string): Promise<Buffer> {
    const buf = this.blobs.get(storagePath);
    if (!buf) throw new Error("File not found");
    return buf;
  }

  async delete(storagePath: string): Promise<void> {
    this.blobs.delete(storagePath);
  }
}

class InMemoryFileBlobs {
  blobs = new Map<string, any>();

  async findByChecksum(checksum: string) {
    return Array.from(this.blobs.values()).find((b) => b.checksum === checksum) ?? null;
  }

  async create(data: any) {
    const id = crypto.randomUUID();
    const blob = {
      ...data,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.blobs.set(id, blob);
    return blob;
  }

  async incrementRefCount(id: string) {
    const blob = this.blobs.get(id);
    if (!blob) throw new Error("Blob not found");
    blob.refCount += 1;
    blob.updatedAt = new Date();
  }

  async decrementRefCount(id: string): Promise<number> {
    const blob = this.blobs.get(id);
    if (!blob) throw new Error("Blob not found");
    blob.refCount = Math.max(0, blob.refCount - 1);
    blob.updatedAt = new Date();
    return blob.refCount;
  }

  async findOrphaned() {
    return Array.from(this.blobs.values()).filter((b) => b.refCount === 0);
  }

  async delete(id: string) {
    this.blobs.delete(id);
  }
}

class InMemoryFiles {
  files = new Map<string, any>();

  async create(data: any) {
    const id = crypto.randomUUID();
    const now = new Date();
    const record = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
      tags: data.tags ?? [],
      permissions: data.permissions ?? null,
      metadata: data.metadata ?? null,
    };
    this.files.set(id, record);
    return record;
  }

  async findById(id: string) {
    return this.files.get(id) ?? null;
  }

  async findWithBlob(id: string) {
    const file = this.files.get(id);
    if (!file) return null;
    return { ...file, blob: { id: file.blobId, storagePath: "", checksum: "", sizeBytes: file.sizeBytes, mimeType: file.mimeType, refCount: 1, createdAt: new Date(), updatedAt: new Date() } } as FileWithBlob;
  }

  async query(_params: FileQueryParams) {
    return Array.from(this.files.values());
  }

  async update(id: string, data: any) {
    const file = this.files.get(id);
    if (!file) throw new Error("File not found");
    Object.assign(file, data, { updatedAt: new Date() });
    return file;
  }

  async updateStatus(id: string, status: FileStatus) {
    return this.update(id, {
      status,
      trashedAt: status === "trashed" ? new Date() : null,
      trashedBy: status === "trashed" ? "user" : null,
    });
  }

  async findTrashed() {
    return Array.from(this.files.values()).filter((f) => f.status === "trashed");
  }

  async delete(id: string) {
    this.files.delete(id);
  }
}

class InMemoryFileVersions {
  versions = new Map<string, any>();
  byFile = new Map<string, string[]>();

  async create(data: {
    fileId: string;
    blobId: string;
    versionNumber: number;
    sizeBytes: number;
    createdBy?: string | null;
    comment?: string | null;
    id?: string;
  }) {
    const id = data.id || crypto.randomUUID();
    const now = new Date();
    const record = {
      id,
      fileId: data.fileId,
      blobId: data.blobId,
      versionNumber: data.versionNumber,
      sizeBytes: data.sizeBytes,
      createdBy: data.createdBy ?? null,
      comment: data.comment ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.versions.set(id, record);
    const list = this.byFile.get(data.fileId) ?? [];
    list.push(id);
    this.byFile.set(data.fileId, list);
    return record;
  }

  async getNextVersionNumber(fileId: string) {
    const list = await this.findByFile(fileId);
    return list.length === 0 ? 1 : list[0].versionNumber + 1;
  }

  async findByFile(fileId: string) {
    const ids = this.byFile.get(fileId) ?? [];
    const records = ids
      .map((id) => this.versions.get(id))
      .filter(Boolean);
    records.sort((a: any, b: any) => b.versionNumber - a.versionNumber);
    return records;
  }

  async findByFileAndVersion(fileId: string, versionNumber: number) {
    const records = await this.findByFile(fileId);
    return records.find((record: any) => record.versionNumber === versionNumber) ?? null;
  }

  async getLatestVersion(fileId: string) {
    const records = await this.findByFile(fileId);
    return records[0] ?? null;
  }

  async delete(id: string) {
    const record = this.versions.get(id);
    if (!record) return;
    this.versions.delete(id);
    const list = this.byFile.get(record.fileId) ?? [];
    this.byFile.set(record.fileId, list.filter((item) => item !== id));
  }

  async deleteByFile(fileId: string) {
    const ids = this.byFile.get(fileId) ?? [];
    ids.forEach((id) => this.versions.delete(id));
    this.byFile.delete(fileId);
  }
}

class InMemoryDb {
  fileBlobs = new InMemoryFileBlobs();
  fileRecords = new InMemoryFiles();
  fileVersions = new InMemoryFileVersions();
}

const crypto = globalThis.crypto ?? (await import("node:crypto")).webcrypto;

function makeService() {
  const storage = new InMemoryFileStorage();
  const db = new InMemoryDb();
  const dbAccess = db as unknown as any;
  return { service: new (require("../src/domain/services/file-service")).FileService(dbAccess, storage as any), storage, db };
}

describe("FileService (in-memory)", () => {
  let service: any;
  let db: InMemoryDb;

  beforeEach(() => {
    const setup = makeService();
    service = setup.service;
    db = setup.db;
  });

  it("uploads new file and creates blob", async () => {
    const input: UploadFileInput = {
      buffer: Buffer.from("hello world"),
      originalName: "hello.txt",
      mimeType: "text/plain",
      context: { workspaceId: "ws1" },
    } as any;

    const result = await service.upload(input);
    expect(result.isNewBlob).toBe(true);
    expect(result.file.status).toBe("active");
    expect(result.file.workspaceId).toBe("ws1");
    expect(db.fileBlobs.blobs.size).toBe(1);
  });

  it("deduplicates by checksum and increments refCount", async () => {
    const input: UploadFileInput = {
      buffer: Buffer.from("same content"),
      originalName: "file1.txt",
      mimeType: "text/plain",
      context: { workspaceId: "ws1" },
    } as any;

    const first = await service.upload(input);
    const second = await service.upload({ ...input, originalName: "file2.txt" });

    expect(first.isNewBlob).toBe(true);
    expect(second.isNewBlob).toBe(false);
    const blob = Array.from(db.fileBlobs.blobs.values())[0];
    expect(blob.refCount).toBe(2);
  });

  it("soft deletes and restores", async () => {
    const input: UploadFileInput = {
      buffer: Buffer.from("x"),
      originalName: "a.txt",
      mimeType: "text/plain",
      context: { workspaceId: "ws1" },
    } as any;
    const { file } = await service.upload(input);

    const trashed = await service.softDelete(file.id);
    expect(trashed.status).toBe("trashed");

    const restored = await service.restore(file.id);
    expect(restored.status).toBe("active");
  });

  it("hard deletes via emptyTrash and removes blob when refCount hits zero", async () => {
    const input: UploadFileInput = {
      buffer: Buffer.from("y"),
      originalName: "b.txt",
      mimeType: "text/plain",
      context: { workspaceId: "ws1" },
    } as any;
    const { file } = await service.upload(input);

    await service.softDelete(file.id);
    const result = await service.emptyTrash({ workspaceId: "ws1" });

    expect(result.deletedCount).toBe(1);
    expect(db.fileRecords.files.size).toBe(0);
    expect(db.fileBlobs.blobs.size).toBe(0);
  });
});
