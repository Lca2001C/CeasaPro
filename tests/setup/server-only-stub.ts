/**
 * Stub de `server-only` para os testes.
 *
 * `server-only` é um pacote-sentinela: ele existe para EXPLODIR no build quando
 * um módulo de servidor é importado por código de cliente. Quem resolve esse
 * import é o bundler do Next; no Node do Vitest ele simplesmente não existe, e
 * qualquer teste que toque um módulo marcado com ele falhava no import
 * ("Cannot find package 'server-only'") — sem relação com o que estava sendo
 * testado.
 *
 * Substituir por um módulo vazio é correto porque a garantia que o pacote oferece
 * é de tempo de build, e o build continua acontecendo normalmente com o pacote
 * real. O alias está em `vitest.config.ts`.
 */
export {};
