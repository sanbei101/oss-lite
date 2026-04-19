# oss-lite

<p align="center">
  <a href="https://codecov.io/gh/sanbei101/oss-lite">
    <img src="https://codecov.io/gh/sanbei101/oss-lite/graph/badge.svg" alt="codecov">
  </a>
  <img src="https://img.shields.io/npm/v/oss-lite" alt="npm version">
  <img src="https://img.shields.io/npm/l/oss-lite" alt="license">
</p>

<p align="center">
  轻量级的阿里云 OSS Node.js 客户端
</p>

---

## 特性

- **轻量无依赖** — 基于原生 `fetch`，零运行时依赖
- **TypeScript 原生支持** — 类型定义开箱即用
- **ESM 模块** — 现代模块化标准

## 安装

```bash
npm install oss-lite
# 或
pnpm add oss-lite
```

## 快速开始

```typescript
import { LiteOSS } from 'oss-lite';

const oss = new LiteOSS({
  accessKeyId:     'your-access-key-id',
  accessKeySecret: 'your-access-key-secret',
  bucket:          'your-bucket-name',
  region:          'oss-cn-hangzhou',
});

// 上传文件
await oss.uploadFile('hello.txt', Buffer.from('Hello, OSS!'), 'text/plain');

const url = await oss.getSignedUrl('hello.txt');
console.log(url);
```

## API 文档

## 开发

```bash
# 安装依赖
pnpm install

# 运行测试
pnpm test

# 查看覆盖率
pnpm test:coverage

# 构建
pnpm build
```