import { EmailBodyCleaner } from './email-body.cleaner';

describe('EmailBodyCleaner', () => {
  const cleaner = new EmailBodyCleaner();

  it('quita la firma separada por "-- "', () => {
    const body = [
      'No puedo entrar al servidor de cálculo.',
      '',
      '-- ',
      'Juan Pérez',
      'Centro de Modelamiento Matemático',
      'Universidad de Chile',
      '+56 2 2978 0000',
    ].join('\n');

    expect(cleaner.clean(body)).toBe('No puedo entrar al servidor de cálculo.');
  });

  it('corta el texto citado en español', () => {
    const body = [
      'Sigue sin funcionar.',
      '',
      'El 12 de septiembre de 2026, Soporte <soporte@cmm.uchile.cl> escribió:',
      '> ¿Probaste reiniciar la sesión?',
      '> Avisanos.',
    ].join('\n');

    expect(cleaner.clean(body)).toBe('Sigue sin funcionar.');
  });

  /**
   * Regresión: el patrón solo contemplaba "escribió" con tilde, así que una respuesta
   * real que decía "escribio" dejaba el encabezado de la cita dentro del comentario.
   */
  it('corta el texto citado aunque falte la tilde en "escribio"', () => {
    const body = [
      'Gracias por la respuesta. Ya probe regenerar la clave y sigue igual.',
      '',
      'El 12 de septiembre de 2026, Soporte <soporte@cmm.uchile.cl> escribio:',
      '> Hola Juan, probaste regenerar la clave publica?',
    ].join('\n');

    const result = cleaner.clean(body);

    expect(result).toBe('Gracias por la respuesta. Ya probe regenerar la clave y sigue igual.');
    expect(result).not.toContain('escribio');
  });

  it('corta el texto citado en inglés', () => {
    const body = 'Still broken.\n\nOn Sep 12, 2026, Support wrote:\n> Did you retry?';

    expect(cleaner.clean(body)).toBe('Still broken.');
  });

  it('quita las líneas citadas sueltas sin encabezado', () => {
    const body = 'Confirmo el problema.\n> mensaje anterior\n> otra línea';

    expect(cleaner.clean(body)).toBe('Confirmo el problema.');
  });

  it('quita "Enviado desde mi iPhone"', () => {
    const body = 'Urgente, no anda la impresora.\n\nEnviado desde mi iPhone';

    expect(cleaner.clean(body)).toBe('Urgente, no anda la impresora.');
  });

  it('colapsa los saltos de línea de más', () => {
    expect(cleaner.clean('Primera línea.\n\n\n\n\nSegunda línea.')).toBe(
      'Primera línea.\n\nSegunda línea.',
    );
  });

  /**
   * El corte solo aplica si queda contenido antes. Un reenvío puro empieza con el
   * encabezado citado, y cortarlo ahí borraría el correo entero.
   */
  it('no vacía un correo que empieza con texto reenviado', () => {
    const body = '---------- Forwarded message ----------\nDe: alguien\n\nRevisen esto por favor.';

    const result = cleaner.clean(body);

    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('Revisen esto');
  });

  it('normaliza los saltos de Windows', () => {
    expect(cleaner.clean('Una línea.\r\n\r\nOtra línea.')).toBe('Una línea.\n\nOtra línea.');
  });

  describe('buildDescription', () => {
    it('usa el cuerpo limpio cuando alcanza', () => {
      const result = cleaner.buildDescription(
        'Problema con VPN',
        'La VPN rechaza mis credenciales desde el lunes.\n\n-- \nJuan',
        'juan@cmm.uchile.cl',
      );

      expect(result).toBe('La VPN rechaza mis credenciales desde el lunes.');
    });

    /**
     * Pasa de verdad: gente que escribe todo en el asunto y manda el cuerpo vacío.
     * Sin este respaldo, la validación del dominio (descripción de 10 caracteres
     * mínimo) rechazaría el ticket y se perdería el pedido.
     */
    it('cae al asunto cuando el cuerpo queda vacío tras limpiar', () => {
      const result = cleaner.buildDescription(
        'No funciona la impresora de recepción',
        '-- \nJuan Pérez\nCMM',
        'juan@cmm.uchile.cl',
      );

      expect(result).toContain('No funciona la impresora de recepción');
      expect(result).toContain('juan@cmm.uchile.cl');
      expect(result.length).toBeGreaterThanOrEqual(10);
    });

    it('el resultado siempre pasa el mínimo que exige el dominio', () => {
      const casos = [
        ['', ''],
        ['Hola', ''],
        ['', 'ok'],
        ['x', '-- \nfirma'],
      ];

      for (const [subject, text] of casos) {
        const result = cleaner.buildDescription(subject, text, 'a@cmm.uchile.cl');
        expect(result.length).toBeGreaterThanOrEqual(10);
      }
    });
  });
});
