declare module "occt-import-js" {
    export interface OcctModuleOptions {
        locateFile?: (path: string, prefix: string) => string;
    }

    export interface OcctResult {
        success: boolean;
        meshes: Array<{
            name: string;
            color?: [number, number, number];
            brep_faces?: { first: number; last: number }[];
            index: { array: number[] };
            attributes: {
                position: { array: number[] };
                normal?: { array: number[] };
            };
        }>;
    }

    export interface OcctApi {
        ReadStepFile(data: Uint8Array, params: null): OcctResult;
    }

    export default function initOcct(options?: OcctModuleOptions): Promise<OcctApi>;
}
