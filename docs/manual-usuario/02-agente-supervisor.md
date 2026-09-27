# 02 — Manual del Agente y del Supervisor

Sos agente si formás parte del equipo de soporte que atiende tickets.
Sos supervisor si además coordinás al equipo. Las diferencias entre uno y
otro están marcadas en cada sección.

Ninguna de las funciones de este manual está disponible por correo — el
correo solo sirve para que los solicitantes escriban. Todo lo de acá es por
la interfaz web (a construir; la funcionalidad ya existe en el sistema).

## Tu cuenta

Un administrador te da de alta con tu rol (Agente o Supervisor), tu
especialidad (una o más categorías: Hardware, Software, Red, Accesos, Otro)
y cuántos tickets podés tener asignados en simultáneo como máximo. Esa
información es la que el sistema usa para decidir qué ticket te asigna.

## Tu tablero

Una vista pensada para vos: los tickets bajo tu responsabilidad, para saber
rápido qué tenés pendiente sin tener que armar un filtro cada vez.

## Ver y filtrar tickets

A diferencia del solicitante, vos ves **todos** los tickets del sistema, no
solo los tuyos. Los mismos filtros que tiene el solicitante (estado,
prioridad, categoría, etiqueta, texto, rango de fechas) más dos que solo
tiene sentido usar en tu rol:

- **Sin asignar**: para encontrar tickets que todavía nadie tomó.
- **Vencidos**: tickets cuyo plazo de atención ya pasó.

## Tomar o recibir un ticket

Un ticket llega a vos de dos formas:

- **Asignación automática**: si el solicitante dejó esa opción activada al
  crear el ticket, el sistema elige solo a la persona más adecuada — mira
  tu especialidad, tu carga de trabajo actual, y si el ticket es urgente,
  prioriza que quede resuelto rápido por sobre repartir la carga parejo.
- **Asignación manual**: un supervisor (o vos mismo, si el ticket está
  libre) lo asigna a mano.

**Diferencia entre agente y supervisor acá**: como agente, podés tomar para
vos un ticket que está libre, pero no podés sacarle un ticket a otro agente
para dártelo a vos — eso sí lo puede hacer un supervisor. Asignar el mismo
ticket a la misma persona que ya lo tiene no hace nada (no genera un aviso
duplicado ni ningún efecto extra).

## Trabajar un ticket

### Cambiar el estado

Las transiciones válidas dependen de en qué estado está el ticket — el
sistema te va a mostrar solo las que corresponden en cada momento, y si
intentás una que no es válida, te va a decir cuáles sí lo son en vez de un
error genérico.

Como agente asignado o como supervisor, podés mover el ticket libremente
entre los estados que el flujo permite: tomarlo (Asignado → En progreso),
pedirle algo al solicitante (En progreso → Esperando al solicitante),
marcarlo resuelto, o reabrirlo si hace falta. Un supervisor puede además
operar sobre **cualquier** ticket, esté o no asignado a él.

Si el ticket no es tuyo (no estás asignado ni sos supervisor), no vas a
poder cambiarle el estado — sí vas a poder comentarlo igual (ver abajo),
porque cualquier miembro del equipo de soporte puede sumar información
aunque el ticket no esté formalmente a su cargo.

### Comentar

Dos tipos de comentario:

- **Comentario normal**: lo ve también el solicitante, y le llega una
  notificación.
- **Nota interna**: solo la ve el equipo de soporte. Útil para dejar
  contexto que no le compete al solicitante (por ejemplo, coordinación
  interna sobre cómo resolver el problema). Esta opción es exclusiva de
  agentes, supervisores y administradores — un solicitante no puede marcar
  un comentario como interno aunque lo intente.

### Reasignar

Un supervisor puede reasignar cualquier ticket a cualquier agente en
cualquier momento. Un agente solo puede tomar un ticket que está libre, no
reasignar uno que ya es de otro agente.

## A quién le llega cada aviso

Para que sepas qué esperar: cuando vos cambiás el estado de un ticket, el
aviso le llega al **solicitante** (no a vos, porque el cambio lo hiciste
vos). Si otra persona cambia el estado de un ticket que **vos** tenés
asignado, el aviso te llega a **vos**. Lo mismo con los comentarios: el
aviso le llega a la otra parte de la conversación, nunca a quien escribió el
comentario.

## Tus propios derechos sobre tus datos personales

Como cualquier usuario del sistema, tenés los mismos derechos ARCO que un
solicitante sobre tu propia cuenta — acceso, rectificación, cancelación,
oposición, bloqueo temporal. Están detallados en el
[manual del solicitante](./01-solicitante.md#tus-derechos-sobre-tus-datos-personales-ley-21719).
