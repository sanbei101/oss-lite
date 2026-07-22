package lites3

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Config 存储 S3/OSS 配置信息
type Config struct {
	AccessKeyID     string
	AccessKeySecret string
	Bucket          string
	Region          string
	Internal        bool
}

// Client LiteS3 客户端
type Client struct {
	config     Config
	endpoint   string
	httpClient *http.Client
}

// UploadResult 上传成功后的返回值
type UploadResult struct {
	Success    bool
	URL        string
	ObjectName string
}

// Part 分片上传的每个分片信息
type Part struct {
	PartNumber int    `xml:"PartNumber"`
	ETag       string `xml:"ETag"`
}

// CompleteMultipartUpload 组装完成分片上传的 XML 结构
type CompleteMultipartUpload struct {
	XMLName xml.Name `xml:"CompleteMultipartUpload"`
	Parts   []Part   `xml:"Part"`
}

// NewClient 初始化 LiteS3 客户端
func NewClient(config Config) *Client {
	config.AccessKeyID = strings.TrimSpace(config.AccessKeyID)
	config.AccessKeySecret = strings.TrimSpace(config.AccessKeySecret)

	networkType := ""
	if config.Internal {
		networkType = "-internal"
	}
	endpoint := fmt.Sprintf("%s.s3.%s%s.aliyuncs.com", config.Bucket, config.Region, networkType)

	return &Client{
		config:   config,
		endpoint: endpoint,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// computeSignature 计算 HMAC-SHA1 签名并进行 base64 编码
func (c *Client) computeSignature(stringToSign string) string {
	mac := hmac.New(sha1.New, []byte(c.config.AccessKeySecret))
	mac.Write([]byte(stringToSign))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// generateAuthHeader 生成标准的 Authorization 请求头
func (c *Client) generateAuthHeader(signature string) string {
	return fmt.Sprintf("AWS %s:%s", c.config.AccessKeyID, signature)
}

// UploadFile 上传文件
func (c *Client) UploadFile(
	ctx context.Context,
	objectName string,
	data io.Reader,
	contentType string,
) (*UploadResult, error) {
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	verb := http.MethodPut
	date := time.Now().UTC().Format(http.TimeFormat)
	canonicalizedResource := fmt.Sprintf("/%s/%s", c.config.Bucket, objectName)
	stringToSign := fmt.Sprintf("%s\n\n%s\n%s\n%s", verb, contentType, date, canonicalizedResource)

	reqURL := fmt.Sprintf("https://%s/%s", c.endpoint, objectName)
	req, err := http.NewRequestWithContext(ctx, verb, reqURL, data)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Date", date)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", c.generateAuthHeader(c.computeSignature(stringToSign)))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		errorMsg, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Upload Failed: %d - %s", resp.StatusCode, string(errorMsg))
	}

	return &UploadResult{Success: true, URL: reqURL, ObjectName: objectName}, nil
}

// DownloadFile 下载文件,返回文件内容的字节数组 []byte
func (c *Client) DownloadFile(ctx context.Context, objectName string) ([]byte, error) {
	verb := http.MethodGet
	date := time.Now().UTC().Format(http.TimeFormat)
	canonicalizedResource := fmt.Sprintf("/%s/%s", c.config.Bucket, objectName)
	stringToSign := fmt.Sprintf("%s\n\n\n%s\n%s", verb, date, canonicalizedResource)

	reqURL := fmt.Sprintf("https://%s/%s", c.endpoint, objectName)
	req, err := http.NewRequestWithContext(ctx, verb, reqURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Date", date)
	req.Header.Set("Authorization", c.generateAuthHeader(c.computeSignature(stringToSign)))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errorMsg, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Download Failed: %d - %s", resp.StatusCode, string(errorMsg))
	}

	return io.ReadAll(resp.Body)
}

// GetPresignedURL 生成带有效期的临时下载链接 (expiresIn 默认值传入 3600)
func (c *Client) GetPresignedURL(objectName string, expiresIn int64) string {
	if expiresIn <= 0 {
		expiresIn = 3600
	}
	verb := http.MethodGet
	expiresTimestamp := time.Now().Unix() + expiresIn
	canonicalizedResource := fmt.Sprintf("/%s/%s", c.config.Bucket, objectName)

	stringToSign := fmt.Sprintf("%s\n\n\n%d\n%s", verb, expiresTimestamp, canonicalizedResource)
	signature := c.computeSignature(stringToSign)

	params := url.Values{}
	params.Set("AWSAccessKeyId", c.config.AccessKeyID)
	params.Set("Expires", strconv.FormatInt(expiresTimestamp, 10))
	params.Set("Signature", signature)

	return fmt.Sprintf("https://%s/%s?%s", c.endpoint, objectName, params.Encode())
}

// InitiateMultipartUpload 分片上传 - 初始化
func (c *Client) InitiateMultipartUpload(ctx context.Context, objectName, contentType string) (string, error) {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	verb := http.MethodPost
	date := time.Now().UTC().Format(http.TimeFormat)
	canonicalizedResource := fmt.Sprintf("/%s/%s?uploads", c.config.Bucket, objectName)
	stringToSign := fmt.Sprintf("%s\n\n%s\n%s\n%s", verb, contentType, date, canonicalizedResource)

	reqURL := fmt.Sprintf("https://%s/%s?uploads", c.endpoint, objectName)
	req, err := http.NewRequestWithContext(ctx, verb, reqURL, nil)
	if err != nil {
		return "", err
	}

	req.Header.Set("Date", date)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", c.generateAuthHeader(c.computeSignature(stringToSign)))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errorMsg, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("InitiateMultipartUpload Failed: %d - %s", resp.StatusCode, string(errorMsg))
	}

	body, _ := io.ReadAll(resp.Body)
	var result struct {
		UploadID string `xml:"UploadId"`
	}
	if err := xml.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("cannot parse UploadId XML: %w (raw: %s)", err, string(body))
	}
	return result.UploadID, nil
}

