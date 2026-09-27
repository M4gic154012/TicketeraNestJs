import { Global, Module } from '@nestjs/common';
import { CircuitBreakerRegistry } from './circuit-breaker.registry';

@Global()
@Module({
  providers: [CircuitBreakerRegistry],
  exports: [CircuitBreakerRegistry],
})
export class CircuitBreakerModule {}
