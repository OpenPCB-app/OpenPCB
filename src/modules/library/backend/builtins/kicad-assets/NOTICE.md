# KiCad footprint assets — third-party notice

The `.kicad_mod` files bundled in this directory are sourced from the
**KiCad footprint libraries** project:

- Upstream: https://gitlab.com/kicad/libraries/kicad-footprints (master archive)
- License: **Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)** — https://creativecommons.org/licenses/by-sa/4.0/

The bundled files remain under CC BY-SA 4.0. Re-distribution must preserve
attribution and license. The surrounding OpenPCB code is governed by the
repository's primary license; the share-alike clause attaches only to the
asset files themselves and to verbatim-derived works of those assets.

## Bundled files (SHA1 manifest)

Used by `footprint-seeds.ts` for `sourceHash` continuity. If a file is
re-curated upstream, replace the file and bump the trailing `:v1` in its
`sourceHash` so existing dev databases pick up the change on next boot.

| Path                                                                       | SHA1                                       |
| -------------------------------------------------------------------------- | ------------------------------------------ |
| `Capacitor_SMD/C_0402_1005Metric.kicad_mod`                                | `41612f64f21fc008849af554eddc9c3f7bcaf784` |
| `Capacitor_SMD/C_0603_1608Metric.kicad_mod`                                | `3ebe4f2224dd7839b5583226011b0b32603ec981` |
| `Capacitor_SMD/C_0805_2012Metric.kicad_mod`                                | `a38497ea3d49325f269a565b215de4cad3ae81c9` |
| `Capacitor_SMD/C_1206_3216Metric.kicad_mod`                                | `a047d91b193909b8a2650a6c89feb7277370d0bd` |
| `Capacitor_SMD/C_1210_3225Metric.kicad_mod`                                | `83ee2cc37b9e0faac5f2481201a0f0c52f72eddb` |
| `Capacitor_THT/C_Disc_D3.0mm_W2.0mm_P2.50mm.kicad_mod`                     | `80cb36f2474aba98ebd2e7151912389b33768f34` |
| `Capacitor_THT/C_Disc_D5.0mm_W2.5mm_P5.00mm.kicad_mod`                     | `52c3c11a8b4cd3aeb2b861956c514c6ecd01fd8b` |
| `Capacitor_THT/C_Disc_D7.5mm_W5.0mm_P5.00mm.kicad_mod`                     | `0fcfebf330d3082f243b3403500f0531ab83d2cb` |
| `Resistor_SMD/R_0402_1005Metric.kicad_mod`                                 | `ba2a1fbb5e51200a081e93cd5c209d8ef50034b5` |
| `Resistor_SMD/R_0603_1608Metric.kicad_mod`                                 | `9617d8d504462abd16740dfac8959a4323866960` |
| `Resistor_SMD/R_0805_2012Metric.kicad_mod`                                 | `d1679745f477543b2526b5fa478c48638d1d6502` |
| `Resistor_SMD/R_1206_3216Metric.kicad_mod`                                 | `a0eac81591bf145e5f210b258ee4b366ab5d3eef` |
| `Resistor_SMD/R_1210_3225Metric.kicad_mod`                                 | `dc1e5ad821dbe670f44c65311f0716b1350d8a90` |
| `Resistor_SMD/R_2512_6332Metric.kicad_mod`                                 | `9376a6f3247391ed7afdd53a74edbc920244b875` |
| `Resistor_THT/R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal.kicad_mod` | `ee289dc7fd5b25f1ac12855e28469afaa3fc560c` |
| `Resistor_THT/R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal.kicad_mod`  | `a0f843eec50a47f1383985b7f55f861ed16dc4d0` |
| `Resistor_THT/R_Axial_DIN0309_L9.0mm_D3.2mm_P12.70mm_Horizontal.kicad_mod` | `b13376715c4b5b090e1c154bef5078074ac33681` |
