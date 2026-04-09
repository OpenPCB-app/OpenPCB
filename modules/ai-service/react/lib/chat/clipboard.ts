/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<void> {
    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
        throw new Error("Clipboard API not available");
    }

    await navigator.clipboard.writeText(text);
}

/**
 * Extract files from clipboard data transfer items
 */
export function extractFilesFromClipboard(
    items: DataTransferItemList
): File[] {
    const files: File[] = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;

        // Handle file items (including images copied as files or from filesystem)
        if (item.kind === "file") {
            const file = item.getAsFile();
            if (file) {
                files.push(file);
            }
        }
        // Handle image data from clipboard (e.g., screenshots, copied images from browser)
        else if (item.type.startsWith("image/")) {
            const blob = item.getAsFile();
            if (blob) {
                // Determine file extension from MIME type
                const extension = blob.type.split("/")[1] || "png";
                // Create a File object from the blob with a proper name
                const file = new File(
                    [blob],
                    `pasted-image-${Date.now()}.${extension}`,
                    { type: blob.type }
                );
                files.push(file);
            }
        }
    }

    return files;
}
