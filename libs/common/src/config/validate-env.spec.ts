import { validateEnv } from './validate-env';

describe('validateEnv', () => {
  const base = { RPC_SHARED_SECRET: 'x'.repeat(32) };

  it('acepta un entorno mínimo válido', () => {
    expect(() => validateEnv({ ...base })).not.toThrow();
  });

  it('rechaza un typo real con el prefijo de una variable propia', () => {
    // CORS_ORIGIN en vez de CORS_ORIGINS: sin este chequeo, arrancaba en
    // silencio aplicando el default de CORS_ORIGINS.
    expect(() => validateEnv({ ...base, CORS_ORIGIN: 'http://localhost:5173' })).toThrow(
      /CORS_ORIGIN/,
    );
  });

  // Regresión: los runners hospedados de GitHub Actions definen
  // ENABLE_RUNNER_TRACING, que comparte el prefijo ENABLE_ de ENABLE_SWAGGER
  // por coincidencia. Tumbó los jobs test y migrations de la CI real la
  // primera vez que corrió (ver .github/workflows/ci.yml).
  it('no rechaza ENABLE_RUNNER_TRACING (variable propia del runner de CI, no del proyecto)', () => {
    expect(() => validateEnv({ ...base, ENABLE_RUNNER_TRACING: 'true' })).not.toThrow();
  });

  it('sigue rechazando cualquier otra variable no declarada con prefijo ENABLE_', () => {
    expect(() => validateEnv({ ...base, ENABLE_ALGO_INVENTADO: 'true' })).toThrow(
      /ENABLE_ALGO_INVENTADO/,
    );
  });
});
