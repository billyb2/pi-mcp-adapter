import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => ({ withFileMutationQueue: undefined }));
import { withFileMutationQueue } from "../file-mutation-queue.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("configuration mutation on hosts without Pi's queue", () => {
  it("preserves concurrent updates through symlink aliases without blocking another file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcp-mutation-"));
    directories.push(directory);
    const config = join(directory, "config.json");
    const alias = join(directory, "alias.json");
    await writeFile(config, "[]");
    await symlink(config, alias);
    const entered = deferred();
    const release = deferred();
    let secondEntered = false;
    const first = withFileMutationQueue(config, async () => {
      const names: string[] = JSON.parse(await readFile(config, "utf8"));
      entered.resolve();
      await release.promise;
      await writeFile(config, JSON.stringify([...names, "first"]));
    });
    await entered.promise;
    const second = withFileMutationQueue(alias, async () => {
      secondEntered = true;
      const names: string[] = JSON.parse(await readFile(alias, "utf8"));
      await writeFile(alias, JSON.stringify([...names, "second"]));
    });
    try {
      await withFileMutationQueue(join(directory, "other.json"), async () => {
        await writeFile(join(directory, "other.json"), "independent");
      });
      expect(secondEntered).toBe(false);
    } finally {
      release.resolve();
      await Promise.all([first, second]);
    }
    expect(JSON.parse(await readFile(config, "utf8"))).toEqual(["first", "second"]);
  });

  it("releases a failed mutation so a queued save can create the missing file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcp-mutation-"));
    directories.push(directory);
    const config = join(directory, "new.json");
    const failure = withFileMutationQueue(config, async () => { throw new Error("save failed"); });
    const rejection = expect(failure).rejects.toThrow("save failed");
    const recovery = withFileMutationQueue(config, async () => {
      await writeFile(config, JSON.stringify({ mcpServers: { recovered: { url: "https://example.com/mcp" } } }));
    });
    await Promise.all([rejection, recovery]);
    expect(JSON.parse(await readFile(config, "utf8"))).toEqual({
      mcpServers: { recovered: { url: "https://example.com/mcp" } },
    });
  });
});
