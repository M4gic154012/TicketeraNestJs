import { Injectable } from '@nestjs/common';
import {
  TicketCategory,
  TicketSourceChannel,
  TicketCreatedEvent,
  TicketPriority,
  TicketStatus,
  ValidationError,
} from '@ticketera/common';
import { Ticket } from '@ticketera/database';
import { Factory } from '@ticketera/patterns';
import { randomUUID } from 'node:crypto';
import { SlaResult } from '../strategies/sla';

export interface CreateTicketInput {
  title: string;
  description: string;
  requesterId: string;
  category: TicketCategory;
  /**
   * Prioridad pedida por el usuario. Puede ser corregida por la heurística de
   * urgencia; usa `resolvePriority` para conocer la efectiva antes de crear.
   */
  requestedPriority?: TicketPriority;
  tags?: string[];
  /** Resultado ya calculado por la estrategia de SLA. */
  sla: SlaResult;
  /** Secuencia para el código legible. La provee el repositorio. */
  sequence: number;
  /** Canal de entrada. Por omisión WEB. */
  sourceChannel?: TicketSourceChannel;
  sourceMessageId?: string;
}

/**
 * Patrón Factory.
 *
 * Concentra todo lo que debe ser cierto en el instante en que nace un ticket:
 * código legible, estado inicial, prioridad efectiva, SLA, normalización de
 * tags y el primer asiento del historial. Si esto viviera en el caso de uso,
 * cada punto de entrada (API, importador masivo, correo entrante) tendría que
 * recordar la lista completa — y alguno la olvidaría.
 */
@Injectable()
export class TicketFactory implements Factory<CreateTicketInput, Ticket> {
  /**
   * Señales fuertes: describen un servicio que no está funcionando. Cada una, por
   * sí sola, eleva la prioridad.
   *
   * Se escriben SIN tildes porque el texto se normaliza antes de comparar: la
   * versión anterior listaba 'caído' con tilde y 'caida', así que "el servidor
   * esta caido" —la forma en que la gente escribe realmente— no disparaba. El caso
   * más típico de urgencia pasaba desapercibido por un acento.
   */
  private static readonly STRONG_SIGNALS = [
    'no funciona',
    'no anda',
    'dejo de funcionar',
    'esta caido',
    'esta caida',
    'se cayo',
    'sin servicio',
    'no puedo trabajar',
    'no podemos trabajar',
    'no puedo acceder',
    'inaccesible',
    'perdida de datos',
    'todos los usuarios',
    'nadie puede',
  ];

  /**
   * Señales de contexto: agravan, pero no describen una falla por sí mismas.
   * "producción" aparece tanto en "producción está caída" como en "consulta sobre
   * el ambiente de producción", y solo la primera es urgente. Escalan únicamente
   * si además hay una señal fuerte, o si hay dos de contexto juntas.
   */
  private static readonly CONTEXT_SIGNALS = [
    'produccion',
    'urgente',
    'bloqueado',
    'bloqueada',
    'critico',
    'toda la oficina',
    'toda la sucursal',
  ];

  /**
   * Señales de atenuación: marcan un pedido que no es una falla en curso. Anulan el
   * escalamiento incluso si hay otras señales, porque el usuario ya dijo que no
   * corre prisa o que el problema pasó.
   */
  private static readonly DAMPENING_SIGNALS = [
    'consulta',
    'capacitacion',
    'documentacion',
    'ya funciona',
    'ya quedo',
    'quedo resuelto',
    'sin apuro',
    'cuando puedan',
    'no es urgente',
    'a futuro',
    'mejora',
    'sugerencia',
  ];

