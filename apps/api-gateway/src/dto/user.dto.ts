import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@ticketera/common';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({ minLength: 12, description: 'Mayúsculas, minúsculas y un número' })
  @IsString()
  @MinLength(12)
  @MaxLength(72)
  password!: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  skills?: string[];

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxConcurrentTickets?: number;
}

// --- Derechos ARCO + portabilidad + bloqueo (Ley 21.719) -------------------

export class UpdateUserProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string;
}

export class CancellationRequestDto {
  @ApiProperty({ description: 'Motivo de la solicitud de cancelación (supresión) de datos' })
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason!: string;
}

export class OppositionRequestDto {
  @ApiProperty({ description: 'Motivo de la oposición al tratamiento de datos' })
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason!: string;
}

export class PrivacyBlockDto {
  @ApiProperty({ description: 'Motivo del bloqueo temporal del tratamiento de datos' })
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason!: string;
}
