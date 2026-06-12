// Type alias so other modules can import the S3Client type from this file
// instead of depending on @aws-sdk/client-s3.
export type S3Client = Bun.S3Client;

const s3Config = {
    ENDPOINT: process.env.S3_ENDPOINT,
    ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    BUCKET_NAME: process.env.S3_BUCKET_NAME,
    REGION: process.env.S3_REGION,
    FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE !== 'false'
};

export { s3Config };

export const ENABLED =
    !!s3Config.ENDPOINT &&
    !!s3Config.ACCESS_KEY_ID &&
    !!s3Config.SECRET_ACCESS_KEY &&
    !!s3Config.BUCKET_NAME;

/**
 * Builds the endpoint URL. For virtual-hosted style, the bucket is prepended
 * as a subdomain: https://{bucket}.{host}/...
 * For path-style, the original endpoint is used as-is.
 */
function buildEndpoint(baseEndpoint: string, bucket: string, virtualHosted: boolean): string {
    if (!virtualHosted) return baseEndpoint;

    const url = new URL(baseEndpoint);
    url.hostname = `${bucket}.${url.hostname}`;
    return url.origin;
}

let client: S3Client | null = null;

export function getClient(): S3Client | null {
    if (!ENABLED || client) return client;

    const virtualHosted = !s3Config.FORCE_PATH_STYLE;

    client = new Bun.S3Client({
        accessKeyId: s3Config.ACCESS_KEY_ID!,
        secretAccessKey: s3Config.SECRET_ACCESS_KEY!,
        endpoint: buildEndpoint(s3Config.ENDPOINT!, s3Config.BUCKET_NAME!, virtualHosted),
        bucket: s3Config.BUCKET_NAME!,
        region: s3Config.REGION || 'auto',
        virtualHostedStyle: virtualHosted
    });
    return client;
}

export async function fileExists(client: S3Client, key: string): Promise<boolean> {
    try {
        return await client.exists(key);
    } catch {
        return false;
    }
}

export async function getObject(client: S3Client, key: string): Promise<Uint8Array> {
    const data = await client.file(key).arrayBuffer();
    return new Uint8Array(data);
}

export async function deleteObject(client: S3Client, key: string): Promise<void> {
    await client.delete(key);
}

/**
 * Wraps a body in a TransformStream that counts bytes flowing through
 * and calls `onProgress(uploadedBytes)` after each chunk.
 *
 * Note: `fetch()` buffers the entire request body before sending, so progress
 * events fire at disk speed, not network speed. This still provides useful
 * feedback for large files as the stream is consumed.
 */
function withUploadProgress(
    body: Uint8Array | ArrayBuffer | Blob | ReadableStream<Uint8Array>,
    onProgress: (bytes: number) => void
): { stream: ReadableStream<Uint8Array>; length?: number } {
    let uploaded = 0;

    // Normalise to a ReadableStream
    let source: ReadableStream<Uint8Array>;
    let length: number | undefined;

    if (body instanceof ReadableStream) {
        source = body;
        length = undefined;
    } else if (body instanceof Blob) {
        source = body.stream();
        length = body.size;
    } else {
        const buf = body instanceof Uint8Array ? body : new Uint8Array(body);
        source = new ReadableStream<Uint8Array>({
            pull(controller) {
                controller.enqueue(buf);
                controller.close();
            }
        });
        length = buf.byteLength;
    }

    const stream = source.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
                uploaded += chunk.byteLength;
                onProgress(uploaded);
                controller.enqueue(chunk);
            }
        })
    );

    return { stream, length };
}

export async function uploadToS3(
    key: string,
    data: Uint8Array | ArrayBuffer | Blob | ReadableStream<Uint8Array>,
    options?: {
        onProgress?: (bytes: number) => void;
        contentType?: string;
        contentLength?: number;
    }
): Promise<void> {
    const client = getClient();
    if (!client) throw new Error('S3 client not initialized');

    const contentType = options?.contentType;
    const onProgress = options?.onProgress;
    const contentLength = options?.contentLength;

    const url = client.presign(key, {
        method: 'PUT',
        expiresIn: 3600,
        ...(contentType ? { type: contentType } : {})
    });

    const headers: Record<string, string> = {};
    if (contentType) headers['Content-Type'] = contentType;

    if (!onProgress) {
        const response = await fetch(url, {
            method: 'PUT',
            body: data instanceof Uint8Array ? (data.buffer as ArrayBuffer) : data,
            headers: contentLength
                ? { ...headers, 'Content-Length': String(contentLength) }
                : headers
        });

        if (!response.ok) {
            throw new Error(`S3 upload failed: ${response.status} ${response.statusText}`);
        }
        return;
    }

    const { stream, length } = withUploadProgress(data, onProgress);
    const resolvedContentLength = contentLength ?? length;

    if (typeof resolvedContentLength === 'number' && resolvedContentLength >= 0) {
        headers['Content-Length'] = String(resolvedContentLength);
    }

    const response = await fetch(url, {
        method: 'PUT',
        body: stream,
        headers
    });

    if (!response.ok) {
        throw new Error(`S3 upload failed: ${response.status} ${response.statusText}`);
    }
}
