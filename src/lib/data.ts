import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppData } from './types';
import { parseAppData } from './validation';

export function loadAppData(): AppData {
    const dataPath = resolve('static/data.json');
    return parseAppData(JSON.parse(readFileSync(dataPath, 'utf-8')));
}
