import * as host from "@earendil-works/pi-coding-agent";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

const queues = new Map<string, Promise<void>>();
let registrationQueue = Promise.resolve();

async function mutationKey(filePath: string): Promise<string> {
  const resolved = resolve(filePath);
  try {
    return await realpath(resolved);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error
      && (error.code === "ENOENT" || error.code === "ENOTDIR")) return resolved;
    throw error;
  }
}

/** Share Pi's queue when available; older hosts retain same-file serialization. */
export async function withFileMutationQueue<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  if (typeof host.withFileMutationQueue === "function") {
    return host.withFileMutationQueue(filePath, fn);
  }

  // Serialize registration as well as writes so asynchronous realpath resolution
  // cannot reorder mutations submitted for the same file or its symlink aliases.
  const registration = registrationQueue.then(async () => {
    const key = await mutationKey(filePath);
    const previous = queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolveNext) => { release = resolveNext; });
    const tail = previous.then(() => next);
    queues.set(key, tail);
    return { key, previous, tail, release };
  });
  registrationQueue = registration.then(() => undefined, () => undefined);
  const { key, previous, tail, release } = await registration;
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (queues.get(key) === tail) queues.delete(key);
  }
}
