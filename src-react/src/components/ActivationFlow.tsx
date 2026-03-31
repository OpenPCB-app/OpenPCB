import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  activateLicense,
  registerAlpha,
  replaceDevice,
  type DeviceInfo,
  type LicenseStatus,
} from "@/lib/api/auth-api";
import { AlertCircle, Laptop } from "lucide-react";

interface ActivationFlowProps {
  onActivated: (status: LicenseStatus) => void;
  initialLicenseCode?: string | null;
}

export function ActivationFlow({
  onActivated,
  initialLicenseCode,
}: ActivationFlowProps) {
  const [licenseKey, setLicenseKey] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [showReplacementDialog, setShowReplacementDialog] = useState(false);

  const [alphaEmail, setAlphaEmail] = useState("");
  const [alphaLoading, setAlphaLoading] = useState(false);
  const [alphaError, setAlphaError] = useState<string | null>(null);
  const [alphaEnded, setAlphaEnded] = useState(false);

  const handleAlphaRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!alphaEmail.trim()) return;

    setAlphaLoading(true);
    setAlphaError(null);
    setAlphaEnded(false);

    try {
      const response = await registerAlpha(alphaEmail.trim());
      if (response.success && response.data) {
        onActivated({
          state: "active",
          expiresAt: response.data.expiresAt,
          features: ["*"],
        });
      } else if (response.error?.code === "ALPHA_TESTING_ENDED") {
        setAlphaEnded(true);
      } else {
        setAlphaError(
          response.error?.message ?? "Registration failed. Please try again.",
        );
      }
    } catch (err) {
      setAlphaError(
        err instanceof Error ? err.message : "An unexpected error occurred",
      );
    } finally {
      setAlphaLoading(false);
    }
  };

  const handleActivate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!licenseKey.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await activateLicense(licenseKey);
      if (response.success && response.license) {
        onActivated(response.license);
      } else if (response.requiresReplacement && response.devices) {
        setDevices(response.devices);
        setShowReplacementDialog(true);
      } else {
        setError("Activation failed. Please check your license key.");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleReplaceDevice = async (deviceId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await replaceDevice(licenseKey, deviceId);
      if (response.success && response.license) {
        setShowReplacementDialog(false);
        onActivated(response.license);
      } else {
        setError("Device replacement failed.");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] w-full max-w-md mx-auto p-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Activate OpenPCB</CardTitle>
          <CardDescription>
            Enter your license key to unlock full access to OpenPCB.
          </CardDescription>
          {initialLicenseCode && (
            <p className="text-xs text-muted-foreground mt-1">
              Code: {initialLicenseCode}
            </p>
          )}
        </CardHeader>
        <form onSubmit={handleActivate}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Input
                data-testid="license-key-input"
                placeholder="XXXX-XXXX-XXXX-XXXX"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                disabled={isLoading}
                className="font-mono"
              />
            </div>
            {error && (
              <Alert variant="destructive" data-testid="activation-error">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter>
            <Button
              data-testid="activate-button"
              type="submit"
              className="w-full"
              disabled={isLoading || !licenseKey.trim()}
            >
              {isLoading ? "Activating..." : "Activate License"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card className="w-full mt-4">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="flex-1 border-t border-border" />
          </div>
          <CardTitle className="text-base">Join Alpha Testing</CardTitle>
          <CardDescription>
            Get free alpha access by signing up with your email.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleAlphaRegister}>
          <CardContent className="space-y-4">
            <Input
              data-testid="alpha-email-input"
              type="email"
              placeholder="you@example.com"
              value={alphaEmail}
              onChange={(e) => setAlphaEmail(e.target.value)}
              disabled={alphaLoading}
            />
            {alphaEnded && (
              <Alert data-testid="alpha-ended-message">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Alpha Testing Ended</AlertTitle>
                <AlertDescription>
                  Alpha testing is no longer available. Please use a license key
                  to activate OpenPCB.
                </AlertDescription>
              </Alert>
            )}
            {alphaError && (
              <Alert variant="destructive" data-testid="alpha-error">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{alphaError}</AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter>
            <Button
              data-testid="alpha-register-button"
              type="submit"
              variant="outline"
              className="w-full"
              disabled={alphaLoading || !alphaEmail.trim()}
            >
              {alphaLoading ? "Registering..." : "Join Alpha Testing"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Dialog
        open={showReplacementDialog}
        onOpenChange={setShowReplacementDialog}
      >
        <DialogContent data-testid="replacement-dialog">
          <DialogHeader>
            <DialogTitle>Device Limit Reached</DialogTitle>
            <DialogDescription>
              Your license has reached its device limit. Select a device to
              replace with this one.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {devices.map((device) => (
              <div
                key={device.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Laptop className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{device.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Last active:{" "}
                      {new Date(device.lastActive).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <Button
                  data-testid={`replace-device-${device.id}`}
                  variant="outline"
                  size="sm"
                  onClick={() => handleReplaceDevice(device.id)}
                  disabled={isLoading}
                >
                  Replace
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              data-testid="cancel-replacement"
              variant="ghost"
              onClick={() => setShowReplacementDialog(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
