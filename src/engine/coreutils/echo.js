/**
 * echo — escribe sus argumentos.
 *
 * Mensajes verificados con GNU coreutils 8.32:
 *   echo: write error: Broken pipe
 *   bash: echo: -n: invalid option
 *
 * `echo -n` no anade salto; `-e` interpreta `\n`, `\t`; `-E` cancela `-e` (que
 * es el comportamiento de bash, no el de /bin/echo de GNU). Sin opciones, echo
 * une sus argumentos con un espacio y anade un salto.
 */

export default {
    name: 'echo',
    alias: [],
    synopsis: 'echo [OPTION]... [STRING]...',
    run(ctx, argv) {
        const args = argv.slice(1);
        let interprete = false;
        let salto = true;
        let corte = 0;

        while (corte < args.length) {
            const a = args[corte];
            if (a === '-n') { salto = false; corte++; continue; }
            if (a === '-e') { interprete = true; corte++; continue; }
            if (a === '-E') { interprete = false; corte++; continue; }
            if (a === '--help') break;
            if (a === '--') { corte++; break; }
            break;
        }

        const texto = args.slice(corte).join(' ');
        ctx.stdout.write((interprete ? escapes(texto) : texto) + (salto ? '\n' : ''));
        return 0;
    }
};

/** `\n`, `\t`, `\0nnn` y `\\`, como hace echo -e de bash. */
function escapes(texto) {
    return texto.replace(/\\(x[0-9a-fA-F]{1,2}|0[0-7]{1,3}|[ntrabfv0\\])/g, (_, seq) => {
        switch (seq) {
            case 'n': return '\n';
            case 't': return '\t';
            case 'r': return '\r';
            case 'a': return '\x07';
            case 'b': return '\b';
            case 'f': return '\f';
            case 'v': return '\v';
            case '0': return '\0';
            case '\\': return '\\';
            default:
                if (seq[0] === 'x') return String.fromCharCode(parseInt(seq.slice(1), 16));
                return String.fromCharCode(parseInt(seq.slice(1), 8));
        }
    });
}
