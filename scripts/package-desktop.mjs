import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stage = await mkdtemp(join(tmpdir(), "piharness-desktop-"));
const appName = "BuildMe";
const platform = process.env.BUILDME_PLATFORM ?? "darwin";
const arch = process.env.BUILDME_ARCH ?? (platform === "darwin" ? "arm64" : "x64");

if (!new Set(["darwin", "win32"]).has(platform)) {
  throw new Error(`Unsupported desktop packaging platform: ${platform}`);
}

const releaseDirectory = join(root, "release", `${appName}-${platform}-${arch}`);
const packagedApp = platform === "darwin"
  ? join(releaseDirectory, `${appName}.app`)
  : join(releaseDirectory, `${appName}.exe`);

function command(program, args) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(program, args, { cwd: root, stdio: "inherit" });
    child.once("error", rejectCommand);
    child.once("exit", (code) => {
      if (code === 0) resolveCommand();
      else rejectCommand(new Error(`${program} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function createProductionStage() {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  delete packageJson.devDependencies;
  packageJson.scripts = {};
  await Promise.all([
    cp(join(root, "dist"), join(stage, "dist"), { recursive: true }),
    cp(join(root, "desktop"), join(stage, "desktop"), { recursive: true }),
    cp(join(root, "bundles"), join(stage, "bundles"), { recursive: true }),
    cp(join(root, "legal"), join(stage, "legal"), { recursive: true }),
    cp(join(root, "THIRD_PARTY_NOTICES.md"), join(stage, "THIRD_PARTY_NOTICES.md")),
    cp(join(root, "pnpm-lock.yaml"), join(stage, "pnpm-lock.yaml")),
    cp(join(root, "pnpm-workspace.yaml"), join(stage, "pnpm-workspace.yaml")),
    cp(join(root, ".npmrc"), join(stage, ".npmrc")),
    writeFile(join(stage, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8"),
  ]);
  await command("pnpm", ["--dir", stage, "install", "--prod", "--config.node-linker=hoisted"]);
}

try {
  await createProductionStage();
  const icon = platform === "win32"
    ? join(root, "desktop", "assets", "icon.ico")
    : join(root, "desktop", "assets", "icon.icns");
  await command(join(root, "node_modules", ".bin", "electron-packager"), [
    stage,
    appName,
    `--platform=${platform}`,
    `--arch=${arch}`,
    "--electron-version=43.4.0",
    "--app-bundle-id=local.personal.agent",
    `--out=${join(root, "release")}`,
    "--overwrite",
    "--asar.unpack=**/*.{node,dylib}",
    `--icon=${icon}`,
  ]);

  if (platform === "darwin") {
    // electron-packager 18 may skip .icns on newer macOS releases in favor of
    // the new .icon format. Keep the generated cube artwork authoritative by
    // replacing the packaged fallback before signing.
    await cp(join(root, "desktop", "assets", "icon.icns"), join(packagedApp, "Contents", "Resources", "electron.icns"));
    await command("codesign", ["--force", "--deep", "--sign", "-", packagedApp]);
    console.log(`已生成：${packagedApp}`);
  } else {
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const archive = join(root, "release", `${appName}-${packageJson.version}-${platform}-${arch}.zip`);
    await rm(archive, { force: true });
    await command("ditto", ["-c", "-k", "--keepParent", releaseDirectory, archive]);
    const checksum = createHash("sha256").update(await readFile(archive)).digest("hex");
    await writeFile(`${archive}.sha256`, `${checksum}  ${basename(archive)}\n`, "utf8");
    console.log(`已生成：${packagedApp}`);
    console.log(`Windows 分发包：${archive}`);
    console.log(`SHA-256：${archive}.sha256`);
  }
} finally {
  await rm(stage, { recursive: true, force: true });
}
