import type { ToolDefinition } from '@omega/core';

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a file, or a range of lines, relative to project root. Use line_offset and line_count to read only the section you need; this keeps context small and saves tokens. Set line_numbers=true before using edit_lines.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        line_numbers: { type: 'boolean', description: 'Prefix each line with its 1-based line number, useful for edit_lines.' },
        line_offset: { type: 'number', description: '1-based starting line to read from. Omit to start at line 1.' },
        line_count: { type: 'number', description: 'Maximum number of lines to read. Omit to read to end of file.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'edit_lines',
    description:
      'Replace a range of lines in an existing file relative to project root. Use when edit_file old_string matching fails. Lines are 1-based and inclusive.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        start_line: { type: 'number', description: '1-based start line to replace (inclusive).' },
        end_line: { type: 'number', description: '1-based end line to replace (inclusive).' },
        new_string: { type: 'string', description: 'Replacement content. Replaces the whole line range.' },
      },
      required: ['path', 'start_line', 'end_line', 'new_string'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a new file relative to project root. Do NOT use this to overwrite an existing file; use edit_file for existing files.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Apply a targeted edit to an existing file relative to project root. Replaces one occurrence of old_string with new_string.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'apply_patch',
    description:
      'Apply a unified diff patch to one or more files relative to project root. Use this for coordinated multi-file changes or when edit_file keeps failing. The patch must use git unified diff format (--- / +++ headers and @@ hunks). New files can be created with --- /dev/null.',
    parameters: {
      type: 'object',
      properties: {
        patch: { type: 'string', description: 'Unified diff patch string.' },
      },
      required: ['patch'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command in the project root.',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
  },
  {
    name: 'list_files',
    description: 'List files and directories at a path relative to the project root. Use this instead of find/ls to explore structure. Skips node_modules, .git, and build dirs.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative directory path. Use "." for project root.' },
        recursive: { type: 'boolean', description: 'If true, list recursively up to 2 levels.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search',
    description: 'Search file contents for a regex pattern. Use this to find where symbols, functions, or terms are used. Skips node_modules, .git, and build dirs.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for (ripgrep syntax).' },
        path: { type: 'string', description: 'Relative directory to search (default: project root).' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'think',
    description: 'Record reasoning.',
    parameters: {
      type: 'object',
      properties: { thought: { type: 'string' } },
      required: ['thought'],
    },
  },
  {
    name: 'finish',
    description: 'Mark the task complete.',
    parameters: {
      type: 'object',
      properties: { summary: { type: 'string' }, success: { type: 'boolean' } },
      required: ['summary', 'success'],
    },
  },
  {
    name: 'publish',
    description: 'Build, validate, and publish the project.',
    parameters: {
      type: 'object',
      properties: { version: { type: 'string' } },
      required: [],
    },
  },
  {
    name: 'lsp_diagnostics',
    description: 'Get language-server diagnostics (type errors, lint issues) for a file. Use after edits to catch type errors quickly.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'lsp_hover',
    description: 'Get type/docs hover at a line/character position from the language server. Use to understand types and signatures before editing.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        line: { type: 'number' },
        character: { type: 'number' },
      },
      required: ['path', 'line', 'character'],
    },
  },
  {
    name: 'lsp_symbol',
    description: 'Search workspace symbols via the language server. Use to find where functions, classes, or types are defined across the project.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'code_overview',
    description: 'Get a structural overview of the project: entry points, main source directories, test files, framework markers, and key exports. Use this at the start of exploration to understand where to wire new features.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative directory path to overview (default: project root).' },
      },
      required: [],
    },
  },
  {
    name: 'verify_api_surface',
    description: 'Verify that public API methods/properties required by the task are exposed. Call this before finish.',
    parameters: {
      type: 'object',
      properties: {
        entry: { type: 'string', description: 'Relative path to the package entry file (e.g., src/index.ts). Defaults to package.json main.' },
        checks: {
          type: 'array',
          description: 'List of API checks to perform. Each check is a JS expression that should evaluate to truthy.',
          items: { type: 'string' },
        },
      },
      required: [],
    },
  },
  {
    name: 'validate_patch',
    description: 'Validate that the current code changes form a clean, applyable patch against the base commit. Call this after making edits and before finish.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];
