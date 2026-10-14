# Bundled EDA font

`NotoSans-Regular.ttf` is the unmodified static hinted Noto Sans font from the official `notofonts/noto-fonts` repository at revision `ffebf8c1ee449e544955a7e813c54f9b73848eac`. Source URL, SHA-256, byte length, and license provenance are recorded in `manifest.json`. `OFL.txt` contains the upstream copyright notice and full SIL Open Font License 1.1 and must ship with the font.

The manifest's inclusive coverage intervals come from the exact Unicode cmap selected by Troika 0.52's bundled Typr parser, using its selection priority and mapping behavior, excluding glyph ID 0. The `?` replacement and Greek `Ωωµμ` and Cyrillic glyphs are covered. CJK is not covered; unsupported glyphs must degrade visibly without contacting a font CDN. Interior newline/tab layout is handled by the canvas package, rather than being claimed as a font cmap glyph.

The application must explicitly configure the reviewed canvas package before mounting previews or editors. Merely shipping this asset does not change the installed package's text path and does not establish cold offline browser or native Electron acceptance. Source-package tests retain an identical licensed fixture and verify its hash and cmap; there is no runtime font download from the provenance URLs.
