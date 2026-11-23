import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type COS from "cos-nodejs-sdk-v5";
import { sts } from "tencentcloud-sdk-nodejs-sts";

const CREDENTIAL_DURATION_SECONDS = 3600;
const REFRESH_BEFORE_EXPIRY_SECONDS = 120;

type CosLocation = { Bucket: string; Region: string };

@Injectable()
export class CosStsService {
  private cached?: { scope: string; credentials: COS.Credentials };
  private pending?: { scope: string; result: Promise<COS.Credentials> };

  async credentials(location: CosLocation): Promise<COS.Credentials> {
    const scope = `${location.Region}/${location.Bucket}`;
    if (this.cached?.scope === scope &&
      this.cached.credentials.ExpiredTime > Date.now() / 1000 + REFRESH_BEFORE_EXPIRY_SECONDS) {
      return this.cached.credentials;
    }
    if (this.pending?.scope === scope) return this.pending.result;

    const request = { scope, result: this.requestCredentials(location) };
    this.pending = request;
    try {
      const credentials = await request.result;
      this.cached = { scope, credentials };
      return credentials;
    } finally {
      if (this.pending === request) this.pending = undefined;
    }
  }

  private async requestCredentials({ Bucket, Region }: CosLocation): Promise<COS.Credentials> {
    const secretId = process.env.COS_STS_SECRET_ID?.trim();
    const secretKey = process.env.COS_STS_SECRET_KEY?.trim();
    const appId = Bucket.match(/-(\d+)$/)?.[1];
    if (!secretId || !secretKey || !appId) {
      throw new ServiceUnavailableException("COS 上传需要配置 STS 签发身份及包含 APPID 的存储桶名");
    }

    const client = new sts.v20180813.Client({
      credential: { secretId, secretKey },
      region: Region,
      profile: { httpProfile: { endpoint: "sts.tencentcloudapi.com", reqTimeout: 10 } },
    });
    const startTime = Math.floor(Date.now() / 1000);
    try {
      const response = await client.GetFederationToken({
        Name: "ShortDramaCos",
        DurationSeconds: CREDENTIAL_DURATION_SECONDS,
        Policy: encodeURIComponent(JSON.stringify({
          version: "2.0",
          statement: [{
            effect: "allow",
            action: [
              "name/cos:PutObject",
              "name/cos:DeleteObject",
              "name/cos:InitiateMultipartUpload",
              "name/cos:ListMultipartUploads",
              "name/cos:ListParts",
              "name/cos:UploadPart",
              "name/cos:CompleteMultipartUpload",
            ],
            resource: [`qcs::cos:${Region}:uid/${appId}:${Bucket}/short-drama/*`],
          }],
        })),
      });
      const { Credentials, ExpiredTime } = response;
      if (!Credentials?.TmpSecretId || !Credentials.TmpSecretKey || !Credentials.Token ||
        !ExpiredTime || ExpiredTime <= startTime) {
        throw new Error("STS 返回的临时凭证无效");
      }
      return {
        TmpSecretId: Credentials.TmpSecretId,
        TmpSecretKey: Credentials.TmpSecretKey,
        SecurityToken: Credentials.Token,
        StartTime: startTime,
        ExpiredTime,
      };
    } catch {
      throw new ServiceUnavailableException("无法从腾讯云 STS 获取 COS 上传凭证");
    }
  }
}
