import type { RotationDeg } from "../geometry";

export interface Transform2DComponent {
  xNm: number;
  yNm: number;
  rotationDeg: RotationDeg;
  mirrored: boolean;
}
