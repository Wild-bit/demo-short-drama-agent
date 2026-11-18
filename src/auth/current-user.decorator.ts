import { createParamDecorator, ExecutionContext } from "@nestjs/common";

/** 仅用于经过 AuthGuard 的接口，身份来自已验证的 Token。 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string =>
    context.switchToHttp().getRequest().currentUserId,
);
