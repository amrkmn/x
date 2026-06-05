import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppData } from './types';

export function loadAppData(): AppData {
    const dataPath = resolve('static/data.json');
    return JSON.parse(readFileSync(dataPath, 'utf-8')) as AppData;
}
