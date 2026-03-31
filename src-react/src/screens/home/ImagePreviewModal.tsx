import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ImagePreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  title?: string;
}

export function ImagePreviewModal({
  open,
  onOpenChange,
  imageUrl,
  title,
}: ImagePreviewModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle>{title || "Image Preview"}</DialogTitle>
        </DialogHeader>
        <div className="p-4 pt-2">
          <img
            src={imageUrl}
            alt={title || "Preview"}
            className="w-full h-auto max-h-[70vh] object-contain rounded-md"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
