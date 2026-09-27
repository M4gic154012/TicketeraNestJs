import { EmailClassifier } from './email-classifier';
import { EmailDisposition } from './classification.types';
import { IncomingEmail } from './incoming-email';

/**
 * El caso que motivó este filtro: el buzón institucional recibe la salida de los
 * crontab de los servicios. Cada uno convertido en ticket es basura que alguien
 * limpia a mano, y una bandeja con ruido hace que el equipo deje de confiar en la
 * herramienta.
 */
describe('EmailClassifier', () => {
  const classifier = new EmailClassifier('soporte@cmm.uchile.cl', ['cmm.uchile.cl', 'uchile.cl']);

  const email = (overrides: Partial<IncomingEmail> = {}): IncomingEmail => ({
    messageId: '<abc123@mail.example>',
    from: { address: 'persona@cmm.uchile.cl', name: 'Una Persona' },
    to: ['soporte@cmm.uchile.cl'],
    subject: 'No puedo acceder al servidor de cálculo',
    text: 'Desde ayer no puedo entrar por SSH al servidor de cálculo. ¿Pueden revisar?',
    receivedAt: new Date('2026-09-12T10:00:00Z'),
    references: [],
    headers: {},
    attachmentCount: 0,
    ...overrides,
  });

  describe('correos de personas: crean ticket', () => {
    it('un pedido normal crea ticket', () => {
      const result = classifier.classify(email());

      expect(result.disposition).toBe(EmailDisposition.CREATE_TICKET);
    });

    it('acepta subdominios del dominio autorizado', () => {
      const result = classifier.classify(
        email({ from: { address: 'alguien@dim.uchile.cl' } }),
      );

      expect(result.disposition).toBe(EmailDisposition.CREATE_TICKET);
    });

    it('un correo sin cuerpo pero con adjunto se acepta', () => {
      const result = classifier.classify(
        email({ subject: '', text: '', attachmentCount: 1 }),
      );

      expect(result.disposition).toBe(EmailDisposition.CREATE_TICKET);
    });

    it('`auto-submitted: no` es explícitamente un correo humano', () => {
      const result = classifier.classify(email({ headers: { 'auto-submitted': 'no' } }));

      expect(result.disposition).toBe(EmailDisposition.CREATE_TICKET);
    });
  });

  describe('salida de crontab y monitoreo: se descarta', () => {
    it.each([
      ['root@servidor', { from: { address: 'root@calculo.cmm.uchile.cl' } }],
      ['cron@servidor', { from: { address: 'cron@web.cmm.uchile.cl' } }],
      ['mailer-daemon', { from: { address: 'MAILER-DAEMON@cmm.uchile.cl' } }],
      ['backup@', { from: { address: 'backup@cmm.uchile.cl' } }],
      ['nagios@', { from: { address: 'nagios@cmm.uchile.cl' } }],
    ])('descarta por remitente %s', (_caso, overrides) => {
      const result = classifier.classify(email(overrides as Partial<IncomingEmail>));

      expect(result.disposition).toBe(EmailDisposition.DISCARD);
      expect(result.reason).toMatch(/Remitente automático/);
    });

    it('descarta la salida clásica de cron por asunto', () => {
      // Formato real de la salida de cron en Debian/Ubuntu.
      const result = classifier.classify(
        email({
          from: { address: 'sistemas@cmm.uchile.cl' },
          subject: 'Cron <www-data@calculo> /usr/local/bin/respaldo.sh',
          text: 'rsync: 1204 files transferred',
        }),
      );

      expect(result.disposition).toBe(EmailDisposition.DISCARD);
      expect(result.reason).toMatch(/Asunto de correo automático/);
    });

    it.each([
      'Backup completed successfully',
      'Disk space alert on /var',
      'SSL certificate expiring in 14 days',
      'systemd: unit failed',
      'Delivery Status Notification (Failure)',
      'Respuesta automática: estoy de vacaciones',
      'Out of office',
    ])('descarta el asunto automático "%s"', (subject) => {
      const result = classifier.classify(
        email({ from: { address: 'sistemas@cmm.uchile.cl' }, subject }),
      );

      expect(result.disposition).toBe(EmailDisposition.DISCARD);
    });

    it.each([
      ['auto-submitted', { 'auto-submitted': 'auto-generated' }],
      ['precedence bulk', { precedence: 'bulk' }],
      ['list-id', { 'list-id': '<lista.cmm.uchile.cl>' }],
      ['x-autoreply', { 'x-autoreply': 'yes' }],
    ])('descarta por la cabecera %s', (_caso, headers) => {
      const result = classifier.classify(email({ headers }));

      expect(result.disposition).toBe(EmailDisposition.DISCARD);
      expect(result.reason).toMatch(/Cabecera de correo automático/);
    });
  });

  describe('prevención de bucles', () => {
    it('descarta un correo del propio buzón', () => {
      const result = classifier.classify(
        email({ from: { address: 'soporte@cmm.uchile.cl' } }),
      );

      expect(result.disposition).toBe(EmailDisposition.DISCARD);
      expect(result.reason).toMatch(/propio buzón/);
    });

    it('el bucle se corta antes que cualquier otra regla', () => {
      // Aunque además sea una respuesta a un ticket: si viene de nosotros, se corta.
      const result = classifier.classify(
        email({
          from: { address: 'soporte@cmm.uchile.cl' },
          subject: 'Re: [TCK-000123] algo',
        }),
      );

      expect(result.disposition).toBe(EmailDisposition.DISCARD);
    });
  });

  describe('respuestas a tickets existentes', () => {
    it('reconoce el código en el asunto y agrega comentario', () => {
      const result = classifier.classify(
        email({ subject: 'Re: [TCK-000123] No puedo acceder al servidor' }),
      );

      expect(result.disposition).toBe(EmailDisposition.APPEND_COMMENT);
      expect(result.ticketCode).toBe('TCK-000123');
    });

    it('reconoce el código en las cabeceras de threading', () => {
      const result = classifier.classify(
        email({
          subject: 'Sin el código en el asunto',
          inReplyTo: '<TCK-000456.evento@ticketera.cmm.uchile.cl>',
        }),
      );

      expect(result.disposition).toBe(EmailDisposition.APPEND_COMMENT);
      expect(result.ticketCode).toBe('TCK-000456');
    });

    it('una respuesta se detecta ANTES de evaluar el dominio', () => {
      // Un tercero copiado en el hilo puede responder: su aporte va al ticket.
      const result = classifier.classify(
        email({
          from: { address: 'proveedor@externo.com' },
          subject: 'Re: [TCK-000789] consulta',
        }),
      );

      expect(result.disposition).toBe(EmailDisposition.APPEND_COMMENT);
    });
  });

  describe('dominios', () => {
    it('descarta un dominio no autorizado', () => {
      const result = classifier.classify(email({ from: { address: 'spam@dominio-raro.ru' } }));

      expect(result.disposition).toBe(EmailDisposition.DISCARD);
      expect(result.reason).toMatch(/Dominio no autorizado/);
    });

    it('sin lista de dominios acepta a cualquiera', () => {
      const abierto = new EmailClassifier('soporte@cmm.uchile.cl', []);

      expect(abierto.classify(email({ from: { address: 'x@gmail.com' } })).disposition).toBe(
        EmailDisposition.CREATE_TICKET,
      );
    });
  });

  it('siempre explica el motivo, también en los descartes', () => {
    const todos = [
      email(),
      email({ from: { address: 'root@host' } }),
      email({ from: { address: 'x@no-autorizado.com' } }),
      email({ subject: 'Re: [TCK-000001] x' }),
    ];

    for (const caso of todos) {
      expect(classifier.classify(caso).reason.length).toBeGreaterThan(10);
    }
  });
});
