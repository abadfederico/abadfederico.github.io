import fs from 'node:fs/promises';
import ts from 'typescript';

export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) {
    if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error;
    for (const ext of ['.ts', '.tsx']) {
      try { return await next(specifier + ext, context); } catch { /* next candidate */ }
    }
    throw error;
  }
}
export async function load(url, context, next) {
  if (!/\.tsx?$/.test(url)) return next(url, context);
  const source = await fs.readFile(new URL(url), 'utf8');
  return { format: 'module', shortCircuit: true, source: ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText };
}
