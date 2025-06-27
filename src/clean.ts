import { rmSync } from "fs";
import { join } from "path";

const distPath = join(process.cwd(), "dist");

try {
    rmSync(distPath, { recursive: true, force: true });
    console.log("✅ Cleaned dist directory");
} catch (error) {
    console.log("ℹ️  Dist directory doesn't exist or already clean");
}
