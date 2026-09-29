/**
 * date — imprime o interpreta fechas.
 *
 * Verificado contra GNU coreutils 8.32:
 *   date                       -> Sun Feb  1 12:00:00 UTC 2026
 *   date '+%Y-%m-%d'           -> 2026-02-01
 *   date 2026-02-01            -> date: invalid date '2026-02-01'     exit 1
 *   date 2026-02-01 2026-03-01 -> date: extra operand '2026-03-01' + pista, exit 1
 *   date -d '2026-02-30'       -> date: invalid date '2026-02-30'     exit 1
 *   date -d @1769947200        -> 2026-02-01 12:00:00 UTC
 *   date +%Q                   -> %Q   (directiva desconocida, literal)
 *   date +                     -> linea vacia
 *
 * `date` no pone la fecha (lo hace con `-s`, que aqui es opcion desconocida):
 * un operando sin `+` se interpreta como fecha a fijar y por eso sale
 * `invalid date`.
 *
 * Desvios conscientes: sin `-f`, `-r`, `-I`, `--rfc-3339` ni zonas horarias;
 * todo se calcula en UTC porque el reloj del sistema esta congelado.
 */

import { ShellError, EXIT_ERROR } from '../errors.js';

const DIAS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DIAS_LARGOS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MESES_LARGOS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

/** Error de uso con la ayuda corta, tal y como la imprime GNU. */
function usageError(message) {
    return new ShellError(message + "\nTry 'date --help' for more information.", EXIT_ERROR);
}

/** Rellena con ceros a la izquierda. */
function pad2(n) {
    return String(n).padStart(2, '0');
}

