import * as React from "react";
import { Copy, Check, ExternalLink, Loader2, Clock } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { completeGitHubOAuth } from "@/lib/api/oauth-api";

interface DeviceCodeModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    interval: number;
    expiresIn: number;
    onSuccess: () => void;
    onError: (error: string) => void;
}

export function DeviceCodeModal({
    open,
    onOpenChange,
    deviceCode,
    userCode,
    verificationUri,
    interval,
    expiresIn,
    onSuccess,
    onError,
}: DeviceCodeModalProps) {
    const { toast } = useToast();
    const [copied, setCopied] = React.useState(false);
    const [isPolling, setIsPolling] = React.useState(false);
    const [timeLeft, setTimeLeft] = React.useState(expiresIn);
    const pollIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
    const countdownRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

    const clearIntervals = () => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
        }
        if (countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
        }
    };

    const handleCopyCode = async () => {
        try {
            await navigator.clipboard.writeText(userCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toast({
                title: "Failed to copy",
                description: "Please copy the code manually.",
            });
        }
    };

    const handleOpenVerificationUrl = async () => {
        try {
            await openUrl(verificationUri);
        } catch {
            window.open(verificationUri, "_blank");
        }
    };

    const startPolling = () => {
        setIsPolling(true);

        countdownRef.current = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    clearIntervals();
                    setIsPolling(false);
                    onError("Device code expired. Please try again.");
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        pollIntervalRef.current = setInterval(async () => {
            try {
                const result = await completeGitHubOAuth({
                    deviceCode,
                    interval,
                });

                if (result.success) {
                    clearIntervals();
                    setIsPolling(false);
                    onOpenChange(false);
                    toast({
                        title: "Authentication successful",
                        description: "GitHub Copilot is now connected.",
                    });
                    onSuccess();
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "";
                if (!errorMessage.toLowerCase().includes("authorization pending")) {
                    clearIntervals();
                    setIsPolling(false);
                    onOpenChange(false);
                    onError(errorMessage || "Authentication failed");
                }
            }
        }, interval * 1000);
    };

    const handleCancel = () => {
        clearIntervals();
        setIsPolling(false);
        onOpenChange(false);
    };

    React.useEffect(() => {
        if (open && !isPolling) {
            startPolling();
        }
        return () => {
            clearIntervals();
        };
    }, [open]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    return (
        <Dialog open={open} onOpenChange={handleCancel}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Connect GitHub Copilot</DialogTitle>
                    <DialogDescription>
                        Enter the code below on GitHub to authorize OpenPCB.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Your Code</span>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                Expires in {formatTime(timeLeft)}
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <code className="flex-1 rounded-md bg-muted px-3 py-2 text-center text-2xl font-mono font-bold tracking-wider">
                                {userCode}
                            </code>
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={handleCopyCode}
                                className="shrink-0"
                            >
                                {copied ? (
                                    <Check className="h-4 w-4 text-green-500" />
                                ) : (
                                    <Copy className="h-4 w-4" />
                                )}
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <span className="text-sm font-medium">Verification URL</span>
                        <Button
                            variant="outline"
                            className="w-full justify-between"
                            onClick={handleOpenVerificationUrl}
                        >
                            <span className="truncate">{verificationUri}</span>
                            <ExternalLink className="ml-2 h-4 w-4 shrink-0" />
                        </Button>
                    </div>

                    <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                        <ol className="list-decimal list-inside space-y-1">
                            <li>Click the verification URL above</li>
                            <li>Enter the code: <strong>{userCode}</strong></li>
                            <li>Click Authorize on GitHub</li>
                            <li>Return to this window</li>
                        </ol>
                    </div>

                    {isPolling && (
                        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Waiting for authorization...
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleCancel}>
                        Cancel
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
