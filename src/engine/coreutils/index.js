/**
 * Barril de comandos. Cada modulo de coreutils se anade aqui y el registro lo
 * recoge automaticamente.
 */

import awk from './awk.js';
import basename from './basename.js';
import bash from './bash.js';
import cat from './cat.js';
import chmod from './chmod.js';
import chown from './chown.js';
import cp from './cp.js';
import cut from './cut.js';
import date from './date.js';
import dirname from './dirname.js';
import echo from './echo.js';
import env from './env.js';
import comandoFalse from './false.js';
import file from './file.js';
import find from './find.js';
import grep from './grep.js';
import head from './head.js';
import hostname from './hostname.js';
import id from './id.js';
import ln from './ln.js';
import ls from './ls.js';
import mkdir from './mkdir.js';
import mv from './mv.js';
import printenv from './printenv.js';
import printf from './printf.js';
import pwd from './pwd.js';
import readlink from './readlink.js';
import realpath from './realpath.js';
import rm from './rm.js';
import rmdir from './rmdir.js';
import sed from './sed.js';
import seq from './seq.js';
import sleep from './sleep.js';
import sort from './sort.js';
import stat from './stat.js';
import tail from './tail.js';
import tar from './tar.js';
import tee from './tee.js';
import test from './test.js';
import touch from './touch.js';
import tr from './tr.js';
import comandoTrue from './true.js';
import uniq from './uniq.js';
import wc from './wc.js';
import which from './which.js';
import whoami from './whoami.js';
import xargs from './xargs.js';
import yes from './yes.js';

export const COMANDOS = [
    awk, bash, basename, cat, chmod, chown, cp, cut, date, dirname, echo, env,
    comandoFalse, file, find, grep, head, hostname, id, ln, ls, mkdir, mv, printenv,
    printf, pwd, readlink, realpath, rm, rmdir, sed, seq, sleep, sort, stat, tail, tar,
    tee, test, touch, tr, comandoTrue, uniq, wc, which, whoami, xargs, yes
];
