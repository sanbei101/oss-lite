import { describe, it, expect } from 'vitest';
import { LiteOSS } from './oss';

describe('LiteOSS', () => {
    if (!process.env.OSS_ACCESS_KEY_ID || !process.env.OSS_ACCESS_KEY_SECRET) {
        it.skip('Skipped because OSS_ACCESS_KEY_ID and OSS_ACCESS_KEY_SECRET are not set', () => { });
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
        expect(url).toContain('https://tuchuang-ghr.oss-cn-beijing.aliyuncs.com/gsc.png');
        expect(url).toContain('OSSAccessKeyId=LTAI5t8bSiHSS5eWFQXkA8hZ');
        expect(url).toContain('Signature=');
        expect(url).toContain('Expires=');
    });

    it('should successfully upload and download a file', async () => {
        const testContent = `hello world vitest - ${Date.now()}!`;
        const objectName = `vitest-upload-test-${Date.now()}.txt`;
        const uploadRes = await oss.uploadFile(objectName, testContent, 'text/plain');
        expect(uploadRes.success).toBe(true);
        expect(uploadRes.objectName).toBe(objectName);
        expect(uploadRes.url).toBe(`https://tuchuang-ghr.oss-cn-beijing.aliyuncs.com/${objectName}`);

        const downloadBuffer = await oss.downloadFile(objectName);
        const downloadText = new TextDecoder().decode(downloadBuffer);

        expect(downloadText).toBe(testContent);
        await oss.deleteFile(objectName);
    });

    it('should get head object', async () => {
        const objectName = `vitest-head-test-${Date.now()}.txt`;
        await oss.uploadFile(objectName, 'head test content', 'text/plain');

        const headers = await oss.headObject(objectName);
        expect(headers).toBeDefined();
        expect(headers.has('content-length')).toBe(true);
        expect(headers.get('content-length')).toBe('17');
        expect(headers.get('content-type')).toBe('text/plain');
        await oss.deleteFile(objectName);
    });

    it('should download file with range', async () => {
        const objectName = `vitest-range-test-${Date.now()}.txt`;
        const content = '0123456789'; // 10 bytes
        await oss.uploadFile(objectName, content, 'text/plain');

        const buffer = await oss.downloadFileWithRange(objectName, 'bytes=2-5');
        const text = new TextDecoder().decode(buffer);
        expect(text).toBe('2345');
        await oss.deleteFile(objectName);
    });

    it('should generate put object presign URL', () => {
        const url = oss.putObjectPresign('presign-put.txt', 3600, 'text/plain');
        expect(url).toContain('https://tuchuang-ghr.oss-cn-beijing.aliyuncs.com/presign-put.txt');
        expect(url).toContain('Signature=');
        expect(url).toContain('Expires=');
    });

    it('should successfully perform multipart upload', async () => {
        const objectName = `vitest-multipart-test-${Date.now()}.txt`;
        const part1Content = 'a'.repeat(102400); // 100KB minimum size for non-last parts
        const part2Content = 'part 2 content.';
        const fullContent = part1Content + part2Content;

        const uploadId = await oss.initiateMultipartUpload(objectName, 'text/plain');
        expect(uploadId).toBeTruthy();

        const eTag1 = await oss.uploadPart(objectName, uploadId, 1, part1Content);
        expect(eTag1).toBeTruthy();

        const eTag2 = await oss.uploadPart(objectName, uploadId, 2, part2Content);
        expect(eTag2).toBeTruthy();

        await oss.completeMultipartUpload(objectName, uploadId, [
            { partNumber: 1, eTag: eTag1 },
            { partNumber: 2, eTag: eTag2 }
        ]);

        const downloadBuffer = await oss.downloadFile(objectName);
        const downloadText = new TextDecoder().decode(downloadBuffer);
        expect(downloadText).toBe(fullContent);
        await oss.deleteFile(objectName);
    });

    it('should successfully abort multipart upload', async () => {
        const objectName = `vitest-abort-test-${Date.now()}.txt`;
        const uploadId = await oss.initiateMultipartUpload(objectName, 'text/plain');
        expect(uploadId).toBeTruthy();

        await oss.abortMultipartUpload(objectName, uploadId);
    });

    it('should successfully delete a file', async () => {
        const objectName = `vitest-delete-test-${Date.now()}.txt`;
        await oss.uploadFile(objectName, 'delete me', 'text/plain');

        await oss.deleteFile(objectName);
        await expect(oss.headObject(objectName)).rejects.toThrow('404');
    });
});
