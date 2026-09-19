import { common, createLowlight } from 'lowlight';
import apache from 'highlight.js/lib/languages/apache';
import clojure from 'highlight.js/lib/languages/clojure';
import cmake from 'highlight.js/lib/languages/cmake';
import dart from 'highlight.js/lib/languages/dart';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import elixir from 'highlight.js/lib/languages/elixir';
import erlang from 'highlight.js/lib/languages/erlang';
import gradle from 'highlight.js/lib/languages/gradle';
import groovy from 'highlight.js/lib/languages/groovy';
import haskell from 'highlight.js/lib/languages/haskell';
import http from 'highlight.js/lib/languages/http';
import julia from 'highlight.js/lib/languages/julia';
import latex from 'highlight.js/lib/languages/latex';
import lisp from 'highlight.js/lib/languages/lisp';
import matlab from 'highlight.js/lib/languages/matlab';
import nginx from 'highlight.js/lib/languages/nginx';
import nix from 'highlight.js/lib/languages/nix';
import ocaml from 'highlight.js/lib/languages/ocaml';
import pgsql from 'highlight.js/lib/languages/pgsql';
import powershell from 'highlight.js/lib/languages/powershell';
import properties from 'highlight.js/lib/languages/properties';
import protobuf from 'highlight.js/lib/languages/protobuf';
import scala from 'highlight.js/lib/languages/scala';
import scheme from 'highlight.js/lib/languages/scheme';
import verilog from 'highlight.js/lib/languages/verilog';
import vim from 'highlight.js/lib/languages/vim';
import x86asm from 'highlight.js/lib/languages/x86asm';
import dos from 'highlight.js/lib/languages/dos';

/**
 * 代码高亮用到的语言。highlight.js 一共近两百种，全带上要占启动主包将近 1 MB，
 * 其中一大半体积是 Mathematica、1C、ISBL、GML 这类几乎没人在笔记里写的语言。
 * 这里带上 lowlight 的常用集（37 种：JS / TS / Python / Go / Rust / Java / C 系 / Shell / SQL / YAML / JSON……）
 * 再补一批笔记里确实会出现的。没收录的语言照样能用，只是代码块不着色。
 */
export const lowlight = createLowlight({
  ...common,
  apache, clojure, cmake, dart, dockerfile, dos, elixir, erlang, gradle, groovy, haskell, http, julia, latex, lisp, matlab,
  nginx, nix, ocaml, pgsql, powershell, properties, protobuf, scala, scheme, verilog, vim, x86asm,
});
lowlight.registerAlias({ dockerfile: ['docker'], powershell: ['ps1', 'pwsh'], dos: ['bat', 'cmd'], latex: ['tex'], x86asm: ['asm', 'nasm'], protobuf: ['proto'] });
