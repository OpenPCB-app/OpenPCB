export interface PointNm {
  xNm: number;
  yNm: number;
}

export type RotationDeg = 0 | 90 | 180 | 270;

export function pointKey(point: PointNm): string {
  return `${point.xNm}:${point.yNm}`;
}