  create(input: CreateTicketInput): Ticket {
    this.assertValid(input);

    const ticket = new Ticket();
    // El id se genera acá, no en la base: el evento de creación necesita el
    // aggregateId y se emite antes de que exista una fila.
    ticket.id = randomUUID();
    ticket.code = this.buildCode(input.sequence);
    ticket.title = input.title.trim();
    ticket.description = input.description.trim();
    ticket.requesterId = input.requesterId;
    ticket.category = input.category;
    ticket.priority = this.resolvePriority(input);
    ticket.status = TicketStatus.OPEN;
    ticket.assigneeId = null;
    ticket.slaDueAt = input.sla.dueAt;
    ticket.slaBreached = false;
    ticket.firstResponseAt = null;
    ticket.resolvedAt = null;
    ticket.closedAt = null;
    ticket.tags = this.normalizeTags(input.tags);
    ticket.comments = [];
    ticket.sourceChannel = input.sourceChannel ?? TicketSourceChannel.WEB;
    ticket.sourceMessageId = input.sourceMessageId ?? null;

    // Primer asiento del historial: deja explícito el nacimiento en OPEN, para
    // que las métricas de tiempo por estado no tengan un hueco inicial.
    ticket.recordInitialHistory(input.requesterId);

    ticket.recordCreation(
      new TicketCreatedEvent(ticket.id, {
        code: ticket.code,
        title: ticket.title,
        requesterId: ticket.requesterId,
        priority: ticket.priority,
        category: ticket.category,
        slaDueAt: ticket.slaDueAt?.toISOString() ?? null,
      }),
    );

    return ticket;
  }

  /**
   * Prioridad efectiva del ticket, expuesta para que el caso de uso calcule el
   * SLA sobre ella. Si el SLA se calculara con la prioridad pedida, un ticket
   * escalado a CRITICAL conservaría el vencimiento holgado de un MEDIUM.
   */
  resolvePriority(input: {
    title: string;
    description: string;
    requestedPriority?: TicketPriority;
  }): TicketPriority {
    return this.effectivePriority(input);
  }

  private assertValid(input: CreateTicketInput): void {
    if (input.title.trim().length < 5) {
      throw new ValidationError('El título debe tener al menos 5 caracteres', {
        title: input.title,
      });
    }
    if (input.description.trim().length < 10) {
      throw new ValidationError('La descripción debe tener al menos 10 caracteres');
    }
    if (input.sequence < 1) {
      throw new ValidationError('Secuencia de código de ticket inválida', {
        sequence: input.sequence,
      });
    }
  }

  private buildCode(sequence: number): string {
    return `TCK-${String(sequence).padStart(6, '0')}`;
  }

  /**
   * La prioridad declarada por el usuario es una sugerencia. Si el texto
   * contiene señales de urgencia, se eleva un nivel: los usuarios rara vez
   * marcan CRITICAL aunque su servicio esté caído.
   */
  private effectivePriority(input: {
    title: string;
    description: string;
    requestedPriority?: TicketPriority;
  }): TicketPriority {
    const requested = input.requestedPriority ?? TicketPriority.MEDIUM;
    const haystack = TicketFactory.normalize(`${input.title} ${input.description}`);

    // El usuario que avisa que no hay apuro manda sobre cualquier palabra clave.
    if (TicketFactory.DAMPENING_SIGNALS.some((s) => haystack.includes(s))) {
      return requested;
    }

    const hasStrong = TicketFactory.STRONG_SIGNALS.some((s) => haystack.includes(s));
    const contextCount = TicketFactory.CONTEXT_SIGNALS.filter((s) =>
      haystack.includes(s),
    ).length;

    // Una señal fuerte alcanza; las de contexto necesitan compañía. Así
    // "producción está caída" escala y "consulta sobre producción" no.
    if (!hasStrong && contextCount < 2) return requested;

    const escalation: Record<TicketPriority, TicketPriority> = {
      [TicketPriority.LOW]: TicketPriority.MEDIUM,
      [TicketPriority.MEDIUM]: TicketPriority.HIGH,
      [TicketPriority.HIGH]: TicketPriority.CRITICAL,
      [TicketPriority.CRITICAL]: TicketPriority.CRITICAL,
    };
    return escalation[requested];
  }

  /**
   * Quita tildes y pasa a minúsculas. Sin esto, la detección depende de que el
   * usuario acentúe correctamente, que es exactamente lo que no pasa cuando está
   * reportando algo con apuro.
   */
  private static normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private normalizeTags(tags?: string[]): string[] {
    if (!tags?.length) return [];
    const normalized = tags
      .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, '-'))
      .filter((tag) => tag.length > 0 && tag.length <= 40);
    // Deduplicado: dos tags iguales con distinta capitalización son uno.
    return [...new Set(normalized)].slice(0, 10);
  }
}
