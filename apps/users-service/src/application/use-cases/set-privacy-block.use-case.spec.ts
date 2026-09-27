import { ValidationError, UserRole } from '@ticketera/common';
import { User } from '@ticketera/database';
import { randomUUID } from 'node:crypto';
import { SetPrivacyBlockUseCase } from './set-privacy-block.use-case';

describe('SetPrivacyBlockUseCase (Bloqueo temporal)', () => {
  const buildUser = (): User => {
    const user = new User();
    user.id = randomUUID();
    user.isActive = true;
    user.skills = [];
    user.privacyBlockedAt = null;
    user.privacyBlockReason = null;
    return user;
  };

  function build(user: User | null) {
    const save = jest.fn(async (u: User) => u);
    const record = jest.fn(async (entry: unknown) => entry);
    const users = { findById: jest.fn(async () => user), saveWithManager: save };
    const requests = { recordWithManager: record };
    const uow = { runInTransaction: jest.fn((work: (ctx: { manager: unknown }) => unknown) => work({ manager: {} })) };
    const useCase = new SetPrivacyBlockUseCase(users as never, requests as never, uow as never);
    return { useCase };
  }

  it('exige un motivo al bloquear', async () => {
    const user = buildUser();
    const { useCase } = build(user);

    await expect(
      useCase.execute({
        actorId: user.id,
        actorRole: UserRole.REQUESTER,
        targetUserId: user.id,
        blocked: true,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('alterna el estado de bloqueo', async () => {
    const user = buildUser();
    const { useCase } = build(user);

    await useCase.execute({
      actorId: user.id,
      actorRole: UserRole.REQUESTER,
      targetUserId: user.id,
      blocked: true,
      reason: 'Pausa mientras evalúo mi oposición',
    });
    expect(user.isPrivacyBlocked()).toBe(true);

    await useCase.execute({
      actorId: user.id,
      actorRole: UserRole.REQUESTER,
      targetUserId: user.id,
      blocked: false,
    });
    expect(user.isPrivacyBlocked()).toBe(false);
  });
});
