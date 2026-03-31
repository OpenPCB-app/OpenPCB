import { useHealthCheck } from "@/hooks/useHealthCheck";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ConnectionStatus() {
  const { status, lastChecked, checkNow } = useHealthCheck();

  const getStatusColor = () => {
    switch (status) {
      case "connected":
        return "bg-green-500";
      case "checking":
        return "bg-yellow-500";
      case "disconnected":
        return "bg-destructive";
      default:
        return "bg-muted";
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "connected":
        return "Connected";
      case "checking":
        return "Checking connection...";
      case "disconnected":
        return "Disconnected";
      default:
        return "Unknown";
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => checkNow()}
            aria-label={`Connection status: ${getStatusText()}. Click to refresh.`}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted/50 transition-colors"
          >
            <div className="relative flex h-2.5 w-2.5 items-center justify-center">
              <span
                className={cn(
                  "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                  getStatusColor(),
                )}
              />
              <span
                className={cn(
                  "relative inline-flex h-2 w-2 rounded-full",
                  getStatusColor(),
                )}
              />
            </div>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">
            <p className="font-semibold">{getStatusText()}</p>
            {lastChecked && (
              <p className="text-muted-foreground">
                Last checked: {new Date(lastChecked).toLocaleTimeString()}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
