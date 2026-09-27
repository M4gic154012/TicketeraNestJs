import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../contracts';

export const ROLES_KEY = 'roles';

/** Roles autorizados para el handler. Lo consume RolesGuard. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
