/**
 * Room file attachments: what a member may put on the table, and where it lives.
 *
 * Non-threatening files only. This is a strict ALLOWLIST by extension, so
 * anything not named here (every executable, script, archive, or active-content
 * type) is rejected by default. The stored MIME is derived from the extension,
 * never trusted from the client. Files live in the private app-digital-assets
 * bucket under a per-room prefix and are only ever served as short-lived signed
 * URLs.
 *
 * This module is pure (no storage import) so the allowlist is unit-testable; the
 * upload/sign I/O lives in the route via lib/app/storage.
 */

// extension -> canonical mime. Images and common documents only. Deliberately
// excludes: exe/bat/cmd/sh/ps1/com/msi/scr/vbs/js/mjs/jar/app/dll (executables),
// html/htm/svg/xml (active content), and zip/rar/7z/tar/gz (archives that can
// smuggle the above).
const ALLOWED: Record<string, string> = {
  // images
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  // documents
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
};

export const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB

export type FileCheck =
  | { ok: true; mime: string; object_type: 'image' | 'file'; safeName: string }
  | { ok: false; error: string };

/** Strip any path, keep a readable basename, cap the length. */
function sanitizeName(name: string): string {
  const base = name.replace(/[\\/]/g, ' ').replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, ' ');
  const trimmed = base.slice(-120) || 'file';
  return trimmed;
}

/**
 * Validate a proposed attachment by name + size. Returns the canonical mime
 * (derived from the extension) and whether it renders as an image.
 */
export function checkFile(filename: string, size: number): FileCheck {
  if (!filename) return { ok: false, error: 'file has no name' };
  if (size <= 0) return { ok: false, error: 'file is empty' };
  if (size > MAX_FILE_BYTES) return { ok: false, error: 'file is larger than 15 MB' };
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const mime = ALLOWED[ext];
  if (!mime) return { ok: false, error: 'that file type is not allowed here. Images and documents only, no programs.' };
  return {
    ok: true,
    mime,
    object_type: mime.startsWith('image/') ? 'image' : 'file',
    safeName: sanitizeName(filename),
  };
}

/** Private storage path for a room attachment. */
export function backroomFilePath(roomId: string, id: string, safeName: string): string {
  return `backroom/${roomId}/${id}-${safeName}`;
}
