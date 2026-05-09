import { afterEach, describe, expect, test, vi } from "vitest";
import * as THREE from "three";
import { createModelCache, disposeModelScene } from "./ModelCacheProvider";

const loaderMocks = vi.hoisted(() => ({
  parse: vi.fn(),
  sceneFactory: null as null | (() => unknown),
}));

vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class MockGLTFLoader {
    parse(
      arrayBuffer: ArrayBuffer,
      path: string,
      onLoad: (gltf: { scene: unknown }) => void,
      onError?: (error: Error) => void,
    ): void {
      loaderMocks.parse(arrayBuffer, path, onLoad, onError);
    }
  },
}));

function findFirstMesh(group: THREE.Group): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  group.traverse((object) => {
    if (!found && (object as THREE.Mesh).isMesh) {
      found = object as THREE.Mesh;
    }
  });
  if (!found) throw new Error("Expected cloned model to contain a mesh");
  return found;
}

describe("ModelCacheProvider cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    loaderMocks.parse.mockReset();
    loaderMocks.sceneFactory = null;
  });

  test("dedupes concurrent GLB loads by sha256 and returns independent clones", async () => {
    loaderMocks.sceneFactory = () => {
      const group = new THREE.Group();
      group.add(
        new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshBasicMaterial({ color: "red" }),
        ),
      );
      return group;
    };
    loaderMocks.parse.mockImplementation(
      (_arrayBuffer, _path, onLoad: (gltf: { scene: unknown }) => void) => {
        onLoad({ scene: loaderMocks.sceneFactory?.() });
      },
    );
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const cache = createModelCache();
    const [first, second] = await Promise.all([
      cache.getModel("/api/modules/library/footprints/fp-1/model", "same-sha"),
      cache.getModel("/api/modules/library/footprints/fp-1/model", "same-sha"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(loaderMocks.parse).toHaveBeenCalledTimes(1);
    expect(cache.getStatus("same-sha")).toBe("ready");
    expect(first).toBeInstanceOf(THREE.Group);
    expect(second).toBeInstanceOf(THREE.Group);
    expect(first).not.toBe(second);

    const firstMesh = findFirstMesh(first!);
    const secondMesh = findFirstMesh(second!);
    expect(firstMesh.geometry).not.toBe(secondMesh.geometry);
    expect(firstMesh.material).not.toBe(secondMesh.material);

    disposeModelScene(first!);
    expect(secondMesh.geometry.attributes.position).toBeDefined();
  });
});
