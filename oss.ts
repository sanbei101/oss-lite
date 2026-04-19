import * as crypto from 'crypto';

export type OSSConfig = {
    accessKeyId: string;
    accessKeySecret: string;
    bucket: string;
    region: string;
    internal?: boolean;
}

export class LiteOSS {
    private config: OSSConfig;
    private endpoint: string;

    constructor(config: OSSConfig) {
        this.config = config;
        const networkType = config.internal ? '-internal' : '';
        this.endpoint = `${config.bucket}.${config.region}${networkType}.aliyuncs.com`;
    }

    private computeSignature(stringToSign: string): string {
        return crypto
            .createHmac('sha1', this.config.accessKeySecret)
            .update(stringToSign, 'utf8')
            .digest('base64');
    }

    /**
     * @param objectName OSS 中的存储路径及文件名
     * @param data 文件数据 (Buffer | Blob | string)
     * @param contentType MIME 类型
     */
    async uploadFile(objectName: string, data: BodyInit, contentType: string = 'application/octet-stream'): Promise<{
        success: boolean;
        url: string;
        objectName: string;
    }> {
        const verb = 'PUT';
        const date = new Date().toUTCString();
        const canonicalizedResource = `/${this.config.bucket}/${objectName}`;

        const stringToSign = `${verb}\n\n${contentType}\n${date}\n${canonicalizedResource}`;
        const signature = this.computeSignature(stringToSign);
        const authorization = `OSS ${this.config.accessKeyId}:${signature}`;

        const url = `https://${this.endpoint}/${objectName}`;

        const response = await fetch(url, {
            method: verb,
            headers: {
                'Date': date,
                'Content-Type': contentType,
                'Authorization': authorization,
            },
            body: data,
        });

        if (!response.ok) {
            const errorMsg = await response.text();
            throw new Error(`Upload Failed: ${response.status} - ${errorMsg}`);
        }

        return { success: true, url, objectName };
    }

    /**
     * @param objectName OSS 中的文件名
     */
    async downloadFile(objectName: string): Promise<ArrayBuffer> {
        const verb = 'GET';
        const date = new Date().toUTCString();
        const canonicalizedResource = `/${this.config.bucket}/${objectName}`;
        const stringToSign = `${verb}\n\n\n${date}\n${canonicalizedResource}`;
        const signature = this.computeSignature(stringToSign);
        const authorization = `OSS ${this.config.accessKeyId}:${signature}`;

        const url = `https://${this.endpoint}/${objectName}`;

        const response = await fetch(url, {
            method: verb,
            headers: {
                'Date': date,
                'Authorization': authorization,
            },
        });

        if (!response.ok) {
            const errorMsg = await response.text();
            throw new Error(`Download Failed: ${response.status} - ${errorMsg}`);
        }

        return await response.arrayBuffer();
    }

    /**
     * 生成带有效期的临时下载链接
     * @param objectName OSS 中的文件名
     * @param expiresIn 有效期 (单位:秒),默认 3600 秒
     */
    getPresignedUrl(objectName: string, expiresIn: number = 3600): string {
        const verb = 'GET';
        const expiresTimestamp = Math.floor(Date.now() / 1000) + expiresIn;
        const canonicalizedResource = `/${this.config.bucket}/${objectName}`;

        const stringToSign = `${verb}\n\n\n${expiresTimestamp}\n${canonicalizedResource}`;
        const signature = this.computeSignature(stringToSign);

        const params = new URLSearchParams({
            OSSAccessKeyId: this.config.accessKeyId,
            Expires: expiresTimestamp.toString(),
            Signature: signature,
        });

        return `https://${this.endpoint}/${objectName}?${params.toString()}`;
    }

