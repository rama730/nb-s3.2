/**
 * Normalize folder drops into a single representation that the task Files
 * tab can hand to the resolver. Two entry points:
 *
 *   - `extractFoldersFromDataTransfer(dataTransfer)` — for Chromium
 *     drag/drop. Uses `DataTransferItem.webkitGetAsEntry()` and walks
 *     directory entries via the `FileSystemDirectoryReader` API.
 *
 *   - `extractFoldersFromWebkitInput(fileList)` — for the keyboard-
 *     triggered `<input type="file" webkitdirectory />` fallback. Groups
 *     files by their top-level `webkitRelativePath` segment.
 *
 * Both return the same `DroppedFolder[] + looseFiles[]` shape so the
 * FilesTab doesn't have to care which path produced the drop.
 *
 * Empty directories are represented as a DroppedFolder with `files: []`,
 * which is useful for the "create subfolder" intent even though we can't
 * create an empty folder via the upload flow alone. The caller decides
 * whether to materialize empty folders as bare `createFolder(...)` calls.
 *
 * ⚠ `webkitGetAsEntry` is vendor-prefixed but implemented by all major
 * browsers (including Firefox and Safari as of 2020+), so it's safe to
 * use without a polyfill for our target platforms. If the browser
 * doesn't expose it, we silently treat everything as loose files.
 */

export type DroppedFolder = {
  /** Top-level folder name as it appeared on the user's disk. */
  name: string;
  /**
   * Every file descendant (recursive). Each entry carries its path
   * relative to `name/`, WITHOUT the leading folder segment. Example:
   * dropped `assets/images/logo.png` under folder `assets` becomes
   * `{ file, relativePath: "images/logo.png" }`.
   */
  files: Array<{ file: File; relativePath: string }>;
};

export type ExtractedDrop = {
  folders: DroppedFolder[];
  /** Files dropped at the top level alongside any folders. */
  looseFiles: File[];
};

// -- Chromium drag/drop ------------------------------------------------------

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => FileSystemDirectoryReaderLike;
};

type FileSystemDirectoryReaderLike = {
  readEntries: (
    cb: (entries: FileSystemEntryLike[]) => void,
    err?: (e: unknown) => void,
  ) => void;
};

async function readAllEntries(
  reader: FileSystemDirectoryReaderLike,
): Promise<FileSystemEntryLike[]> {
  // `readEntries` can return results in batches (~100 per call). Keep
  // invoking until we get an empty array.
  const out: FileSystemEntryLike[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) break;
    out.push(...batch);
  }
  return out;
}

async function readFileFromEntry(entry: FileSystemEntryLike): Promise<File | null> {
  if (!entry.file) return null;
  return new Promise<File | null>((resolve) => {
    entry.file!(
      (f) => resolve(f),
      () => resolve(null),
    );
  });
}

async function walkEntry(
  entry: FileSystemEntryLike,
  relativePrefix: string,
  acc: Array<{ file: File; relativePath: string }>,
): Promise<void> {
  if (entry.isFile) {
    const f = await readFileFromEntry(entry);
    if (f) {
      acc.push({
        file: f,
        relativePath: relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name,
      });
    }
    return;
  }

  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const entries = await readAllEntries(reader);
    const nextPrefix = relativePrefix
      ? `${relativePrefix}/${entry.name}`
      : entry.name;
    // Walk children sequentially — directory readers are stateful and
    // parallelizing them can produce duplicate or missed entries.
    for (const child of entries) {
      await walkEntry(child, nextPrefix, acc);
    }
  }
}

export async function extractFoldersFromDataTransfer(
  dataTransfer: DataTransfer,
): Promise<ExtractedDrop> {
  const folders: DroppedFolder[] = [];
  const looseFiles: File[] = [];

  const items = Array.from(dataTransfer.items ?? []);
  for (const item of items) {
    if (item.kind !== "file") continue;

    // webkitGetAsEntry is where the directory info lives. If the browser
    // doesn't support it we fall back to `getAsFile` (treated as loose).
    const getAsEntry = (item as DataTransferItem & {
      webkitGetAsEntry?: () => FileSystemEntryLike | null;
    }).webkitGetAsEntry;
    const entry = getAsEntry ? getAsEntry.call(item) : null;

    if (!entry) {
      const file = item.getAsFile();
      if (file) looseFiles.push(file);
      continue;
    }

    if (entry.isFile) {
      const file = await readFileFromEntry(entry);
      if (file) looseFiles.push(file);
      continue;
    }

    if (entry.isDirectory) {
      const folder: DroppedFolder = { name: entry.name, files: [] };
      // First-level entries become `${child}` (no folder prefix), so the
      // "folder name" stays separate from the child's relativePath.
      if (entry.createReader) {
        const reader = entry.createReader();
        const children = await readAllEntries(reader);
        for (const child of children) {
          await walkEntry(child, "", folder.files);
        }
      }
      folders.push(folder);
    }
  }

  return { folders, looseFiles };
}

// -- <input type="file" webkitdirectory /> ----------------------------------

export function extractFoldersFromWebkitInput(fileList: FileList | File[]): ExtractedDrop {
  // `webkitRelativePath` looks like `myFolder/sub/file.txt`. The top-level
  // segment is the folder the user picked. Multiple top-level segments
  // can appear if the user selected several folders in succession (not
  // typical) — we handle that case by grouping.
  const byFolder = new Map<string, DroppedFolder>();
  const looseFiles: File[] = [];

  const files = Array.from(fileList);
  for (const file of files) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (!rel) {
      looseFiles.push(file);
      continue;
    }

    const segments = rel.split("/");
    if (segments.length < 2) {
      looseFiles.push(file);
      continue;
    }

    const [folderName, ...rest] = segments;
    const relativePath = rest.join("/");
    if (!folderName || !relativePath) {
      looseFiles.push(file);
      continue;
    }

    let bucket = byFolder.get(folderName);
    if (!bucket) {
      bucket = { name: folderName, files: [] };
      byFolder.set(folderName, bucket);
    }
    bucket.files.push({ file, relativePath });
  }

  return {
    folders: Array.from(byFolder.values()),
    looseFiles,
  };
}

/**
 * Convenience: the direct-child basenames of a dropped folder — what the
 * resolver expects for `candidateChildNames`. Falls back to empty.
 */
export function topLevelChildNames(folder: DroppedFolder): string[] {
  return folder.files
    .filter((entry) => !entry.relativePath.includes("/"))
    .map((entry) => entry.relativePath);
}
