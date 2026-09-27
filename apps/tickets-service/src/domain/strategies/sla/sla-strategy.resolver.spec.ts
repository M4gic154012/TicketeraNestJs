import { ConfigService } from '@nestjs/config';
import { TicketCategory, TicketPriority } from '@ticketera/common';
import { BusinessHoursSlaStrategy } from './business-hours-sla.strategy';
import { Sla24x7Strategy } from './cat24x7-sla.strategy';
import { SlaStrategyResolver } from './sla-strategy.resolver';

describe('Estrategias de SLA', () => {
  const config = {
    get: (key: string) =>
      ({
        SLA_CRITICAL_MINUTES: 60,
        SLA_HIGH_MINUTES: 240,
        SLA_MEDIUM_MINUTES: 1440,
        SLA_LOW_MINUTES: 4320,
      })[key],
  } as unknown as ConfigService;

  const businessHours = new BusinessHoursSlaStrategy(config);
  const always = new Sla24x7Strategy(config);
  const resolver = new SlaStrategyResolver([always, businessHours]);

  const context = (
    priority: TicketPriority,
    createdAt: Date,
    isVipRequester = false,
  ) => ({ priority, category: TicketCategory.SOFTWARE, createdAt, isVipRequester });

  it('un ticket crítico usa la política 24x7 en tiempo corrido', async () => {
    const createdAt = new Date('2026-01-10T22:00:00');

    const result = await resolver.calculate(context(TicketPriority.CRITICAL, createdAt));

    expect(result.policyName).toBe('24x7');
    expect(result.dueAt.getTime() - createdAt.getTime()).toBe(60 * 60_000);
  });

  it('un solicitante VIP también obtiene 24x7 aunque no sea crítico', async () => {
    const result = await resolver.calculate(
      context(TicketPriority.LOW, new Date('2026-01-10T22:00:00'), true),
    );

    expect(result.policyName).toBe('24x7');
  });

  it('el resto usa horario laboral', async () => {
    const result = await resolver.calculate(
      context(TicketPriority.HIGH, new Date('2026-01-12T10:00:00')),
    );

    expect(result.policyName).toBe('business-hours');
  });

  describe('cálculo en horario laboral', () => {
    it('cuenta dentro de la misma jornada', async () => {
      // Lunes 12/01/2026 10:00 + 4h hábiles = mismo día 14:00
      const result = await businessHours.execute(
        context(TicketPriority.HIGH, new Date('2026-01-12T10:00:00')),
      );

      expect(result.dueAt.getDate()).toBe(12);
      expect(result.dueAt.getHours()).toBe(14);
    });

    it('un ticket abierto de noche empieza a contar al día hábil siguiente', async () => {
      // Lunes 23:00 -> arranca martes 09:00, +4h = martes 13:00
      const result = await businessHours.execute(
        context(TicketPriority.HIGH, new Date('2026-01-12T23:00:00')),
      );

      expect(result.dueAt.getDate()).toBe(13);
      expect(result.dueAt.getHours()).toBe(13);
    });

    it('salta el fin de semana', async () => {
      // Viernes 16/01 17:00 + 4h hábiles: 1h el viernes, 3h el lunes 19 -> 12:00
      const result = await businessHours.execute(
        context(TicketPriority.HIGH, new Date('2026-01-16T17:00:00')),
      );

      expect(result.dueAt.getDay()).toBe(1);
      expect(result.dueAt.getDate()).toBe(19);
      expect(result.dueAt.getHours()).toBe(12);
    });

    it('un ticket abierto en sábado arranca el lunes', async () => {
      const result = await businessHours.execute(
        context(TicketPriority.HIGH, new Date('2026-01-17T11:00:00')),
      );

      expect(result.dueAt.getDate()).toBe(19);
      expect(result.dueAt.getHours()).toBe(13);
    });

    it('reparte un SLA largo entre varias jornadas', async () => {
      // Lunes 09:00 + 1440 min hábiles = 2 jornadas completas (540 x2) + 360 min
      const result = await businessHours.execute(
        context(TicketPriority.MEDIUM, new Date('2026-01-12T09:00:00')),
      );

      expect(result.dueAt.getDate()).toBe(14);
      expect(result.dueAt.getHours()).toBe(15);
    });

    it('el vencimiento nunca cae fuera del horario laboral', async () => {
      const result = await businessHours.execute(
        context(TicketPriority.LOW, new Date('2026-01-12T09:00:00')),
      );

      // El rango se afirma en minutos, no en horas: `getHours() <= 18` aceptaba
      // 18:45, que ya es fuera de horario. Las 18:00 exactas sí son válidas — son el
      // cierre de la jornada, el último instante hábil — y ocurren cuando el SLA
      // consume jornadas completas.
      const minutosDelDia = result.dueAt.getHours() * 60 + result.dueAt.getMinutes();
      expect(minutosDelDia).toBeGreaterThanOrEqual(9 * 60);
      expect(minutosDelDia).toBeLessThanOrEqual(18 * 60);
      expect([0, 6]).not.toContain(result.dueAt.getDay());
    });

    it('un SLA que consume jornadas exactas vence al cierre, no al día siguiente', async () => {
      // LOW = 4320 min = exactamente 8 jornadas de 540. Vence el viernes 23 a las
      // 18:00 y no el lunes 26 a las 9:00: el borde no debe empujar al día hábil
      // siguiente.
      const result = await businessHours.execute(
        context(TicketPriority.LOW, new Date('2026-01-12T09:00:00')),
      );

      expect(result.dueAt.getDate()).toBe(21);
      expect(result.dueAt.getHours()).toBe(18);
      expect(result.dueAt.getMinutes()).toBe(0);
    });
  });
});
