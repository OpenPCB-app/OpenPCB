import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface ModelLoadingErrorModalProps {
    isOpen: boolean;
    modelName: string;
    error: string;
    onRetry: () => void;
    onCancel: () => void;
}

/**
 * Blocking modal for model loading errors
 * Shows retry option to force preload and auto-retry
 */
export function ModelLoadingErrorModal({
    isOpen,
    modelName,
    error,
    onRetry,
    onCancel,
}: ModelLoadingErrorModalProps) {
    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
            <DialogContent showCloseButton={false} className="max-w-md flex-col">
                <DialogHeader>
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 mb-4">
                        <AlertTriangle className="h-6 w-6 text-destructive" />
                    </div>
                    <DialogTitle className="text-center">Failed to load model</DialogTitle>
                    <DialogDescription className="text-center">
                        Could not load <span className="font-medium">{modelName}</span> into memory.
                    </DialogDescription>
                </DialogHeader>

                <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                    <p className="font-mono text-xs">{error}</p>
                </div>

                <DialogFooter className="sm:justify-center gap-2">
                    <Button variant="outline" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button onClick={onRetry}>
                        Retry
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
