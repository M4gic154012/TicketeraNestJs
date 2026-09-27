# Proceso del proyecto Ticketera

Documentación del ciclo de vida del proyecto, pensada para quien necesita
seguir el avance sin entrar al detalle técnico del código: dirección,
stakeholders, y cualquier persona nueva en el equipo que quiera entender el
panorama antes de entrar en el detalle de `CLAUDE.md`.

Cuatro documentos, uno por fase. Cada uno es un **documento vivo**: se
actualiza a medida que esa fase avanza, no es una foto fija del día en que se
escribió.

| Documento | Fase | Estado |
|---|---|---|
| [01 — Planificación](./01-planificacion.md) | Qué se decidió construir y por qué, antes de escribir código | Cerrada |
| [02 — Desarrollo](./02-desarrollo.md) | Qué se construyó, en qué orden y qué se corrigió en el camino | Cerrada |
| [03 — Implementación](./03-implementacion.md) | Cómo se despliega, y la verificación de calidad antes de exponerlo | **En curso** |
| [04 — Marcha blanca](./04-marcha-blanca.md) | Piloto con usuarios reales antes del lanzamiento completo | **No iniciada** |

## Cómo leer esto si venís de afuera del equipo técnico

- El sistema es una **mesa de ayuda interna**: alguien reporta un problema
  (por formulario o por correo), el sistema lo clasifica, le calcula un plazo
  de atención y lo asigna a la persona indicada.
- Corre en 5 procesos separados que se reparten el trabajo (una puerta de
  entrada única, y cuatro "especialistas" internos que no son accesibles
  desde afuera). El porqué de esa separación está en el documento de
  planificación.
- La fecha de referencia de este documento es **2026-09-14**.
