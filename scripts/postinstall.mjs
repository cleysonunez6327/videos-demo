/**
 * Compile the toolkit right after `npm install`.
 *
 * `dist/` is gitignored, so a plugin installed from GitHub arrives as source
 * only. The `ndemo` executable does `import("./dist/cli.js")`, which means a
 * fresh install threw on the very first command until somebody read the setup
 * section and built it by hand.
 *
 * A failure here never fails the install. Breaking `npm install` would leave
 * the plugin impossible to install at all, which is worse than one that needs
 * a manual build — so a broken build prints how to finish the job and exits
 * clean.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

/** Resolve the bundled compiler rather than trusting PATH. */
function findCompiler() {
  try {
    return require.resolve("typescript/bin/tsc");
  } catch {
    return null;
  }
}

function warn(reason) {
  process.stderr.write(
    `\nndemo: could not build automatically — ${reason}.\n` +
    `       Run this once before using it:\n` +
    `         cd ${root} && npm install && npm run build\n\n`
  );
}

const compiler = findCompiler();
if (!compiler) {
  // Installing with --omit=dev is the usual way to land here.
  warn("TypeScript is not installed");
  process.exit(0);
}

const result = spawnSync(process.execPath, [compiler, "--project", root], {
  cwd: root,
  stdio: "inherit",
});

if (result.status !== 0) {
  warn("the TypeScript build failed");
  process.exit(0);
}

if (!existsSync(join(root, "dist", "cli.js"))) {
  warn("the build produced no dist/cli.js");
  process.exit(0);
}
