import { S3Client as LiteS3Client } from '@bradenmacdonald/s3-lite-client';

// Type alias so other modules can import the S3 client type without depending
// on the package implementation details.
export type S3Client = LiteS3Client;
type S3UploadBody = Parameters<S3Client['putObject']>[1];
type S3UploadOptions = NonNullable<Parameters<S3Client['putObject']>[2]>;

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

let client: S3Client | null = null;

export function getClient(): S3Client | null {
    if (!ENABLED || client) return client;

    client = new LiteS3Client({
        accessKey: s3Config.ACCESS_KEY_ID!,
        bucket: s3Config.BUCKET_NAME!,
        endPoint: s3Config.ENDPOINT!,
        pathStyle: s3Config.FORCE_PATH_STYLE,
        region: s3Config.REGION || 'auto',
        secretKey: s3Config.SECRET_ACCESS_KEY!
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
    const response = await client.getObject(key);
    if (!response.body) throw new Error(`S3 object has no body: ${key}`);
    return new Uint8Array(await response.arrayBuffer());
}

export async function deleteObject(client: S3Client, key: string): Promise<void> {
    await client.deleteObject(key);
}

export async function uploadToS3(
    key: string,
    data: S3UploadBody | ArrayBuffer | Blob,
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
    const body =
        data instanceof Blob
            ? data.stream()
            : data instanceof ArrayBuffer
              ? new Uint8Array(data)
              : data;
    const length =
        contentLength ??
        (data instanceof Blob
            ? data.size
            : data instanceof Uint8Array
              ? data.byteLength
              : undefined);
    let uploaded = 0;
    const uploadBody = onProgress
        ? body instanceof ReadableStream
            ? body.pipeThrough(
                  new TransformStream<Uint8Array, Uint8Array>({
                      transform(chunk, controller) {
                          uploaded += chunk.byteLength;
                          onProgress(uploaded);
                          controller.enqueue(chunk);
                      }
                  })
              )
            : body
        : body;
    const uploadOptions: S3UploadOptions = {};
    if (contentType) uploadOptions.metadata = { 'Content-Type': contentType };
    if (length !== undefined) uploadOptions.size = length;

    await client.putObject(key, uploadBody, uploadOptions);
}