    /**
     * 分片上传 - 初始化分片上传
     * @param objectName OSS 中的存储路径及文件名
     * @param contentType MIME 类型
     */
    async initiateMultipartUpload(objectName: string, contentType: string = 'application/octet-stream'): Promise<string> {
        const verb = 'POST';
        const date = new Date().toUTCString();
        const canonicalizedResource = `/${this.config.bucket}/${objectName}?uploads`;
        const stringToSign = `${verb}\n\n${contentType}\n${date}\n${canonicalizedResource}`;
        const signature = this.computeSignature(stringToSign);
        const authorization = `OSS ${this.config.accessKeyId}:${signature}`;

        const url = `https://${this.endpoint}/${objectName}?uploads`;

        const response = await fetch(url, {
            method: verb,
            headers: {
                'Date': date,
                'Content-Type': contentType,
                'Authorization': authorization,
            },
        });

        if (!response.ok) {
            const errorMsg = await response.text();
            throw new Error(`InitiateMultipartUpload Failed: ${response.status} - ${errorMsg}`);
        }

        const text = await response.text();
        const match = text.match(/<UploadId>(.+?)<\/UploadId>/);
        if (!match) {
            throw new Error(`Cannot parse UploadId: ${text}`);
        }
        return match[1];
    }

    /**
     * 分片上传 - 上传分片
     * @param objectName OSS 中的文件名
     * @param uploadId 分片上传的 UploadId
     * @param partNumber 分片号 (1-10000)
     * @param data 分片数据
     * @param contentType MIME 类型
     */
    async uploadPart(objectName: string, uploadId: string, partNumber: number, data: BodyInit, contentType: string = 'application/octet-stream'): Promise<string> {
        const verb = 'PUT';
        const date = new Date().toUTCString();
        const canonicalizedResource = `/${this.config.bucket}/${objectName}?partNumber=${partNumber}&uploadId=${uploadId}`;
        const stringToSign = `${verb}\n\n${contentType}\n${date}\n${canonicalizedResource}`;
        const signature = this.computeSignature(stringToSign);
        const authorization = `OSS ${this.config.accessKeyId}:${signature}`;

        const url = `https://${this.endpoint}/${objectName}?partNumber=${partNumber}&uploadId=${uploadId}`;

        const response = await fetch(url, {
            method: verb,
            headers: {
                'Date': date,
                'Content-Type': contentType,
                'Authorization': authorization,
            },
            body: data,
        });

        if (!response.ok) {
            const errorMsg = await response.text();
            throw new Error(`UploadPart Failed: ${response.status} - ${errorMsg}`);
        }

        return response.headers.get('ETag') || '';
    }

    /**
     * 分片上传 - 完成分片上传
     * @param objectName OSS 中的文件名
     * @param uploadId 分片上传的 UploadId
     * @param parts 已上传的分片列表
     */
    async completeMultipartUpload(objectName: string, uploadId: string, parts: { partNumber: number, eTag: string }[]): Promise<void> {
        const verb = 'POST';
        const date = new Date().toUTCString();
        const canonicalizedResource = `/${this.config.bucket}/${objectName}?uploadId=${uploadId}`;
        const contentType = 'application/xml';
        const stringToSign = `${verb}\n\n${contentType}\n${date}\n${canonicalizedResource}`;
        const signature = this.computeSignature(stringToSign);
        const authorization = `OSS ${this.config.accessKeyId}:${signature}`;

        const url = `https://${this.endpoint}/${objectName}?uploadId=${uploadId}`;

        const body = `<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUpload>\n${parts.map(p => `  <Part>\n    <PartNumber>${p.partNumber}</PartNumber>\n    <ETag>${p.eTag}</ETag>\n  </Part>`).join('\n')}\n</CompleteMultipartUpload>`;

        const response = await fetch(url, {
            method: verb,
            headers: {
                'Date': date,
                'Content-Type': contentType,
                'Authorization': authorization,
            },
            body: body,
        });

        if (!response.ok) {
            const errorMsg = await response.text();
            throw new Error(`CompleteMultipartUpload Failed: ${response.status} - ${errorMsg}`);
        }
    }

