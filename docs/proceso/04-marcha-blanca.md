# 04 — Marcha blanca

**Estado: no iniciada.** Este documento es un borrador de lo que hay que
tener resuelto antes de arrancar, y de cómo se va a medir si el piloto
funcionó. Se completa con fechas y datos reales una vez que arranque.

## Qué es esta fase

Un período acotado en que el sistema atiende tickets reales de un grupo
reducido de personas (no toda la organización), con seguimiento cercano,
antes de abrirlo a todos. El objetivo es encontrar en chico lo que solo
aparece con uso real — no todo lo que sale mal en producción es algo que una
prueba automática puede anticipar.

## Condiciones para arrancar (borrador, a confirmar)

- [ ] Los pendientes de severidad media del documento de implementación
      están resueltos, o aceptados explícitamente como riesgo conocido por
      quien corresponda.
- [ ] El buzón de correo institucional real está habilitado (hoy se prueba
      en modo simulado).
- [ ] Al menos un administrador y un supervisor reales están dados de alta
      (no solo los usuarios de prueba).
- [ ] Hay un respaldo de la base de datos probado — no solo generado, sino
      restaurado al menos una vez para confirmar que sirve.
- [ ] Está decidido quién es el contacto de guardia si algo falla durante el
      piloto.

## Alcance propuesto del piloto

*(a definir con quien coordine la marcha blanca)*

- Grupo de usuarios: ¿un equipo o departamento específico?
- Duración: ¿cuántas semanas?
- Categorías de ticket habilitadas desde el día uno, si se decide no abrir
  todas a la vez.

## Qué se va a medir

*(a definir — propuesta inicial)*

- Tickets creados por la vía de formulario vs. por correo.
- Tiempo real de atención comparado contra el plazo calculado por el
  sistema (¿el cálculo automático es razonable en la práctica?).
- Cualquier caso donde una notificación no haya llegado, o haya llegado a
  la persona equivocada.
- Feedback directo de los agentes: ¿la asignación automática les está
  llegando a la especialidad correcta?

## Plan de reversión

*(a definir)* Si el piloto tiene que suspenderse, ¿qué pasa con los tickets
ya creados durante ese período? ¿Se migran a como se manejaban antes, o
quedan en el sistema para retomar más adelante?

## Bitácora del piloto

*(se completa una vez que arranque, con fecha de cada evento relevante:
incidentes, ajustes hechos sobre la marcha, feedback recibido)*

Sin entradas todavía.
