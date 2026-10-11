import { spawn } from "node:child_process";

const mode = process.argv[2];
if (!["dev", "start"].includes(mode)) throw new Error("Expected dev or start");
const children = ["web", "worker"].map((name) =>
  spawn("pnpm", ["--filter", `@workspace/${name}`, mode], {
    stdio: "inherit", detached: true,
  }),
);
let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (child.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
    }
  }
  setTimeout(() => {
    for (const child of children) {
      if (child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ }
      }
    }
    process.exit(code);
  }, 12_000).unref();
  process.exitCode = code;
}
for (const child of children) {
  child.on("error", () => shutdown(1));
  child.on("exit", (code) => shutdown(code ?? 1));
}
process.on("SIGTERM", () => shutdown());
process.on("SIGINT", () => shutdown());
