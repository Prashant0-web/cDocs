import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
    HeadObjectCommand,
    type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";

export interface R2UploadOptions {
    fileBuffer: Buffer;
    key: string;
    contentType?: string | undefined;
    metadata?: Record<string, string> | undefined;
    cacheControl?: string | undefined; // Default: "public, max-age=31536000, immutable"
}

export interface R2UploadResult {
    key: string;
    publicUrl: string;
    size: number;
    contentType: string;
    etag?: string | undefined;
}

export interface R2BatchUploadItem {
    fileBuffer: Buffer;
    key: string;
    contentType?: string | undefined;
    metadata?: Record<string, string> | undefined;
    cacheControl?: string | undefined;
}

export interface R2BatchUploadResult {
    successful: R2UploadResult[];
    failed: Array<{ key: string; error: string }>;
}

/**
 * Singleton R2 client instance to reuse connections and avoid socket leaks
 */
let cachedR2Client: S3Client | null = null;

export const getR2Client = (): S3Client => {
    if (cachedR2Client) {
        return cachedR2Client;
    }

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (!accountId || !accessKeyId || !secretAccessKey) {
        throw new Error(
            "Cloudflare R2 configuration missing. Please ensure CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY are set in server/.env"
        );
    }

    cachedR2Client = new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
    });

    return cachedR2Client;
};

export const getR2BucketName = (): string => {
    const bucket = process.env.R2_BUCKET_NAME;
    if (!bucket) {
        throw new Error("R2_BUCKET_NAME is not configured in server/.env");
    }
    return bucket;
};

/**
 * Returns the public CDN / dev URL for any file stored in Cloudflare R2
 * Default URL: https://pub-752bf94badc54c60984a126ab8565981.r2.dev
 */
export const getR2PublicUrl = (key: string): string => {
    const base = (
        process.env.R2_PUBLIC_DOMAIN ||
        "https://pub-752bf94badc54c60984a126ab8565981.r2.dev"
    ).replace(/\/+$/, "");
    const cleanKey = key.replace(/^\/+/, "");
    return `${base}/${cleanKey}`;
};

/**
 * Uploads a single file buffer to Cloudflare R2
 */
export const uploadToR2 = async (options: R2UploadOptions): Promise<R2UploadResult> => {
    const client = getR2Client();
    const bucket = getR2BucketName();
    const contentType = options.contentType || "application/octet-stream";
    const cacheControl = options.cacheControl || "public, max-age=31536000, immutable";

    const cleanKey = options.key.replace(/^\/+/, "");

    const input: PutObjectCommandInput = {
        Bucket: bucket,
        Key: cleanKey,
        Body: options.fileBuffer,
        ContentType: contentType,
        CacheControl: cacheControl,
    };

    if (options.metadata) {
        input.Metadata = options.metadata;
    }

    const command = new PutObjectCommand(input);
    const response = await client.send(command);

    return {
        key: cleanKey,
        publicUrl: getR2PublicUrl(cleanKey),
        size: options.fileBuffer.length,
        contentType,
        etag: response.ETag,
    };
};

/**
 * Uploads a batch of files to Cloudflare R2 with controlled concurrency
 * (Prevents saturating the Node.js event loop or network socket limits)
 */
export const uploadBatchToR2 = async (
    items: R2BatchUploadItem[],
    concurrency: number = 3
): Promise<R2BatchUploadResult> => {
    const successful: R2UploadResult[] = [];
    const failed: Array<{ key: string; error: string }> = [];

    let index = 0;
    const worker = async () => {
        while (index < items.length) {
            const currentItem = items[index++];
            if (!currentItem) break;

            try {
                const uploadOpts: R2UploadOptions = {
                    fileBuffer: currentItem.fileBuffer,
                    key: currentItem.key,
                };
                if (currentItem.contentType) uploadOpts.contentType = currentItem.contentType;
                if (currentItem.metadata) uploadOpts.metadata = currentItem.metadata;
                if (currentItem.cacheControl) uploadOpts.cacheControl = currentItem.cacheControl;

                const result = await uploadToR2(uploadOpts);
                successful.push(result);
            } catch (err: any) {
                console.error(`[R2 Batch Upload] Failed key=${currentItem.key}:`, err.message);
                failed.push({
                    key: currentItem.key,
                    error: err.message || "Upload failed",
                });
            }
        }
    };

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
    await Promise.all(workers);

    return { successful, failed };
};

/**
 * Reads a document as a Node.js Readable stream from R2
 */
export const readFromR2Stream = async (key: string): Promise<Readable> => {
    const client = getR2Client();
    const bucket = getR2BucketName();
    const cleanKey = key.replace(/^\/+/, "");

    const command = new GetObjectCommand({
        Bucket: bucket,
        Key: cleanKey,
    });

    const response = await client.send(command);
    if (!response.Body) {
        throw new Error(`Empty body returned for key: ${cleanKey}`);
    }

    return response.Body as Readable;
};

/**
 * Reads a document from R2 into memory as a Buffer
 */
export const readFromR2Buffer = async (key: string): Promise<Buffer> => {
    const stream = await readFromR2Stream(key);
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
        stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on("error", (err) => reject(err));
        stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
};

/**
 * Checks if an object exists in the R2 bucket
 */
export const checkObjectExistsInR2 = async (key: string): Promise<boolean> => {
    const client = getR2Client();
    const bucket = getR2BucketName();
    const cleanKey = key.replace(/^\/+/, "");

    try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: cleanKey }));
        return true;
    } catch (err: any) {
        if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
            return false;
        }
        throw err;
    }
};

/**
 * Generates a presigned URL for direct client-to-R2 upload (zero backend CPU/memory overhead)
 */
export const getPresignedUploadUrl = async (
    key: string,
    contentType: string,
    expiresInSeconds: number = 900 // 15 minutes
): Promise<{ uploadUrl: string; key: string; publicUrl: string }> => {
    const client = getR2Client();
    const bucket = getR2BucketName();
    const cleanKey = key.replace(/^\/+/, "");

    const command = new PutObjectCommand({
        Bucket: bucket,
        Key: cleanKey,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
    });

    const uploadUrl = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });

    return {
        uploadUrl,
        key: cleanKey,
        publicUrl: getR2PublicUrl(cleanKey),
    };
};

/**
 * Generates a presigned URL for secure, time-limited reading of private objects
 */
export const getPresignedDownloadUrl = async (
    key: string,
    expiresInSeconds: number = 3600 // 1 hour
): Promise<string> => {
    const client = getR2Client();
    const bucket = getR2BucketName();
    const cleanKey = key.replace(/^\/+/, "");

    const command = new GetObjectCommand({
        Bucket: bucket,
        Key: cleanKey,
    });

    return await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
};

/**
 * Deletes a single object from Cloudflare R2
 */
export const deleteFromR2 = async (key: string): Promise<void> => {
    const client = getR2Client();
    const bucket = getR2BucketName();
    const cleanKey = key.replace(/^\/+/, "");

    await client.send(
        new DeleteObjectCommand({
            Bucket: bucket,
            Key: cleanKey,
        })
    );
};

/**
 * Deletes multiple objects in a single batch request
 */
export const deleteBatchFromR2 = async (keys: string[]): Promise<void> => {
    if (keys.length === 0) return;

    const client = getR2Client();
    const bucket = getR2BucketName();

    const objects = keys.map((key) => ({ Key: key.replace(/^\/+/, "") }));

    await client.send(
        new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
                Objects: objects,
                Quiet: true,
            },
        })
    );
};
