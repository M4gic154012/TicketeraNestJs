import { Injectable } from '@nestjs/common';
import { EntityNotFoundError } from '@ticketera/common';
import { ApplicationService } from '@ticketera/patterns';
import { UserByEmailSpec } from '../../domain/specifications';
import { UsersRepository } from '../../infrastructure/repositories';
import { UserView, toUserView } from '../dto';

@Injectable()
export class GetUserUseCase extends ApplicationService<
  { id?: string; email?: string },
  UserView
> {
  constructor(private readonly users: UsersRepository) {
    super();
  }

  async execute(query: { id?: string; email?: string }): Promise<UserView> {
    const user = await this.findUser(query);

    if (!user) {
      throw new EntityNotFoundError('Usuario', query.id ?? query.email ?? 'sin identificador');
    }

    return toUserView(user);
  }

  private findUser(query: { id?: string; email?: string }) {
    if (query.id) return this.users.findById(query.id);
    if (query.email) return this.users.findOne(new UserByEmailSpec(query.email));
    return null;
  }
}
