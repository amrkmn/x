import { rm } from 'fs/promises';
import { join } from 'path';

try {
    await rm(join(process.cwd(), 'dist'), { recursive: true, force: true });
    console.log('Cleaned dist directory');
} catch (error) {
    console.log("Dist directory doesn't exist or already clean");
}
