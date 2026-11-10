import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Asset } from "./entities/asset.entity";

@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(Asset)
    private readonly assetRepository: Repository<Asset>,
  ) {}
  async searchAssets(ownerId: string, query: string): Promise<Asset[]> {
    const keyword = query.trim();
    if (!keyword) {
      return [];
    }
    let result = await this.assetRepository
      .createQueryBuilder("asset")
      .where("asset.ownerId = :ownerId", { ownerId })
      .andWhere(
        "(asset.name LIKE :keyword OR asset.description LIKE :keyword)",
        { keyword: `%${keyword}%` },
      )
      .orderBy("asset.updatedAt", "DESC")
      .take(10)
      .getMany();
    return result;
  }
}
