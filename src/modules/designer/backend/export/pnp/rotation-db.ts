/**
 * JLCPCB pick-and-place rotation-offset table.
 *
 * KiCad-derived footprint libraries (which OpenPCB imports) define each
 * package's 0° orientation per the KiCad Library Convention; JLCPCB's assembly
 * machines expect the IPC-7351 zero. The difference is a fixed per-package
 * offset, added to the part rotation before the CPL is written. This is the
 * canonical community database (matthewlai/JLCKicadTools `cpl_rotations_db.csv`)
 * used by the common JLCPCB export tools, matched by footprint-name regex —
 * the FIRST matching rule wins, so order is significant.
 *
 * Offsets are degrees CCW-positive. They are empirical and JLCPCB revises them
 * occasionally; always validate a new design against JLCPCB's 3D assembly
 * preview. A per-part override (`propertiesJson.pnpRotation`, absolute degrees)
 * takes precedence over this table — see the CPL writer.
 *
 * Position offsets (a few connectors in the upstream DB carry X/Y offsets) are
 * not yet applied — rotation only. Tracked as a follow-up.
 *
 * Source: https://github.com/matthewlai/JLCKicadTools (cpl_rotations_db.csv)
 */

interface RotationRule {
  readonly pattern: RegExp;
  readonly offsetDeg: number;
}

// Order mirrors the upstream CSV (first match wins). Keep `^SOP-4_` before the
// general `^SOP-(?!18_)` so the 0° special-case is not shadowed by 270°.
const ROTATION_RULES: readonly RotationRule[] = [
  { pattern: /^R_Array_Convex_/, offsetDeg: 90 },
  { pattern: /^R_Array_Concave_/, offsetDeg: 90 },
  { pattern: /^SOT-223/, offsetDeg: 180 },
  { pattern: /^SOT-23/, offsetDeg: -90 },
  { pattern: /^SOT-89/, offsetDeg: 180 },
  { pattern: /^TSOT-23/, offsetDeg: 180 },
  { pattern: /^SOT-353/, offsetDeg: 180 },
  { pattern: /^SOT-363/, offsetDeg: 180 },
  { pattern: /^LQFP-/, offsetDeg: 270 },
  { pattern: /^TQFP-/, offsetDeg: 270 },
  { pattern: /^SOP-4_/, offsetDeg: 0 },
  { pattern: /^SOP-(?!18_)/, offsetDeg: 270 },
  { pattern: /^TSSOP-/, offsetDeg: 270 },
  { pattern: /^SSOP-/, offsetDeg: 270 },
  { pattern: /^DFN-/, offsetDeg: 270 },
  { pattern: /^SOIC-/, offsetDeg: 270 },
  { pattern: /^SOP-18_/, offsetDeg: 0 },
  { pattern: /^VSSOP-8_3.0x3.0mm_P0.65mm/, offsetDeg: 270 },
  { pattern: /^VSSOP-8_/, offsetDeg: 180 },
  { pattern: /^VSSOP-10_/, offsetDeg: 270 },
  { pattern: /^VSON-8_/, offsetDeg: 270 },
  { pattern: /^TSOP-6/, offsetDeg: 270 },
  { pattern: /^UDFN-10/, offsetDeg: 270 },
  { pattern: /^USON-10/, offsetDeg: 270 },
  { pattern: /^TDSON-8-1/, offsetDeg: 270 },
  { pattern: /^CP_EIA-/, offsetDeg: 180 },
  { pattern: /^CP_Elec_8x5.4/, offsetDeg: 180 },
  { pattern: /^CP_Elec_8x10.5/, offsetDeg: 180 },
  { pattern: /^CP_Elec_6.3x7.7/, offsetDeg: 180 },
  { pattern: /^CP_Elec_8x6.7/, offsetDeg: 180 },
  { pattern: /^CP_Elec_8x10/, offsetDeg: 180 },
  { pattern: /^CP_Elec_10x10/, offsetDeg: 180 },
  { pattern: /^(.*?_|V)?QFN-(16|20|24|28|40)(-|_|$)/, offsetDeg: 270 },
  {
    pattern: /^Bosch_LGA-8_2x2.5mm_P0.65mm_ClockwisePinNumbering/,
    offsetDeg: 90,
  },
  { pattern: /^PowerPAK_SO-8_Single/, offsetDeg: 270 },
  { pattern: /^HTSSOP-28-1EP_4.4x9.7mm/, offsetDeg: 270 },
  { pattern: /^PUIAudio_SMT_0825_S_4_R/, offsetDeg: 270 },
  { pattern: /^USB_C_Receptacle_HRO_TYPE-C-31-M-12/, offsetDeg: 180 },
  { pattern: /^ESP32-W/, offsetDeg: 270 },
  { pattern: /^SOIC127P798X216-8N/, offsetDeg: -90 },
  {
    pattern: /^SW_DIP_SPSTx01_Slide_Copal_CHS-01B_W7.62mm_P1.27mm/,
    offsetDeg: -180,
  },
  { pattern: /^BatteryHolder_Keystone_1060_1x2032/, offsetDeg: -180 },
  { pattern: /^SO-14/, offsetDeg: -90 },
  { pattern: /^HTSSOP-/, offsetDeg: 270 },
  { pattern: /^Relay_DPDT_Omron_G6K-2F-Y/, offsetDeg: 270 },
  { pattern: /^RP2040-QFN-56/, offsetDeg: 270 },
  { pattern: /^TO-277/, offsetDeg: 90 },
  { pattern: /^SW_SPST_B3/, offsetDeg: 90 },
  { pattern: /^Transformer_Ethernet_Pulse_HX0068ANL/, offsetDeg: 270 },
  { pattern: /^JST_GH_SM/, offsetDeg: 180 },
  { pattern: /^JST_PH_S/, offsetDeg: 180 },
  { pattern: /^Diodes_PowerDI3333-8/, offsetDeg: 270 },
  { pattern: /^Quectel_L80-R/, offsetDeg: 270 },
  { pattern: /^SC-74-6/, offsetDeg: 180 },
  { pattern: /^SOT-143/, offsetDeg: 180 },
  { pattern: /^PinHeader_2x05_P1\.27mm_Vertical/, offsetDeg: 90 },
  { pattern: /^LED_WS2812B-2020_PLCC4_2.0x2.0mm/, offsetDeg: 90 },
  { pattern: /^WSON-8-1EP_6x5mm_P1.27mm/, offsetDeg: -90 },
];

/**
 * Footprint-family rotation offset (deg, CCW-positive) to convert a
 * KiCad-zero footprint to JLCPCB's expected orientation. 0 when no rule
 * matches (assume the footprint already sits at the IPC zero).
 */
export function footprintRotationOffsetDeg(footprintName: string): number {
  for (const rule of ROTATION_RULES) {
    if (rule.pattern.test(footprintName)) return rule.offsetDeg;
  }
  return 0;
}
