import { TicketCategory, TicketPriority, TicketStatus, ValidationError } from '@ticketera/common';
import { TicketFactory } from './ticket.factory';

describe('TicketFactory', () => {
  const factory = new TicketFactory();

  const baseInput = {
    title: 'La impresora no imprime',
    description: 'La impresora de recepción no responde desde ayer por la tarde',
    requesterId: '11111111-1111-1111-1111-111111111111',
    category: TicketCategory.HARDWARE,
    sla: { dueAt: new Date('2026-01-02T12:00:00Z'), minutes: 240, policyName: 'business-hours' },
    sequence: 42,
  };

  it('genera el código legible con relleno de ceros', () => {
    expect(factory.create(baseInput).code).toBe('TCK-000042');
  });

  it('nace en OPEN, sin asignar y con el SLA calculado', () => {
    const ticket = factory.create(baseInput);

    expect(ticket.status).toBe(TicketStatus.OPEN);
    expect(ticket.assigneeId).toBeNull();
    expect(ticket.slaDueAt).toEqual(baseInput.sla.dueAt);
    expect(ticket.slaBreached).toBe(false);
  });

  it('asigna un id propio para poder emitir el evento de creación', () => {
    const ticket = factory.create(baseInput);

    expect(ticket.id).toMatch(/^[0-9a-f-]{36}$/);
    const events = ticket.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0].aggregateId).toBe(ticket.id);
  });

  it('crea el asiento inicial del historial', () => {
    const history = factory.create(baseInput).pullNewStatusHistory();

    expect(history).toHaveLength(1);
    expect(history[0].fromStatus).toBeNull();
    expect(history[0].toStatus).toBe(TicketStatus.OPEN);
  });

  describe('prioridad efectiva', () => {
    it('respeta la prioridad pedida cuando no hay señales de urgencia', () => {
      const ticket = factory.create({
        ...baseInput,
        requestedPriority: TicketPriority.LOW,
      });

      expect(ticket.priority).toBe(TicketPriority.LOW);
    });

    it('eleva un nivel si el texto contiene una señal de urgencia', () => {
      const ticket = factory.create({
        ...baseInput,
        description: 'El sistema no funciona y frena la facturación',
        requestedPriority: TicketPriority.MEDIUM,
      });

      expect(ticket.priority).toBe(TicketPriority.HIGH);
    });

    it('no eleva más allá de CRITICAL', () => {
      const ticket = factory.create({
        ...baseInput,
        title: 'Servidor caido, el sistema no funciona',
        requestedPriority: TicketPriority.CRITICAL,
      });

      expect(ticket.priority).toBe(TicketPriority.CRITICAL);
    });

    describe('señales fuertes: escalan solas', () => {
      it.each([
        ['el servidor esta caido', 'El servidor de correo esta caido desde la manana'],
        ['sin tilde ni mayusculas', 'el sistema NO ANDA y no puedo trabajar'],
        ['dejo de funcionar', 'La aplicacion dejo de funcionar tras la actualizacion'],
        ['nadie puede', 'Nadie puede entrar al sistema de facturacion'],
      ])('%s', (_caso, description) => {
        const ticket = factory.create({
          ...baseInput,
          description,
          requestedPriority: TicketPriority.MEDIUM,
        });

        expect(ticket.priority).toBe(TicketPriority.HIGH);
      });

      it('la detección no depende de los acentos', () => {
        const conTilde = factory.create({
          ...baseInput,
          description: 'El servicio está caído y perdida de datos',
          requestedPriority: TicketPriority.LOW,
        });
        const sinTilde = factory.create({
          ...baseInput,
          description: 'El servicio esta caido y perdida de datos',
          requestedPriority: TicketPriority.LOW,
        });

        expect(sinTilde.priority).toBe(conTilde.priority);
        expect(sinTilde.priority).toBe(TicketPriority.MEDIUM);
      });
    });

    describe('señales de contexto: no escalan solas', () => {
      it.each([
        ['consulta sobre producción', 'Quisiera saber como pedir acceso al ambiente de produccion'],
        ['capacitación', 'Solicito capacitacion sobre el proceso de despliegue a produccion'],
        ['documentación con la palabra urgente', 'La documentacion del procedimiento urgente esta desactualizada'],
      ])('no escala: %s', (_caso, description) => {
        const ticket = factory.create({
          ...baseInput,
          description,
          requestedPriority: TicketPriority.LOW,
        });

        expect(ticket.priority).toBe(TicketPriority.LOW);
      });

      it('dos señales de contexto juntas sí escalan', () => {
        const ticket = factory.create({
          ...baseInput,
          title: 'Urgente en produccion',
          description: 'Es urgente, el ambiente de produccion quedo bloqueado para el equipo',
          requestedPriority: TicketPriority.LOW,
        });

        expect(ticket.priority).toBe(TicketPriority.MEDIUM);
      });
    });

    describe('señales de atenuación: anulan el escalamiento', () => {
      it('el usuario que avisa que ya se resolvió no escala', () => {
        const ticket = factory.create({
          ...baseInput,
          description: 'El sistema no funcionaba pero ya funciona, quedo resuelto solo',
          requestedPriority: TicketPriority.LOW,
        });

        expect(ticket.priority).toBe(TicketPriority.LOW);
      });

      it('una mejora a futuro no escala aunque mencione producción', () => {
        const ticket = factory.create({
          ...baseInput,
          description: 'Sugerencia de mejora para el tablero de produccion, sin apuro',
          requestedPriority: TicketPriority.LOW,
        });

        expect(ticket.priority).toBe(TicketPriority.LOW);
      });
    });

    it('resolvePriority devuelve lo mismo que aplica create', () => {
      const input = {
        title: 'Todo esta caido',
        description: 'El servicio esta caido para todos los usuarios',
        requestedPriority: TicketPriority.LOW,
      };

      expect(factory.resolvePriority(input)).toBe(
        factory.create({ ...baseInput, ...input }).priority,
      );
    });
  });

  describe('normalización de tags', () => {
    it('pasa a minúsculas, reemplaza espacios y deduplica', () => {
      const ticket = factory.create({
        ...baseInput,
        tags: ['Sucursal Norte', 'sucursal norte', '  VPN  ', ''],
      });

      expect(ticket.tags).toEqual(['sucursal-norte', 'vpn']);
    });

    it('recorta a 10 tags como máximo', () => {
      const ticket = factory.create({
        ...baseInput,
        tags: Array.from({ length: 20 }, (_, i) => `tag${i}`),
      });

      expect(ticket.tags).toHaveLength(10);
    });
  });

  describe('validación', () => {
    it('rechaza un título demasiado corto', () => {
      expect(() => factory.create({ ...baseInput, title: 'abc' })).toThrow(ValidationError);
    });

    it('rechaza una descripción demasiado corta', () => {
      expect(() => factory.create({ ...baseInput, description: 'corta' })).toThrow(
        ValidationError,
      );
    });

    it('rechaza una secuencia inválida', () => {
      expect(() => factory.create({ ...baseInput, sequence: 0 })).toThrow(/Secuencia/);
    });
  });
});
