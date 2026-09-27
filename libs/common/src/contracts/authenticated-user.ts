import { UserRole } from './enums';

/** Identidad ya verificada por el gateway y propagada hacia adentro. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}
