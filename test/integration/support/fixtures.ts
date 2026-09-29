import { TicketCategory, TicketPriority, TicketStatus, UserRole } from '@ticketera/common';
import { Ticket, User } from '@ticketera/database';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

let ticketSeq = 0;

export async function createUser(
  dataSource: DataSource,
  overrides: Partial<User> = {},
): Promise<User> {
  const repo = dataSource.getRepository(User);
  const user = repo.create({
    id: randomUUID(),
    email: `${randomUUID()}@test.local`,
    fullName: 'Usuario de prueba',
    passwordHash: 'no-se-usa-en-estos-tests',
    role: UserRole.REQUESTER,
    isActive: true,
    skills: [],
    maxConcurrentTickets: null,
    ...overrides,
  });
  return repo.save(user);
}

/**
 * Inserta un ticket directo por el repositorio de TypeORM, sin pasar por
 * `TicketFactory` ni por el agregado: estos tests verifican la traducción a
 * SQL de las Specifications y del repositorio, no las reglas del dominio —
 * esas ya las cubre `ticket.entity.spec.ts` y `ticket.factory.spec.ts` sin
 * tocar la base.
 */
export async function createTicket(
  dataSource: DataSource,
  requesterId: string,
  overrides: Partial<Ticket> = {},
): Promise<Ticket> {
  const repo = dataSource.getRepository(Ticket);
  const ticket = repo.create({
    id: randomUUID(),
    code: `TCK-TEST-${String(++ticketSeq).padStart(4, '0')}`,
    title: 'Ticket de prueba',
    description: 'Descripción de prueba',
    status: TicketStatus.OPEN,
    priority: TicketPriority.MEDIUM,
    category: TicketCategory.OTHER,
    requesterId,
    assigneeId: null,
    slaDueAt: null,
    slaBreached: false,
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    tags: [],
    ...overrides,
  });
  return repo.save(ticket);
}
