import { DataSubjectRequestStatus, UnauthorizedActionError, UserRole } from '@ticketera/common';
import { User } from '@ticketera/database';
import { randomUUID } from 'node:crypto';
import { RegisterOppositionUseCase } from './register-opposition.use-case';

describe('RegisterOppositionUseCase (Oposición)', () => {
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
    const record = jest.fn(async (entry: { id?: string }) => ({ id: randomUUID(), ...entry }));
    const users = { findById: jest.fn(async () => user), saveWithManager: save };
    const requests = { recordWithManager: record };
    const uow = { runInTransaction: jest.fn((work: (ctx: { manager: unknown }) => unknown) => work({ manager: {} })) };
    const useCase = new RegisterOppositionUseCase(users as never, requests as never, uow as never);
    return { useCase, save, record };
  }

  it('el titular actuando sobre sí mismo bloquea de inmediato y queda COMPLETED', async () => {
    const user = buildUser();
    const { useCase, save, record } = build(user);

    const result = await useCase.execute({
      actorId: user.id,
      actorRole: UserRole.REQUESTER,
      targetUserId: user.id,
      reason: 'No quiero que sigan tratando mis datos',
    });

    expect(user.isPrivacyBlocked()).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(DataSubjectRequestStatus.COMPLETED);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ status: DataSubjectRequestStatus.COMPLETED }),
      expect.anything(),
    );
  });

  it('un ADMIN en representación NO bloquea automáticamente y queda RECEIVED', async () => {
    const user = buildUser();
    const admin = randomUUID();
    const { useCase, save, record } = build(user);

    const result = await useCase.execute({
      actorId: admin,
      actorRole: UserRole.ADMIN,
      targetUserId: user.id,
      reason: 'Solicitud recibida por otro canal',
    });

    expect(user.isPrivacyBlocked()).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(result.status).toBe(DataSubjectRequestStatus.RECEIVED);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ status: DataSubjectRequestStatus.RECEIVED }),
      expect.anything(),
    );
  });

  it('rechaza a un tercero que no es el titular ni ADMIN', async () => {
    const user = buildUser();
    const { useCase } = build(user);

    await expect(
      useCase.execute({
        actorId: randomUUID(),
        actorRole: UserRole.SUPERVISOR,
        targetUserId: user.id,
        reason: 'intento ajeno',
      }),
    ).rejects.toThrow(UnauthorizedActionError);
  });
});
