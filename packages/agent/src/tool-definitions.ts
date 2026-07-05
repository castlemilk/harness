import type { ToolDefinition } from '@omega/core';

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a file relative to project root.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file relative to project root.',
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
    description: 'List files and directories at a path relative to the project root. Use this instead of find/ls to explore structure.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative directory path. Use "." for project root.' },
        recursive: { type: 'boolean', description: 'If true, list recursively up to 3 levels.' },
      },
      required: ['path'],
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
    description: 'Get language-server diagnostics for a file.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'lsp_hover',
    description: 'Get type/docs hover at a position from the language server.',
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
    description: 'Search workspace symbols via the language server.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
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
];
