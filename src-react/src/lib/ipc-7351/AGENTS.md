# IPC-7351 Land Pattern Calculator

Implements IPC-7351B standard for SMD footprint generation.

## Files

| File               | Purpose                                       |
| ------------------ | --------------------------------------------- |
| `calculator.ts`    | Land pattern calculation from body dimensions |
| `fillet-tables.ts` | Toe/heel/side fillet values per density level |
| `naming.ts`        | IPC-7351 naming convention generator          |
| `types.ts`         | TypeScript interfaces for calculator I/O      |

## Density Levels

| Level   | Code | Use Case                        |
| ------- | ---- | ------------------------------- |
| Most    | M    | Maximum land for hand soldering |
| Nominal | N    | Default, balanced (use this)    |
| Least   | L    | Minimum land for dense boards   |

## Calculation Flow

```typescript
import { calculateLandPattern } from "./calculator";

const pattern = calculateLandPattern({
  packageType: "SOIC",
  bodyLength: 4.9, // mm
  bodyWidth: 3.9, // mm
  leadSpan: 6.0, // mm (toe-to-toe)
  leadWidth: 0.45, // mm
  leadLength: 0.8, // mm
  pitch: 1.27, // mm
  pinCount: 8,
  densityLevel: "N",
});
// Returns: { padWidth, padHeight, padX, padY, courtyard, name }
```

## Fillet Tables

From IPC-7351B Table 3-2:

- **Toe fillet**: Extension beyond lead toe
- **Heel fillet**: Extension toward body center
- **Side fillet**: Extension beyond lead sides

Values vary by package family (SOIC, QFP, BGA, etc.) and density level.

## Naming Convention

Auto-generated per IPC-7351:

```
SOIC127P600X175-8N
│    │   │   │  │└─ Density level
│    │   │   │  └── Pin count
│    │   │   └───── Height (0.1mm units)
│    │   └───────── Body width (0.1mm units)
│    └───────────── Pitch (0.01mm units)
└────────────────── Package type
```

## Testing

```bash
npm run test:react -- src/lib/ipc-7351/calculator.test.ts
```

Tests verify against known IPC-7351B reference values.

## References

- IPC-7351B: Generic Requirements for Surface Mount Design
- Manufacturer datasheets for body/lead dimensions
- See root `AGENTS.md` for PCB Design Standards section
