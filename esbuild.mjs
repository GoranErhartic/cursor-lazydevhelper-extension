import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";

const require = createRequire(import.meta.url);

async function vendorCursorSdk() {
  const sdkEntry = require.resolve("@cursor/sdk");
  const sdkRoot = resolve(dirname(sdkEntry), "..", "..");
  const target = resolve("dist/vendor/cursor-sdk");
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  // Only the CommonJS build is loaded via require(); skip esm/bundled copies,
  // type declarations and sourcemaps (~25MB -> a fraction of that).
  await cp(resolve(sdkRoot, "package.json"), resolve(target, "package.json"));
  await cp(resolve(sdkRoot, "LICENSE.md"), resolve(target, "LICENSE.md"));
  await cp(resolve(sdkRoot, "dist/cjs"), resolve(target, "dist/cjs"), {
    recursive: true,
    dereference: true,
    filter: (src) => !/\.d\.ts(\.map)?$|\.js\.map$/.test(src),
  });
  // The packaged .vsix ships without node_modules (--no-dependencies), so the
  // SDK's runtime requires must be vendored next to it.
  // pnpm places the SDK's dependencies as siblings of its real path.
  const sdkNodeModules = resolve(realpathSync(sdkRoot), "..", "..");
  for (const dep of ["zod", "@bufbuild/protobuf"]) {
    const depRoot = resolve(sdkNodeModules, dep);
    await cp(depRoot, resolve(target, "node_modules", dep), {
      recursive: true,
      dereference: true,
      filter: (src) => !/\.d\.[mc]?ts(\.map)?$|\.map$/.test(src),
    });
  }
}

/** Lets VS Code/Cursor detect when the watch build is ready (preLaunchTask). */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      for (const error of result.errors) {
        const loc = error.location;
        if (loc) {
          console.error(`✘ [ERROR] ${error.text}`);
          console.error(`    ${loc.file}:${loc.line}:${loc.column}:`);
        } else {
          console.error(`✘ [ERROR] ${error.text}`);
        }
      }
      console.log("[watch] build finished");
    });
  },
};

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode", "@cursor/sdk"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  minify: process.env.NODE_ENV === "production",
  plugins: [esbuildProblemMatcherPlugin],
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await vendorCursorSdk();
  await ctx.dispose();
}