// UploadPart 分片上传 - 上传分片数据
func (c *Client) UploadPart(
	ctx context.Context,
	objectName, uploadID string,
	partNumber int,
	data io.Reader,
	contentType string,
) (string, error) {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	verb := http.MethodPut
	date := time.Now().UTC().Format(http.TimeFormat)
	canonicalizedResource := fmt.Sprintf(
		"/%s/%s?partNumber=%d&uploadId=%s",
		c.config.Bucket,
		objectName,
		partNumber,
		uploadID,
	)
	stringToSign := fmt.Sprintf("%s\n\n%s\n%s\n%s", verb, contentType, date, canonicalizedResource)

	reqURL := fmt.Sprintf("https://%s/%s?partNumber=%d&uploadId=%s", c.endpoint, objectName, partNumber, uploadID)
	req, err := http.NewRequestWithContext(ctx, verb, reqURL, data)
	if err != nil {
		return "", err
	}

	req.Header.Set("Date", date)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", c.generateAuthHeader(c.computeSignature(stringToSign)))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errorMsg, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("UploadPart Failed: %d - %s", resp.StatusCode, string(errorMsg))
	}

	return resp.Header.Get("ETag"), nil
}

// CompleteMultipartUpload 分片上传 - 完成
func (c *Client) CompleteMultipartUpload(ctx context.Context, objectName, uploadID string, parts []Part) error {
	verb := http.MethodPost
	date := time.Now().UTC().Format(http.TimeFormat)
	canonicalizedResource := fmt.Sprintf("/%s/%s?uploadId=%s", c.config.Bucket, objectName, uploadID)
	contentType := "application/xml"
	stringToSign := fmt.Sprintf("%s\n\n%s\n%s\n%s", verb, contentType, date, canonicalizedResource)

	xmlBody, err := xml.Marshal(CompleteMultipartUpload{Parts: parts})
	if err != nil {
		return err
	}
	body := append([]byte(xml.Header), xmlBody...)

	reqURL := fmt.Sprintf("https://%s/%s?uploadId=%s", c.endpoint, objectName, uploadID)
	req, err := http.NewRequestWithContext(ctx, verb, reqURL, bytes.NewReader(body))
	if err != nil {
		return err
	}

	req.Header.Set("Date", date)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", c.generateAuthHeader(c.computeSignature(stringToSign)))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errorMsg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("CompleteMultipartUpload Failed: %d - %s", resp.StatusCode, string(errorMsg))
	}

	return nil
}

