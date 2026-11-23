import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}
  // 测试密码：lance123456 测试账号：demo
  @Post("login")
  @HttpCode(200)
  login(
    @Body("username") username: unknown,
    @Body("password") password: unknown,
  ) {
    if (
      typeof username !== "string" ||
      !username.trim() ||
      username.length > 64 ||
      typeof password !== "string" ||
      password.length < 1 ||
      password.length > 256
    ) {
      throw new BadRequestException("请提供有效用户名和密码");
    }
    return this.authService.login(username.trim(), password);
  }

  @Post("logout")
  @UseGuards(AuthGuard)
  @HttpCode(204)
  async logout(@Req() request: { authToken: string }) {
    await this.authService.logout(request.authToken);
  }
}
