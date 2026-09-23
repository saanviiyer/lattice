// package-desktop.mjs - build the lattice desktop app.
//
// Two steps. First rasterise the brand mark into whatever icon format the target
// platform wants (macOS gets a real .icns built from the same SVG the app uses as its
// favicon, so the dock icon and the tab icon are the same drawing). Then hand the
// project to @electron/packager.
//
// Unlike a purely client-side app, lattice ships a Node server inside the shell for
// metadata lookups, PDF text extraction, and the AI actions, so the packaged app does
// carry node_modules. `prune: true` strips devDependencies (Electron itself, the
// packager, the client toolchain), leaving the handful of runtime deps the API needs.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import packager from "@electron/packager";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, "build");
const SVG = path.join(ROOT, "client", "public", "lattice.svg");

/** The sizes an .iconset needs, as [file, px]. */
const ICONSET = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];

/**
 * Rasterise the brand SVG once, at full size.
 *
 * sips cannot read SVG -- it fails on every call, and because the failure was caught
 * and treated as "this platform has no toolchain", every build so far shipped with
 * the stock Electron icon and only a warning to show for it. qlmanage renders SVG
 * through WebKit and is present on every macOS install; sips is still the right tool
 * for the downscales, which are PNG to PNG.
 *
 * The mark is inset inside the canvas rather than drawn edge to edge: macOS reserves
 * a margin so every icon in the dock lines up, and a full-bleed square reads as
 * oversized next to them. The source drawing is embedded rather than re-parsed, so
 * this stays correct whatever the mark becomes.
 */
