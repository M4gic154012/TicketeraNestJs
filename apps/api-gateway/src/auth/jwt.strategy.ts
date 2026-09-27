import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { AuthenticatedUser, JwtPayload } from '@ticketera/common';
import { ExtractJwt, Strategy } from 'passport-jwt';

/**
 * Verifica la firma del access token y arma la identidad de la petición.
 *
 * No se consulta la base en cada request: el token es la fuente de verdad
 * durante su vigencia (15 minutos por defecto), que es el precio a pagar por no
 * agregar un round-trip a users-service en cada llamada.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Nunca ignorar la expiración: un token vencido debe fallar.
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
      // Se verifican, no solo se emiten: firmar con issuer/audience sin
      // validarlos del otro lado no aporta nada.
      issuer: config.get<string>('JWT_ISSUER') ?? 'ticketera',
      audience: config.get<string>('JWT_AUDIENCE') ?? 'ticketera-api',
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    if (!payload.sub || !payload.role) {
      throw new UnauthorizedException('Token sin identidad válida');
    }
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
