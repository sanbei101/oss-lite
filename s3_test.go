package lites3

import (
	"context"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"os"
	"strings"
	"testing"
)

type mockTransport struct {
	resp *http.Response
	err  error
}

func (m *mockTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return m.resp, m.err
}

func createMockClient(config Config, statusCode int, body string, headers map[string]string) *Client {
	client := NewClient(config)
	mockResp := &http.Response{
		StatusCode: statusCode,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
	}
	for k, v := range headers {
		mockResp.Header.Set(k, v)
	}
	client.httpClient.Transport = &mockTransport{resp: mockResp}
	return client
}

func getRandomString() string {
	return fmt.Sprintf("%x", rand.Uint32())
}

func TestLiteS3(t *testing.T) {
	ak := os.Getenv("OSS_ACCESS_KEY_ID")
	sk := os.Getenv("OSS_ACCESS_KEY_SECRET")

	if ak == "" || sk == "" {
		t.Skip("Skipped because OSS_ACCESS_KEY_ID and OSS_ACCESS_KEY_SECRET are not set")
		return
	}

	config := Config{
		AccessKeyID:     ak,
		AccessKeySecret: sk,
		Bucket:          "tuchuang-ghr",
		Region:          "oss-cn-beijing",
		Endpoint:        "s3.oss-cn-beijing.aliyuncs.com",
	}

	s3 := NewClient(config)
	ctx := context.Background()

	t.Run("should generate correct presigned URL", func(t *testing.T) {
		url := s3.GetPresignedURL("test.png", 3600)
		if !strings.Contains(url, "https://tuchuang-ghr.s3.oss-cn-beijing.aliyuncs.com/test.png") {
			t.Errorf("Missing expected base URL in: %s", url)
		}
		if !strings.Contains(url, "AWSAccessKeyId="+config.AccessKeyID) {
			t.Errorf("Missing AWSAccessKeyId in: %s", url)
		}
		if !strings.Contains(url, "Signature=") {
			t.Errorf("Missing Signature in: %s", url)
		}
		if !strings.Contains(url, "Expires=") {
			t.Errorf("Missing Expires in: %s", url)
		}
	})

	t.Run("should successfully upload and download a file", func(t *testing.T) {
		testContent := fmt.Sprintf("hello world vitest - %s!", getRandomString())
		objectName := fmt.Sprintf("vitest-upload-test-%s.txt", getRandomString())

		uploadRes, err := s3.UploadFile(ctx, objectName, strings.NewReader(testContent), "text/plain")
		if err != nil {
			t.Fatalf("UploadFile failed: %v", err)
		}
		if !uploadRes.Success {
			t.Errorf("Expected success to be true")
		}
		if uploadRes.ObjectName != objectName {
			t.Errorf("Expected objectName %s, got %s", objectName, uploadRes.ObjectName)
		}
		expectedURL := fmt.Sprintf("https://tuchuang-ghr.s3.oss-cn-beijing.aliyuncs.com/%s", objectName)
		if uploadRes.URL != expectedURL {
			t.Errorf("Expected URL %s, got %s", expectedURL, uploadRes.URL)
		}

		downloadBuffer, err := s3.DownloadFile(ctx, objectName)
		if err != nil {
			t.Fatalf("DownloadFile failed: %v", err)
		}
		if string(downloadBuffer) != testContent {
			t.Errorf("Download content mismatch. Expected %s, got %s", testContent, string(downloadBuffer))
		}

		_ = s3.DeleteFile(ctx, objectName)
	})

	t.Run("should get head object", func(t *testing.T) {
		objectName := fmt.Sprintf("vitest-head-test-%s.txt", getRandomString())
		_, err := s3.UploadFile(ctx, objectName, strings.NewReader("head test content"), "text/plain")
		if err != nil {
			t.Fatalf("UploadFile failed: %v", err)
		}
		defer s3.DeleteFile(ctx, objectName)

		headers, err := s3.HeadObject(ctx, objectName)
		if err != nil {
			t.Fatalf("HeadObject failed: %v", err)
		}
		if headers.Get("Content-Length") != "17" {
			t.Errorf("Expected Content-Length to be 17, got %s", headers.Get("Content-Length"))
		}
		if !strings.Contains(headers.Get("Content-Type"), "text/plain") {
			t.Errorf("Expected Content-Type to contain text/plain, got %s", headers.Get("Content-Type"))
		}
	})

	t.Run("should download file with range", func(t *testing.T) {
		objectName := fmt.Sprintf("vitest-range-test-%s.txt", getRandomString())
		content := "0123456789" // 10 bytes
		_, err := s3.UploadFile(ctx, objectName, strings.NewReader(content), "text/plain")
		if err != nil {
			t.Fatalf("UploadFile failed: %v", err)
		}
		defer s3.DeleteFile(ctx, objectName)

		buffer, err := s3.DownloadFileWithRange(ctx, objectName, "bytes=2-5")
		if err != nil {
			t.Fatalf("DownloadFileWithRange failed: %v", err)
		}
		if string(buffer) != "2345" {
			t.Errorf("Expected 2345, got %s", string(buffer))
		}
	})

	t.Run("should generate put object presign URL", func(t *testing.T) {
		url := s3.PutObjectPresign("presign-put.txt", 3600, "text/plain")
		if !strings.Contains(url, "https://tuchuang-ghr.s3.oss-cn-beijing.aliyuncs.com/presign-put.txt") {
			t.Errorf("Missing expected base URL in: %s", url)
		}
		if !strings.Contains(url, "Signature=") {
			t.Errorf("Missing Signature in: %s", url)
		}
		if !strings.Contains(url, "Expires=") {
			t.Errorf("Missing Expires in: %s", url)
		}
	})

	t.Run("should successfully perform multipart upload", func(t *testing.T) {
		objectName := fmt.Sprintf("vitest-multipart-test-%s.txt", getRandomString())
		part1Content := strings.Repeat("a", 102400) // 100KB
		part2Content := "part 2 content."
		fullContent := part1Content + part2Content

		uploadId, err := s3.InitiateMultipartUpload(ctx, objectName, "text/plain")
		if err != nil {
			t.Fatalf("InitiateMultipartUpload failed: %v", err)
		}
		if uploadId == "" {
			t.Fatalf("uploadId is empty")
		}

		eTag1, err := s3.UploadPart(ctx, objectName, uploadId, 1, strings.NewReader(part1Content), "text/plain")
		if err != nil {
			t.Fatalf("UploadPart 1 failed: %v", err)
		}
		if eTag1 == "" {
			t.Fatalf("eTag1 is empty")
		}

		eTag2, err := s3.UploadPart(ctx, objectName, uploadId, 2, strings.NewReader(part2Content), "text/plain")
		if err != nil {
			t.Fatalf("UploadPart 2 failed: %v", err)
		}
		if eTag2 == "" {
			t.Fatalf("eTag2 is empty")
		}

		err = s3.CompleteMultipartUpload(ctx, objectName, uploadId, []Part{
			{PartNumber: 1, ETag: eTag1},
			{PartNumber: 2, ETag: eTag2},
		})
		if err != nil {
			t.Fatalf("CompleteMultipartUpload failed: %v", err)
		}

		downloadBuffer, err := s3.DownloadFile(ctx, objectName)
		if err != nil {
			t.Fatalf("DownloadFile failed: %v", err)
		}
		if string(downloadBuffer) != fullContent {
			t.Errorf("Content mismatch in multipart upload")
		}

		_ = s3.DeleteFile(ctx, objectName)
	})

	t.Run("should successfully abort multipart upload", func(t *testing.T) {
		objectName := fmt.Sprintf("vitest-abort-test-%s.txt", getRandomString())
		uploadId, err := s3.InitiateMultipartUpload(ctx, objectName, "text/plain")
		if err != nil {
			t.Fatalf("InitiateMultipartUpload failed: %v", err)
		}

		err = s3.AbortMultipartUpload(ctx, objectName, uploadId)
		if err != nil {
			t.Fatalf("AbortMultipartUpload failed: %v", err)
		}
	})

	// ---------------------- 异常/错误处理测试 (使用 Mock 拦截) ----------------------

	t.Run("should throw error when abort multipart upload fails", func(t *testing.T) {
		mockS3 := createMockClient(config, 500, "Internal Error", nil)
		err := mockS3.AbortMultipartUpload(ctx, "test.txt", "fake-id")
		if err == nil || !strings.Contains(err.Error(), "abort multipart upload failed: 500") {
			t.Errorf("Expected abort failure error, got: %v", err)
		}
	})

	t.Run("should throw error when delete file fails", func(t *testing.T) {
		mockS3 := createMockClient(config, 404, "Not Found", nil)
		err := mockS3.DeleteFile(ctx, "test.txt")
		if err == nil || !strings.Contains(err.Error(), "delete failed: 404") {
			t.Errorf("Expected delete failure error, got: %v", err)
		}
	})

	t.Run("should throw error when download file with range fails", func(t *testing.T) {
		mockS3 := createMockClient(config, 500, "Server Error", nil)
		_, err := mockS3.DownloadFileWithRange(ctx, "test.txt", "bytes=0-100")
		if err == nil || !strings.Contains(err.Error(), "download with range failed: 500") {
			t.Errorf("Expected download with range failure error, got: %v", err)
		}
	})

	t.Run("should throw error when upload file fails", func(t *testing.T) {
		mockS3 := createMockClient(config, 500, "Server Error", nil)
		_, err := mockS3.UploadFile(ctx, "test.txt", strings.NewReader("test"), "text/plain")
		if err == nil || !strings.Contains(err.Error(), "upload failed: 500") {
			t.Errorf("Expected upload failure error, got: %v", err)
		}
	})

	t.Run("should throw error when download file fails", func(t *testing.T) {
		mockS3 := createMockClient(config, 404, "Not Found", nil)
		_, err := mockS3.DownloadFile(ctx, "test.txt")
		if err == nil || !strings.Contains(err.Error(), "download failed: 404") {
			t.Errorf("Expected download failure error, got: %v", err)
		}
	})

	t.Run("should throw error when initiate multipart upload fails", func(t *testing.T) {
		mockS3 := createMockClient(config, 500, "Server Error", nil)
		_, err := mockS3.InitiateMultipartUpload(ctx, "test.txt", "text/plain")
		if err == nil || !strings.Contains(err.Error(), "initiate multipart upload failed: 500") {
			t.Errorf("Expected initiate multipart failure error, got: %v", err)
		}
	})

	t.Run("should throw error when cannot parse uploadId", func(t *testing.T) {
		mockS3 := createMockClient(config, 200, "No UploadId XML", nil)
		_, err := mockS3.InitiateMultipartUpload(ctx, "test.txt", "text/plain")
		if err == nil || !strings.Contains(err.Error(), "cannot parse uploadId") {
			t.Errorf("Expected parse XML error, got: %v", err)
		}
	})

	t.Run("should throw error when upload part fails", func(t *testing.T) {
		mockS3 := createMockClient(config, 500, "Server Error", nil)
		_, err := mockS3.UploadPart(ctx, "test.txt", "fake-id", 1, strings.NewReader("data"), "text/plain")
		if err == nil || !strings.Contains(err.Error(), "upload part failed: 500") {
			t.Errorf("Expected upload part failure error, got: %v", err)
		}
	})

	t.Run("should return empty string when ETag is null", func(t *testing.T) {
		mockS3 := createMockClient(config, 200, "OK", nil) // 没传 ETag Header
		eTag, err := mockS3.UploadPart(ctx, "test.txt", "fake-id", 1, strings.NewReader("data"), "text/plain")
		if err != nil {
			t.Fatalf("Unexpected error: %v", err)
		}
		if eTag != "" {
			t.Errorf("Expected empty ETag, got: %s", eTag)
		}
	})

	t.Run("should throw error when complete multipart upload fails", func(t *testing.T) {
		mockS3 := createMockClient(config, 500, "Server Error", nil)
		err := mockS3.CompleteMultipartUpload(ctx, "test.txt", "fake-id", []Part{{PartNumber: 1, ETag: "etag"}})
		if err == nil || !strings.Contains(err.Error(), "complete multipart upload failed: 500") {
			t.Errorf("Expected complete multipart failure error, got: %v", err)
		}
	})

	t.Run("should throw error when head object fails", func(t *testing.T) {
		mockS3 := createMockClient(config, 404, "Not Found", nil)
		_, err := mockS3.HeadObject(ctx, "test.txt")
		if err == nil || !strings.Contains(err.Error(), "head object failed: 404") {
			t.Errorf("Expected head object failure error, got: %v", err)
		}
	})

	t.Run("should successfully delete a file", func(t *testing.T) {
		objectName := fmt.Sprintf("vitest-delete-test-%s.txt", getRandomString())
		s3.UploadFile(ctx, objectName, strings.NewReader("delete me"), "text/plain")

		err := s3.DeleteFile(ctx, objectName)
		if err != nil {
			t.Fatalf("DeleteFile failed: %v", err)
		}

		header, err := s3.HeadObject(ctx, objectName)
		if err == nil || header.Get("Content-Length") != "" {
			t.Errorf("Expected HeadObject to fail after deletion, but it succeeded")
		}
	})
}
