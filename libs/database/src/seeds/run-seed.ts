import { TicketCategory, UserRole } from '@ticketera/common';
import * as bcrypt from 'bcrypt';
import dataSource from '../data-source';
import { User } from '../entities';

/**
 * Datos mínimos para poder usar el sistema en desarrollo: un admin, un
 * supervisor, dos agentes con especialidades distintas y un solicitante.
 *
 * Es idempotente: se puede correr varias veces sin duplicar.
 */
async function seed(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('El seed no debe ejecutarse en producción');
  }

  await dataSource.initialize();
  const users = dataSource.getRepository(User);

  // Contraseña única para todos los usuarios de prueba. Solo desarrollo.
  const password = process.env.SEED_PASSWORD ?? 'Ticketera2026';
  const passwordHash = await bcrypt.hash(password, 12);

  const definitions: Array<Partial<User>> = [
    {
      email: 'admin@ticketera.local',
      fullName: 'Admin Sistema',
      role: UserRole.ADMIN,
      department: 'Dirección',
      skills: [],
      maxConcurrentTickets: 5,
    },
    {
      email: 'supervisor@ticketera.local',
      fullName: 'Silvia Supervisora',
      role: UserRole.SUPERVISOR,
      department: 'Soporte',
      skills: [TicketCategory.NETWORK, TicketCategory.ACCESS],
      maxConcurrentTickets: 10,
    },
    {
      email: 'agente.redes@ticketera.local',
      fullName: 'Ramiro Redes',
      role: UserRole.AGENT,
      department: 'Soporte',
      skills: [TicketCategory.NETWORK, TicketCategory.HARDWARE],
      maxConcurrentTickets: 15,
    },
    {
      email: 'agente.software@ticketera.local',
      fullName: 'Sofía Software',
      role: UserRole.AGENT,
      department: 'Soporte',
      skills: [TicketCategory.SOFTWARE, TicketCategory.ACCESS],
      maxConcurrentTickets: 15,
    },
    {
      email: 'usuario@ticketera.local',
      fullName: 'Úrsula Usuaria',
      role: UserRole.REQUESTER,
      department: 'Administración',
      skills: [],
      maxConcurrentTickets: null,
    },
  ];

  let created = 0;
  for (const definition of definitions) {
    const exists = await users.findOne({ where: { email: definition.email } });
    if (exists) continue;

    await users.save(users.create({ ...definition, passwordHash, isActive: true }));
    created++;
  }

  console.log(`Seed completo: ${created} usuarios creados, ${definitions.length - created} ya existían`);
  console.log(`Contraseña de todos los usuarios de prueba: ${password}`);

  await dataSource.destroy();
}

seed().catch((error) => {
  console.error('El seed falló:', error);
  process.exit(1);
});
