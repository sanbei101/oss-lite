import { describe, it, expect } from 'vitest';
import { LiteOSS } from './oss';

describe('LiteOSS', () => {
    if (!process.env.OSS_ACCESS_KEY_ID || !process.env.OSS_ACCESS_KEY_SECRET) {
        console.warn('Skipping tests: OSS_ACCESS_KEY_ID and OSS_ACCESS_KEY_SECRET environment variables are not set.');
        return;
    }

    const config = {
        accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
        accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
        bucket: 'tuchuang-ghr',
        region: 'oss-cn-beijing'
    };

    const oss = new LiteOSS(config);

    it('should generate correct presigned URL', () => {
        const url = oss.getPresignedUrl('gsc.png', 3600);
        console.log('Generated Presigned URL:', url);
        expect(url).toContain('https://tuchuang-ghr.oss-cn-beijing.aliyuncs.com/gsc.png');
        expect(url).toContain('OSSAccessKeyId=LTAI5t8bSiHSS5eWFQXkA8hZ');
        expect(url).toContain('Signature=');
        expect(url).toContain('Expires=');
    });

    it('should successfully upload and download a file', async () => {
        const testContent = `hello world vitest - ${Date.now()}!`;
        const objectName = `vitest-upload-test.txt`;
        const uploadRes = await oss.uploadFile(objectName, testContent, 'text/plain');
        expect(uploadRes.success).toBe(true);
        expect(uploadRes.objectName).toBe(objectName);
        expect(uploadRes.url).toBe(`https://tuchuang-ghr.oss-cn-beijing.aliyuncs.com/${objectName}`);

        const downloadBuffer = await oss.downloadFile(objectName);
        const downloadText = new TextDecoder().decode(downloadBuffer);

        expect(downloadText).toBe(testContent);
    });
});
