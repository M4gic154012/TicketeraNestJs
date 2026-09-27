# 01 — Manual del Solicitante

Sos solicitante si reportás un problema para que el equipo de soporte lo
resuelva: no importa tu cargo, es el rol por defecto de cualquier persona
que usa el sistema para pedir ayuda.

## Por correo electrónico (disponible hoy)

### Crear un ticket

Escribí un correo a **`soporte@cmm.uchile.cl`** (o la dirección que tu
organización haya configurado). No hace falta que tengas una cuenta creada
de antemano: si es la primera vez que escribís desde esa dirección, el
sistema te da de alta automáticamente — siempre que tu correo sea de un
dominio autorizado por tu organización (por ejemplo, `@uchile.cl`).

Recomendaciones para que el ticket se cree bien:

- **Poné un asunto descriptivo.** Se va a usar como título del ticket.
- **Contá el problema en el cuerpo del correo** con el detalle que puedas:
  qué esperabas que pasara, qué pasó en cambio, desde cuándo. Cuanto más
  claro, más rápido lo puede tomar el equipo de soporte.
- **No dependas de los archivos adjuntos.** El sistema los cuenta para
  saber si el correo tiene contenido, pero **no los guarda como parte del
  ticket**. Si necesitás compartir una captura de pantalla o un archivo,
  mencionalo en el texto y el equipo de soporte te va a pedir que se lo
  envíes por otra vía si hace falta.
- **Escribí como le contarías el problema a una persona.** El sistema
  interpreta el tono para calcular la prioridad — no hace falta que agregues
  "URGENTE" en mayúsculas; si tu problema describe algo caído, el sistema lo
  va a notar solo.

Vas a recibir un correo de vuelta confirmando que tu ticket fue creado, con
su código (`TCK-000123`).

### Responder o agregar información a un ticket ya creado

Respondé el correo original (o cualquier correo que hayas recibido sobre ese
ticket) **sin borrar el código del asunto** — algo como
`Re: [TCK-000123] no puedo entrar al sistema`. El sistema reconoce el código
y agrega tu respuesta como un comentario del ticket existente, en vez de
crear uno nuevo.

Si el código no aparece en el asunto (por ejemplo, porque reenviaste el
correo a mano y lo borraste sin querer), el sistema va a interpretar tu
mensaje como un ticket nuevo.

### Qué esperar después

- Vas a recibir un correo cada vez que tu ticket cambie de estado o alguien
  del equipo de soporte comente.
- El equipo de soporte puede pedirte más información — si el ticket queda
  en estado "Esperando al solicitante", significa que están esperando tu
  respuesta para seguir.
- Cuando el problema se resuelve, el ticket pasa a "Resuelto". Si más
  adelante el problema vuelve a aparecer, respondé ese mismo correo: el
  sistema te permite reabrirlo en vez de tener que crear uno nuevo.

## Por interfaz web (a construir — funcionalidad ya disponible en el sistema)

Todo lo de abajo ya lo puede hacer el sistema; falta la pantalla que lo
muestre. Se describe igual para que sirva de referencia de lo que la futura
interfaz va a ofrecer.

### Crear un ticket

Un formulario con:

- **Título** (5 a 200 caracteres).
- **Descripción** (10 a 10.000 caracteres).
- **Categoría**: Hardware, Software, Red, Accesos, u Otro.
- **Prioridad** (opcional): si no la elegís, el sistema la calcula solo a
  partir del texto.
- **Etiquetas** (opcional, hasta 10): palabras clave libres para
  clasificarlo mejor.
- Una opción, activada por defecto, para que el sistema **asigne
  automáticamente** un agente apenas se crea el ticket.

### Ver tus tickets

Un listado con los tickets que **vos** creaste (nunca vas a ver los de otra
persona), con filtros por estado, prioridad, categoría, si tiene o no
agente asignado, si está vencido, una etiqueta puntual, o una búsqueda de
texto libre sobre el título y la descripción.

### Ver el detalle de un ticket

Muestra el estado actual, quién lo tiene asignado (si ya se asignó), el
plazo de atención calculado, la conversación completa (tus comentarios y
los del equipo de soporte — las notas internas del equipo no se muestran, es
información que no te corresponde ver), y **qué acciones podés hacer vos
mismo en ese momento** — esto cambia según en qué estado esté el ticket:

| Estado del ticket | Qué podés hacer |
|---|---|
| Abierto | Cerrarlo (si ya no hace falta) |
| Asignado | Cerrarlo |
| En progreso | Nada por ahora — es el equipo de soporte quien tiene la pelota |
| Esperando tu respuesta | Responder (vuelve a "En progreso") o cerrarlo |
| Resuelto | Reabrirlo (si el problema no estaba resuelto de verdad) o confirmar el cierre |
| Cerrado | Ninguna — si el problema reaparece, hay que crear un ticket nuevo |

Si intentás una acción que no corresponde al estado en que está el ticket,
el sistema te va a avisar cuáles son las que sí podés hacer en ese momento,
en vez de un error genérico.

### Comentar

Podés agregar comentarios en cualquier momento sobre tu propio ticket. No
podés marcar un comentario como "nota interna" — esa opción es solo para el
equipo de soporte.

## Tus derechos sobre tus datos personales (Ley 21.719)

Disponible por interfaz web (a construir) sobre tu propia cuenta, sin
necesidad de pedírselo a nadie:

- **Acceso y portabilidad**: pedir una copia completa de todo lo que el
  sistema tiene sobre vos — tu perfil, los tickets que creaste o te
  asignaron, los comentarios que escribiste, y las notificaciones que
  recibiste. Si tu historial es muy grande, el sistema te va a avisar
  explícitamente si algo quedó afuera del reporte, en vez de entregarte un
  resultado incompleto sin decírtelo.
- **Rectificación**: corregir tu nombre, tu correo o tu área. (El rol, las
  especialidades y la capacidad de carga de trabajo no son datos personales
  tuyos para corregir — esos los gestiona un administrador.)
- **Cancelación**: pedir que tu cuenta se anonimice. Es distinto de borrar:
  tu actividad pasada (tickets, comentarios) queda en el sistema porque le
  pertenece también a las otras personas involucradas, pero tu nombre y tu
  correo dejan de estar asociados a ella. Es **irreversible**.
- **Oposición**: manifestar que no querés que tus datos se sigan tratando.
  Si lo pedís sobre vos mismo, el sistema bloquea el tratamiento de
  inmediato; si lo pide alguien más en tu representación, queda registrado
  para que el responsable lo evalúe.
- **Bloqueo temporal**: pausar el tratamiento de tus datos mientras se
  resuelve una disputa, sin llegar a la cancelación. Se puede levantar
  después.
- **Historial**: ver todas las veces que ejerciste alguno de estos derechos,
  con fecha y resultado.

Cada uno de estos pedidos queda registrado de forma auditable, así que
siempre vas a poder confirmar que quedó hecho.
