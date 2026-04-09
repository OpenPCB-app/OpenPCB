import type {
  ComponentImportResult,
  IComponentImportService,
  ImportFileInput,
} from "./component-import-service";

type ZipEntry = {
  isDirectory: boolean;
  entryName: string;
  getData(): Buffer;
};

type AdmZipConstructor = new (data: Buffer) => {
  getEntries(): ZipEntry[];
};

const AdmZip = require("adm-zip") as AdmZipConstructor;

export interface IComponentZipImportService {
  importZip(file: File): Promise<ComponentImportResult>;
}

export class ComponentZipImportService implements IComponentZipImportService {
  constructor(private readonly importService: IComponentImportService) {}

  async importZip(file: File): Promise<ComponentImportResult> {
    if (!file.name.endsWith(".zip")) {
      throw new Error("File must be a ZIP archive");
    }

    const archive = new AdmZip(Buffer.from(await file.arrayBuffer()));
    const files: ImportFileInput[] = archive
      .getEntries()
      .filter((entry) => !entry.isDirectory)
      .map((entry) => ({
        fileName: entry.entryName.split("/").pop() ?? entry.entryName,
        content: isBinaryEntry(entry.entryName)
          ? undefined
          : entry.getData().toString("utf-8"),
      }));

    return this.importService.importFiles(files);
  }
}

function isBinaryEntry(fileName: string): boolean {
  return /\.(step|stp|wrl)$/i.test(fileName);
}
