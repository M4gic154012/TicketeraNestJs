# 03 — Manual del Administrador

Sos administrador si gestionás las cuentas del sistema: quién puede
entrar, con qué rol, y quién puede ejercer derechos en representación de
otra persona cuando esa persona no puede hacerlo por sí misma.

Todo lo de este manual es por la interfaz web (a construir; la
funcionalidad ya existe en el sistema), salvo la creación del primer
administrador, que es un caso especial explicado al final.

## Crear un usuario

Un formulario con:

- **Correo** y **nombre completo**.
- **Contraseña** (mínimo 12 caracteres, con mayúsculas, minúsculas y un
  número). En una primera versión se la asignás vos; lo normal es que la
  persona la cambie apenas entra.
- **Rol**: Solicitante, Agente, Supervisor o Administrador.
- **Área** (opcional).
- Si el rol es Agente o Supervisor: **especialidades** (una o más
  categorías de ticket) y **cuántos tickets puede tener asignados en
  simultáneo**. Estos dos datos son los que usa el sistema para decidir a
  quién asignarle un ticket nuevo automáticamente — si los dejás en blanco
  o mal configurados, esa persona no va a recibir asignaciones automáticas
  aunque exista.

No hace falta que crees manualmente a un solicitante: si alguien escribe
por primera vez al buzón de soporte y su correo es de un dominio
autorizado, el sistema lo da de alta solo, como solicitante. Vos usás este
formulario para el resto de los roles, y para cualquier solicitante que
prefieras dar de alta vos mismo.

## Gestión asistida de derechos ARCO

Hay situaciones en las que una persona no puede ejercer sus propios
derechos por la vía normal — por ejemplo, alguien que perdió el acceso a su
cuenta y pide por otro medio (un correo, un llamado) que se anonimice su
información. Para esos casos, como administrador podés ejercer, **en
representación de otra persona**, exactamente los mismos derechos que esa
persona podría ejercer sobre sí misma:

- Ver o exportar todos los datos de esa persona.
- Corregir su perfil.
- Anonimizar su cuenta (cancelación).
- Registrar una oposición en su nombre — a diferencia de cuando la persona
  lo hace por sí misma, esto **no** aplica un bloqueo automático: queda
  registrada como pedido recibido, para que la evalúes vos antes de
  decidir si corresponde bloquear.
- Aplicar o levantar un bloqueo temporal.
- Ver el historial completo de derechos ejercidos sobre esa cuenta,
  incluidos los que ejerció la propia persona.

Cada una de estas acciones deja el mismo registro auditable que si la
persona la hiciera por sí misma, con la diferencia de que además queda
registrado que fuiste vos quien la ejecutó en su representación.

## Crear el primer administrador (caso especial)

Si el sistema es nuevo y todavía no existe ningún administrador, no hay
forma de crear uno por la interfaz web — crear un usuario exige estar
logueado como administrador, y en una base de datos vacía eso es imposible
por definición.

Para ese caso puntual existe un comando que se ejecuta directamente sobre
el servidor (no es algo que uses en el día a día):

```bash
npm run user:create -- --email=admin@tuorganizacion.cl --name="Nombre" --role=ADMIN
```

Genera una contraseña al azar y te la muestra **una sola vez** en pantalla
— guardala en ese momento, porque no se puede volver a consultar. Este
comando usa exactamente las mismas reglas que el alta normal (mismas
validaciones, mismo tratamiento de la contraseña), así que no hay
diferencia de tratamiento entre el primer administrador y los que se creen
después por la interfaz.

## Tus propios derechos sobre tus datos personales

Como cualquier usuario del sistema, tenés los mismos derechos ARCO que un
solicitante sobre tu propia cuenta. Están detallados en el
[manual del solicitante](./01-solicitante.md#tus-derechos-sobre-tus-datos-personales-ley-21719).
