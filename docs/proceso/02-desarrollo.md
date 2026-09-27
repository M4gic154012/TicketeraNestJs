# 02 — Desarrollo

**Estado: cerrada** (en el sentido de que las funcionalidades planificadas ya
están construidas; el sistema sigue recibiendo correcciones, que se
documentan igual en la cronología de abajo a medida que ocurren).

Reconstruido a partir del historial de cambios del repositorio. Cada bloque
es una etapa real de trabajo, no una entrega parcial.

## Etapa 1 — La base del sistema (2026-09-12)

Se construyeron los 5 procesos completos: la puerta de entrada, el
compositor de pantallas, y los tres especialistas (usuarios, tickets,
notificaciones), con:

- Inicio de sesión y control de acceso por rol (solicitante, agente,
  supervisor, administrador).
- Creación, búsqueda, asignación y cambio de estado de tickets.
- Cálculo automático de plazo de atención según el tipo de problema y el
  horario.
- Asignación automática al agente adecuado, con tres formas distintas de
  decidir "quién es el adecuado" (por especialidad, por carga de trabajo, o
  por escalamiento cuando es urgente).
- Notificaciones a cada involucrado cuando su ticket cambia.
- Base de datos con las tablas y los índices de búsqueda necesarios.

Esta etapa dejó el sistema funcional de punta a punta por primera vez.

## Etapa 2 — Ingesta de tickets por correo (2026-09-12)

Se sumó un sexto proceso, separado de los demás a propósito: lee un buzón de
correo dedicado y convierte cada mensaje nuevo en un ticket. Incluye:

- Un filtro que descarta correo que no es un pedido real (avisos
  automáticos de otros sistemas, remitentes tipo `cron@`, respuestas
  automáticas de "fuera de oficina", etc.), para que el buzón no se llene de
  basura desde el primer día.
- Reconocimiento de cuando un correo es la respuesta a un ticket ya
  existente (para no abrir uno nuevo y partir la conversación en dos).
- Alta automática de la persona que escribe por primera vez, si su dominio
  de correo está autorizado.
- Un modo de prueba que lee correos guardados como archivo, para poder
  probar todo el flujo sin depender de que el buzón institucional ya
  estuviera habilitado.

## Etapa 3 — Documentación pública de la API (2026-09-12)

Se publicó la documentación interactiva de todos los endpoints
(Swagger), protegida con usuario y contraseña cuando el sistema corre en
modo producción, para que sirva como referencia sin quedar abierta a
cualquiera.

## Etapa 4 — Alta del primer administrador (2026-09-12)

Se resolvió un problema de "huevo y gallina": crear un usuario nuevo por la
vía normal exige estar logueado como administrador, pero en una base de
datos recién instalada no existe ningún administrador todavía. Se construyó
un comando de línea de comandos, separado de la API, que permite crear ese
primer usuario sin necesidad de tener uno ya creado.

## Etapa 5 — Correcciones encontradas en revisión (2026-09-14)

Antes de sumar la funcionalidad de protección de datos, se hizo una pasada
de robustez sobre lo ya construido: manejo más preciso de errores de red
entre los procesos internos, ajustes al mecanismo que corta el tráfico hacia
un servicio caído (para que no se "contagie" un problema de un proceso a
otro), y correcciones puntuales en cómo se buscan y ordenan los tickets.

## Etapa 6 — Derechos ARCO, portabilidad y bloqueo de privacidad (2026-09-14)

Se construyó el módulo que permite a cualquier persona ejercer sus derechos
sobre sus propios datos personales según la Ley 21.719: pedir una copia de
todo lo que el sistema tiene sobre ella, corregir sus datos, pedir que se
anonimice su cuenta, oponerse al tratamiento de sus datos, y bloquearlo
temporalmente. Cada uno de estos pedidos queda registrado de forma auditable
— quién lo pidió, cuándo, y con qué resultado — porque sin ese registro no
hay forma de demostrar más adelante que el derecho se ejerció de verdad.

---

## Dos auditorías que encontraron fallas reales durante el desarrollo

Vale la pena que quede documentado, porque son la razón de varias reglas que
el sistema sigue hoy.

**Una revisión de seguridad** encontró que, en una versión temprana, un
usuario cualquiera podía cerrar o comentar el ticket de otra persona con solo
conocer su identificador — el control de "¿es realmente tuyo este ticket?"
no se estaba aplicando donde correspondía. Encontró además que los procesos
internos no verificaban entre sí quién les hablaba: conectándose
directamente (sin pasar por la puerta de entrada) se podía crear un usuario
administrador saltándose todos los controles. Las dos fallas quedaron
corregidas y con una prueba automática que impide que vuelvan a pasar
desapercibidas.

**Una revisión funcional (QA)** encontró 18 problemas más, nueve de los
cuales solo eran visibles probando los 5 procesos juntos — la batería de
pruebas de cada pieza por separado no los detectaba. Entre ellos: un filtro
de búsqueda que ignoraba en silencio la opción "no marcado" y mostraba
siempre el mismo resultado que "marcado"; notificaciones que le avisaban a
la persona equivocada (a quien hizo el cambio, no a quien lo esperaba); y una
falla donde el "usar más de una palabra para configurar una opción" no
funcionaba, así que activar una mitigación de emergencia (bajar la carga de
un servicio) no tenía ningún efecto real.

Ambas quedan resumidas acá porque explican por qué ciertas reglas del
sistema son como son, no porque sigan pendientes — las dos están corregidas.
