import { randomUUID } from 'node:crypto';
import { UnauthorizedActionError } from '../filters/domain.errors';
import { UserRole } from './enums';
import {
  assertCanAccess,
  assertCanBlock,
  assertCanCancel,
  assertCanOppose,
  assertCanPort,
  assertCanRectify,
  assertCanUnblock,
} from './user-permissions';

/**
 * Regresión IDOR sobre derechos ARCO — mismo propósito que
 * `authorization.spec.ts` de tickets: fijar que solo el titular o un ADMIN
 * pueden ejercer estos derechos, y que NINGÚN otro rol (ni AGENT ni
 * SUPERVISOR, que sí tienen acceso amplio en `ticket-permissions.ts`) puede
 * actuar en representación de otro usuario sin serlo.
 */
describe('user-permissions (regresión IDOR sobre datos personales)', () => {
  const subjectId = randomUUID();
  const strangerId = randomUUID();

  const assertions = [
    assertCanAccess,
    assertCanRectify,
    assertCanCancel,
    assertCanOppose,
    assertCanPort,
    assertCanBlock,
    assertCanUnblock,
  ];

  it.each(assertions)('%p: el titular puede ejercerlo sobre sí mismo', (assertFn) => {
    expect(() => assertFn({ id: subjectId, role: UserRole.REQUESTER }, subjectId)).not.toThrow();
  });

  it.each(assertions)('%p: un ADMIN puede ejercerlo sobre cualquier titular', (assertFn) => {
    expect(() => assertFn({ id: strangerId, role: UserRole.ADMIN }, subjectId)).not.toThrow();
  });

  it.each([UserRole.AGENT, UserRole.SUPERVISOR, UserRole.REQUESTER])(
    '%s ajeno al titular NO puede ejercer ningún derecho (a diferencia de tickets, acá no hay "equipo de soporte")',
    (role) => {
      for (const assertFn of assertions) {
        expect(() => assertFn({ id: strangerId, role }, subjectId)).toThrow(
          UnauthorizedActionError,
        );
      }
    },
  );
});
