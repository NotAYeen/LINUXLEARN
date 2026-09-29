/**
 * Casos de comparacion diferencial. Cada entrada se ejecuta tal cual en bash
 * real y en el emulador: si algo difiere, el guion se considera incompatible.
 *
 *   nombre   identificador legible, aparece en el informe
 *   guion    el texto que ejecuta el alumno
 *   archivos contenido previo del arbol, relativo a la sesion
 *   cwd      directorio de trabajo inicial
 *   ignorar  campos que no se comparan (`code` para codigos de Coreutils)
 */

export const CASOS = [];
