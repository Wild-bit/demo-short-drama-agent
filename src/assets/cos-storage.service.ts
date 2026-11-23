import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import COS from "cos-nodejs-sdk-v5";
import { CosStsService } from "./cos-sts.service";

const MULTIPART_THRESHOLD = 5 * 1024 * 1024;

@Injectable()
export class CosStorageService {
  constructor(private readonly sts: CosStsService) {}

  async uploadFile(objectKey: string, filePath: string, contentType: string): Promise<void> {
    await this.withClient(async (client, location) => {
      await client.uploadFile({
        ...location,
        Key: objectKey,
        FilePath: filePath,
        SliceSize: MULTIPART_THRESHOLD,
        ContentType: contentType,
      });
    });
  }

  async deleteFile(objectKey: string): Promise<void> {
    await this.withClient(async (client, location) => {
      await client.deleteObject({ ...location, Key: objectKey });
    });
  }

  private async withClient(operation: (client: COS, location: { Bucket: string; Region: string }) => Promise<void>) {
    const Bucket = process.env.COS_BUCKET?.trim();
    const Region = process.env.COS_REGION?.trim();
    if (!Bucket || !Region) {
      throw new ServiceUnavailableException("COS 上传需要配置存储桶和地域");
    }
    const location = { Bucket, Region };

    let credentialError: unknown;
    const client = new COS({
      Timeout: 60_000,
      getAuthorization: (_request, respond) => {
        void this.sts.credentials(location).then(
          credentials => respond({ ...credentials }),
          error => {
            credentialError = error;
            // SDK 使用空签名结束当前请求，外层再返回原始 STS 错误。
            respond("");
          },
        );
      },
    });

    try {
      await operation(client, location);
    } catch (error) {
      throw credentialError ?? error;
    }
  }
}
