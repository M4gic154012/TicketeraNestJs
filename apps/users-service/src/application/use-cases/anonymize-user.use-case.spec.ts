import { ConfigService } from '@nestjs/config';
import { DataSubjectRequestStatus, DataSubjectRequestType, UnauthorizedActionError, UserRole } from '@ticketera/common';
import { User } from '@ticketera/database';
import { randomUUID } from 'node:crypto';
import { AnonymizeUserUseCase } from './anonymize-user.use-case';

describe('AnonymizeUserUseCase (Cancelación)', () => {
  const buildUser = (overrides: Partial<User> = {}): User => {
    const user = new User();
    user.id = randomUUID();
    user.email = 'titular@test.local';
    user.fullName = 'Titular';
    user.passwordHash = '$2b$12$original';
    user.role = UserRole.REQUESTER;
    user.isActive = true;
    user.skills = [];
    user.anonymizedAt = null;
    user.privacyBlockedAt = null;
    user.privacyBlockReason = null;
    return Object.assign(user, overrides);
  };

  const config = { get: () => 4 } as unknown as ConfigService;

  function build(user: User | null) {
    const save = jest.fn(async (u: User) => u);
    const record = jest.fn(async (entry: unknown) => entry);
    const users = {
      findById: jest.fn(async () => user),
      saveWithManager: save,
    };
    const requests = { recordWithManager: record };
    // `runInTransaction` ejecuta el callback contra un `EntityManager` falso: lo
    // que este test verifica es que ambas escrituras ocurran, no el manejo real
    // de la transacción (eso lo cubre `TypeOrmUnitOfWork` por su cuenta).
    const uow = { runInTransaction: jest.fn((work: (ctx: { manager: unknown }) => unknown) => work({ manager: {} })) };
    const useCase = new AnonymizeUserUseCase(users as never, requests as never, uow as never, config);
    return { useCase, save, record };
  }

  it('anonimiza al titular sobre sí mismo y registra la solicitud', async () => {
    const user = buildUser();
    const { useCase, save, record } = build(user);

    const result = await useCase.execute({
      actorId: user.id,
      actorRole: UserRole.REQUESTER,
      targetUserId: user.id,
      reason: 'Ya no uso el servicio',
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(user.isAnonymized()).toBe(true);
    expect(result.id).toBe(user.id);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectUserId: user.id,
        type: DataSubjectRequestType.CANCELLATION,
        status: DataSubjectRequestStatus.COMPLETED,
      }),
      expect.anything(),
    );
  });

  it('es idempotente: una segunda solicitud no vuelve a guardar ni a registrar', async () => {
    const user = buildUser({ anonymizedAt: new Date() });
    const { useCase, save, record } = build(user);

    await useCase.execute({
      actorId: user.id,
      actorRole: UserRole.REQUESTER,
      targetUserId: user.id,
      reason: 'de nuevo',
    });

    expect(save).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('rechaza a un actor que no es el titular ni ADMIN', async () => {
    const user = buildUser();
    const { useCase } = build(user);

    await expect(
      useCase.execute({
        actorId: randomUUID(),
        actorRole: UserRole.AGENT,
        targetUserId: user.id,
        reason: 'intento ajeno',
      }),
    ).rejects.toThrow(UnauthorizedActionError);
  });
});