function rasterise(out) {
  const source = fs.readFileSync(SVG).toString("base64");
  const canvas = 1024;
  const inset = 100; // leaves 824pt of art, the proportion Apple's icon grid uses
  const wrapper = path.join(os.tmpdir(), `lattice-icon-${process.pid}.svg`);
  fs.writeFileSync(
    wrapper,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `viewBox="0 0 ${canvas} ${canvas}" width="${canvas}" height="${canvas}">` +
      `<image x="${inset}" y="${inset}" width="${canvas - inset * 2}" height="${canvas - inset * 2}" ` +
      `xlink:href="data:image/svg+xml;base64,${source}"/></svg>`
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-icon-"));
  try {
    execFileSync("qlmanage", ["-t", "-s", String(canvas), "-o", dir, wrapper], {
      stdio: "ignore",
    });
    const rendered = fs.readdirSync(dir).find((f) => f.endsWith(".png"));
    if (!rendered) throw new Error("qlmanage produced no PNG");
    fs.copyFileSync(path.join(dir, rendered), out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(wrapper, { force: true });
  }
}

/** Downscale the rendered PNG. sips is fine here: PNG in, PNG out. */
function png(size, out, from) {
  execFileSync("sips", ["-s", "format", "png", "-Z", String(size), from, "--out", out], {
    stdio: "ignore",
  });
}

/**
 * Build a platform icon from the brand SVG, or return undefined if this platform's
 * toolchain is not available. A missing icon is a cosmetic loss, so it never fails
 * the build.
 */
function buildIcon() {
  fs.mkdirSync(BUILD, { recursive: true });
  if (process.platform !== "darwin") {
    // Linux takes a PNG directly. Windows wants .ico, which needs a converter this
    // repo does not carry, so those builds use the Electron default.
    try {
      const out = path.join(BUILD, "icon.png");
      rasterise(out);
      return process.platform === "linux" ? out : undefined;
    } catch {
      return undefined;
    }
  }
  try {
    const iconset = path.join(BUILD, "icon.iconset");
    fs.rmSync(iconset, { recursive: true, force: true });
    fs.mkdirSync(iconset, { recursive: true });
    const full = path.join(BUILD, "icon-1024.png");
    rasterise(full);
    for (const [file, size] of ICONSET) png(size, path.join(iconset, file), full);
    const icns = path.join(BUILD, "icon.icns");
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", icns], { stdio: "ignore" });
    // Handed over without its extension: packager appends the right one for the
    // target platform, and rejects the path if it is already there.
    return path.join(BUILD, "icon");
  } catch (err) {
    console.warn(`could not build the app icon (${err.message}); using the default`);
    return undefined;
  }
}

// Everything the packaged app needs, and nothing else. The client's own node_modules
// and source are excluded: Vite already bundled them into client/dist.
const KEEP = [
  /^\/package\.json$/,
  /^\/desktop$/,
  /^\/desktop\/(main|preload|serve)\.cjs$/,
  /^\/server$/,
  /^\/server\/[^/]+\.js$/,
  /^\/client$/,
  /^\/client\/dist$/,
  /^\/client\/dist\//,
  /^\/node_modules$/,
  /^\/node_modules\//,
];

if (!fs.existsSync(path.join(ROOT, "client", "dist", "index.html"))) {
  console.error("client/dist/index.html is missing. Run `npm run build` first.");
  process.exit(1);
}

const icon = buildIcon();
const out = path.join(ROOT, "release");


/**
 * Code signing and notarisation.
 *
 * Without these macOS shows "lattice cannot be opened because the developer cannot be
 * verified", and the only way past it is right-click -> Open. That dialog is where
 * most people stop, so an unsigned build is close to unshareable.
 *
 * Both are driven by environment variables and are skipped entirely when they are
 * absent, so an ordinary `npm run desktop:build` still works with no Apple account.
 * To produce a shareable build you need a paid Apple Developer account, then:
 *
 *   LATTICE_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
 *   APPLE_ID="you@example.com" \
 *   APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx" \
 *   APPLE_TEAM_ID="TEAMID" \
 *   npm run desktop:build
 *
 * The app-specific password is generated at appleid.apple.com, not your Apple ID
 * password. Notarisation uploads the app to Apple and usually takes a few minutes.
 */
function signingOptions() {
  const identity = process.env.LATTICE_SIGN_IDENTITY;
  if (!identity) {
    if (process.platform === "darwin") {
      console.log(
        "not signing: set LATTICE_SIGN_IDENTITY to sign, or the first launch will\n" +
          "need right-click -> Open on any machine but this one."
      );
    }
    return {};
  }

  const options = {
    osxSign: {
      identity,
      // The app runs a Node server in-process and loads its own local content, so it
      // needs the hardened-runtime exceptions notarisation otherwise rejects.
      optionsForFile: () => ({
        entitlements: ENTITLEMENTS,
        hardenedRuntime: true,
      }),
    },
  };

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (APPLE_ID && APPLE_APP_SPECIFIC_PASSWORD && APPLE_TEAM_ID) {
    options.osxNotarize = {
      appleId: APPLE_ID,
      appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
      teamId: APPLE_TEAM_ID,
    };
    console.log("signing and notarising — the upload to Apple takes a few minutes");
  } else {
    console.log(
      "signing but NOT notarising: set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and\n" +
        "APPLE_TEAM_ID as well. A signed but un-notarised app is still blocked by\n" +
        "Gatekeeper on other machines."
    );
  }
  return options;
}

/**
 * Written next to the build rather than committed, because it only matters when
 * signing. The two exceptions are what an Electron app needs under the hardened
 * runtime: V8 compiles JavaScript at runtime, which reads as unsigned executable
 * memory, and the packaged Electron framework is signed separately from this app.
 */
const ENTITLEMENTS = path.join(BUILD, "entitlements.plist");
function writeEntitlements() {
  fs.mkdirSync(BUILD, { recursive: true });
  fs.writeFileSync(
    ENTITLEMENTS,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
  </dict>
</plist>
`
  );
}

if (process.env.LATTICE_SIGN_IDENTITY) writeEntitlements();

const paths = await packager({
  dir: ROOT,
  out,
  name: "lattice",
  appBundleId: "com.lattice.workspace",
  appCategoryType: "public.app-category.productivity",
  platform: process.env.LATTICE_PLATFORM || os.platform(),
  arch: process.env.LATTICE_ARCH || os.arch(),
  overwrite: true,
  asar: true,
  // Keeps the runtime deps the embedded API needs, drops the build toolchain.
  prune: true,
  icon,
  // macOS: let the app be opened by dropping a PDF on it, and appear under
  // "Open With" for PDFs. It does not claim the default handler.
  extendInfo: {
    CFBundleDocumentTypes: [
      {
        CFBundleTypeName: "PDF document",
        CFBundleTypeRole: "Viewer",
        LSHandlerRank: "Alternate",
        LSItemContentTypes: ["com.adobe.pdf"],
      },
    ],
  },
  ignore: (p) => p !== "" && !KEEP.some((re) => re.test(p)),
  ...signingOptions(),
});

for (const p of paths) console.log(`built ${p}`);
console.log(
  "\nThis build is unsigned. On macOS, right-click the app and choose Open the\n" +
    "first time, or Gatekeeper will refuse to launch it."
);
