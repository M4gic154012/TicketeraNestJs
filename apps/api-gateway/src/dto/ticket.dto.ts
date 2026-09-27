import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PaginationQueryDto,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from '@ticketera/common';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Convierte un booleano de query string sin el defecto de `Boolean(string)`.
 *
 * @returns `undefined` si el valor no es reconocible, para que `@IsOptional()` lo
 *   trate como ausente en lugar de inventar un `false`.
 */
function toOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}

/**
 * DTOs del borde HTTP. Son la primera barrera contra entrada malformada.
 *
 * El ValidationPipe corre con `whitelist: true` y `forbidNonWhitelisted: true`, así
 * que un campo no declarado acá **rechaza la petición con 400** — no se descarta en
 * silencio. El cliente se entera de que mandó algo inválido.
 */

export class CreateTicketDto {
  @ApiProperty({ minLength: 5, maxLength: 200 })
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ minLength: 10, maxLength: 10000 })
  @IsString()
  @MinLength(10)
  @MaxLength(10_000)
  description!: string;

  @ApiProperty({ enum: TicketCategory })
  @IsEnum(TicketCategory)
  category!: TicketCategory;

  @ApiPropertyOptional({ enum: TicketPriority })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiPropertyOptional({ type: [String], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ default: true, description: 'Asignar un agente automáticamente' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value !== 'false' && value !== false)
  autoAssign?: boolean = true;
}

export class AssignTicketDto {
  @ApiPropertyOptional({
    description: 'Si se omite, las estrategias eligen al agente',
  })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;
}

export class ChangeStatusDto {
  @ApiProperty({ enum: TicketStatus })
  @IsEnum(TicketStatus)
  status!: TicketStatus;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AddCommentDto {
  @ApiProperty({ maxLength: 10000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  body!: string;

  @ApiPropertyOptional({ default: false, description: 'Nota interna, no visible al solicitante' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  isInternal?: boolean = false;
}

export class SearchTicketsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TicketStatus, isArray: true })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsEnum(TicketStatus, { each: true })
  statuses?: TicketStatus[];

  @ApiPropertyOptional({ enum: TicketPriority, isArray: true })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsEnum(TicketPriority, { each: true })
  priorities?: TicketPriority[];

  @ApiPropertyOptional({ enum: TicketCategory })
  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({ description: 'Solo tickets sin agente asignado' })
  @IsOptional()
  @IsBoolean()
  // `@Type(() => Boolean)` estaba mal: `Boolean('false') === true`, así que
  // `unassignedOnly=false` filtraba igual que `=true`. Una pantalla que mande el
  // estado del checkbox siempre mostraba la vista filtrada al desmarcarlo.
  @Transform(({ value }) => toOptionalBoolean(value))
  unassignedOnly?: boolean;

  @ApiPropertyOptional({ description: 'Solo tickets con SLA vencido' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => toOptionalBoolean(value))
  overdueOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tag?: string;

  @ApiPropertyOptional({ description: 'Busca en código, título y descripción' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  text?: string;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.000Z' })
  @IsOptional()
  @IsISO8601()
  createdTo?: string;
}