    /**
     * 分片上传 - 取消分片上传 (AbortMultipartUpload)
     * @param objectName OSS 中的文件名
     * @param uploadId 分片上传的 UploadId
     */
    async abortMultipartUpload(objectName: string, uploadId: string): Promise<void> {
        const verb = 'DELETE';
        const date = new Date().toUTCString();
        const canonicalizedResource = `/${this.config.bucket}/${objectName}?uploadId=${uploadId}`;
        const stringToSign = `${verb}\n\n\n${date}\n${canonicalizedResource}`;
        const signature = this.computeSignature(stringToSign);
        const authorization = `OSS ${this.config.accessKeyId}:${signature}`;

        const url = `https://${this.endpoint}/${objectName}?uploadId=${uploadId}`;

        const response = await fetch(url, {
            method: verb,
            headers: {
                'Date': date,
                'Authorization': authorization,
            },
        });

        if (!response.ok) {
            const errorMsg = await response.text();
            throw new Error(`AbortMultipartUpload Failed: ${response.status} - ${errorMsg}`);
        }
    }

    /**
     * GetObject + Range 请求头(范围下载 / 断点续传下载)
     * @param objectName OSS 中的文件名
     * @param range 范围请求头,例如 'bytes=0-1048575'
     */
    async downloadFileWithRange(objectName: string, range: string): Promise<ArrayBuffer> {
        const verb = 'GET';
        const date = new Date().toUTCString();
        const canonicalizedResource = `/${this.config.bucket}/${objectName}`;
        const stringToSign = `${verb}\n\n\n${date}\n${canonicalizedResource}`;
        const signature = this.computeSignature(stringToSign);
        const authorization = `OSS ${this.config.accessKeyId}:${signature}`;

        const url = `https://${this.endpoint}/${objectName}`;

        const response = await fetch(url, {
            method: verb,
            headers: {
                'Date': date,
                'Authorization': authorization,
                'Range': range
            },
        });

        if (!response.ok) {
            const errorMsg = await response.text();
            throw new Error(`Download with Range Failed: ${response.status} - ${errorMsg}`);
        }

        return await response.arrayBuffer();
    }

    /**
     * HeadObject(下载辅助 API),获取文件的元数据(如大小、类型等)
     * @param objectName OSS 中的文件名
     */
    async headObject(objectName: string): Promise<Headers> {
        const verb = 'HEAD';
        const date = new Date().toUTCString();
        const canonicalizedResource = `/${this.config.bucket}/${objectName}`;
        const stringToSign = `${verb}\n\n\n${date}\n${canonicalizedResource}`;
        const signature = this.computeSignature(stringToSign);
        const authorization = `OSS ${this.config.accessKeyId}:${signature}`;

        const url = `https://${this.endpoint}/${objectName}`;
        const response = await fetch(url, {
            method: verb,
            headers: {
                'Date': date,
                'Authorization': authorization,
            },
        });

        if (!response.ok) {
            throw new Error(`HeadObject Failed: ${response.status}`);
        }
        return response.headers;
    }

    /**
     * 生成带有效期的带签名的上传链接
     * @param objectName OSS 中的文件名
     * @param expiresIn 有效期 (单位:秒),默认 3600 秒
     * @param contentType MIME 类型
     */
    putObjectPresign(objectName: string, expiresIn: number = 3600, contentType: string = 'application/octet-stream'): string {
        const verb = 'PUT';
        const expiresTimestamp = Math.floor(Date.now() / 1000) + expiresIn;
        const canonicalizedResource = `/${this.config.bucket}/${objectName}`;

        const stringToSign = `${verb}\n\n${contentType}\n${expiresTimestamp}\n${canonicalizedResource}`;
        const signature = this.computeSignature(stringToSign);

        const params = new URLSearchParams({
            OSSAccessKeyId: this.config.accessKeyId,
            Expires: expiresTimestamp.toString(),
            Signature: signature,
        });

        return `https://${this.endpoint}/${objectName}?${params.toString()}`;
    }
}