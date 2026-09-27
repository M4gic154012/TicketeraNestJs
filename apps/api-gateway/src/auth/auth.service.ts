import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import {
  JwtPayload,
  USERS_PATTERNS,
  USERS_SERVICE,
  UserRole,
  withRpcAuth,
} from '@ticketera/common';
import { CircuitBreakerRegistry } from '@ticketera/patterns';
import { firstValueFrom, timeout } from 'rxjs';

/**
 * `expiresIn` de jsonwebtoken usa un tipo literal de duraciones ('15m', '7d').
 * El valor llega del entorno como string, así que se convierte en un punto único
 * en lugar de castear en cada firma.
 */
type ExpiresIn = SignOptions['expiresIn'];

const asExpiresIn = (value: string): ExpiresIn => value as ExpiresIn;

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  user: { id: string; email: string; fullName: string; role: UserRole };
}

/**
 * Emisión de tokens.
 *
 * La verificación de la contraseña la hace users-service; la firma del JWT se
 * hace acá, porque el gateway es el único proceso que necesita el secreto de
 * firma. Este login NO lleva fallback del circuit breaker: si no se puede
 * verificar la credencial, la respuesta correcta es rechazar, jamás degradar.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(USERS_SERVICE) private readonly users: ClientProxy,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly breakers: CircuitBreakerRegistry,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    // El breaker de 'users-service' es único por proceso (lo comparte
    // UpstreamClient): el timeoutMs del breaker tiene que coincidir con el que
    // usa ahí (8_000), si no gana el que se registra primero según el orden de
    // arranque. El timeout de 5_000 de abajo sigue siendo el límite real del
    // login — más ajustado a propósito porque es una espera activa del usuario —
    // y corre por debajo del techo del breaker sin conflicto.
    const breaker = this.breakers.get('users-service', { timeoutMs: 8_000 });

    const user = await breaker.execute(() =>
      firstValueFrom(
        this.users
          .send<{ id: string; email: string; fullName: string; role: UserRole }>(
            USERS_PATTERNS.validateCredentials,
            withRpcAuth({ email, password }, this.config.getOrThrow<string>('RPC_SHARED_SECRET')),
          )
          .pipe(timeout(5_000)),
      ),
    );

    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };

    return {
      accessToken: await this.jwt.signAsync(payload, {
        expiresIn: asExpiresIn(this.config.get<string>('JWT_ACCESS_TTL') ?? '15m'),
      }),
      // Refresh de vida larga con el mismo secreto. Si el sistema crece, esto
      // debería pasar a un secreto distinto y a una tabla de refresh tokens
      // revocables — hoy no hay revocación posible antes del vencimiento.
      refreshToken: await this.jwt.signAsync(
        { ...payload, tokenType: 'refresh' },
        { expiresIn: asExpiresIn(this.config.get<string>('JWT_REFRESH_TTL') ?? '7d') },
      ),
      expiresIn: this.config.get<string>('JWT_ACCESS_TTL') ?? '15m',
      user,
    };
  }

  async refresh(refreshToken: string): Promise<Omit<LoginResult, 'user' | 'refreshToken'>> {
    let payload: JwtPayload & { tokenType?: string };

    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        issuer: this.config.get<string>('JWT_ISSUER') ?? 'ticketera',
        audience: this.config.get<string>('JWT_AUDIENCE') ?? 'ticketera-api',
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }

    // Sin este chequeo, un access token serviría como refresh y extendería la
    // sesión indefinidamente.
    if (payload.tokenType !== 'refresh') {
      throw new UnauthorizedException('El token provisto no es un refresh token');
    }

    const accessToken = await this.jwt.signAsync(
      { sub: payload.sub, email: payload.email, role: payload.role },
      { expiresIn: asExpiresIn(this.config.get<string>('JWT_ACCESS_TTL') ?? '15m') },
    );

    return { accessToken, expiresIn: this.config.get<string>('JWT_ACCESS_TTL') ?? '15m' };
  }
}
