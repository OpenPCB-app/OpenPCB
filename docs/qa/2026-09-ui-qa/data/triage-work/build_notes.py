KSTAT = {f"K{i:02d}": "confirmed" for i in range(1, 46)}
KSTAT.update({"K16": "partial", "K27": "refuted", "N1": "confirmed", "N2": "confirmed", "spike": "confirmed"})
KNOTE = {
    "K01": "Docs FixedToolbar + Tasks tasks.map crash blank #root; designer survived injections but 2 unhandled rejections",
    "K09": "Schematic confirmed; PCB analog shows 'projection unavailable' without retry (F1A-012)",
    "K13": "Downgraded S4: Tune/Bundle behind dev flags; Measure reachable via context menu",
    "K16": "Hint 'T/B' never rendered; but T in idle Route quits Route and arms Text",
    "K20": "Code-confirmed (flag on in dev so not visible on dev stacks)",
    "K27": "Refuted: button named 'Snapshot' from visible text",
    "K28": "Schematic mislabels R as clockwise (it is CCW); editors correct",
    "K30": "Plus 4-layer variant: unchecking ships unmanufacturable bundle (F2B-006)",
    "K40": "Confirmed on Home, Library, Docs, Designer, BOM, cloud; not every one of 42 sites exercised",
    "K43": "Partial nuance: 3D Height heatmap is enabled and shows a fake legend",
    "N2": "Latent: Library→schematic drop path unreachable (MIME mismatch, F1C-006)",
    "spike": "Toolbar counts errors only; dock/status errors+warnings (Q4-001)",
}


