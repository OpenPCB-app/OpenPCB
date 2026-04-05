import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_ID = "medium-hardening";
const FORMAT_VERSION = "pcb.schematic-project-document/v1";
const MANIFEST_FORMAT_VERSION = "openpcb.e2e.fixture-manifest/v1";
const SEED = "openpcb-medium-hardening-v1";
const GENERATED_AT = "2026-04-05T00:00:00.000Z";

const GRID = 1_270_000;
const SYMBOL_COUNT = 500;
const WIRE_COUNT = 1_000;
const LABEL_COUNT = 120;
const COLS = 25;
const ROWS = 20;
const SPACING_X = GRID * 4;
const SPACING_Y = GRID * 3;

const SYMBOL_MIX = {
  resistor: 200,
  capacitor: 120,
  connector: 100,
  genericIc: {
    total: 80,
    byPinCount: {
      8: 16,
      14: 16,
      16: 16,
      20: 16,
      24: 16,
    },
  },
};

const VIEWPORT_SEED = {
  offsetX: 320,
  offsetY: 180,
  zoom: 1 / 12_700,
};

function fnv1a32(input) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
    hash >>>= 0;
  }

  return hash >>> 0;
}

function mulberry32(seed) {
  let value = seed >>> 0;

  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function clonePoint(point) {
  return { x: point.x, y: point.y };
}

function createResistorPins(symbolId) {
  return [
    {
      id: `${symbolId}-pin-1`,
      name: "1",
      position: { x: -GRID, y: 0 },
    },
    {
      id: `${symbolId}-pin-2`,
      name: "2",
      position: { x: GRID, y: 0 },
    },
  ];
}

function createCapacitorPins(symbolId) {
  return [
    {
      id: `${symbolId}-pin-1`,
      name: "1",
      position: { x: -GRID, y: 0 },
    },
    {
      id: `${symbolId}-pin-2`,
      name: "2",
      position: { x: GRID, y: 0 },
    },
  ];
}

function createConnectorPins(symbolId) {
  return [
    {
      id: `${symbolId}-pin-1`,
      name: "1",
      position: { x: -GRID, y: 0 },
    },
    {
      id: `${symbolId}-pin-2`,
      name: "2",
      position: { x: GRID, y: 0 },
    },
    {
      id: `${symbolId}-pin-3`,
      name: "3",
      position: { x: 0, y: -GRID },
    },
    {
      id: `${symbolId}-pin-4`,
      name: "4",
      position: { x: 0, y: GRID },
    },
  ];
}

function createIcPins(symbolId, pinCount) {
  const halfCount = pinCount / 2;
  const pitch = GRID / 2;
  const startY = -((halfCount - 1) * pitch) / 2;
  const pins = [];

  for (let index = 0; index < halfCount; index += 1) {
    const y = startY + index * pitch;
    const leftPinNumber = index + 1;
    const rightPinNumber = pinCount - index;

    pins.push({
      id: `${symbolId}-pin-${leftPinNumber}`,
      name: String(leftPinNumber),
      position: { x: -GRID, y },
    });

    pins.push({
      id: `${symbolId}-pin-${rightPinNumber}`,
      name: String(rightPinNumber),
      position: { x: GRID, y },
    });
  }

  return pins.sort((left, right) => {
    const leftNumber = Number(left.name);
    const rightNumber = Number(right.name);
    return leftNumber - rightNumber;
  });
}

function pickDirectionalPin(symbol, directionX, directionY) {
  const sortedPins = [...symbol.pins].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  let selectedPin = sortedPins[0];
  let bestScore = -Infinity;

  for (const pin of sortedPins) {
    const scoreX =
      directionX > 0
        ? pin.position.x
        : directionX < 0
          ? -pin.position.x
          : -Math.abs(pin.position.x);
    const scoreY =
      directionY > 0
        ? pin.position.y
        : directionY < 0
          ? -pin.position.y
          : -Math.abs(pin.position.y);
    const score = scoreX * 2 + scoreY;

    if (score > bestScore) {
      bestScore = score;
      selectedPin = pin;
    }
  }

  return selectedPin;
}

function buildWirePoints(source, target) {
  if (source.x === target.x || source.y === target.y) {
    return [clonePoint(source), clonePoint(target)];
  }

  return [
    clonePoint(source),
    { x: target.x, y: source.y },
    clonePoint(target),
  ];
}

function shuffleInPlace(items, random) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const temporary = items[index];
    items[index] = items[swapIndex];
    items[swapIndex] = temporary;
  }

  return items;
}

