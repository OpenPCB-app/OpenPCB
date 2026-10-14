export interface MentionImage {
  src: string;
  alt: string;
  mimeType: string;
  byteSize: number;
}

/** Why a referenced image was not sent to the model. */
export type MentionImageOmission = "unsupported" | "too_large" | "over_limit";

export interface ResolvedMentionContent {
  entityType: string;
  entityId: string;
  displayText: string;
  content: string;
  images: MentionImage[];
  omittedImages?: MentionImageOmission[];
  exists: boolean;
}
