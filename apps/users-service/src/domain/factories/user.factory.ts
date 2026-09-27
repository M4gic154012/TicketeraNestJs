import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole, ValidationError } from '@ticketera/common';
import { User } from '@ticketera/database';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { CreateUserCommand } from '../../application/dto';

/**
 * Factory de usuarios.
 *
 * Además de normalizar, es el único lugar donde se hashea una contraseña: si el
 * hashing viviera en el caso de uso, un segundo punto de creación (importación
 * LDAP, alta por CSV) podría guardar la contraseña en claro.
 */
@Injectable()
export class UserFactory {
  constructor(private readonly config: ConfigService) {}

  async create(command: CreateUserCommand): Promise<User> {
    this.assertValidPassword(command.password);

    const user = new User();
    user.id = randomUUID();
    // El email se normaliza a minúsculas al guardar, para que el índice único
    // impida dos cuentas que solo difieren en capitalización.
    user.email = command.email.trim().toLowerCase();
    user.fullName = command.fullName.trim();
    user.passwordHash = await bcrypt.hash(
      command.password,
      this.config.get<number>('BCRYPT_ROUNDS') ?? 12,
    );
    user.role = command.role ?? UserRole.REQUESTER;
    user.department = command.department?.trim() ?? null;
    user.isActive = true;
    user.skills = this.normalizeSkills(command.skills);
    user.maxConcurrentTickets = this.defaultCapacity(user.role, command.maxConcurrentTickets);

    return user;
  }

  private assertValidPassword(password: string): void {
    if (password.length < 12) {
      throw new ValidationError('La contraseña debe tener al menos 12 caracteres');
    }
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
      throw new ValidationError(
        'La contraseña debe incluir mayúsculas, minúsculas y al menos un número',
      );
    }
  }

  private normalizeSkills(skills?: string[]): string[] {
    if (!skills?.length) return [];
    return [...new Set(skills.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  }

  /** Un solicitante no atiende tickets; un agente tiene capacidad por defecto. */
  private defaultCapacity(role: UserRole, requested?: number): number | null {
    if (role === UserRole.REQUESTER) return null;
    return requested ?? 15;
  }
}
