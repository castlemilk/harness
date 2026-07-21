const CATEGORY_STYLES: Record<string, { label: string; classes: string }> = {
  install_failure: { label: 'install failure', classes: 'bg-amber-100 text-amber-800' },
  dependency_error: { label: 'dependency error', classes: 'bg-amber-100 text-amber-800' },
  build_failure: { label: 'build failure', classes: 'bg-orange-100 text-orange-800' },
  compile_error: { label: 'compile error', classes: 'bg-orange-100 text-orange-800' },
  test_failure: { label: 'test failure', classes: 'bg-red-100 text-red-800' },
  verifier_timeout: { label: 'verifier timeout', classes: 'bg-purple-100 text-purple-800' },
  patch_apply_failed: { label: 'patch apply failed', classes: 'bg-pink-100 text-pink-800' },
  model_error: { label: 'model error', classes: 'bg-blue-100 text-blue-800' },
  timeout: { label: 'timeout', classes: 'bg-yellow-100 text-yellow-800' },
  validation_failure: { label: 'validation failure', classes: 'bg-red-100 text-red-800' },
  tool_misuse: { label: 'tool misuse', classes: 'bg-cyan-100 text-cyan-800' },
  parse_error: { label: 'parse error', classes: 'bg-indigo-100 text-indigo-800' },
  plan_error: { label: 'plan error', classes: 'bg-indigo-100 text-indigo-800' },
  unknown: { label: 'unknown', classes: 'bg-gray-200 text-gray-700' },
};

interface Props {
  category?: string | null;
  title?: string;
}

export function ErrorBadge({ category, title }: Props) {
  if (!category) return null;
  const style = CATEGORY_STYLES[category] ?? CATEGORY_STYLES.unknown;
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${style.classes}`}
      title={title ?? category}
    >
      {style.label}
    </span>
  );
}
