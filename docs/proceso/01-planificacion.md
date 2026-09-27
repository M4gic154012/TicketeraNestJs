# 01 — Planificación

**Estado: cerrada.** Este documento reconstruye las decisiones tomadas antes
de construir, a partir de la arquitectura y las reglas que quedaron fijadas en
el proyecto. No hay actas de esa etapa; lo que sigue es la lectura de **qué
se decidió** y **por qué**, tal como se refleja en cómo está armado el sistema.

## Qué problema resuelve

Una mesa de ayuda interna: las personas reportan incidencias (formulario o
correo), el sistema las clasifica por urgencia, les calcula un plazo de
atención según el tipo de problema, las asigna a la persona con la
especialidad adecuada, y avisa a cada involucrado cuando algo cambia.

## Decisión de arquitectura: un frente único, especialistas separados por dentro

Se decidió que **un solo punto de entrada** reciba tráfico de internet. Todo
lo demás — la lógica de tickets, la de usuarios, la de notificaciones, y el
servicio que lee el correo — vive detrás, sin acceso directo desde afuera.

**Por qué**: es la misma lógica que separar caja de cocina en un restaurante.
Si algo sale mal adentro, no queda expuesto hacia la calle. El punto de
entrada es también el único lugar que necesita saber "quién sos" (la llave de
sesión); los especialistas de adentro solo necesitan saber "esto viene del
punto de entrada autorizado", con una llave distinta. Si una de las dos
llaves se filtra, la otra sigue protegiendo.

**Costo asumido**: son 5 procesos en vez de 1, lo que pesa más en
infraestructura y en complejidad de despliegue. La decisión fue que ese costo
vale la pena por el aislamiento que da.

## Decisión de cumplimiento: la Ley 21.719 se planificó desde el modelo de datos

Antes de construir el módulo de usuarios se decidió qué campos hacían falta
para poder, más adelante, cumplir con los derechos ARCO (acceso,
rectificación, cancelación, oposición) más portabilidad y bloqueo temporal —
la Ley de Protección de Datos Personales. Eso se tradujo en:

- Cada usuario puede quedar "anonimizado" en vez de borrado (borrarlo de
  verdad rompería el historial de tickets de terceros).
- Cada vez que alguien ejerce uno de estos derechos, queda un registro
  aparte, auditable, de qué se pidió, quién lo pidió y cuándo.

Este módulo se construyó recién en la última etapa de desarrollo (ver
documento 02), pero el espacio para que existiera se dejó desde el diseño de
la tabla de usuarios.

## Decisión de negocio: la urgencia no se declara, se infiere

Se decidió que el sistema no confíe en que la persona que reporta un problema
sepa marcarlo como urgente — en la práctica, casi nadie lo hace aunque su
problema sea grave. En cambio, el sistema lee el texto del reporte buscando
señales de que algo está caído de verdad, y sube la prioridad solo. El
diseño de esa heurística (qué palabras escalan, cuáles no, y cuáles anulan la
escalada) está documentado en detalle en `CLAUDE.md`.

## Decisión sobre el correo: buzón nuevo, no el existente

Se decidió NO conectar el sistema al buzón de soporte que ya existía
(`sistemas@...`), porque ese buzón recibe años de ruido automático (avisos de
sistemas, cron jobs, etc.) que habría entrado como tickets basura desde el
primer día. Se planificó un buzón nuevo, dedicado, que arranca limpio.

## Decisiones que se tomaron sabiendo el costo que tenían

Quedaron fijadas explícitamente para no tener que redebatirlas más adelante
sin recordar por qué se decidieron así. Las más relevantes para quien no lee
código:

- **Una sola base de datos** para los 5 procesos, en vez de una por proceso.
  Más simple de operar; a cambio, no se puede escalar o migrar una parte de
  los datos de forma independiente del resto.
- **Sin sistema de mensajería intermedio** (broker) entre los procesos: se
  habla directo. Más simple de correr; a cambio, si el proceso de
  notificaciones está caído en el instante exacto en que algo pasa, esa
  notificación puntual se pierde (queda igual el cambio en el ticket, se
  pierde el aviso).
- **El envío real de correos no se implementó todavía** — el sistema ya sabe
  qué correo mandar y a quién, pero el paso final (conectarlo a un servidor
  de correo saliente) quedó para cuando haga falta.
- **Sin invalidación inmediata de sesión**: si se desactiva una cuenta, la
  sesión activa de esa persona sigue funcionando hasta que expira sola
  (15 minutos). Se identificó como una brecha en la revisión de seguridad de
  la fase de implementación — ver documento 03.

## Qué quedó fuera de este alcance, a propósito

- Balanceo de carga entre varias copias de un mismo proceso (si hace falta
  escalar, hoy se escala verticalmente).
- Envío de correo saliente real.
- Copia de los respaldos de base de datos fuera del mismo disco donde vive la
  base.

Estos tres puntos están para que, si en algún momento se vuelven necesarios,
no se lean como un olvido sino como una decisión tomada con el costo a la
vista.
