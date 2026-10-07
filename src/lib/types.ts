export type MediaKind = "photo" | "video";

/** A file we can read lazily, wherever it lives (disk, picked folder, zip entry). */
export interface SourceFile {
  /** Path relative to the imported root, using "/" separators. */
  path: string;
  name: string;
  size: number;
  lastModified: number;
  getBlob(): Promise<Blob>;
}

export type DateSource = "json" | "filename" | "exif" | "file";

export interface Memory {
  /** Stable id: Snapchat media id when we have it, otherwise a hash of name + size. */
  id: string;
  kind: MediaKind;
  /** Capture time, ms since epoch. */
  date: number;
  dateSource: DateSource;
  main: SourceFile;
  /** Caption / stickers / drawings layer exported separately by Snapchat. */
  overlay?: SourceFile;
  location?: { lat: number; lon: number };
  /** Cache key for thumbnails (survives re-imports). */
  key: string;
}

export interface MonthGroup {
  /** e.g. 2023 * 12 + 9 */
  key: number;
  year: number;
  month: number;
  items: Memory[];
}
