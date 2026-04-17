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
     * 功能二:下载文件为 Buffer (对应 API: GetObject)
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
     * 功能三:生成带有效期的临时下载链接 (URL 签名)
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
}