import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const py = `
import zipfile
from pathlib import Path
root = Path(${JSON.stringify(join(root, "public/extension"))})
dest = Path(${JSON.stringify(join(root, "public/exn-collector.zip"))})
with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
    for p in sorted(root.rglob("*")):
        if p.is_file():
            z.write(p, Path("exn-collector") / p.relative_to(root))
print(dest, dest.stat().st_size)
`;
const run = spawnSync("python3", ["-c", py], { stdio: "inherit" });
process.exit(run.status ?? 1);
