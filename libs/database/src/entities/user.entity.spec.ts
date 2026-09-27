import { UserRole } from '@ticketera/common';
import { randomUUID } from 'node:crypto';
import { User } from './user.entity';

/**
 * Tests del agregado. Sin infraestructura: es justamente lo que permite poner
 * las invariantes de anonimización/bloqueo en la entidad.
 */
describe('User (agregado) — derechos ARCO', () => {
  const buildUser = (overrides: Partial<User> = {}): User => {
    const user = new User();
    user.id = randomUUID();
    user.email = 'titular@test.local';
    user.fullName = 'Titular de Datos';
    user.passwordHash = '$2b$12$original';
    user.role = UserRole.REQUESTER;
    user.department = 'Facultad de Ciencias';
    user.isActive = true;
    user.skills = [];
    user.maxConcurrentTickets = null;
    user.anonymizedAt = null;
    user.privacyBlockedAt = null;
    user.privacyBlockReason = null;
    return Object.assign(user, overrides);
  };

  describe('anonymize (Cancelación)', () => {
    it('reemplaza los campos identificables por placeholders estables', () => {
      const user = buildUser();
      const id = user.id;

      user.anonymize('$2b$12$unusable');

      expect(user.email).toBe(`eliminado-${id}@anonimizado.local`);
      expect(user.fullName).toBe('Usuario eliminado');
      expect(user.passwordHash).toBe('$2b$12$unusable');
      expect(user.department).toBeNull();
      expect(user.skills).toEqual([]);
      expect(user.maxConcurrentTickets).toBeNull();
      expect(user.isActive).toBe(false);
      expect(user.isAnonymized()).toBe(true);
    });

    it('es idempotente: una segunda llamada no vuelve a mutar el estado', () => {
      const user = buildUser();
      user.anonymize('$2b$12$first');
      const firstAnonymizedAt = user.anonymizedAt;

      user.anonymize('$2b$12$second');

      expect(user.passwordHash).toBe('$2b$12$first');
      expect(user.anonymizedAt).toBe(firstAnonymizedAt);
    });
  });

  describe('blockPrivacy / unblockPrivacy (Bloqueo temporal)', () => {
    it('activa el bloqueo con motivo, independiente de isActive', () => {
      const user = buildUser({ isActive: true });

      user.blockPrivacy('Oposición en evaluación');

      expect(user.isPrivacyBlocked()).toBe(true);
      expect(user.privacyBlockReason).toBe('Oposición en evaluación');
      expect(user.isActive).toBe(true);
    });

    it('levanta el bloqueo y limpia el motivo', () => {
      const user = buildUser();
      user.blockPrivacy('motivo');

      user.unblockPrivacy();

      expect(user.isPrivacyBlocked()).toBe(false);
      expect(user.privacyBlockedAt).toBeNull();
      expect(user.privacyBlockReason).toBeNull();
    });
  });
});
