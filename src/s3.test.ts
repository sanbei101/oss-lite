import { describe, it, expect, vi } from "vitest";
import { LiteS3 } from "./s3";

describe("LiteS3", () => {
  if (!process.env.OSS_ACCESS_KEY_ID || !process.env.OSS_ACCESS_KEY_SECRET) {
    it.skip("Skipped because OSS_ACCESS_KEY_ID and OSS_ACCESS_KEY_SECRET are not set", () => {});
    return;
  }

  const config = {
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    bucket: "tuchuang-ghr",
    region: "oss-cn-beijing",
  };

  const s3 = new LiteS3(config);

  it("should use internal endpoint when internal is true", () => {
    const internalS3 = new LiteS3({ ...config, internal: true });
    const url = internalS3.getPresignedUrl("test.txt", 3600);
    expect(url).toContain(".s3.oss-cn-beijing-internal.aliyuncs.com");
  });

  it("should generate correct presigned URL", () => {
    const url = s3.getPresignedUrl("test.png", 3600);
    expect(url).toContain("https://tuchuang-ghr.s3.oss-cn-beijing.aliyuncs.com/test.png");
    expect(url).toContain(`AWSAccessKeyId=${config.accessKeyId}`);
    expect(url).toContain("Signature=");
    expect(url).toContain("Expires=");
  });

  it("should successfully upload and download a file", async () => {
    const testContent = `hello world vitest - ${Math.random().toString(36).slice(2)}!`;
    const objectName = `vitest-upload-test-${Math.random().toString(36).slice(2)}.txt`;
    const uploadRes = await s3.uploadFile(objectName, testContent, "text/plain");
    expect(uploadRes.success).toBe(true);
    expect(uploadRes.objectName).toBe(objectName);
    expect(uploadRes.url).toBe(`https://tuchuang-ghr.s3.oss-cn-beijing.aliyuncs.com/${objectName}`);

    const downloadBuffer = await s3.downloadFile(objectName);
    const downloadText = new TextDecoder().decode(downloadBuffer);

    expect(downloadText).toBe(testContent);
    await s3.deleteFile(objectName);
  });

  it("should get head object", async () => {
    const objectName = `vitest-head-test-${Math.random().toString(36).slice(2)}.txt`;
    await s3.uploadFile(objectName, "head test content", "text/plain");

    const headers = await s3.headObject(objectName);
    expect(headers).toBeDefined();
    expect(headers.has("content-length")).toBe(true);
    expect(headers.get("content-length")).toBe("17");
    expect(headers.get("content-type")).toBe("text/plain");
    await s3.deleteFile(objectName);
  });

  it("should download file with range", async () => {
    const objectName = `vitest-range-test-${Math.random().toString(36).slice(2)}.txt`;
    const content = "0123456789"; // 10 bytes
    await s3.uploadFile(objectName, content, "text/plain");

    const buffer = await s3.downloadFileWithRange(objectName, "bytes=2-5");
    const text = new TextDecoder().decode(buffer);
    expect(text).toBe("2345");
    await s3.deleteFile(objectName);
  });

  it("should generate put object presign URL", () => {
    const url = s3.putObjectPresign("presign-put.txt", 3600, "text/plain");
    expect(url).toContain("https://tuchuang-ghr.s3.oss-cn-beijing.aliyuncs.com/presign-put.txt");
    expect(url).toContain("Signature=");
    expect(url).toContain("Expires=");
  });

  it("should successfully perform multipart upload", async () => {
    const objectName = `vitest-multipart-test-${Math.random().toString(36).slice(2)}.txt`;
    const part1Content = "a".repeat(102400); // 100KB minimum size for non-last parts
    const part2Content = "part 2 content.";
    const fullContent = part1Content + part2Content;

    const uploadId = await s3.initiateMultipartUpload(objectName, "text/plain");
    expect(uploadId).toBeTruthy();

    const eTag1 = await s3.uploadPart(objectName, uploadId, 1, part1Content);
    expect(eTag1).toBeTruthy();

    const eTag2 = await s3.uploadPart(objectName, uploadId, 2, part2Content);
    expect(eTag2).toBeTruthy();

    await s3.completeMultipartUpload(objectName, uploadId, [
      { partNumber: 1, eTag: eTag1 },
      { partNumber: 2, eTag: eTag2 },
    ]);

    const downloadBuffer = await s3.downloadFile(objectName);
    const downloadText = new TextDecoder().decode(downloadBuffer);
    expect(downloadText).toBe(fullContent);
    await s3.deleteFile(objectName);
  });

  it("should successfully abort multipart upload", async () => {
    const objectName = `vitest-abort-test-${Math.random().toString(36).slice(2)}.txt`;
    const uploadId = await s3.initiateMultipartUpload(objectName, "text/plain");
    expect(uploadId).toBeTruthy();

    await s3.abortMultipartUpload(objectName, uploadId);
  });

  it("should throw error when abort multipart upload fails", async () => {
    const objectName = `vitest-abort-test-${Math.random().toString(36).slice(2)}.txt`;
    const uploadId = "fake-upload-id";

    const response = new Response("Internal Error", { status: 500 });
    vi.spyOn(global, "fetch").mockResolvedValue(response);

    await expect(s3.abortMultipartUpload(objectName, uploadId)).rejects.toThrow(
      "AbortMultipartUpload Failed: 500",
    );
    vi.restoreAllMocks();
  });

  it("should throw error when delete file fails", async () => {
    const objectName = `vitest-delete-test-${Math.random().toString(36).slice(2)}.txt`;

    const response = new Response("Not Found", { status: 404 });
    vi.spyOn(global, "fetch").mockResolvedValue(response);

    await expect(s3.deleteFile(objectName)).rejects.toThrow("Delete Failed: 404");
    vi.restoreAllMocks();
  });

  it("should throw error when download file with range fails", async () => {
    const objectName = `vitest-range-test-${Math.random().toString(36).slice(2)}.txt`;

    const response = new Response("Server Error", { status: 500 });
    vi.spyOn(global, "fetch").mockResolvedValue(response);

    await expect(s3.downloadFileWithRange(objectName, "bytes=0-100")).rejects.toThrow(
      "Download with Range Failed: 500",
    );
    vi.restoreAllMocks();
  });

  it("should throw error when upload file fails", async () => {
    const objectName = `vitest-upload-test-${Math.random().toString(36).slice(2)}.txt`;

    const response = new Response("Server Error", { status: 500 });
    vi.spyOn(global, "fetch").mockResolvedValue(response);

    await expect(s3.uploadFile(objectName, "test", "text/plain")).rejects.toThrow(
      "Upload Failed: 500",
    );
    vi.restoreAllMocks();
  });

  it("should throw error when download file fails", async () => {
    const objectName = `vitest-download-test-${Math.random().toString(36).slice(2)}.txt`;

    const response = new Response("Not Found", { status: 404 });
    vi.spyOn(global, "fetch").mockResolvedValue(response);

    await expect(s3.downloadFile(objectName)).rejects.toThrow("Download Failed: 404");
    vi.restoreAllMocks();
  });

  it("should throw error when initiate multipart upload fails", async () => {
    const objectName = `vitest-multipart-test-${Math.random().toString(36).slice(2)}.txt`;

    const response = new Response("Server Error", { status: 500 });
    vi.spyOn(global, "fetch").mockResolvedValue(response);

    await expect(s3.initiateMultipartUpload(objectName, "text/plain")).rejects.toThrow(
      "InitiateMultipartUpload Failed: 500",
    );
    vi.restoreAllMocks();
  });

  it("should throw error when cannot parse uploadId", async () => {
    const objectName = `vitest-multipart-test-${Math.random().toString(36).slice(2)}.txt`;

    const response = new Response("No UploadId", { status: 200 });
    vi.spyOn(global, "fetch").mockResolvedValue(response);

    await expect(s3.initiateMultipartUpload(objectName, "text/plain")).rejects.toThrow(
      "Cannot parse UploadId",
    );
    vi.restoreAllMocks();
  });

  it("should throw error when upload part fails", async () => {
    const objectName = `vitest-upload-part-test-${Math.random().toString(36).slice(2)}.txt`;
    const uploadId = "fake-upload-id";

    const response = new Response("Server Error", { status: 500 });
    vi.spyOn(global, "fetch").mockResolvedValue(response);

    await expect(s3.uploadPart(objectName, uploadId, 1, "data")).rejects.toThrow(
      "UploadPart Failed: 500",
    );
    vi.restoreAllMocks();
  });

  it("should return empty string when ETag is null", async () => {
    const objectName = `vitest-etag-test-${Math.random().toString(36).slice(2)}.txt`;
    const uploadId = "fake-upload-id";

    const headers = new Headers();
    const response = new Response("OK", { status: 200, headers });
    vi.spyOn(global, "fetch").mockResolvedValue(response);

    const eTag = await s3.uploadPart(objectName, uploadId, 1, "data");
    expect(eTag).toBe("");
    vi.restoreAllMocks();
  });

  it("should throw error when complete multipart upload fails", async () => {
    const objectName = `vitest-complete-test-${Math.random().toString(36).slice(2)}.txt`;
    const uploadId = "fake-upload-id";

    const response = new Response("Server Error", { status: 500 });
    vi.spyOn(global, "fetch").mockResolvedValue(response);

    await expect(
      s3.completeMultipartUpload(objectName, uploadId, [{ partNumber: 1, eTag: "etag" }]),
    ).rejects.toThrow("CompleteMultipartUpload Failed: 500");
    vi.restoreAllMocks();
  });

  it("should throw error when head object fails", async () => {
    const objectName = `vitest-head-test-${Math.random().toString(36).slice(2)}.txt`;

    const response = new Response("Not Found", { status: 404 });
    vi.spyOn(global, "fetch").mockResolvedValue(response);

    await expect(s3.headObject(objectName)).rejects.toThrow("HeadObject Failed: 404");
    vi.restoreAllMocks();
  });

  it("should successfully delete a file", async () => {
    const objectName = `vitest-delete-test-${Math.random().toString(36).slice(2)}.txt`;
    await s3.uploadFile(objectName, "delete me", "text/plain");

    await s3.deleteFile(objectName);
    await expect(s3.headObject(objectName)).rejects.toThrow("404");
  });
});
