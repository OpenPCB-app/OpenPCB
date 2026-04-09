import type { FileUIPart } from "ai";

export type FileValidationOptions = {
    accept?: string;
    maxSize?: number;
};

export type FileError = {
    code: "max_files" | "max_file_size" | "accept" | "general";
    message: string;
};

/**
 * Validate a file against accept pattern
 */
export function matchesAcceptPattern(file: File, accept?: string): boolean {
    if (!accept || accept.trim() === "") {
        return true;
    }
    if (accept.includes("image/*")) {
        return file.type.startsWith("image/");
    }
    // Add more patterns as needed
    return true;
}

/**
 * Validate a file against size constraint
 */
export function isWithinSizeLimit(file: File, maxSize?: number): boolean {
    if (!maxSize) return true;
    return file.size <= maxSize;
}

/**
 * Validate a file against all constraints
 */
export function validateFile(
    file: File,
    options: FileValidationOptions
): boolean {
    return (
        matchesAcceptPattern(file, options.accept) &&
        isWithinSizeLimit(file, options.maxSize)
    );
}

/**
 * Convert a blob URL to a data URL
 */
export async function convertBlobUrlToDataUrl(url: string): Promise<string> {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Create a FileUIPart preview from a File object
 */
export function createFilePreview(file: File): FileUIPart & { id: string } {
    return {
        id: `${Date.now()}-${Math.random()}`,
        type: "file",
        url: URL.createObjectURL(file),
        mediaType: file.type,
        filename: file.name,
    };
}

/**
 * Validate multiple files and return validation results
 */
export function validateFiles(
    files: File[],
    options: FileValidationOptions & { maxFiles?: number }
): {
    valid: File[];
    errors: FileError[];
} {
    const errors: FileError[] = [];

    // Check accept patterns
    const accepted = files.filter((f) => matchesAcceptPattern(f, options.accept));
    if (files.length > 0 && accepted.length === 0) {
        errors.push({
            code: "accept",
            message: "No files match the accepted types.",
        });
    }

    // Check size limits
    const sized = accepted.filter((f) => isWithinSizeLimit(f, options.maxSize));
    if (accepted.length > 0 && sized.length === 0) {
        errors.push({
            code: "max_file_size",
            message: "All files exceed the maximum size.",
        });
    }

    // Check file count limits
    let valid = sized;
    if (options.maxFiles && sized.length > options.maxFiles) {
        valid = sized.slice(0, options.maxFiles);
        errors.push({
            code: "max_files",
            message: "Too many files. Some were not added.",
        });
    }

    return { valid, errors };
}
