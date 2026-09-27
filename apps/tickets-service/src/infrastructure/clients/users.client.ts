import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { USERS_PATTERNS, USERS_SERVICE, UserRole, withRpcAuth } from '@ticketera/common';
import { User } from '@ticketera/database';
import { ClientProxy } from '@nestjs/microservices';
import { CircuitBreakerRegistry } from '@ticketera/patterns';
import { plainToInstance } from 'class-transformer';
import { firstValueFrom, timeout } from 'rxjs';

/**
 * Cliente de users-service.
 *
 * tickets-service no consulta la tabla de usuarios para decidir: le pregunta al
 * servicio dueño de ese dato. La llamada va envuelta en un circuit breaker
 * porque es una dependencia de red en el camino crítico de la asignación.
 */
@Injectable()
export class UsersClient {
  private readonly logger = new Logger(UsersClient.name);

  constructor(
    @Inject(USERS_SERVICE) private readonly client: ClientProxy,
    private readonly breakers: CircuitBreakerRegistry,
    config: ConfigService,
  ) {
    this.rpcSecret = config.getOrThrow<string>('RPC_SHARED_SECRET');
  }

  private readonly rpcSecret: string;

  async findAgents(): Promise<User[]> {
    const breaker = this.breakers.get('users-service');

    const raw = await breaker.execute(
      () =>
        firstValueFrom(
          this.client
            .send<Record<string, unknown>[]>(
              USERS_PATTERNS.findMany,
              withRpcAuth(
                {
                  roles: [UserRole.AGENT, UserRole.SUPERVISOR, UserRole.ADMIN],
                  isActive: true,
                },
                this.rpcSecret,
              ),
            )
            .pipe(timeout(3_000)),
        ),
      // Sin agentes no se puede asignar, pero tampoco queremos tumbar la
      // creación del ticket: se crea sin asignar y un supervisor lo toma.
      async (error) => {
        this.logger.warn(`No se pudo obtener agentes: ${error.message}. Se deja sin asignar.`);
        return [];
      },
    );

    // Se rehidrata a instancias de User para conservar los métodos de dominio
    // (isAgent, hasSkill) que usan las estrategias de asignación.
    return plainToInstance(User, raw);
  }

  async findById(id: string): Promise<User | null> {
    const breaker = this.breakers.get('users-service');

    const raw = await breaker.execute(() =>
      firstValueFrom(
        this.client
          .send<Record<string, unknown> | null>(
            USERS_PATTERNS.findById,
            withRpcAuth({ id }, this.rpcSecret),
          )
          .pipe(timeout(3_000)),
      ),
    );

    return raw ? plainToInstance(User, raw) : null;
  }
}
