# 03 — Implementación

**Estado: en curso.** Esta es la fase de llevar lo construido a un estado
desplegable y verificado, antes de exponerlo a usuarios reales en una marcha
blanca. Documento vivo: cada verificación y cada corrección se agrega acá a
medida que ocurre, con fecha.

## Cómo se despliega

El sistema corre en contenedores (Docker): una imagen por proceso, más un
proceso aparte que solo se encarga de aplicar los cambios de base de datos
antes de que el resto arranque — así se evita el escenario de "el sistema
arrancó pero la base todavía no tiene las tablas". Cada proceso recibe
únicamente las claves y contraseñas que necesita para su propio trabajo: la
puerta de entrada, por ejemplo, no tiene ninguna credencial de la base de
datos, porque no le hace falta y porque así, si se filtrara, no expondría la
base.

## 2026-09-14 — Primera verificación de extremo a extremo

Hasta esta fecha, el sistema tenía pruebas automáticas de cada pieza por
separado (204 pruebas, todas pasando), pero **ninguna prueba que levantara
los 5 procesos juntos y probara un flujo real** — el tipo de prueba que,
según quedó documentado en la etapa de QA (ver documento 02), es la única
forma de detectar cierta clase de problemas.

Se construyó esa batería de pruebas de punta a punta. Cubre:

- El recorrido completo de un ticket con los cuatro roles involucrados
  (solicitante, agente, agente sin relación con el ticket, supervisor),
  verificando que cada notificación llegue a quien corresponde y a nadie
  más.
- Que un usuario sin relación con un ticket no pueda leerlo ni modificarlo,
  aunque conozca su identificador.
- Que asignar dos veces el mismo ticket al mismo agente no duplique avisos
  (y que dos asignaciones simultáneas no dejen el ticket en un estado
  inconsistente).
- Que repetir peticiones no autorizadas no termine cortando el servicio para
  el resto de los usuarios (un usuario malicioso no puede usar sus propios
  rechazos como forma de tirar el sistema abajo).

**Resultado: 24 de 24 pruebas pasando**, contra el sistema real corriendo en
contenedores.

## 2026-09-14 — Análisis de calidad de código y revisión cruzada

Se corrió un análisis automático de calidad de código (SonarQube) sobre todo
el proyecto: **0 fallas de seguridad, 0 errores, superó el estándar de
calidad exigido.** Las 25 observaciones que marcó resultaron, al revisarlas
a mano, ser falsos positivos — la herramienta interpretó la palabra "todo"
en español como si fuera la marca en inglés de una tarea pendiente.

Como ese análisis automático no encontró nada real, se complementó con una
**revisión manual cruzada e independiente**, hecha por tres revisiones
separadas (calidad de código, seguridad ofensiva, y una revisión adicional
en la nube), cada una sin ver el trabajo de las otras. Coincidieron en
señalar los mismos puntos débiles por vías distintas — lo cual es una buena
señal de que los hallazgos son reales y no ruido de una sola herramienta.

### Hallazgos de alto impacto — ya corregidos

- **Una solicitud de derechos ARCO podía quedar anonimizada sin dejar
  rastro de auditoría.** Si el segundo de dos pasos internos fallaba (por
  una falla transitoria de la base de datos), la cuenta quedaba anonimizada
  — una acción irreversible — sin que quedara registro de que la solicitud
  había ocurrido. **Corregido**: ambos pasos ahora ocurren juntos o ninguno.
- **Un motivo de bloqueo u oposición largo (pero válido según el
  formulario) hacía fallar la solicitud** con un error interno, en vez de
  guardarse. **Corregido y verificado** contra el sistema real.
- **La documentación técnica completa de la API quedaba accesible sin
  contraseña** por una de sus tres rutas de acceso, pese a estar protegida
  en las otras dos. **Corregido y verificado**: las tres rutas piden
  credenciales ahora.
- **El reporte de "todos mis datos personales" (derecho de acceso y
  portabilidad) podía devolver información incompleta en silencio**, sin
  avisar que faltaban datos, si la persona tenía mucho historial. Se
  corrigió: ahora reúne el historial completo cuando es técnicamente
  posible, y cuando existe un límite real que no se puede levantar (el caso
  de las notificaciones, con un tope técnico de 5000), el reporte lo declara
  explícitamente en vez de mostrar un resultado incompleto sin decirlo.

### Pendientes identificados, con severidad media o baja

Quedan para una próxima ronda, no bloquean lo ya corregido:

| Hallazgo | Impacto si no se corrige |
|---|---|
| Al anonimizar una cuenta (cancelación ARCO), la sesión activa de esa persona sigue funcionando hasta por 7 días | La supresión de datos no corta el acceso de inmediato |
| El sistema de correo entrante no verifica que el remitente sea quien dice ser | Alguien podría, en teoría, falsificar el remitente de un correo para comentar o abrir tickets a nombre de otra persona |
| Un correo con el código de un ticket ajeno en el asunto, mandado por un dominio no autorizado, queda reintentándose para siempre | Consumo innecesario de recursos; no compromete datos |
| Cambiar el email propio no pide confirmación de la nueva dirección | Alguien podría tomar el email de otra persona del mismo dominio si esa persona nunca se registró |
| Un registro de bloqueo de privacidad no tiene ningún efecto real todavía (nadie lo consulta) | La función existe en el formulario pero no bloquea nada en la práctica |

## Qué falta para dar por cerrada esta fase

- [ ] Decidir si los pendientes de la tabla de arriba se resuelven antes de
      la marcha blanca o se aceptan como riesgo conocido.
- [ ] Revisión de infraestructura (imágenes Docker, respaldos, manejo de
      certificados) — todavía no se hizo con el mismo nivel de detalle que la
      revisión de código.
- [ ] Confirmar el buzón de correo institucional real (hoy se prueba con un
      modo simulado; falta el trámite para el buzón definitivo).