/** Dias de un mes de un anio concreto (1-12). */
function diasDelMes(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Indice del dia de la semana del domingo (0) al sabado (6). */
function diaSemana(year, month, day) {
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Semana ISO-8701: par de semana y anio de esa semana. */
function isoWeek(year, month, day) {
    const fecha = new Date(Date.UTC(year, month - 1, day));
    const dia = (fecha.getUTCDay() + 6) % 7;
    fecha.setUTCDate(fecha.getUTCDate() - dia + 3);
    const jueves = new Date(Date.UTC(fecha.getUTCFullYear(), 0, 4));
    const juevesDia = (jueves.getUTCDay() + 6) % 7;
    jueves.setUTCDate(jueves.getUTCDate() - juevesDia + 3);
    const semana = 1 + Math.round((fecha - jueves) / 604800000);
    return { semana, anio: fecha.getUTCFullYear() };
}

/**
 * Interpreta la fecha de `-d`. Solo los formatos que la practica exige:
 * `@epoch`, `AAAA-MM-DD` y `AAAA-MM-DD HH:MM[:SS]` (con `T` o espacio).
 */
function parseDate(text) {
    const at = /^@(-?[0-9]+(?:\.[0-9]+)?)$/.exec(text);
    if (at) {
        const seconds = Math.floor(Number(at[1]));
        if (!Number.isFinite(seconds)) return null;
        return new Date(seconds * 1000);
    }
    const iso = /^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[T ]([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?)?$/.exec(text);
    if (!iso) return null;
    const year = parseInt(iso[1], 10);
    const month = parseInt(iso[2], 10);
    const day = parseInt(iso[3], 10);
    const hour = iso[4] == null ? 0 : parseInt(iso[4], 10);
    const minute = iso[5] == null ? 0 : parseInt(iso[5], 10);
    const second = iso[6] == null ? 0 : parseInt(iso[6], 10);
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > diasDelMes(year, month)) return null;
    if (hour > 23 || minute > 59 || second > 59) return null;
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

/** Traduce un directivo `%X` al texto correspondiente. */
function directive(code, fecha) {
    const year = fecha.getUTCFullYear();
    const month = fecha.getUTCMonth() + 1;
    const day = fecha.getUTCDate();
    const hour = fecha.getUTCHours();
    const minute = fecha.getUTCMinutes();
    const second = fecha.getUTCSeconds();
    const dia = fecha.getUTCDay();
    const yday = Math.floor((fecha - Date.UTC(year, 0, 1)) / 86400000);
    const iso = isoWeek(year, month, day);
    const hora12 = hour % 12 === 0 ? 12 : hour % 12;
    switch (code) {
        case 'a': return DIAS[dia];
        case 'A': return DIAS_LARGOS[dia];
        case 'b': case 'h': return MESES[month - 1];
        case 'B': return MESES_LARGOS[month - 1];
        case 'C': return pad2(Math.floor(year / 100));
        case 'd': return pad2(day);
        case 'D': return pad2(month) + '/' + pad2(day) + '/' + String(year % 100).padStart(2, '0');
        case 'e': return String(day).padStart(2, ' ');
        case 'F': return year + '-' + pad2(month) + '-' + pad2(day);
        case 'g': return String(iso.anio % 100).padStart(2, '0');
        case 'G': return String(iso.anio);
        case 'H': return pad2(hour);
        case 'I': return pad2(hora12);
        case 'j': return String(yday + 1).padStart(3, '0');
        case 'k': return String(hour).padStart(2, ' ');
        case 'l': return String(hora12).padStart(2, ' ');
        case 'm': return pad2(month);
        case 'M': return pad2(minute);
        case 'n': return '\n';
        case 'N': return '000000000';
        case 'p': return hour < 12 ? 'AM' : 'PM';
        case 'P': return hour < 12 ? 'am' : 'pm';
        case 'q': return String(Math.floor((month - 1) / 3) + 1);
        case 'r': return pad2(hora12) + ':' + pad2(minute) + ':' + pad2(second) + ' ' + (hour < 12 ? 'AM' : 'PM');
        case 'R': return pad2(hour) + ':' + pad2(minute);
        case 's': return String(Math.floor(fecha.getTime() / 1000));
        case 'S': return pad2(second);
        case 't': return '\t';
        case 'T': return pad2(hour) + ':' + pad2(minute) + ':' + pad2(second);
        case 'u': return String(dia === 0 ? 7 : dia);
        case 'U': return String(Math.floor((yday + 7 - dia) / 7)).padStart(2, '0');
        case 'w': return String(dia);
        case 'W': return String(Math.floor((yday + 7 - ((dia + 6) % 7)) / 7)).padStart(2, '0');
        case 'x': return pad2(month) + '/' + pad2(day) + '/' + String(year % 100).padStart(2, '0');
        case 'X': return pad2(hour) + ':' + pad2(minute) + ':' + pad2(second);
        case 'y': return String(year % 100).padStart(2, '0');
        case 'Y': return String(year);
        case 'z': return '+0000';
        case 'Z': return 'UTC';
        case 'V': return String(iso.semana).padStart(2, '0');
        default: return null;
    }
}

/** Aplica un formato de strftime con las directivas conocidas. */
function formatDate(format, fecha) {
    let out = '';
    for (let i = 0; i < format.length; i++) {
        const ch = format[i];
        if (ch !== '%') { out += ch; continue; }
        const code = format[i + 1];
        if (code == null) { out += '%'; break; }
        const text = directive(code, fecha);
        if (text == null) { out += '%' + code; i++; continue; }
        out += text;
        i++;
    }
    return out;
}

/** Desempaqueta las opciones. */
function parseOptions(argv) {
    const opts = { format: null, source: null, operands: [] };
    for (let i = 1; i < argv.length; i++) {
        const op = argv[i];
        if (op === '-u' || op === '--utc' || op === '--universal') continue;
        if (op === '--date') {
            if (i + 1 >= argv.length) throw usageError('date: option requires an argument -- d');
            opts.source = argv[++i];
            continue;
        }
        if (op.startsWith('--date=')) { opts.source = op.slice('--date='.length); continue; }
        if (op.startsWith('--')) throw usageError('date: unknown option -- ' + op.slice(2));
        if (op.length > 1 && op[0] === '-') {
            const flags = op.slice(1);
            for (let j = 0; j < flags.length; j++) {
                const flag = flags[j];
                if (flag === 'u') continue;
                if (flag === 'd') {
                    const rest = flags.slice(j + 1);
                    if (rest) opts.source = rest;
                    else if (i + 1 < argv.length) opts.source = argv[++i];
                    else throw usageError('date: option requires an argument -- d');
                    break;
                }
                throw usageError('date: unknown option -- ' + flag);
            }
            continue;
        }
        opts.operands.push(op);
    }
    return opts;
}

export default {
    name: 'date',
    alias: [],
    synopsis: 'date [+FORMATO] [-d FECHA]',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        if (opts.operands.length > 1) {
            throw usageError("date: extra operand '" + opts.operands[1] + "'");
        }
        let format = null;
        if (opts.operands.length === 1) {
            if (opts.operands[0].startsWith('+')) {
                format = opts.operands[0].slice(1);
            } else {
                throw new ShellError("date: invalid date '" + opts.operands[0] + "'", EXIT_ERROR);
            }
        }

        let fecha = new Date(ctx.shell.now * 1000);
        if (opts.source != null) {
            const parsed = parseDate(opts.source);
            if (parsed == null) {
                throw new ShellError("date: invalid date '" + opts.source + "'", EXIT_ERROR);
            }
            fecha = parsed;
        }

        const texto = format == null
            ? formatDate('%a %b %e %H:%M:%S %Z %Y', fecha)
            : formatDate(format, fecha);
        ctx.stdout.write(texto + '\n');
        return 0;
    }
};
