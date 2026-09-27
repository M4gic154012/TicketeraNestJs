import { isTransportFailure } from './transport-failure';

/**
 * Regresión del mapeo de errores entre hops.
 *
 * Un dependiente caído debe dar 503 (reintentá), no 500 (hay un bug). Además, un
 * 500 espurio contaba como fallo de infraestructura y empujaba el circuito del
 * BFF hacia OPEN: repetir lecturas no autorizadas alcanzaba para degradar el
 * servicio de todos.
 */
describe('isTransportFailure', () => {
  it('reconoce los códigos de error de socket', () => {
    expect(isTransportFailure({ code: 'ECONNREFUSED' })).toBe(true);
    expect(isTransportFailure({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransportFailure({ code: 'ETIMEDOUT' })).toBe(true);
  });

  /**
   * Regresión. El test original afirmaba exactamente los tres códigos que la
   * implementación manejaba, y por eso estaba verde mientras el invariante
   * documentado estaba roto: en Docker un contenedor detenido NO rechaza la
   * conexión, no resuelve por DNS. `ENOTFOUND` era el único caso que ocurría de
   * verdad y era el que faltaba.
   */
  it('reconoce ENOTFOUND, que es lo que da un contenedor caído', () => {
    expect(isTransportFailure({ code: 'ENOTFOUND', syscall: 'getaddrinfo' })).toBe(true);
    expect(isTransportFailure(new Error('getaddrinfo ENOTFOUND users-service'))).toBe(true);
  });

  it('reconoce el resto de los fallos de red alcanzables', () => {
    for (const code of ['EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'EPIPE']) {
      expect(isTransportFailure({ code })).toBe(true);
    }
  });

  it('reconoce los mensajes del ClientProxy de Nest', () => {
    expect(isTransportFailure(new Error('There is no matching message handler'))).toBe(true);
    expect(isTransportFailure(new Error('Connection closed'))).toBe(true);
    expect(isTransportFailure(new Error('Empty response'))).toBe(true);
  });

  /**
   * Regresión. Con un contenedor detenido, el ClientProxy reintenta la resolución
   * DNS y el `timeout()` de RxJS dispara ANTES de que aparezca el código de red, así
   * que lo que llega al filtro es un TimeoutError. Sin reconocerlo, el login daba 503
   * (ahí el error sí era ENOTFOUND) pero crear un ticket daba 500.
   */
  it('reconoce un timeout como fallo de transporte', () => {
    const rxjsTimeout = Object.assign(new Error('Timeout has occurred'), {
      name: 'TimeoutError',
    });
    expect(isTransportFailure(rxjsTimeout)).toBe(true);

    // El timeout del propio circuit breaker.
    expect(isTransportFailure(new Error("Timeout de 3000ms al llamar a 'users-service'"))).toBe(
      true,
    );
  });

  it('reconoce un observable que completa sin emitir', () => {
    const empty = Object.assign(new Error('no elements in sequence'), { name: 'EmptyError' });
    expect(isTransportFailure(empty)).toBe(true);
  });

  it('no confunde un error de negocio con una caída', () => {
    expect(isTransportFailure({ code: 'UNAUTHORIZED_ACTION', message: 'sin permiso' })).toBe(
      false,
    );
    expect(isTransportFailure(new Error('Transición no permitida de OPEN a RESOLVED'))).toBe(
      false,
    );
  });

  it('tolera valores no objeto', () => {
    expect(isTransportFailure(null)).toBe(false);
    expect(isTransportFailure('texto')).toBe(false);
  });
});
