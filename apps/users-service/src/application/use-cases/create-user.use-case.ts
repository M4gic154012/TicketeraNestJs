import { Injectable } from '@nestjs/common';
import { BusinessRuleViolationError } from '@ticketera/common';
import { ApplicationService } from '@ticketera/patterns';
import { UserFactory } from '../../domain/factories';
import { UsersRepository } from '../../infrastructure/repositories';
import { CreateUserCommand, UserView, toUserView } from '../dto';

@Injectable()
export class CreateUserUseCase extends ApplicationService<CreateUserCommand, UserView> {
  constructor(
    private readonly users: UsersRepository,
    private readonly factory: UserFactory,
  ) {
    super();
  }

  async execute(command: CreateUserCommand): Promise<UserView> {
    const email = command.email.trim().toLowerCase();

    // Chequeo previo para dar un error claro. El índice único de la base sigue
    // siendo la garantía real ante dos altas simultáneas.
    if (await this.users.emailExists(email)) {
      throw new BusinessRuleViolationError('Ya existe un usuario con ese email', { email });
    }

    const user = await this.factory.create({ ...command, email });
    const saved = await this.users.save(user);

    this.logger.log(`Usuario ${saved.email} creado con rol ${saved.role}`);
    return toUserView(saved);
  }
}
