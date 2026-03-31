import * as React from "react";
import { Loader2, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
    startOAuthFlow,
    type OAuthProvider,
    type GitHubStartResponse,
    type CodexStartResponse,
} from "@/lib/api/oauth-api";

import { DeviceCodeModal } from "./DeviceCodeModal";

interface OAuthButtonProps {
    provider: OAuthProvider;
    onSuccess: () => void;
    onError: (error: string) => void;
    className?: string;
}

export function OAuthButton({
    provider,
    onSuccess,
    onError,
    className,
}: OAuthButtonProps) {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = React.useState(false);
    const [deviceCodeData, setDeviceCodeData] = React.useState<GitHubStartResponse | null>(null);
    const [isModalOpen, setIsModalOpen] = React.useState(false);

    const handleStartOAuth = async () => {
        setIsLoading(true);
        try {
            const response = await startOAuthFlow(provider);

            if (!response.success) {
                throw new Error(response.error || "Failed to start OAuth flow");
            }

            if (provider === "github-copilot") {
                const githubResponse = response as GitHubStartResponse;
                setDeviceCodeData(githubResponse);
                setIsModalOpen(true);
            } else if (provider === "codex") {
                const codexResponse = response as CodexStartResponse;
                // Open auth URL in browser
                try {
                    await openUrl(codexResponse.url);
                } catch {
                    // Fallback to window.open if Tauri open fails
                    window.open(codexResponse.url, "_blank");
                }
                toast({
                    title: "Browser opened",
                    description: "Complete authentication in your browser and return to the app.",
                });
                // For Codex, we would typically wait for a callback
                // This is a simplified flow - in production, you'd handle the callback
                onSuccess();
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            toast({
                title: "OAuth failed",
                description: errorMessage,
            });
            onError(errorMessage);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeviceCodeSuccess = () => {
        setIsModalOpen(false);
        setDeviceCodeData(null);
        onSuccess();
    };

    const handleDeviceCodeError = (error: string) => {
        setIsModalOpen(false);
        setDeviceCodeData(null);
        onError(error);
    };

    const providerLabel = provider === "github-copilot" ? "GitHub Copilot" : "Codex";

    return (
        <>
            <Button
                onClick={handleStartOAuth}
                disabled={isLoading}
                className={className}
                variant="outline"
            >
                {isLoading ? (
                    <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Connecting...
                    </>
                ) : (
                    <>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Connect {providerLabel}
                    </>
                )}
            </Button>

            {deviceCodeData && (
                <DeviceCodeModal
                    open={isModalOpen}
                    onOpenChange={setIsModalOpen}
                    deviceCode={deviceCodeData.deviceCode}
                    userCode={deviceCodeData.userCode}
                    verificationUri={deviceCodeData.verificationUri}
                    interval={deviceCodeData.interval}
                    expiresIn={deviceCodeData.expiresIn}
                    onSuccess={handleDeviceCodeSuccess}
                    onError={handleDeviceCodeError}
                />
            )}
        </>
    );
}
