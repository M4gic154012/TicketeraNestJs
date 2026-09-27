import { Injectable } from '@nestjs/common';
import { ApplicationService, Specification } from '@ticketera/patterns';
import { User } from '@ticketera/database';
import {
  ActiveUserSpec,
  AllUsersSpec,
  UserByIdsSpec,
  UserByRolesSpec,
  UserWithSkillSpec,
} from '../../domain/specifications';
import { UsersRepository } from '../../infrastructure/repositories';
import { FindManyUsersQuery, UserView, toUserView } from '../dto';

@Injectable()
export class FindUsersUseCase extends ApplicationService<FindManyUsersQuery, UserView[]> {
  constructor(private readonly users: UsersRepository) {
    super();
  }

  async execute(query: FindManyUsersQuery): Promise<UserView[]> {
    let spec: Specification<User> = new AllUsersSpec();

    if (query.ids?.length) spec = spec.and(new UserByIdsSpec(query.ids));
    if (query.roles?.length) spec = spec.and(new UserByRolesSpec(query.roles));
    if (query.isActive !== undefined) spec = spec.and(new ActiveUserSpec(query.isActive));
    if (query.skill) spec = spec.and(new UserWithSkillSpec(query.skill));

    const found = await this.users.findAll(spec);
    return found.map(toUserView);
  }
}
