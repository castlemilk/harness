import type { ToolResult } from './tool-types.js';

export type { ToolResult };
import { applyPatch, validatePatch } from './patch-utils.js';
export { applyPatch, validatePatch };
import { listFiles, searchFiles, codeOverview } from './search-utils.js';
export { listFiles, searchFiles, codeOverview };
import { setLspClients, clearLspClients, lspDiagnostics, lspHover, lspSymbol } from './lsp-utils.js';
export { setLspClients, clearLspClients, lspDiagnostics, lspHover, lspSymbol };
import { pnpmArgs, runCommand } from './run-utils.js';
export { pnpmArgs, runCommand };
import { readFile, writeFile, editFile, editLines, think } from './file-utils.js';
export { readFile, writeFile, editFile, editLines, think };
import { verifyApiSurface } from './verify-utils.js';
export { verifyApiSurface };

function argString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || value === 'boolean') return value.toString();
  return JSON.stringify(value);
}

export async function executeTool(
  projectPath: string,
  name: string,
  arguments_: Record<string, unknown>
): Promise<ToolResult> {
  switch (name) {
    case 'read_file':
      return readFile(
        projectPath,
        argString(arguments_.path),
        Boolean(arguments_.line_numbers),
        arguments_.line_offset === undefined ? undefined : Number(arguments_.line_offset),
        arguments_.line_count === undefined ? undefined : Number(arguments_.line_count)
      );
    case 'write_file':
      return writeFile(projectPath, argString(arguments_.path), argString(arguments_.content));
    case 'edit_file':
      return editFile(
        projectPath,
        argString(arguments_.path),
        argString(arguments_.old_string),
        argString(arguments_.new_string)
      );
    case 'edit_lines':
      return editLines(
        projectPath,
        argString(arguments_.path),
        Number(arguments_.start_line),
        Number(arguments_.end_line),
        argString(arguments_.new_string)
      );
    case 'apply_patch':
      return applyPatch(projectPath, argString(arguments_.patch));
    case 'run_command':
      return runCommand(projectPath, argString(arguments_.command));
    case 'list_files':
      return listFiles(projectPath, argString(arguments_.path), Boolean(arguments_.recursive));
    case 'search':
      return searchFiles(projectPath, argString(arguments_.pattern), argString(arguments_.path) || '.');
    case 'think':
      return think(projectPath, argString(arguments_.thought));
    case 'code_overview':
      return codeOverview(projectPath, argString(arguments_.path) || '.');
    case 'lsp_diagnostics':
      return lspDiagnostics(projectPath, argString(arguments_.path));
    case 'lsp_hover':
      return lspHover(
        projectPath,
        argString(arguments_.path),
        Number(arguments_.line),
        Number(arguments_.character)
      );
    case 'lsp_symbol':
      return lspSymbol(projectPath, argString(arguments_.query));
    case 'verify_api_surface':
      return verifyApiSurface(
        projectPath,
        argString(arguments_.entry),
        Array.isArray(arguments_.checks) ? arguments_.checks.map((c) => argString(c)) : undefined
      );
    case 'validate_patch':
      return validatePatch(projectPath);
    default:
      return { success: false, output: `Unknown tool: ${name}` };
  }
}
