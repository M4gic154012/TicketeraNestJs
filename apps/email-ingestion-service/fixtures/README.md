# Correos de ejemplo

Correos reales (anonimizados) que cubren los cuatro caminos de la ingesta:

| Archivo | Qué ejercita |
|---|---|
| `01-pedido-persona.eml` | Pedido legítimo → crea ticket, da de alta al remitente, limpia la firma |
| `02-salida-crontab.eml` | Salida de `crontab` → **descarta**. El caso que motivó el filtro |
| `03-respuesta-automatica.eml` | Respuesta de vacaciones → descarta por `Auto-Submitted` |
| `04-respuesta-a-ticket.eml` | Respuesta con `[TCK-000059]` → comentario, no ticket nuevo |

## Cómo usarlos

```bash
mkdir -p correos-prueba/procesados
cp apps/email-ingestion-service/fixtures/*.eml correos-prueba/
```

Con `MAIL_ADAPTER=simulado` el poller los procesa en la corrida siguiente (cada
minuto) y mueve cada archivo a `correos-prueba/procesados/`.

Para agregar un caso nuevo, guardá el correo desde Gmail con "Mostrar original →
Descargar original". Revisá que no queden datos personales antes de versionarlo.
