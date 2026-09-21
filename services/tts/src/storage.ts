import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Audio blob storage (PLAN.md §4.5 `story_audio.object_key`). Production
 * needs real object storage (S3/R2/GCS); `LocalFileAudioStorage` is an
 * honest placeholder for local development — real, working file I/O
 * (unlike the NRHP placeholder dataset, this isn't standing in for
 * something unreachable, just for infrastructure this milestone doesn't
 * provision) that a real bucket-backed implementation can drop in for
 * behind the same interface with zero calling-code changes.
 */
export interface AudioStorage {
  /** Stores audio bytes under `key` and returns the URL path it can be served from. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<{ url: string }>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}

export class LocalFileAudioStorage implements AudioStorage {
  constructor(
    private readonly directory: string,
    /** The URL prefix `apps/api` serves this directory under — see its static-file route. */
    private readonly urlPrefix = "/audio",
  ) {}

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<{ url: string }> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, key), bytes);
    await writeFile(join(this.directory, `${key}.contenttype`), contentType, "utf8");
    return { url: `${this.urlPrefix}/${key}` };
  }

  async get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    try {
      const bytes = await readFile(join(this.directory, key));
      const contentType = await readFile(join(this.directory, `${key}.contenttype`), "utf8").catch(
        () => "application/octet-stream",
      );
      return { bytes: new Uint8Array(bytes), contentType };
    } catch {
      return null; // missing file — never distinguished from a corrupted one, both are just "not found"
    }
  }
}
