import { NestFactory } from '@nestjs/core';
import { UserRole } from '@ticketera/common';
import { randomBytes } from 'node:crypto';
import { CreateUserUseCase } from '../application/use-cases';
import { UsersModule } from '../users.module';

/**
 * Alta de usuarios desde la consola.
 *
 * Existe para resolver un bloqueo circular real: crear un usuario por la API exige un
 * ADMIN autenticado (`@Roles(ADMIN)`), y el seed se niega a correr en producción. En una
 * base limpia de producción no había **ninguna** forma de crear el primer administrador.
 *
 * Reusa `CreateUserUseCase`, así que aplica exactamente las mismas reglas que la API:
 * política de contraseñas, hashing con bcrypt, normalización del email, unicidad y
 * capacidad por omisión según el rol. Duplicar esa lógica en un script sería la forma
 * de que se desincronice.
 *
 * Uso:
 *   npm run user:create -- --email=admin@cmm.uchile.cl --name="Nombre Apellido" --role=ADMIN
 *   npm run user:create -- --email=tec@cmm.uchile.cl --name="Tecnico" --role=AGENT \
 *     --department=Soporte --skills=NETWORK,HARDWARE --capacity=15
 *
 * La contraseña NO se pasa por argumento: quedaría en el historial del shell y visible
 * en `ps` para cualquier usuario de la máquina. Por omisión se genera una y se imprime
 * una sola vez; con `--password-stdin` se lee de la entrada estándar, que es la vía para
 * automatizar sin dejar rastro:
 *
 *   echo "$CLAVE" | npm run user:create -- --email=... --name=... --role=ADMIN --password-stdin
 */

interface Argumentos {
  email?: string;
  name?: string;
  role?: string;
  department?: string;
  skills?: string;
  capacity?: string;
  'password-stdin'?: boolean;
}

function parseArgs(argv: string[]): Argumentos {
  const args: Record<string, string | boolean> = {};

  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [clave, ...resto] = arg.slice(2).split('=');
    args[clave] = resto.length > 0 ? resto.join('=') : true;
  }

  return args as Argumentos;
}

function mostrarAyuda(): void {
  console.log(String.raw`
Alta de usuarios de Ticketera.

  --email=<correo>        (obligatorio)
  --name="<nombre>"       (obligatorio) Nombre completo, mínimo 3 caracteres
  --role=<rol>            REQUESTER | AGENT | SUPERVISOR | ADMIN (por omisión REQUESTER)
  --department=<área>     Opcional
  --skills=A,B            Categorías en las que es especialista: HARDWARE, SOFTWARE,
                          NETWORK, ACCESS, OTHER. Las usa la asignación automática.
  --capacity=<n>          Tickets simultáneos máximos (1-100). Por omisión 15 para
                          agentes, sin límite para solicitantes.
  --password-stdin        Lee la contraseña de la entrada estándar en lugar de generarla.

Ejemplos:
  npm run user:create -- --email=admin@cmm.uchile.cl --name="Ana Admin" --role=ADMIN
  npm run user:create -- --email=tec@cmm.uchile.cl --name="Tomas Tecnico" --role=AGENT \\
    --department=Soporte --skills=NETWORK,HARDWARE --capacity=12
`);
}

/** Contraseña que cumple la política de la factory: mayúscula, minúscula y dígito. */
function generarContrasena(): string {
  return `Aa1${randomBytes(15).toString('base64url')}`;
}

async function leerDeStdin(): Promise<string> {
  const trozos: Buffer[] = [];
  for await (const trozo of process.stdin) trozos.push(Buffer.from(trozo));
  return Buffer.concat(trozos).toString('utf8').trim();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.email || !args.name) {
    mostrarAyuda();
    throw new Error('Faltan --email o --name');
  }

  const rol = (args.role ?? UserRole.REQUESTER).toUpperCase();
  if (!Object.values(UserRole).includes(rol as UserRole)) {
    throw new Error(`Rol inválido: ${rol}. Válidos: ${Object.values(UserRole).join(', ')}`);
  }

  const generada = !args['password-stdin'];
  const password = generada ? generarContrasena() : await leerDeStdin();

  if (!generada && password.length === 0) {
    throw new Error('No se recibió ninguna contraseña por la entrada estándar');
  }

  // Contexto sin servidor: levanta el módulo para reusar el caso de uso, sin abrir
  // ningún puerto. `logger: false` evita que el arranque tape la salida del comando.
  const app = await NestFactory.createApplicationContext(UsersModule, { logger: false });

  try {
    const crear = app.get(CreateUserUseCase);

    const usuario = await crear.execute({
      email: args.email,
      fullName: args.name,
      password,
      role: rol as UserRole,
      department: args.department,
      skills: args.skills?.split(',').map((s) => s.trim()).filter(Boolean),
      maxConcurrentTickets: args.capacity ? Number(args.capacity) : undefined,
    });

    console.log(`\nUsuario creado:`);
    console.log(`  email:       ${usuario.email}`);
    console.log(`  nombre:      ${usuario.fullName}`);
    console.log(`  rol:         ${usuario.role}`);
    if (usuario.department) console.log(`  área:        ${usuario.department}`);
    if (usuario.skills.length > 0) console.log(`  skills:      ${usuario.skills.join(', ')}`);
    if (usuario.maxConcurrentTickets !== null) {
      console.log(`  capacidad:   ${usuario.maxConcurrentTickets} tickets simultáneos`);
    }

    if (generada) {
      // Se imprime una sola vez y no queda en ningún lado: el hash es lo único que se
      // guarda, así que si se pierde hay que restablecerla.
      console.log(`\n  CONTRASEÑA:  ${password}`);
      console.log('  Guardala ahora: no se puede recuperar, solo restablecer.\n');
    }
  } finally {
    await app.close();
  }
}

main().catch((error: Error) => {
  console.error(`\nError: ${error.message}\n`);
  process.exit(1);
});
