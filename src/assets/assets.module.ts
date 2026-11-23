import { AuthModule } from "@/auth/auth.module";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Asset } from "./entities/asset.entity";
import { AssetsService } from "./assets.service";
import { AssetsController } from "./assets.controller";
import { CosStorageService } from "./cos-storage.service";
import { CosStsService } from "./cos-sts.service";

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Asset])],
  providers: [AssetsService, CosStorageService, CosStsService],
  exports: [AssetsService],
  controllers: [AssetsController],
})
export class AssetsModule {}
