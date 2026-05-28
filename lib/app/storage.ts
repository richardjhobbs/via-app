import { unstable_cache } from 'next/cache';
import { db } from './db';

const BUCKET = 'rrg-submissions';

// ── Upload a file to Supabase private storage ─────────────────────────

export async function uploadSubmissionFile(
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType,
      upsert: false,
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return path;
}

// ── Generate a signed URL (24-hour default) ────────────────────────────

export async function getSignedUrl(
  path: string,
  expiresInSeconds = 86400
): Promise<string> {
  const { data, error } = await db.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to generate signed URL: ${error?.message}`);
  }
  return data.signedUrl;
}

// ── Batch signed URLs with caching (for gallery pages) ────────────────
// Generates signed URLs for multiple paths in a single Supabase call,
// cached for 30 minutes. Returns a Map of path → signedUrl.

export async function getSignedUrlsBatch(paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();

  const cacheKey = paths.slice().sort().join('|');

  const fetch = unstable_cache(
    async () => {
      const { data, error } = await db.storage
        .from(BUCKET)
        .createSignedUrls(paths, 3600); // 1-hour URLs, cached for 30min
      if (error || !data) return [] as { path: string; signedUrl: string }[];
      return data
        .filter(d => !!d.signedUrl && !!d.path)
        .map(d => ({ path: d.path as string, signedUrl: d.signedUrl as string }));
    },
    [`signed-urls-batch-${cacheKey}`],
    { revalidate: 1800, tags: ['signed-urls'] }, // 30-min cache
  );

  const entries = await fetch();
  return new Map(entries.map(e => [e.path, e.signedUrl]));
}

// ── Download a file as a Buffer ────────────────────────────────────────

export async function downloadFile(path: string): Promise<Buffer> {
  const { data, error } = await db.storage
    .from(BUCKET)
    .download(path);

  if (error || !data) throw new Error(`Download failed: ${error?.message}`);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ── Delete a file from storage ────────────────────────────────────────

export async function deleteFile(path: string): Promise<void> {
  const { error } = await db.storage
    .from(BUCKET)
    .remove([path]);

  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}

// ── Build storage paths ────────────────────────────────────────────────

export function jpegStoragePath(submissionId: string, filename: string): string {
  return `submissions/${submissionId}/jpeg/${filename}`;
}

export function additionalFilesPath(submissionId: string): string {
  return `submissions/${submissionId}/additional/`;
}

export function additionalFileStoragePath(submissionId: string, filename: string): string {
  return `submissions/${submissionId}/additional/${filename}`;
}

export function physicalImageStoragePath(submissionId: string, index: number, filename: string): string {
  return `submissions/${submissionId}/physical/${index}-${filename}`;
}
