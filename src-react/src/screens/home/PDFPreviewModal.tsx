import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PDFPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pdfUrl: string;
  title?: string;
}

export function PDFPreviewModal({
  open,
  onOpenChange,
  pdfUrl,
  title,
}: PDFPreviewModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle>{title || "PDF Preview"}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 p-4 pt-2 h-full">
          <iframe
            src={pdfUrl}
            title={title || "PDF Preview"}
            className="w-full h-full rounded-md border"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
