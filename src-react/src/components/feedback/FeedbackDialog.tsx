"use client";

import * as React from "react";
import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

import { X, ImageIcon, Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  submitFeedback,
  fetchBackendLogs,
  getSystemContext,
  APP_VERSION,
  type FeedbackData,
} from "@/lib/api/feedback-api";
import { getRecentLogs, formatLogsForTransmission } from "@/lib/logging/log-buffer";
import { useBackendURL } from "@/contexts/BackendURLContext";
import { useAppStore } from "@/stores/app-store";
import { useNavigationStore } from "@/stores/navigation-store";
import { useToast } from "@/components/ui/use-toast";

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PastedImage {
  id: string;
  file: File;
  preview: string;
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const [email, setEmail] = useState("");
  const [feedbackType, setFeedbackType] = useState<"idea" | "bug" | "critique" | "other">("idea");
  const [message, setMessage] = useState("");
  const [images, setImages] = useState<PastedImage[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { backendURL, isReady } = useBackendURL();
  const { activeWorkspaceId } = useAppStore();
  const { currentScreen } = useNavigationStore();
  const { toast } = useToast();

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setEmail("");
      setFeedbackType("idea");
      setMessage("");
      setImages([]);
      setSubmitStatus("idle");
      setErrorMessage(null);
    }
  }, [open]);

  // Handle paste event for screenshots
  const handlePaste = useCallback((event: React.ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      
      if (item.type.startsWith("image/")) {
        event.preventDefault();
        const file = item.getAsFile();
        if (file) {
          addImage(file);
        }
      }
    }
  }, []);

  // Add image to the list
  const addImage = (file: File) => {
    // Validate file type
    if (!file.type.startsWith("image/")) {
      setErrorMessage("Only image files are allowed");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage("Image size must be less than 5MB");
      return;
    }

    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const preview = URL.createObjectURL(file);
    
    setImages(prev => [...prev, { id, file, preview }]);
    setErrorMessage(null);
  };

  // Handle file input change
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      Array.from(files).forEach(addImage);
    }
    // Reset input so same file can be selected again
    event.target.value = "";
  };

  // Remove image from the list
  const removeImage = (id: string) => {
    setImages(prev => {
      const image = prev.find(img => img.id === id);
      if (image) {
        URL.revokeObjectURL(image.preview);
      }
      return prev.filter(img => img.id !== id);
    });
  };

  // Handle form submission
  const handleSubmit = async () => {
    // Validate email if provided
    if (email && !isValidEmail(email)) {
      setErrorMessage("Please enter a valid email address");
      return;
    }

    // Validate message
    if (!message.trim()) {
      setErrorMessage("Please enter your feedback message");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSubmitStatus("idle");

    try {
      // Collect frontend logs (last 5 minutes)
      const frontendLogsEntries = getRecentLogs(5);
      const frontendLogs = formatLogsForTransmission(frontendLogsEntries);

      // Collect backend logs if backend is ready
      let backendLogs = "";
      if (isReady && backendURL) {
        try {
          console.log("[Feedback] Fetching backend logs from:", backendURL);
          const backendLogsResponse = await fetchBackendLogs(backendURL, 5);
          console.log(
            "[Feedback] Backend logs response:",
            backendLogsResponse.count,
            "entries"
          );

          if (backendLogsResponse.logs.length > 0) {
            backendLogs = backendLogsResponse.logs
              .map(
                (entry) =>
                  `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`
              )
              .join("\n");
            console.log(
              "[Feedback] Backend logs collected:",
              backendLogs.length,
              "chars"
            );
          } else {
            console.warn("[Feedback] No backend logs available");
          }
        } catch (logError) {
          console.error("[Feedback] Failed to fetch backend logs:", logError);
        }
      } else {
        console.warn(
          "[Feedback] Backend not ready, skipping backend logs. isReady:",
          isReady,
          "backendURL:",
          backendURL
        );
      }

      // Collect system context
      const systemContext = {
        ...getSystemContext(),
        activeWorkspaceId: activeWorkspaceId || undefined,
        currentScreen,
      };

      const feedbackData: FeedbackData = {
        email: email || undefined,
        type: feedbackType,
        message: message.trim(),
        images: images.map((img) => img.file),
        timestamp: new Date().toISOString(),
        appVersion: APP_VERSION,
        userAgent: navigator.userAgent,
        frontendLogs: frontendLogs.slice(-50000), // Limit to last 50KB
        backendLogs: backendLogs.slice(-50000), // Limit to last 50KB
        systemContext,
      };

      await submitFeedback(feedbackData);

      setSubmitStatus("success");

      toast({
        title: "Feedback sent!",
        description: "Thank you for helping us improve OpenPCB.",
      });

      // Close dialog after success (with delay for user to see success state)
      setTimeout(() => {
        onOpenChange(false);
      }, 1500);
    } catch (error) {
      setSubmitStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to submit feedback"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Email validation helper
  const isValidEmail = (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  // Cleanup object URLs on unmount
  React.useEffect(() => {
    return () => {
      images.forEach(img => URL.revokeObjectURL(img.preview));
    };
  }, []);

  const feedbackTypes = [
    { value: "idea", label: "💡 Idea", description: "Suggest a new feature or improvement" },
    { value: "bug", label: "🐛 Bug Report", description: "Report something that's not working" },
    { value: "critique", label: "💭 Critique", description: "Share your thoughts on the design or UX" },
    { value: "other", label: "✏️ Other", description: "Anything else you'd like to share" },
  ] as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-surface text-foreground border-border max-w-2xl max-h-[90vh] p-0 gap-0"
        onPointerDownOutside={(e) => {
          if (isSubmitting) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
          <DialogTitle className="text-xl font-semibold">Send Feedback</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Help us improve OpenPCB by sharing your ideas, reporting bugs, or providing feedback.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-6">
            {/* Feedback Type Selection */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">What kind of feedback is this?</Label>
              <div className="grid grid-cols-2 gap-3">
                {feedbackTypes.map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setFeedbackType(type.value)}
                    className={cn(
                      "flex flex-col items-start p-3 rounded-lg border text-left transition-all",
                      feedbackType === type.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background hover:border-primary/50 hover:bg-surface-muted"
                    )}
                  >
                    <span className="font-medium text-sm">{type.label}</span>
                    <span className="text-xs text-muted-foreground mt-1">
                      {type.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Email Field */}
            <div className="space-y-2">
              <Label htmlFor="feedback-email" className="text-sm font-medium">
                Email <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="feedback-email"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-background"
                disabled={isSubmitting}
              />
              <p className="text-xs text-muted-foreground">
                Provide your email if you'd like us to follow up with you.
              </p>
            </div>

            {/* Message Field */}
            <div className="space-y-2">
              <Label htmlFor="feedback-message" className="text-sm font-medium">
                Your Feedback
              </Label>
              <Textarea
                ref={textareaRef}
                id="feedback-message"
                placeholder="Describe your idea, bug, or feedback in detail..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onPaste={handlePaste}
                className="bg-background min-h-[120px] resize-y"
                disabled={isSubmitting}
              />
              <p className="text-xs text-muted-foreground">
                Tip: You can paste screenshots directly into this field (Ctrl+V / Cmd+V)
              </p>
            </div>

            {/* Image Attachments */}
            {images.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Attached Screenshots ({images.length})</Label>
                <div className="grid grid-cols-3 gap-3">
                  {images.map((image) => (
                    <div
                      key={image.id}
                      className="relative group aspect-square rounded-lg border border-border overflow-hidden bg-background"
                    >
                      <img
                        src={image.preview}
                        alt="Screenshot"
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(image.id)}
                        disabled={isSubmitting}
                        className="absolute top-1 right-1 p-1 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-black/50 text-white text-xs truncate">
                        {image.file.name}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error Message */}
            {errorMessage && (
              <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                {errorMessage}
              </div>
            )}

            {/* Success Message */}
            {submitStatus === "success" && (
              <div className="p-3 rounded-md bg-green-500/10 text-green-600 text-sm">
                ✅ Thank you! Your feedback has been submitted successfully.
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border gap-2 shrink-0 bg-surface">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />
          
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSubmitting}
            className="gap-2"
          >
            <ImageIcon className="h-4 w-4" />
            Add Screenshot
          </Button>
          
          <div className="flex-1" />
          
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !message.trim()}
            className="gap-2 min-w-[120px]"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Send Feedback
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
