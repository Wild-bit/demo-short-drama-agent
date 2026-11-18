import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization;
    const match = typeof header === "string" ? /^Bearer ([a-f0-9]{64})$/i.exec(header) : null;
    if (!match) throw new UnauthorizedException("请提供 Bearer Token");
    request.currentUserId = await this.authService.authenticate(match[1]);
    request.authToken = match[1];
    return true;
  }
}
