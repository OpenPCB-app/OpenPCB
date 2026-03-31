import type { HitTestCache, SymbolEntity, Viewport } from "../types";
import { schematicToScreen } from "./viewport";
import { getSymbolBodyBounds, getWorldConnectorAnchors } from "./symbols";

export const CONNECTOR_HIT_RADIUS_SCREEN_PX = 10;

export type SchematicHitTarget =
    | { kind: "connector"; symbolId: string; pinId: string }
    | { kind: "body"; symbolId: string }
    | null;

export function createHitTestCache(symbols: SymbolEntity[]): HitTestCache {
    return {
        symbolBounds: Object.fromEntries(
            symbols.map((symbol) => [symbol.id, getSymbolBodyBounds(symbol)]),
        ),
        connectorAnchors: Object.fromEntries(
            symbols.flatMap((symbol) => Object.entries(getWorldConnectorAnchors(symbol))),
        ),
    };
}

function isWithinScreenRect(
    screenX: number,
    screenY: number,
    viewport: Viewport,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
): boolean {
    const topLeft = schematicToScreen(minX, minY, viewport);
    const bottomRight = schematicToScreen(maxX, maxY, viewport);
    const left = Math.min(topLeft.x, bottomRight.x);
    const right = Math.max(topLeft.x, bottomRight.x);
    const top = Math.min(topLeft.y, bottomRight.y);
    const bottom = Math.max(topLeft.y, bottomRight.y);

    return screenX >= left && screenX <= right && screenY >= top && screenY <= bottom;
}

export function hitTestScreen(
    screenX: number,
    screenY: number,
    symbols: SymbolEntity[],
    viewport: Viewport,
    cache: HitTestCache,
): SchematicHitTarget {
    let closestConnector: { distanceSquared: number; target: Extract<SchematicHitTarget, { kind: "connector" }> } | null = null;

    for (let symbolIndex = symbols.length - 1; symbolIndex >= 0; symbolIndex -= 1) {
        const symbol = symbols[symbolIndex];
        if (!symbol) {
            continue;
        }

        for (const pin of symbol.pins) {
            const anchor = cache.connectorAnchors[pin.id];
            if (!anchor) {
                continue;
            }

            const screenPoint = schematicToScreen(anchor.x, anchor.y, viewport);
            const deltaX = screenPoint.x - screenX;
            const deltaY = screenPoint.y - screenY;
            const distanceSquared = deltaX * deltaX + deltaY * deltaY;

            if (distanceSquared > CONNECTOR_HIT_RADIUS_SCREEN_PX ** 2) {
                continue;
            }

            if (!closestConnector || distanceSquared < closestConnector.distanceSquared) {
                closestConnector = {
                    distanceSquared,
                    target: {
                        kind: "connector",
                        symbolId: symbol.id,
                        pinId: pin.id,
                    },
                };
            }
        }
    }

    if (closestConnector) {
        return closestConnector.target;
    }

    for (let symbolIndex = symbols.length - 1; symbolIndex >= 0; symbolIndex -= 1) {
        const symbol = symbols[symbolIndex];
        if (!symbol) {
            continue;
        }

        const bounds = cache.symbolBounds[symbol.id];
        if (!bounds) {
            continue;
        }

        if (
            isWithinScreenRect(
                screenX,
                screenY,
                viewport,
                bounds.minX,
                bounds.minY,
                bounds.maxX,
                bounds.maxY,
            )
        ) {
            return { kind: "body", symbolId: symbol.id };
        }
    }

    return null;
}
