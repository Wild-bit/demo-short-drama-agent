import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "./entities/user.entity";
import { AuthToken } from "./entities/auth-token.entity";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { AuthController } from "./auth.controller";

@Module({
  imports: [TypeOrmModule.forFeature([User, AuthToken])],
  providers: [AuthService, AuthGuard],
  controllers: [AuthController],
  exports: [AuthGuard, AuthService],
})
export class AuthModule {}
