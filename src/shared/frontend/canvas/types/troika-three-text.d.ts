declare module "troika-three-text" {
  export interface PreloadFontOptions {
    readonly font?: string;
    readonly characters?: string;
    readonly sdfGlyphSize?: number;
  }

  export function preloadFont(
    options: PreloadFontOptions,
    callback?: () => void,
  ): void;
}
