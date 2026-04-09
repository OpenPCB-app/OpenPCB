export interface SheetMetaComponent {
  title: string;
  index: number;
  pageSettings?: {
    widthNm?: number;
    heightNm?: number;
  };
}
