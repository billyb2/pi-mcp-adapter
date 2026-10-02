import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Pi agent dir paths", () => {
  const originalHome = process.env.HOME;
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const originalOAuthDir = process.env.MCP_OAUTH_DIR;
  const originalPackageDir = process.env.PI_PACKAGE_DIR;
  const originalArcAgentDir = process.env.ARC_CODING_AGENT_DIR;
  const originalExecPath = process.execPath;
  const originalOmpAgentDir = process.env.OMP_CODING_AGENT_DIR;
  const ompHomes: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    delete process.env.PI_PACKAGE_DIR;
  });

  afterEach(() => {
    process.execPath = originalExecPath;
    if (originalOmpAgentDir === undefined) {
      delete process.env.OMP_CODING_AGENT_DIR;
    } else {
      process.env.OMP_CODING_AGENT_DIR = originalOmpAgentDir;
    }
    for (const home of ompHomes) rmSync(home, { recursive: true, force: true });
    ompHomes.length = 0;
    process.env.HOME = originalHome;
    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
    if (originalOAuthDir === undefined) {
      delete process.env.MCP_OAUTH_DIR;
    } else {
      process.env.MCP_OAUTH_DIR = originalOAuthDir;
    }
    if (originalPackageDir === undefined) {
      delete process.env.PI_PACKAGE_DIR;
    } else {
      process.env.PI_PACKAGE_DIR = originalPackageDir;
    }
    if (originalArcAgentDir === undefined) {
      delete process.env.ARC_CODING_AGENT_DIR;
    } else {
      process.env.ARC_CODING_AGENT_DIR = originalArcAgentDir;
    }
  });

  it("uses PI_CODING_AGENT_DIR for Pi-owned config and state files", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-mcp-agent-dir-home-"));
    const agentDir = mkdtempSync(join(tmpdir(), "pi-mcp-agent-dir-"));
    process.env.HOME = home;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    delete process.env.MCP_OAUTH_DIR;

    const { getAgentDir } = await import("../agent-dir.ts");
    const { getPiGlobalConfigPath } = await import("../config.ts");
    const { getMetadataCachePath } = await import("../metadata-cache.ts");
    const { getOnboardingStatePath } = await import("../onboarding-state.ts");
    const { getAuthEntryFilePath, saveAuthEntry } = await import("../mcp-auth.ts");

    expect(getAgentDir()).toBe(agentDir);
    expect(getPiGlobalConfigPath()).toBe(join(agentDir, "mcp-adapter.json"));
    expect(getMetadataCachePath()).toBe(join(agentDir, "mcp-cache.json"));
    expect(getOnboardingStatePath()).toBe(join(agentDir, "mcp-onboarding.json"));

    saveAuthEntry("demo", { tokens: { accessToken: "token" } }, "https://example.com/mcp");
    expect(existsSync(getAuthEntryFilePath("demo"))).toBe(false);
    expect(getAuthEntryFilePath("demo").startsWith(join(agentDir, "mcp-oauth"))).toBe(true);
    expect(existsSync(join(agentDir, "mcp-oauth", "demo", "tokens.json"))).toBe(false);
    expect(existsSync(join(home, ".pi", "agent", "mcp-oauth", "demo", "tokens.json"))).toBe(false);
  });

  it("expands tilde in PI_CODING_AGENT_DIR", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-mcp-agent-dir-home-"));
    process.env.HOME = home;
    process.env.PI_CODING_AGENT_DIR = "~/custom-pi-agent";

    const { getAgentDir } = await import("../agent-dir.ts");

    expect(getAgentDir()).toBe(join(home, "custom-pi-agent"));
  });

  it("uses the branded host environment key and config directory", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-mcp-agent-dir-home-"));
    const packageDir = mkdtempSync(join(tmpdir(), "pi-mcp-package-dir-"));
    const agentDir = mkdtempSync(join(tmpdir(), "pi-mcp-agent-dir-"));
    process.env.HOME = home;
    writeFileSync(join(packageDir, "package.json"), JSON.stringify({ piConfig: { name: "arc", configDir: ".arc" } }));
    process.execPath = join(home, "omp");
    process.env.PI_PACKAGE_DIR = packageDir;

    const { getAgentDir } = await import("../agent-dir.ts");

    expect(getAgentDir()).toBe(join(home, ".arc", "agent"));

    process.env.ARC_CODING_AGENT_DIR = agentDir;
    expect(getAgentDir()).toBe(agentDir);

    process.env.ARC_CODING_AGENT_DIR = "~/custom-agent";
    expect(getAgentDir()).toBe(join(home, "custom-agent"));

    process.env.ARC_CODING_AGENT_DIR = "relative-agent";
    expect(getAgentDir()).toBe(join(process.cwd(), "relative-agent"));
  });

  it("loads OMP configuration rather than unrelated Pi configuration in compiled OMP", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-mcp-omp-dir-"));
    ompHomes.push(home);
    process.env.HOME = home;
    process.execPath = join(home, "omp");
    delete process.env.PI_CODING_AGENT_DIR;
    delete process.env.OMP_CODING_AGENT_DIR;
    for (const [directory, server] of [[".omp", "omp_private"], [".pi", "pi_private"]]) {
      const agentDir = join(home, directory, "agent");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, "mcp-adapter.json"), JSON.stringify({
        imports: [],
        settings: { hostConfigDiscovery: "off" },
        mcpServers: { [server]: { command: "node" } },
      }));
    }

    // Import after choosing the executable to exercise module-load-time host detection.
    const { loadMcpConfig } = await import("../config.ts");
    expect(Object.keys(loadMcpConfig(undefined, home).mcpServers)).toEqual(["omp_private"]);
  });

  it("keeps OMP's PI_CODING_AGENT_DIR override authoritative for configuration", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-mcp-omp-dir-"));
    ompHomes.push(home);
    process.env.HOME = home;
    process.execPath = join(home, "omp");
    delete process.env.OMP_CODING_AGENT_DIR;
    const agentDir = join(home, "isolated-agent");
    process.env.PI_CODING_AGENT_DIR = agentDir;
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "mcp-adapter.json"), JSON.stringify({
      imports: [],
      settings: { hostConfigDiscovery: "off" },
      mcpServers: { isolated_private: { command: "node" } },
    }));

    // Import after choosing the executable to exercise module-load-time host detection.
    const { loadMcpConfig } = await import("../config.ts");
    expect(Object.keys(loadMcpConfig(undefined, home).mcpServers)).toEqual(["isolated_private"]);
  });

  it.each([false, true])("keeps OMP native configuration host-owned when Pi MCP support is %s", async (supportsPiMcp) => {
    const home = mkdtempSync(join(tmpdir(), "pi-mcp-omp-native-"));
    ompHomes.push(home);
    process.env.HOME = home;
    process.execPath = join(home, "omp");
    delete process.env.PI_CODING_AGENT_DIR;
    delete process.env.OMP_CODING_AGENT_DIR;
    const agentDir = join(home, ".omp", "agent");
    const projectDir = join(home, "project", ".omp");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({
      mcpServers: { native_only: { command: "native" } },
      disabledServers: ["native_only"],
    }));
    writeFileSync(join(projectDir, "mcp.json"), JSON.stringify({
      mcpServers: { project_native: { command: "native-project" } },
    }));
    writeFileSync(join(agentDir, "mcp-adapter.json"), JSON.stringify({
      imports: [],
      mcpServers: { adapter_only: { command: "adapter" } },
    }));

    // Import after choosing the host to exercise its module-load-time ownership boundary.
    const { getLegacyMcpMigrationNotices, loadMcpConfig, setPiMcpConfigEnabled } = await import("../config.ts");
    setPiMcpConfigEnabled(supportsPiMcp);
    const cwd = join(home, "project");
    expect(getLegacyMcpMigrationNotices(cwd)).toEqual([]);
    expect(Object.keys(loadMcpConfig(undefined, cwd).mcpServers)).toEqual(["adapter_only"]);
  });

  it("keeps MCP_OAUTH_DIR as the explicit OAuth storage override", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-mcp-agent-dir-home-"));
    const agentDir = mkdtempSync(join(tmpdir(), "pi-mcp-agent-dir-"));
    const oauthDir = mkdtempSync(join(tmpdir(), "pi-mcp-oauth-dir-"));
    process.env.HOME = home;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.MCP_OAUTH_DIR = oauthDir;

    const { getAuthEntryFilePath, saveAuthEntry } = await import("../mcp-auth.ts");

    saveAuthEntry("demo", { tokens: { accessToken: "token" } }, "https://example.com/mcp");
    expect(existsSync(getAuthEntryFilePath("demo"))).toBe(false);
    expect(getAuthEntryFilePath("demo").startsWith(oauthDir)).toBe(true);
    expect(existsSync(join(oauthDir, "demo", "tokens.json"))).toBe(false);
    expect(existsSync(join(agentDir, "mcp-oauth", "demo", "tokens.json"))).toBe(false);
  });
});