function generateFixture(seed) {
  const random = mulberry32(fnv1a32(seed));
  const symbols = [];

  let resistorCounter = 0;
  let capacitorCounter = 0;
  let connectorCounter = 0;
  let icCounter = 0;

  for (let index = 0; index < SYMBOL_COUNT; index += 1) {
    const symbolId = `symbol-${String(index + 1).padStart(4, "0")}`;
    const row = Math.floor(index / COLS);
    const col = index % COLS;
    const position = {
      x: col * SPACING_X,
      y: row * SPACING_Y,
    };

    let symbol;

    if (index < SYMBOL_MIX.resistor) {
      resistorCounter += 1;
      symbol = {
        id: symbolId,
        entityType: "symbol",
        symbolKind: "resistor",
        reference: `R${resistorCounter}`,
        value: `${1 + (resistorCounter % 47)}k`,
        position,
        rotation: [0, 90, 180, 270][Math.floor(random() * 4)],
        mirrored: false,
        pins: createResistorPins(symbolId),
        properties: {
          Footprint: "R_0603",
          Tolerance: "1%",
        },
      };
    } else if (index < SYMBOL_MIX.resistor + SYMBOL_MIX.capacitor) {
      capacitorCounter += 1;
      symbol = {
        id: symbolId,
        entityType: "symbol",
        symbolKind: "capacitor",
        reference: `C${capacitorCounter}`,
        value: `${100 + (capacitorCounter % 90)}nF`,
        position,
        rotation: [0, 90, 180, 270][Math.floor(random() * 4)],
        mirrored: false,
        pins: createCapacitorPins(symbolId),
        properties: {
          Footprint: "C_0603",
          Voltage: "16V",
        },
      };
    } else if (
      index <
      SYMBOL_MIX.resistor + SYMBOL_MIX.capacitor + SYMBOL_MIX.connector
    ) {
      connectorCounter += 1;
      symbol = {
        id: symbolId,
        entityType: "symbol",
        symbolKind: "connector",
        reference: `J${connectorCounter}`,
        value: `HDR${4 + (connectorCounter % 8)}`,
        position,
        rotation: [0, 90, 180, 270][Math.floor(random() * 4)],
        mirrored: false,
        pins: createConnectorPins(symbolId),
        properties: {
          Footprint: `PinHeader_1x${4 + (connectorCounter % 8)}`,
        },
      };
    } else {
      icCounter += 1;
      const icPinVariants = [8, 14, 16, 20, 24];
      const pinCount = icPinVariants[(icCounter - 1) % icPinVariants.length];

      symbol = {
        id: symbolId,
        entityType: "symbol",
        symbolKind: "generic_ic",
        reference: `U${icCounter}`,
        value: `IC${pinCount}`,
        position,
        rotation: [0, 90, 180, 270][Math.floor(random() * 4)],
        mirrored: false,
        pins: createIcPins(symbolId, pinCount),
        properties: {
          Footprint: `SOIC_${pinCount}`,
          Package: `SOIC-${pinCount}`,
        },
        pinCount,
      };
    }

    symbols.push(symbol);
  }

  const symbolByGridIndex = new Map();
  symbols.forEach((symbol, index) => {
    symbolByGridIndex.set(index, symbol);
  });

  const wireCandidates = [];

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const sourceIndex = row * COLS + col;

      const rightIndex = col + 1 < COLS ? sourceIndex + 1 : null;
      const downIndex = row + 1 < ROWS ? sourceIndex + COLS : null;
      const downRightIndex =
        row + 1 < ROWS && col + 1 < COLS ? sourceIndex + COLS + 1 : null;
      const downLeftIndex =
        row + 1 < ROWS && col - 1 >= 0 ? sourceIndex + COLS - 1 : null;

      if (rightIndex !== null) {
        wireCandidates.push([sourceIndex, rightIndex]);
      }

      if (downIndex !== null) {
        wireCandidates.push([sourceIndex, downIndex]);
      }

      if (downRightIndex !== null) {
        wireCandidates.push([sourceIndex, downRightIndex]);
      }

      if (downLeftIndex !== null) {
        wireCandidates.push([sourceIndex, downLeftIndex]);
      }
    }
  }

  shuffleInPlace(wireCandidates, random);

  const selectedCandidates = wireCandidates.slice(0, WIRE_COUNT);
  const wires = selectedCandidates.map((candidate, index) => {
    const [sourceIndex, targetIndex] = candidate;
    const sourceSymbol = symbolByGridIndex.get(sourceIndex);
    const targetSymbol = symbolByGridIndex.get(targetIndex);

    if (!sourceSymbol || !targetSymbol) {
      throw new Error("invalid wire candidate indices");
    }

    const directionX = Math.sign(targetSymbol.position.x - sourceSymbol.position.x);
    const directionY = Math.sign(targetSymbol.position.y - sourceSymbol.position.y);
    const sourcePin = pickDirectionalPin(sourceSymbol, directionX, directionY);
    const targetPin = pickDirectionalPin(targetSymbol, -directionX, -directionY);

    const sourcePoint = {
      x: sourceSymbol.position.x + sourcePin.position.x,
      y: sourceSymbol.position.y + sourcePin.position.y,
    };
    const targetPoint = {
      x: targetSymbol.position.x + targetPin.position.x,
      y: targetSymbol.position.y + targetPin.position.y,
    };

    const netName = `NET_${String(index + 1).padStart(4, "0")}`;
    const points = buildWirePoints(sourcePoint, targetPoint);

    return {
      id: `wire-${String(index + 1).padStart(4, "0")}`,
      entityType: "wire",
      position: clonePoint(sourcePoint),
      rotation: 0,
      mirrored: false,
      sourcePinId: sourcePin.id,
      targetPinId: targetPin.id,
      points,
      net: netName,
    };
  });

  const labels = Array.from({ length: LABEL_COUNT }, (_, index) => {
    const wireIndex = Math.floor((index * wires.length) / LABEL_COUNT);
    const wire = wires[wireIndex];

    if (!wire) {
      throw new Error(`missing wire for label index ${index}`);
    }

    const anchorPoint = wire.points[Math.floor(wire.points.length / 2)] ?? wire.points[0];
    const offsetDirection = random() > 0.5 ? 1 : -1;
    const secondaryOffsetDirection = random() > 0.5 ? 1 : -1;
    const position = {
      x: anchorPoint.x + offsetDirection * (GRID / 2),
      y: anchorPoint.y + secondaryOffsetDirection * (GRID / 2),
    };

    return {
      id: `label-${String(index + 1).padStart(4, "0")}`,
      entityType: "label",
      text: wire.net,
      position,
      rotation: random() > 0.5 ? 0 : 90,
      mirrored: false,
      net: wire.net,
    };
  });

  return {
    id: `e2e-${FIXTURE_ID}`,
    projectId: "project-e2e",
    updatedAt: GENERATED_AT,
    version: 1,
    formatVersion: FORMAT_VERSION,
    name: "E2E medium hardening schematic",
    revision: 1,
    symbols,
    wires,
    labels,
  };
}

