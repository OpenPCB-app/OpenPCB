import { Units, type Nanometers } from "../coords";
import type { BoardOutline, Point2D } from "@/components/pcb-editor/pcb-types";

export interface PcbAdapterSceneTransform {
  readonly boardWidthMm: number;
  readonly boardHeightMm: number;
  storePointToScenePoint(pointMm: Point2D): Point2D;
  scenePointToStorePoint(pointMm: Point2D): Point2D;
  worldPointNmToStorePoint(pointNm: Point2D): Point2D;
  storePointToWorldPointNm(pointMm: Point2D): { x: Nanometers; y: Nanometers };
  rotationToScene(rotationDeg: number): number;
}

export function createPcbAdapterSceneTransform(
  boardOutline: BoardOutline | null | undefined,
): PcbAdapterSceneTransform {
  const boardWidthMm = boardOutline?.width ?? 0;
  const boardHeightMm = boardOutline?.height ?? 0;

  function storePointToScenePoint(pointMm: Point2D): Point2D {
    return {
      x: pointMm.x - boardWidthMm / 2,
      y: boardHeightMm / 2 - pointMm.y,
    };
  }

  function scenePointToStorePoint(pointMm: Point2D): Point2D {
    return {
      x: pointMm.x + boardWidthMm / 2,
      y: boardHeightMm / 2 - pointMm.y,
    };
  }

  return {
    boardWidthMm,
    boardHeightMm,
    storePointToScenePoint,
    scenePointToStorePoint,
    worldPointNmToStorePoint(pointNm) {
      return {
        x: Units.nmToMm(pointNm.x),
        y: Units.nmToMm(pointNm.y),
      };
    },
    storePointToWorldPointNm(pointMm) {
      return {
        x: Units.mmToNm(pointMm.x),
        y: Units.mmToNm(pointMm.y),
      };
    },
    rotationToScene(rotationDeg) {
      return -rotationDeg;
    },
  };
}
