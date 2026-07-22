# oss-lite

<p align="center">
  <a href="https://codecov.io/gh/sanbei101/oss-lite">
    <img src="https://codecov.io/gh/sanbei101/oss-lite/graph/badge.svg" alt="codecov">
  </a>
  <img src="https://img.shields.io/npm/v/oss-lite" alt="npm version">
  <img src="https://img.shields.io/npm/l/oss-lite" alt="license">
</p>

<p align="center">
  轻量级的阿里云 OSS / S3 兼容 Node 客户端
</p>

## 特性

- **轻量无依赖** - 基于原生 `fetch`,零第三方运行时依赖
- **双协议支持** - 同时支持阿里云 OSS 原生协议与通用 S3 兼容协议
- **TypeScript 原生** - 完整且精确的类型定义,开箱即用
- **现代 ESM** - 采用现代 ES Module 标准构建

---

## 协议选择:LiteOSS vs LiteS3

阿里云 OSS 支持通过两种不同的协议 Endpoint 进行交互。`oss-lite` 针对这两种场景分别提供了专属客户端:

| 特性               | `LiteOSS` (阿里云原生协议)             | `LiteS3` (S3 兼容协议)                    |
| :----------------- | :------------------------------------- | :---------------------------------------- |
| **应用场景**       | 仅对接阿里云 OSS,追求最纯粹的 OSS 语法 | 适配标准 S3 生态,或未来有跨云存储迁移需求 |
| **Endpoint 格式**  | `<bucket>.<region>.aliyuncs.com`       | `<bucket>.s3.<region>.aliyuncs.com`       |
| **鉴权请求头**     | `Authorization: OSS <AccessKey>:<Sig>` | `Authorization: AWS <AccessKey>:<Sig>`    |
| **预签名链接参数** | `OSSAccessKeyId=...`                   | `AWSAccessKeyId=...`                      |

> 💡 **提示**:阿里云 OSS 存储桶默认开启了 S3 兼容支持。只要使用相同的 `AccessKeyId` 与 `AccessKeySecret`,两个客户端均可无缝对同一存储桶进行读写操作。

---

## 安装

```bash
npm install oss-lite
# 或
pnpm add oss-lite
```

---

## 快速开始

### 1. 使用原生 OSS 客户端 (`LiteOSS`)

```typescript
import { LiteOSS } from "oss-lite";

const oss = new LiteOSS({
  accessKeyId: "your-access-key-id",
  accessKeySecret: "your-access-key-secret",
  bucket: "your-bucket-name",
  region: "oss-cn-beijing",
  // internal: true, // 可选:是否使用阿里云内网 Endpoint
});

// 1. 上传文件
await oss.uploadFile("hello.txt", "Hello, Aliyun OSS!", "text/plain");

// 2. 生成下载预签名链接 (默认 3600 秒有效)
const downloadUrl = oss.getPresignedUrl("hello.txt", 3600);
console.log("Download URL:", downloadUrl);

// 3. 下载文件
const buffer = await oss.downloadFile("hello.txt");
console.log(new TextDecoder().decode(buffer));
```

### 2. 使用 S3 兼容客户端 (`LiteS3`)

```typescript
import { LiteS3 } from "oss-lite";

const s3 = new LiteS3({
  accessKeyId: "your-access-key-id",
  accessKeySecret: "your-access-key-secret",
  bucket: "your-bucket-name",
  region: "oss-cn-beijing",
});

// 1. 上传文件 (底层请求将自动通过 .s3. 节点及 AWS 签名鉴权)
await s3.uploadFile("hello-s3.txt", "Hello, S3 Compatible!", "text/plain");

// 2. 生成 S3 格式的预签名链接
const downloadUrl = s3.getPresignedUrl("hello-s3.txt", 3600);
console.log("S3 Presigned URL:", downloadUrl);
```

---

## API 概览

`LiteOSS` 与 `LiteS3` 保持了完全一致的 API 接口定义:

### 基础文件操作

- **`uploadFile(objectName, data, contentType?)`** - 上传文件
- **`downloadFile(objectName)`** - 下载完整文件(返回 `ArrayBuffer`)
- **`downloadFileWithRange(objectName, range)`** - 范围/断点续传下载(如 `bytes=0-1024`)
- **`headObject(objectName)`** - 获取文件元数据 Headers
- **`deleteFile(objectName)`** - 删除文件

### 签名与预授权

- **`getPresignedUrl(objectName, expiresIn?)`** - 生成 GET 临时下载链接
- **`putObjectPresign(objectName, expiresIn?, contentType?)`** - 生成 PUT 临时直传链接

### 分片上传

- **`initiateMultipartUpload(objectName, contentType?)`** - 初始化分片任务(返回 `uploadId`)
- **`uploadPart(objectName, uploadId, partNumber, data, contentType?)`** - 上传分片(返回 `eTag`)
- **`completeMultipartUpload(objectName, uploadId, parts)`** - 合并完成分片上传
- **`abortMultipartUpload(objectName, uploadId)`** - 取消分片任务

---

## 本地开发与测试

```bash
# 安装依赖
pnpm install

# 运行单元测试
pnpm test

# 查看覆盖率
pnpm test --coverage

# 构建打包
pnpm build
```
