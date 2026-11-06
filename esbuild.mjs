import * as esbuild from "esbuild";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { existsSync, realpathSync } from "node:fs";

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
  // SDK's runtime dependency tree must be vendored next to it.
  // Platform binaries (optionalDependencies) are skipped: the SDK degrades without them.
  await vendorDependencies(sdkRoot, resolve(target, "node_modules"));
}

/** Copies the full dependency tree of `pkgRoot` into a flat `targetNodeModules`. */
async function vendorDependencies(pkgRoot, targetNodeModules, seen = new Set()) {
  const pkg = JSON.parse(await readFile(resolve(pkgRoot, "package.json"), "utf8"));
  const deps = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ];
  // pnpm places a package's dependencies as siblings of its real path.
  const siblings = resolve(realpathSync(pkgRoot), "..", ...(pkg.name.startsWith("@") ? [".."] : []));
  for (const dep of deps) {
    if (seen.has(dep)) {
      continue;
    }
    const depRoot = resolve(siblings, dep);
    if (!existsSync(depRoot)) {
      if (pkg.peerDependenciesMeta?.[dep]?.optional) {
        continue;
      }
      throw new Error(`Cannot vendor ${dep} (required by ${pkg.name}): not found at ${depRoot}`);
    }
    seen.add(dep);
    await cp(depRoot, resolve(targetNodeModules, dep), {
      recursive: true,
      dereference: true,
      filter: (src) => !/\.d\.[mc]?ts(\.map)?$|\.map$/.test(src) && !src.endsWith("/node_modules"),
    });
    await vendorDependencies(depRoot, targetNodeModules, seen);
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
