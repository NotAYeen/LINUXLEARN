/**
 * Codigos de salida y senales de control del motor shell.
 *
 * Los mensajes de error son los REALES de bash y las utilidades GNU, en ingles,
 * porque el alumno los va a encontrar en su terminal de verdad. La interfaz de
 * LinuxLearn va en castellano; el motor habla el idioma del sistema que emula.
 */

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_MISUSE = 2;
export const EXIT_INTERRUPTED = 130;

/** bash: 127 - el comando no existe. */
export const EXIT_NOT_FOUND = 127;
/** bash: 126 - el comando existe pero no se puede ejecutar. */
export const EXIT_NOT_EXECUTABLE = 126;

export class ShellError extends Error {
    constructor(message, code = EXIT_ERROR) {
        super(message);
        this.name = 'ShellError';
        this.code = code;
    }
}

/** `exit N` / `return N`: corta la ejecucion con un codigo de salida. */
export class ExitSignal extends Error {
    constructor(code = EXIT_OK) {
        super('exit ' + code);
        this.name = 'ExitSignal';
        this.code = code;
    }
}

/** Ctrl+C: interrumpe el comando en curso. */
export class InterruptSignal extends Error {
    constructor() {
        super('interrumpido');
        this.name = 'InterruptSignal';
        this.code = EXIT_INTERRUPTED;
    }
}

/** Se agotaron los pasos o el tiempo: casi siempre es un bucle infinito. */
export class BudgetError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BudgetError';
        this.code = EXIT_ERROR;
    }
}
