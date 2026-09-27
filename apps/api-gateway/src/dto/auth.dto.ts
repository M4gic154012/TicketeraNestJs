import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'agente@empresa.com' })
  @IsEmail({}, { message: 'El email no es válido' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'Contrasena123' })
  @IsString()
  @IsNotEmpty()
  // Tope de largo: bcrypt trunca a 72 bytes y un input enorme solo gasta CPU.
  @MaxLength(72)
  password!: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}
