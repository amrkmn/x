import type { JsonObject, JsonValue } from '../../src/lib/validation';

export function isRecord(value: JsonValue | undefined): value is JsonObject {
    return (
        value !== undefined &&
        value !== null &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype
    );
}

export function isString(value: JsonValue | undefined): value is string {
    return value !== undefined && value !== null && String(value) === value;
}

export function requiredObject(value: JsonValue | undefined, label: string): JsonObject {
    if (!isRecord(value)) throw new Error(`Invalid ${label}: expected object`);
    return value;
}

export function requiredArray(value: JsonValue | undefined, label: string): JsonValue[] {
    if (!Array.isArray(value)) throw new Error(`Invalid ${label}: expected array`);
    return value;
}

export function requiredNumber(value: JsonValue | undefined, label: string): number {
    if (!Number.isFinite(value)) throw new Error(`Invalid ${label}: expected number`);
    return Number(value);
}

export function requiredString(value: JsonValue | undefined, label: string): string {
    if (!isString(value) || value.trim() === '') {
        throw new Error(`Invalid ${label}: expected a non-empty string`);
    }
    return value;
}

export function optionalUrl(value: JsonValue | undefined, label: string): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const valueString = requiredString(value, label);
    let url: URL;
    try {
        url = new URL(valueString);
    } catch {
        throw new Error(`Invalid ${label}: ${valueString}`);
    }
    if (url.protocol !== 'https:') throw new Error(`Invalid ${label}: expected HTTPS`);
    return valueString;
}
