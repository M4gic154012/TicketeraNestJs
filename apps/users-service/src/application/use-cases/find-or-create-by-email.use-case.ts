import { Injectable } from '@nestjs/common';
import { UnauthorizedActionError, UserRole } from '@ticketera/common';
import { ApplicationService } from '@ticketera/patterns';
import { randomBytes } from 'node:crypto';
import { UserByEmailSpec } from '../../domain/specifications';
import { UserFactory } from '../../domain/factories';
import { UsersRepository } from '../../infrastructure/repositories';
import { UserView, toUserView } from '../dto';

export interface FindOrCreateByEmailCommand {
  email: string;
  /** Nombre tomado de la cabecera `From` del correo, si venía. */
  fullName?: string;
  /** Dominios cuyos remitentes se aceptan. Vacío significa cualquiera. */
  allowedDomains?: string[];
}

/**
 * Caso de uso: resolver el solicitante de un correo entrante, creándolo si no existe.
 *
 * Sin esto, la ingesta por correo solo funcionaría para gente ya dada de alta — y
 * quien escribe por primera vez es justamente el que más necesita que su pedido entre.
 *
 * El alta queda restringida a los dominios autorizados: sin ese límite, cualquier
 * remitente del mundo podría crear usuarios en el sistema con solo mandar un correo.
 */
@Injectable()
export class FindOrCreateByEmailUseCase extends ApplicationService<
  FindOrCreateByEmailCommand,
  UserView & { created: boolean }
> {
  constructor(
    private readonly users: UsersRepository,
    private readonly factory: UserFactory,
  ) {
    super();
  }

  async execute(
    command: FindOrCreateByEmailCommand,
  ): Promise<UserView & { created: boolean }> {
    const email = command.email.trim().toLowerCase();

    const existing = await this.users.findOne(new UserByEmailSpec(email));
    if (existing) {
      return { ...toUserView(existing), created: false };
    }

    this.assertAllowedDomain(email, command.allowedDomains ?? []);

    // Contraseña aleatoria que nadie conoce: el usuario entra por correo, y si
    // después quiere usar la web, pasa por recuperación de contraseña. Dejar una
    // contraseña previsible acá sería una cuenta con credencial conocida.
    const user = await this.factory.create({
      email,
      fullName: command.fullName?.trim() || email.split('@')[0],
      password: this.randomPassword(),
      role: UserRole.REQUESTER,
    });

    const saved = await this.users.save(user);
    this.logger.log(`Usuario ${saved.email} creado automáticamente desde correo entrante`);

    return { ...toUserView(saved), created: true };
  }

  private assertAllowedDomain(email: string, allowedDomains: string[]): void {
    if (allowedDomains.length === 0) return;

    const domain = email.split('@')[1] ?? '';
    const allowed = allowedDomains.some((d) => domain === d || domain.endsWith(`.${d}`));

    if (!allowed) {
      throw new UnauthorizedActionError(
        'No se crean usuarios para dominios no autorizados',
        { email, domain },
      );
    }
  }

  /** Cumple la política de la factory: mayúsculas, minúsculas y un número. */
  private randomPassword(): string {
    return `Aa1${randomBytes(24).toString('base64url')}`;
  }
}
