import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type UnlistenFn } from "@tauri-apps/api/event";
import { cn } from "@/lib/utils";
import { ConnectionStatus } from "@/components/health/ConnectionStatus";

const RAIL_WIDTH_PX = 48;
const DEFAULT_INSET_PX = 8;
const MAC_TRAFFIC_LIGHT_INSET_PX = 72;
type DragRegionStyle = CSSProperties & { WebkitAppRegion?: string };
const dragRegionStyle: DragRegionStyle = { WebkitAppRegion: "drag" };

function isTauriEnvironment() {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

function detectMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const hint = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent;
  return typeof hint === "string" && /mac/i.test(hint);
}

export default function TopBar() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const windowRef = useMemo(
    () => (isTauriEnvironment() ? getCurrentWindow() : undefined),
    [],
  );
  const isLikelyMac = useMemo(() => detectMacPlatform(), []);

  useEffect(() => {
    if (!windowRef) return;

    let mounted = true;
    let unlistenResize: UnlistenFn | undefined;

    const refreshFullscreen = async () => {
      try {
        const fs = await windowRef.isFullscreen();
        if (mounted) setIsFullscreen(fs);
      } catch {
        /* ignore */
      }
    };

    (async () => {
      await refreshFullscreen();
      try {
        unlistenResize = await windowRef.onResized(refreshFullscreen);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      mounted = false;
      unlistenResize?.();
    };
  }, [windowRef]);

  if (windowRef && isFullscreen) return null;

  const leftPad = isLikelyMac
    ? MAC_TRAFFIC_LIGHT_INSET_PX
    : RAIL_WIDTH_PX + DEFAULT_INSET_PX;

  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex h-10 w-full items-center bg-surface",
      )}
      data-tauri-drag-region
      style={{
        ...dragRegionStyle,
        paddingLeft: `${leftPad}px`,
        paddingRight: `${DEFAULT_INSET_PX}px`,
      }}
    >
      <div
        className="flex w-full items-center justify-between"
        data-tauri-drag-region
        style={dragRegionStyle}
      >
        <span
          className="text-xs font-medium text-muted-foreground select-none"
          data-tauri-drag-region
          style={dragRegionStyle}
        >
          OpenPCB
        </span>
        <div className="flex-none" data-tauri-drag-region>
          <ConnectionStatus />
        </div>
      </div>
    </header>
  );
}
