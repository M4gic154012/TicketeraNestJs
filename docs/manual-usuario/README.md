# Manual de usuario — Ticketera

Guía de uso del sistema de mesa de ayuda, por rol.

## Aviso importante sobre el estado del sistema

Hoy el sistema **no tiene pantallas propias** — funciona por dos canales:

1. **Correo electrónico**, ya funcionando de punta a punta: escribís o
   respondés un correo y el sistema lo convierte en un ticket, sin nada que
   instalar ni ninguna cuenta que crear a mano.
2. Una **interfaz web** con la que se puede hacer todo lo demás (ver el
   estado de un ticket, filtrarlos, comentar, cambiar su estado, ejercer tus
   derechos sobre tus datos personales) — el sistema que hay detrás **ya
   sabe hacer todo esto**, pero la pantalla que lo muestre todavía no está
   construida.

Este manual documenta las dos cosas: lo que ya podés usar por correo hoy
mismo, y lo que vas a poder hacer por pantalla una vez que esa interfaz
exista — descrito a partir de lo que el sistema ya sabe hacer, no como una
promesa sin base.

## Índice

| Documento | Para quién |
|---|---|
| [01 — Solicitante](./01-solicitante.md) | Cualquier persona que reporta un problema |
| [02 — Agente y Supervisor](./02-agente-supervisor.md) | Equipo de soporte que atiende los tickets |
| [03 — Administrador](./03-administrador.md) | Quien gestiona las cuentas del sistema |

## Conceptos que se repiten en los tres manuales

- **Ticket**: cada problema reportado. Tiene un código único con el formato
  `TCK-000123`.
- **Categoría**: de qué tipo es el problema — Hardware, Software, Red,
  Accesos, u Otro. Define quién es la persona indicada para resolverlo.
- **Prioridad**: Baja, Media, Alta o Crítica. El sistema la sugiere solo,
  leyendo la descripción del problema (ver más abajo), y el equipo de
  soporte la puede ajustar.
- **Estado**: dónde está el ticket en su recorrido — Abierto, Asignado, En
  progreso, Esperando al solicitante, Resuelto, Cerrado. Qué se puede hacer
  en cada estado depende de tu rol; está detallado en cada manual.
- **Plazo de atención (SLA)**: el sistema calcula automáticamente para
  cuándo debería estar resuelto un ticket, según su categoría y prioridad.

### Cómo el sistema decide si algo es urgente

No hace falta marcar nada como urgente a mano. El sistema lee el texto del
problema buscando señales de que algo está caído de verdad — frases como
"no funciona", "nadie puede entrar" — y sube la prioridad solo. Si además el
texto menciona que es en "producción" o que es "urgente", eso refuerza la
señal. Y si el texto aclara que no corre apuro ("es solo una consulta", "ya
funciona"), el sistema no escala aunque aparezca alguna de esas palabras.
En criollo: **escribí el problema como se lo contarías a alguien**, el
sistema entiende el tono.
