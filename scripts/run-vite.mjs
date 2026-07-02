import { spawn } from "node:child_process";
import process from "node:process";

const viteArgs = process.argv.slice(2);
const child = spawn(
  "node",
  ["node_modules/vite/bin/vite.js", ...viteArgs],
  {
    cwd: new URL("../frontend/", import.meta.url),
    stdio: "inherit",
    shell: false,
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
