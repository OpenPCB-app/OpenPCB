export interface EditorContent {
  /** Editor engine identifier */
  engine: "tiptap";
  /** Content schema version */
  version: number;
  /** Editor-native JSON content */
  data: unknown;
}
