import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser, ROLES_KEY, UserRole } from '@ticketera/common';

/**
 * Autorización por rol. Solo decide lo que se puede saber del token; la
 * autorización que depende del dato concreto (¿este ticket es mío?) la resuelve
 * el caso de uso en el microservicio.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user) throw new ForbiddenException('Petición sin identidad');

    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        `Se requiere uno de los roles: ${required.join(', ')}`,
      );
    }

    return true;
  }
}