function hashString(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stringifyStable(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function main() {
  const fixtureRuns = Array.from({ length: 3 }, () =>
    stringifyStable(generateFixture(SEED)),
  );
  const fixtureHashes = fixtureRuns.map(hashString);
  const stable = fixtureHashes.every((hash) => hash === fixtureHashes[0]);

  if (!stable) {
    throw new Error("fixture generation is not deterministic across three runs");
  }

  const fixtureString = fixtureRuns[0];
  const fixture = JSON.parse(fixtureString);

  if (fixture.symbols.length !== SYMBOL_COUNT) {
    throw new Error(`expected ${SYMBOL_COUNT} symbols, got ${fixture.symbols.length}`);
  }

  if (fixture.wires.length !== WIRE_COUNT) {
    throw new Error(`expected ${WIRE_COUNT} wires, got ${fixture.wires.length}`);
  }

  if (fixture.labels.length !== LABEL_COUNT) {
    throw new Error(`expected ${LABEL_COUNT} labels, got ${fixture.labels.length}`);
  }

  const manifest = {
    formatVersion: MANIFEST_FORMAT_VERSION,
    fixtureId: FIXTURE_ID,
    fixtureFile: "tests/e2e/fixtures/medium-hardening.json",
    seed: SEED,
    generationTimestamp: GENERATED_AT,
    documentFormatVersion: FORMAT_VERSION,
    viewportSeed: VIEWPORT_SEED,
    counts: {
      symbols: fixture.symbols.length,
      wires: fixture.wires.length,
      labels: fixture.labels.length,
    },
    symbolMix: {
      resistor: SYMBOL_MIX.resistor,
      capacitor: SYMBOL_MIX.capacitor,
      connector: SYMBOL_MIX.connector,
      generic_ic: SYMBOL_MIX.genericIc,
    },
    reproducibility: {
      runs: 3,
      stable,
      hashAlgorithm: "sha256",
      hashes: fixtureHashes,
      fixtureHash: fixtureHashes[0],
    },
  };

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const fixtureDirectory = __dirname;
  const fixturePath = path.join(fixtureDirectory, `${FIXTURE_ID}.json`);
  const manifestPath = path.join(
    fixtureDirectory,
    `${FIXTURE_ID}-manifest.json`,
  );

  await mkdir(fixtureDirectory, { recursive: true });
  await writeFile(fixturePath, fixtureString, "utf8");
  await writeFile(manifestPath, stringifyStable(manifest), "utf8");

  process.stdout.write(
    `${FIXTURE_ID}: symbols=${fixture.symbols.length}, wires=${fixture.wires.length}, labels=${fixture.labels.length}, hash=${fixtureHashes[0]}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
