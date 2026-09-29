/**
 * yes — repite una linea indefinidamente.
 *
 * `yes` solo imprime `y`; `yes a b` imprime `a b`. La salida se corta a las
 * 1024 lineas para no colgar el navegador: dentro de una tuberia (`yes | head
 * -5`) el lector se lleva lo que necesita y no se nota el corte.
 *
 * Desvios conscientes: GNU no termina nunca; aqui el comando si acaba.
 */

export default {
    name: 'yes',
    alias: [],
    synopsis: 'yes [TEXTO]...',
    run(ctx, argv) {
        const line = argv.slice(1).join(' ') + '\n';
        let out = '';
        for (let i = 0; i < 1024; i++) out += line;
        ctx.stdout.write(out);
        return 0;
    }
};
