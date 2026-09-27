import { Injectable } from '@nestjs/common';
import { InvalidCredentialsError } from '@ticketera/common';
import { ApplicationService } from '@ticketera/patterns';
import * as bcrypt from 'bcrypt';
import { UsersRepository } from '../../infrastructure/repositories';
import { UserView, ValidateCredentialsCommand, toUserView } from '../dto';

/**
 * Caso de uso: validar credenciales.
 *
 * El servicio de usuarios verifica la contraseña pero NO emite el token: firmar
 * el JWT es responsabilidad del gateway, que es quien conoce el secreto de firma.
 * Así el secreto no se replica en más procesos de los necesarios.
 */
@Injectable()
export class ValidateCredentialsUseCase extends ApplicationService<
  ValidateCredentialsCommand,
  UserView
> {
  /**
   * Hash descartable de referencia, bien formado (60 caracteres, sobre una
   * entrada aleatoria que nadie conoce).
   *
   * Se compara contra él cuando el email no existe, para gastar el mismo tiempo
   * de CPU que en un login real: sin esto, la diferencia de latencia permite
   * enumerar qué cuentas están registradas. El hash debe ser válido y no
   * simplemente tener la pinta — un hash malformado funciona hoy por un detalle
   * de cómo bcrypt parsea el salt, y eso no es algo sobre lo que apoyar una
   * mitigación.
   */
  private static readonly DUMMY_HASH =
    '$2b$12$l79f7t91F7Xv11u00C4P7OzwsNixz.MOKT4TeMKiM0GL954RiY.lS';

  constructor(private readonly users: UsersRepository) {
    super();
  }

  async execute(command: ValidateCredentialsCommand): Promise<UserView> {
    const user = await this.users.findByEmailWithPassword(command.email.trim().toLowerCase());

    const passwordMatches = await bcrypt.compare(
      command.password,
      user?.passwordHash ?? ValidateCredentialsUseCase.DUMMY_HASH,
    );

    // Mensaje idéntico en los tres casos: no se le dice al atacante si el email
    // existe, si la contraseña falló o si la cuenta está deshabilitada.
    if (!user || !passwordMatches || !user.isActive) {
      this.logger.warn(`Intento de login fallido para ${command.email}`);
      throw new InvalidCredentialsError('Credenciales inválidas');
    }

    return toUserView(user);
  }
}
