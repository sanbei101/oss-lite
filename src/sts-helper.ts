import * as crypto from "crypto";

export type TempCreds = {
  accessKeyId: string;
  accessKeySecret: string;
  stsToken: string;
};

// 阿里云 STS AssumeRole(RPC 签名 v1),仅供测试换取真实临时凭证
function percentEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~");
}

export async function assumeRole(
  accessKeyId: string,
  accessKeySecret: string,
  roleArn: string,
): Promise<TempCreds> {
  const params: Record<string, string> = {
    Action: "AssumeRole",
    Version: "2015-04-01",
    Format: "JSON",
    AccessKeyId: accessKeyId,
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    SignatureNonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    Timestamp: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    RoleArn: roleArn,
    RoleSessionName: `oss-lite-test-${Math.random().toString(36).slice(2)}`,
    DurationSeconds: "900",
  };
  const canonicalized = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join("&");
  const stringToSign = `GET&${percentEncode("/")}&${percentEncode(canonicalized)}`;
  const signature = crypto
    .createHmac("sha1", `${accessKeySecret}&`)
    .update(stringToSign, "utf8")
    .digest("base64");
  const url = `https://sts.aliyuncs.com/?${canonicalized}&Signature=${percentEncode(signature)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`AssumeRole Failed: ${response.status} - ${await response.text()}`);
  }
  const body = (await response.json()) as {
    Credentials?: { AccessKeyId: string; AccessKeySecret: string; SecurityToken: string };
  };
  if (!body.Credentials?.SecurityToken) {
    throw new Error(`AssumeRole returned no SecurityToken: ${JSON.stringify(body)}`);
  }
  return {
    accessKeyId: body.Credentials.AccessKeyId,
    accessKeySecret: body.Credentials.AccessKeySecret,
    stsToken: body.Credentials.SecurityToken,
  };
}