// AbortMultipartUpload 分片上传 - 取消
func (c *Client) AbortMultipartUpload(ctx context.Context, objectName, uploadID string) error {
	verb := http.MethodDelete
	date := time.Now().UTC().Format(http.TimeFormat)
	canonicalizedResource := fmt.Sprintf("/%s/%s?uploadId=%s", c.config.Bucket, objectName, uploadID)
	stringToSign := fmt.Sprintf("%s\n\n\n%s\n%s", verb, date, canonicalizedResource)

	reqURL := fmt.Sprintf("https://%s/%s?uploadId=%s", c.endpoint, objectName, uploadID)
	req, err := http.NewRequestWithContext(ctx, verb, reqURL, nil)
	if err != nil {
		return err
	}

	req.Header.Set("Date", date)
	req.Header.Set("Authorization", c.generateAuthHeader(c.computeSignature(stringToSign)))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errorMsg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("AbortMultipartUpload Failed: %d - %s", resp.StatusCode, string(errorMsg))
	}

	return nil
}

// DownloadFileWithRange 范围下载/断点续传下载
func (c *Client) DownloadFileWithRange(ctx context.Context, objectName, rangeHeader string) ([]byte, error) {
	verb := http.MethodGet
	date := time.Now().UTC().Format(http.TimeFormat)
	canonicalizedResource := fmt.Sprintf("/%s/%s", c.config.Bucket, objectName)
	stringToSign := fmt.Sprintf("%s\n\n\n%s\n%s", verb, date, canonicalizedResource)

	reqURL := fmt.Sprintf("https://%s/%s", c.endpoint, objectName)
	req, err := http.NewRequestWithContext(ctx, verb, reqURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Date", date)
	req.Header.Set("Authorization", c.generateAuthHeader(c.computeSignature(stringToSign)))
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errorMsg, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Download with Range Failed: %d - %s", resp.StatusCode, string(errorMsg))
	}

	return io.ReadAll(resp.Body)
}

// DeleteFile 删除文件
func (c *Client) DeleteFile(ctx context.Context, objectName string) error {
	verb := http.MethodDelete
	date := time.Now().UTC().Format(http.TimeFormat)
	canonicalizedResource := fmt.Sprintf("/%s/%s", c.config.Bucket, objectName)
	stringToSign := fmt.Sprintf("%s\n\n\n%s\n%s", verb, date, canonicalizedResource)

	reqURL := fmt.Sprintf("https://%s/%s", c.endpoint, objectName)
	req, err := http.NewRequestWithContext(ctx, verb, reqURL, nil)
	if err != nil {
		return err
	}

	req.Header.Set("Date", date)
	req.Header.Set("Authorization", c.generateAuthHeader(c.computeSignature(stringToSign)))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errorMsg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Delete Failed: %d - %s", resp.StatusCode, string(errorMsg))
	}

	return nil
}

// HeadObject 获取文件元数据
func (c *Client) HeadObject(ctx context.Context, objectName string) (http.Header, error) {
	verb := http.MethodHead
	date := time.Now().UTC().Format(http.TimeFormat)
	canonicalizedResource := fmt.Sprintf("/%s/%s", c.config.Bucket, objectName)
	stringToSign := fmt.Sprintf("%s\n\n\n%s\n%s", verb, date, canonicalizedResource)

	reqURL := fmt.Sprintf("https://%s/%s", c.endpoint, objectName)
	req, err := http.NewRequestWithContext(ctx, verb, reqURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Date", date)
	req.Header.Set("Authorization", c.generateAuthHeader(c.computeSignature(stringToSign)))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HeadObject Failed: %d", resp.StatusCode)
	}

	return resp.Header, nil
}

// PutObjectPresign 生成带签名的上传链接
func (c *Client) PutObjectPresign(objectName string, expiresIn int64, contentType string) string {
	if expiresIn <= 0 {
		expiresIn = 3600
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	verb := http.MethodPut
	expiresTimestamp := time.Now().Unix() + expiresIn
	canonicalizedResource := fmt.Sprintf("/%s/%s", c.config.Bucket, objectName)

	stringToSign := fmt.Sprintf("%s\n\n%s\n%d\n%s", verb, contentType, expiresTimestamp, canonicalizedResource)
	signature := c.computeSignature(stringToSign)

	params := url.Values{}
	params.Set("AWSAccessKeyId", c.config.AccessKeyID)
	params.Set("Expires", strconv.FormatInt(expiresTimestamp, 10))
	params.Set("Signature", signature)

	return fmt.Sprintf("https://%s/%s?%s", c.endpoint, objectName, params.Encode())
}
