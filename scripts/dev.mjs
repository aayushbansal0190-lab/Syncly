import { spawn } from "node:child_process";
import process from "node:process";

const children = [];

function run(name, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`${name} exited with signal ${signal}`);
      return;
    }

    if (code && code !== 0) {
      console.log(`${name} exited with code ${code}`);
      shutdown(code);
    }
  });

  children.push(child);
}

function shutdown(exitCode = 0) {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  process.exit(exitCode);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run(
  "backend",
  "node",
  ["src/index.js"],
  new URL("../backend/", import.meta.url)
);
run(
  "frontend",
  "node",
  ["scripts/run-vite.mjs", "--host", "0.0.0.0"],
  process.cwd()
);
