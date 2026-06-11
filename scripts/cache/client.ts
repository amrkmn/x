import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

const s3Config = {
    ENDPOINT: process.env.S3_ENDPOINT,
    ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    BUCKET_NAME: process.env.S3_BUCKET_NAME,
    REGION: process.env.S3_REGION,
    FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE === 'true'
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

    client = new S3Client({
        endpoint: s3Config.ENDPOINT,
        credentials: {
            accessKeyId: s3Config.ACCESS_KEY_ID!,
            secretAccessKey: s3Config.SECRET_ACCESS_KEY!
        },
        region: s3Config.REGION || 'auto',
        forcePathStyle: s3Config.FORCE_PATH_STYLE
    });
    return client;
}

export async function fileExists(client: S3Client, key: string): Promise<boolean> {
    try {
        await client.send(
            new HeadObjectCommand({
                Bucket: s3Config.BUCKET_NAME!,
                Key: key
            })
        );
        return true;
    } catch {
        return false;
    }
}

export async function getObject(client: S3Client, key: string): Promise<Uint8Array> {
    const response = await client.send(
        new GetObjectCommand({
            Bucket: s3Config.BUCKET_NAME!,
            Key: key
        })
    );
    return new Uint8Array(await response.Body!.transformToByteArray());
}

export async function deleteObject(client: S3Client, key: string): Promise<void> {
    await client.send(
        new DeleteObjectCommand({
            Bucket: s3Config.BUCKET_NAME!,
            Key: key
        })
    );
}

export async function uploadToS3(
    key: string,
    data: Uint8Array | ArrayBuffer,
    options?: {
        onProgress?: (bytes: number) => void;
        contentType?: string;
    }
): Promise<void> {
    const client = getClient();
    if (!client) throw new Error('S3 client not initialized');

    const body = data instanceof Uint8Array ? data : new Uint8Array(data);
    const contentType = options?.contentType;
    const onProgress = options?.onProgress;

    if (!onProgress) {
        await client.send(
            new PutObjectCommand({
                Bucket: s3Config.BUCKET_NAME!,
                Key: key,
                Body: body,
                ContentType: contentType
            })
        );
        return;
    }

    const upload = new Upload({
        client,
        params: {
            Bucket: s3Config.BUCKET_NAME!,
            Key: key,
            Body: body,
            ContentType: contentType
        }
    });

    upload.on('httpUploadProgress', (progress) => {
        if (progress.loaded) {
            onProgress(progress.loaded);
        }
    });

    await upload.done();
}
