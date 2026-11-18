import { AuthModule } from "@/auth/auth.module";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Asset } from "./entities/asset.entity";
import { AssetsService } from "./assets.service";
import { AssetsController } from "./assets.controller";

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Asset])],
  providers: [AssetsService],
  exports: [AssetsService],
  controllers: [AssetsController],
})
export class AssetsModule {}
