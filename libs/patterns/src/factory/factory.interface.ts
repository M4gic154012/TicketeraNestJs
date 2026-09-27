/**
 * Patrón Factory.
 *
 * Concentra la construcción de un agregado: normaliza la entrada, aplica los
 * invariantes que deben cumplirse al nacer y deja la entidad en un estado
 * válido. Sin factory, esas reglas se filtran a cada caso de uso que crea la
 * entidad y se desincronizan.
 */
export interface Factory<TInput, TOutput> {
  create(input: TInput): TOutput;
}

/**
 * Factory que además elige la implementación concreta según un discriminador
 * (Factory Method). Útil cuando el "tipo" del input decide la clase creada.
 */
export interface DiscriminatedFactory<TDiscriminator extends string, TInput, TOutput> {
  supports(discriminator: TDiscriminator): boolean;
  create(input: TInput): TOutput;
}
