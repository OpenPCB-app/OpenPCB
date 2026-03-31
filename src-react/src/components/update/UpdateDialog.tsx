import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useUpdateStore } from "@/stores/update-store";
import { AlertCircle, Download, Loader2 } from "lucide-react";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function UpdateDialog() {
  const {
    updateAvailable,
    version,
    releaseNotes,
    downloading,
    downloadProgress,
    downloadedBytes,
    totalBytes,
    installing,
    error,
    dismissed,
    downloadAndInstall,
    dismiss,
  } = useUpdateStore();

  const open = updateAvailable && !dismissed;

  if (installing) {
    return (
      <Dialog open>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Installing update...
            </DialogTitle>
            <DialogDescription>
              The app will restart automatically.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update Available</DialogTitle>
          <DialogDescription>
            Version {version} is ready to install.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {releaseNotes && (
          <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/50 p-3 text-sm whitespace-pre-wrap">
            {releaseNotes}
          </div>
        )}

        {downloading && (
          <div className="space-y-2">
            <Progress value={downloadProgress} />
            <p className="text-xs text-muted-foreground text-center">
              {formatBytes(downloadedBytes)} / {formatBytes(totalBytes)} ({downloadProgress}%)
            </p>
          </div>
        )}

        <DialogFooter>
          {!downloading && (
            <>
              <Button variant="outline" onClick={dismiss}>
                Later
              </Button>
              <Button onClick={downloadAndInstall}>
                <Download className="mr-2 h-4 w-4" />
                {error ? "Retry" : "Update Now"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
